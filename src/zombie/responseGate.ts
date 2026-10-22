// Response gate — the last line between a model claim and the user.
//
// Structural evidence only: a claim must carry a file path, test result, exit
// code or equivalent artifact inside the allowed project root. The gate cannot
// prove real-world truth, so it must never pretend to. Its guarantee is narrower
// and honest: an unproven claim is replaced by an explicit UNVERIFIED message
// that stops the agent and gives the user a clear next step.
//
// The hook uses the provider protocol only to extract the assistant text and to
// rebuild a valid response. Unsupported protocols are passed through and marked
// NOT_TESTED in the audit log instead of being silently called safe.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_MIN_RESPONSE_LENGTH = 40;

export type ResponseVerdict = {
  passed: boolean;
  supported: boolean;
  matched: string[];
  violations: string[];
  reason: string;
  truth: string;
};

export type ParsedResponse = {
  protocol:
    | "openai-chat"
    | "openai-sse"
    | "anthropic"
    | "anthropic-sse"
    | "responses"
    | "responses-sse"
    | "unknown";
  supported: boolean;
  /** True when this payload carries a tool/function call instead of a final answer. */
  toolCalls: boolean;
  text: string;
};

const EVIDENCE_PATTERNS: RegExp[] = [
  // Test output with a count: "78/78 pass", "tests 78", "0 fail".
  /\b\d+\s*\/\s*\d+\s*(?:tests?|cases?|pass(?:ed|es)?|fail(?:ed|s)?|ok)\b/i,
  /\btests?\s*(?:[:=]\s*|\s+)\d+\b/i,
  /\b\d+\s+tests?\s+(?:pass(?:ed|es)?|fail(?:ed|s)?)\b/i,
  /\b\d+\s+(?:pass(?:ed|es)?|fail(?:ed|ures?)?|errors?)\b/i,
  // Exit status has to say "code"/"status" or use assignment form.
  /\bexit(?:ed)?[\s_-]*(?:with\s+)?(?:code|status)\s*[:=]?\s*\d+\b/i,
  /\bexit[_=]\s*\d+\b/i,
  // A test command only counts when the same breath carries its result.
  /(?:npm test|npm run (?:typecheck|test)|pytest|go test|cargo test|node --test)[^\n]{0,120}\b(?:pass(?:ed|es)?|fail(?:ed|s)?|ok|clean|exit(?:ed)?)\b/i,
];

const CLAIM_MARKERS: RegExp[] = [
  // A one-word success report is still a claim. "OK" remains a conversational
  // acknowledgement; "installed", "fixed", "done" need evidence in the text.
  /^(?:ভাইয়া[\s,:-]*)?(?:done|fixed|installed|configured|updated|created|added|removed|solved|completed|complete|success|passed|deployed|committed|pushed)\b/i,
  /\b(i|we)\s+(fixed|changed|added|removed|updated|implemented|created|deleted|refactored|moved|renamed|replaced|rewrote|wrote|built|installed|configured|enabled|disabled|patched|solved|resolved)\b/i,
  /\b(the|a)\s+(bug|root cause|issue|problem)\s+(is|was|lies|exists)\b/i,
  /\b(root cause|the problem is|the issue is|i found|i discovered|i located)\b/i,
  /\b(cause|caused|causing|breaks|broke|fixes|fixed|patched)\b/i,
  /(?:আমি|আমরা)\s+(?:ঠিক|বদল|যোগ|মুছে|আপডেট|তৈরি|ইনস্টল|কনফিগার|সমাধান|লিখ|শেষ)\S*/,
  /(?:বাগ|সমস্যা|কারণ)\s+(?:হলো|হচ্ছে|এই|ওই)/,
  /(?:সব|সবকিছু)\s+(?:ঠিক|ভালো|ঠিকঠাক|কাজ\s+করছে)/,
  /(?:ফিক্স|ঠিক|সমাধান|শেষ|পাস|ইনস্টল|কনফিগার|আপডেট|তৈরি|বদল|যোগ|মুছে)\S*\s*(?:করেছি|করে\s+ফেলেছি|হয়ে\s+গেছে|হয়েছে|সম্পন্ন\s+হয়েছে)/,
  /(?:টেস্ট|বিল্ড|কাজ|সেটআপ)\S*\s*(?:পাস\s+করেছে|শেষ\s+হয়েছে|সম্পন্ন\s+হয়েছে|সফল\s+হয়েছে)/,
  /\b(?:everything|all)\s+(?:works?|is\s+fixed|is\s+done|is\s+ready)\b/i,
];

const TRUTH_PATTERNS: RegExp[] = [
  /প্রমাণ নেই/,
  /প্রমাণ ছাড়া/,
  /নিশ্চিত না/,
  /জানি না/,
  /এই তথ্য বর্তমানে SSOT এ নেই/,
  /\bUNVERIFIED\b/,
  /\bNOT_TESTED\b/,
  /\bunable to verify\b|\bno verified answer\b|\bno proof\b|\bno evidence\b|\bcan'?t verify\b|\bcannot verify\b|\bdon'?t know\b/i,
];

function collectText(value: unknown, out: string[], depth = 0): void {
  if (depth > 10 || value === null || value === undefined) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;

  if (Array.isArray(record.choices)) {
    for (const choice of record.choices) {
      if (!choice || typeof choice !== "object") continue;
      const c = choice as Record<string, unknown>;
      collectText(c.message, out, depth + 1);
      collectText(c.delta, out, depth + 1);
      if (typeof c.text === "string") out.push(c.text);
    }
    return;
  }
  if (Array.isArray(record.content)) {
    collectText(record.content, out, depth + 1);
    return;
  }
  if (Array.isArray(record.output)) {
    collectText(record.output, out, depth + 1);
    return;
  }
  if (Array.isArray(record.parts)) {
    collectText(record.parts, out, depth + 1);
    return;
  }
  if (record.tool_calls || record.function_call) return;
  if (record.delta && typeof record.delta === "object") collectText(record.delta, out, depth + 1);
  for (const key of ["text", "content", "output_text", "message", "delta"]) {
    if (typeof record[key] === "string") out.push(record[key] as string);
  }
}

// A tool/function call means the model is still working, not answering the user.
// Gating such a turn rewrote finish_reason to "stop" and killed the tool chain,
// so detection has to run before any verdict is produced.
function detectToolCalls(value: unknown, depth = 0): boolean {
  if (depth > 10 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => detectToolCalls(item, depth + 1));
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) return true;
  if (record.function_call && typeof record.function_call === "object") return true;
  if (record.type === "tool_use" || record.type === "function_call") return true;
  if (record.stop_reason === "tool_use" || record.stop_reason === "tool_calls") return true;
  if (
    typeof record.type === "string" &&
    /^response\.(?:output_item\.added|function_call_arguments\.)/.test(record.type) &&
    (record.item as Record<string, unknown> | undefined)?.type === "function_call"
  ) {
    return true;
  }
  if (/^response\.function_call_arguments\./.test(String(record.type ?? ""))) return true;

  // Only structural keys are walked: message content strings are prose, and a
  // mention of "function_call" inside them is not a real call.
  for (const key of ["choices", "delta", "message", "content", "content_block", "output", "item"]) {
    if (record[key] !== undefined && detectToolCalls(record[key], depth + 1)) return true;
  }
  return false;
}

export function parseResponseBody(raw: string, contentType = ""): ParsedResponse {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return { protocol: "unknown", supported: false, toolCalls: false, text: "" };
  }

  const looksSse = /text\/event-stream/i.test(contentType) || /^data:/m.test(trimmed);
  if (looksSse) {
    const parts: string[] = [];
    let sawData = false;
    let sawAnthropic = false;
    let sawResponses = false;
    let toolCalls = false;
    for (const line of trimmed.split(/\r?\n/)) {
      if (!/^data:\s*/.test(line)) continue;
      const data = line.replace(/^data:\s*/, "").trim();
      if (!data || data === "[DONE]") continue;
      sawData = true;
      if (/"type"\s*:\s*"(?:message_start|message_delta|message_stop|content_block_start|content_block_delta|content_block_stop)"/.test(data)) {
        sawAnthropic = true;
      }
      if (/"type"\s*:\s*"response\./.test(data)) sawResponses = true;
      try {
        const chunk = JSON.parse(data);
        if (detectToolCalls(chunk)) toolCalls = true;
        collectText(chunk, parts);
      } catch {
        parts.push(data);
      }
    }
    const protocol = sawAnthropic ? "anthropic-sse" : sawResponses ? "responses-sse" : "openai-sse";
    return {
      protocol,
      supported: protocol === "openai-sse" && sawData,
      toolCalls,
      text: parts.join("").trim(),
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as any;
    const parts: string[] = [];
    collectText(parsed, parts);
    const protocol =
      Array.isArray(parsed?.choices) && parsed.choices.length > 0
        ? "openai-chat"
        : Array.isArray(parsed?.output)
          ? "responses"
          : Array.isArray(parsed?.content) && parsed?.type
            ? "anthropic"
            : "unknown";
    return {
      protocol,
      supported: protocol !== "unknown",
      toolCalls: detectToolCalls(parsed),
      text: parts.join("").trim(),
    };
  } catch {
    return { protocol: "unknown", supported: false, toolCalls: false, text: trimmed };
  }
}

const PATH_EXTENSIONS = "ts|tsx|js|jsx|py|java|go|rs|php|rb|json|md|css|html|yml|yaml|sh|sql|toml|ini";

function pathCandidates(text: string): string[] {
  // Absolute ("/tmp/x.json"), home ("~/x.json"), relative ("a/b.ts") and parent
  // ("../x.ts") citations are all evidence candidates. The lookbehind keeps
  // matches from starting mid-word or mid-path.
  const pattern = new RegExp(
    `(?<![\\w.\\/-:])(?:~\\/|\\.{1,2}\\/|\\/)?[\\w.\\/-]+\\.(?:${PATH_EXTENSIONS})(?![\\w])(?::\\d+(?:-\\d+)?)?`,
    "g",
  );
  // Extension-less files (/etc/hostname) are real evidence too, but only when
  // the citation carries an explicit line. Without `:line` an absolute path is
  // too close to an API route to treat as a file reference.
  const bareAbsolute = /(?<![\w.\/-:])(?:~\/|\/)[\w.\/-]+:\d+(?:-\d+)?/g;
  const out = new Set<string>();
  for (const match of text.matchAll(pattern)) out.add(match[0]);
  for (const match of text.matchAll(bareAbsolute)) out.add(match[0]);
  return [...out];
}

export type PathResolution =
  | { status: "ok"; file: string; exact: boolean }
  | { status: "missing" };

const BASENAME_INDEX_TTL_MS = 30_000;
const BASENAME_INDEX_MAX_FILES = 50_000;
const BASENAME_INDEX_MAX_DEPTH = 10;
const BASENAME_INDEX_SKIP = new Set([
  ".git",
  "node_modules",
  ".zombiecoder",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "out",
  "build",
  "vendor",
  "coverage",
  "target",
  "__pycache__",
]);

const basenameIndexCache = new Map<string, { at: number; files: Set<string> }>();

// Root-relative first, then the places OpenCode itself keeps config and data.
// The gate verifies that cited evidence exists, it does not sandbox the agent.
function globalSearchRoots(): string[] {
  const home = os.homedir();
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return [
    path.join(configHome, "opencode"),
    path.join(home, ".opencode"),
    path.join(dataHome, "opencode"),
  ];
}

// A final answer often names a file the way a human would ("edit.blade.php")
// without its directory. Blocking that as "outside the allowed root" was a false
// positive, so a bare basename is resolved against a bounded, cached index of
// the project and of the OpenCode config/data roots.
function basenameIndex(root: string): Set<string> {
  const cached = basenameIndexCache.get(root);
  const now = Date.now();
  if (cached && now - cached.at < BASENAME_INDEX_TTL_MS) return cached.files;

  const files = new Set<string>();
  let seen = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > BASENAME_INDEX_MAX_DEPTH || seen >= BASENAME_INDEX_MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen++ >= BASENAME_INDEX_MAX_FILES) return;
      if (entry.isDirectory()) {
        if (!BASENAME_INDEX_SKIP.has(entry.name)) walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        files.add(entry.name);
      }
    }
  };
  walk(root, 0);
  basenameIndexCache.set(root, { at: now, files });
  return files;
}

export function resolveEvidencePath(
  root: string,
  candidate: string,
  extraRoots: string[] = globalSearchRoots(),
): PathResolution {
  const cleaned = String(candidate ?? "")
    .trim()
    .replace(/:\d+(?:-\d+)?$/, "")
    .replace(/[),.;]+$/, "");
  if (!cleaned) return { status: "missing" };
  // A remote URL is a reference, not local evidence.
  if (/^https?:\/\//i.test(cleaned)) return { status: "missing" };

  let target = cleaned;
  if (target === "~") target = os.homedir();
  else if (target.startsWith("~/")) target = path.join(os.homedir(), target.slice(2));

  const normalized = target.replace(/\\/g, "/");
  const roots = [root, ...extraRoots.filter((entry) => entry && entry !== root)];

  if (path.isAbsolute(target)) {
    if (fs.existsSync(target)) return { status: "ok", file: target, exact: true };
    return { status: "missing" };
  }

  // The agent may read any file, so a citation outside the working directory is
  // still evidence when the file exists. Project root wins, then the OpenCode
  // config/data roots (global config, global install, data dir).
  for (const base of roots) {
    const resolved = path.resolve(base, target);
    if (fs.existsSync(resolved)) {
      return { status: "ok", file: resolved, exact: base === root };
    }
  }

  // A bare basename is only looked up in the project (bounded index); extra
  // roots are matched by their real relative path, never scanned.
  if (!normalized.includes("/") && basenameIndex(root).has(normalized)) {
    return { status: "ok", file: path.join(root, normalized), exact: false };
  }
  return { status: "missing" };
}

const MAX_LINE_CHECK_BYTES = 2 * 1024 * 1024;

// "path:line" is only evidence if the line exists. Checking it stops a shape-only
// citation like "src/plugin.ts:99999" from passing as proof.
function countFileLines(file: string): number | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_LINE_CHECK_BYTES) return null;
    const text = fs.readFileSync(file, "utf8");
    if (!text) return 0;
    const lines = text.split("\n").length;
    return text.endsWith("\n") ? lines - 1 : lines;
  } catch {
    return null;
  }
}

function validLineCitation(file: string, start: number, end: number): boolean {
  const total = countFileLines(file);
  // Binary/oversized/unreadable files: existence is all that can be checked.
  if (total === null) return true;
  return start >= 1 && end >= start && end <= total;
}

export function evaluateResponse(
  text: string,
  options: { allowedRoot: string; minLength?: number },
): ResponseVerdict {
  const trimmed = String(text ?? "").trim();
  const minLength = options.minLength ?? DEFAULT_MIN_RESPONSE_LENGTH;
  const truth = truthMessage(trimmed.length);
  const base = { supported: true, matched: [] as string[], violations: [] as string[], truth };

  if (trimmed.length < minLength) {
    // A short sentence can still be a false success claim ("সব ঠিক আছে").
    // The trivial bypass applies only when no claim marker is present.
    const shortClaim = CLAIM_MARKERS.some((pattern) => pattern.test(trimmed));
    const shortEvidence =
      EVIDENCE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
      pathCandidates(trimmed).some((candidate) => {
        const lineMatch = candidate.match(/:(\d+)(?:-(\d+))?$/);
        if (!lineMatch) return false;
        const resolution = resolveEvidencePath(options.allowedRoot, candidate);
        if (resolution.status !== "ok") return false;
        const start = Number(lineMatch[1]);
        const end = lineMatch[2] ? Number(lineMatch[2]) : start;
        return validLineCitation(resolution.file, start, end);
      });
    if (shortClaim && !shortEvidence) {
      return {
        ...base,
        passed: false,
        reason: `short claim without evidence (${trimmed.length} chars < min ${minLength})`,
      };
    }
    return {
      ...base,
      passed: true,
      reason: `trivial (${trimmed.length} chars < min ${minLength})`,
    };
  }
  if (TRUTH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { ...base, passed: true, reason: "agent stated lack of proof" };
  }

  // URLs are references, not local file evidence. Remove them before path and
  // evidence checks so a remote link cannot satisfy the allowlist.
  const scannable = trimmed.replace(/https?:\/\/[^\s)]+/gi, " ");

  const paths = pathCandidates(scannable);
  const resolvedPaths = paths.map((candidate) => ({
    candidate,
    resolution: resolveEvidencePath(options.allowedRoot, candidate),
  }));
  // A path-shaped reference must resolve to a real file. Otherwise
  // "src/ghost.ts:42" would satisfy the gate by shape alone. The file may live
  // anywhere the agent can read: the working directory, the OpenCode config
  // root or an absolute path.
  const existingPaths = resolvedPaths
    .filter((entry) => entry.resolution.status === "ok")
    .map((entry) => entry.candidate);
  if (paths.length > 0 && existingPaths.length === 0) {
    return {
      ...base,
      passed: false,
      reason: `file path does not exist: ${paths.slice(0, 3).join(", ")}`,
    };
  }

  // Strong evidence first: a cited path:line whose file and line both exist.
  const matched: string[] = [];
  const invalidLines: string[] = [];
  for (const { candidate, resolution } of resolvedPaths) {
    if (resolution.status !== "ok") continue;
    const lineMatch = candidate.match(/:(\d+)(?:-(\d+))?$/);
    if (!lineMatch) continue;
    const start = Number(lineMatch[1]);
    const end = lineMatch[2] ? Number(lineMatch[2]) : start;
    const total = countFileLines(resolution.file);
    if (total === null) {
      // Binary/oversized file: existence is all that can be checked.
      matched.push(candidate);
      continue;
    }
    if (start >= 1 && end >= start && end <= total) matched.push(candidate);
    else invalidLines.push(`${candidate} (file has ${total} lines)`);
  }

  // Then test output and exit status. A bare file path, a bare "line 177" or a
  // bare "5/10" is a reference, not proof, and must not satisfy the gate.
  if (matched.length === 0) {
    for (const pattern of EVIDENCE_PATTERNS) {
      const hit = scannable.match(pattern);
      if (hit?.[0]) {
        matched.push(hit[0]);
        break;
      }
    }
  }
  if (matched.length > 0) {
    return { ...base, passed: true, matched, reason: `evidence: ${matched[0]}` };
  }

  if (invalidLines.length > 0) {
    return {
      ...base,
      passed: false,
      reason: `line out of range: ${invalidLines.slice(0, 3).join(", ")}`,
    };
  }

  if (CLAIM_MARKERS.some((pattern) => pattern.test(trimmed))) {
    return {
      ...base,
      passed: false,
      reason: "claim without evidence: no file ref, test output or exit code found",
    };
  }

  return { ...base, passed: true, reason: "explanatory/conversational (no claim markers)" };
}

export function truthMessage(originalLength: number): string {
  return [
    "**প্রমাণ ছাড়া উত্তর আটকে দেওয়া হয়েছে (response without proof)**",
    "",
    "এআই মডেলটি উত্তর প্রস্তুত করলেও প্রজেক্টের নিয়ম অনুযায়ী কোনো যাচাইযোগ্য প্রমাণ (Verifiable Evidence) প্রদান করতে ব্যর্থ হয়েছে। এতে কোনো নির্দিষ্ট ফাইল রেফারেন্স (`path:line`), টেস্ট আউটপুট বা exit code যুক্ত ছিল না। ZombieCoder গাইডলাইন অনুযায়ী, যাচাইহীন দাবি সরাসরি ব্যবহারকারীকে প্রদর্শন করা নিষিদ্ধ। তাই উক্ত উত্তরের স্ট্যাটাস চিহ্নিত করা হয়েছে `UNVERIFIED` হিসেবে।",
    "",
    `Model ${originalLength} characters produced করেছে, কিন্তু verifiable evidence নেই।`,
    "",
    "**এই turn-এ এজেন্টকে থামানো হয়েছে।** প্রমাণ ছাড়া সে নিজে থেকে আর এগোবে না; অনুমান দিয়ে উত্তর পূরণ করা হবে না।",
    "",
    "**ভাইয়া, কাজ তো এই সমস্যা হয়েছে — এখন কী করব?**",
    "",
    "আপনি একটি পথ বেছে নিন:",
    "1. **প্রমাণ দিন** — `path:line`, test output, exit code বা কোড কোটেশন। আমি সেটা যাচাই করে আবার উত্তর দেব।",
    "2. **শুধু ব্যাখ্যা চান** — লিখুন: `evidence ছাড়া ব্যাখ্যা করো`। উত্তর `UNVERIFIED` লেবেল নিয়ে আসবে, success/PASS দাবি ছাড়া।",
    "3. **নতুন নির্দেশ দিন** — নতুন session বা সংশ্লিষ্ট agent দিয়ে শুরু করুন; আগের অনুমানকে সত্য ধরে নেওয়া হবে না।",
    "",
    "সংক্ষেপে: প্রমাণ আছে তো? থাকলে দিন, নাহলে `UNVERIFIED` লেবেলেই থাকব।",
  ].join("\n");
}

function sseBody(truth: string): string {
  const base = {
    id: "zombiecoder-response-gate",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "zombiecoder-response-gate",
  };
  const first = {
    ...base,
    choices: [{ index: 0, delta: { role: "assistant", content: truth }, finish_reason: null }],
  };
  const last = {
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  return `data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`;
}

function rewriteJson(raw: string, truth: string): string | null {
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(body?.choices) && body.choices[0]) {
    const choice = body.choices[0];
    if (choice.message && typeof choice.message === "object") choice.message.content = truth;
    else if (choice.delta && typeof choice.delta === "object") choice.delta.content = truth;
    else choice.text = truth;
    // A replaced answer is terminal: never leave finish_reason as tool_calls or
    // length, or the client may keep the stopped turn alive.
    choice.finish_reason = "stop";
  } else if (Array.isArray(body?.content)) {
    body.content = [{ type: "text", text: truth }];
    body.stop_reason = "end_turn";
    body.stop_sequence = null;
  } else if (Array.isArray(body?.output)) {
    body.output = [{ type: "message", content: [{ type: "output_text", text: truth }] }];
    body.status = "completed";
    delete body.incomplete_details;
  } else {
    return null;
  }
  return JSON.stringify(body);
}

export async function applyResponseGate(
  response: Response,
  options: { allowedRoot: string; minLength?: number },
): Promise<{ response: Response; verdict: ResponseVerdict; parsed: ParsedResponse }> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.clone().text();
  const parsed = parseResponseBody(raw, contentType);
  if (!parsed.supported) {
    return {
      response,
      parsed,
      verdict: {
        passed: true,
        supported: false,
        matched: [],
        violations: [],
        reason: `unsupported protocol (${parsed.protocol}); marked NOT_TESTED`,
        truth: truthMessage(parsed.text.length),
      },
    };
  }

  // Intermediate tool-call turn: the agent is still working, so there is no
  // user-facing claim to gate yet. Blocking it replaced finish_reason with
  // "stop" and terminated the tool chain mid-task.
  if (parsed.toolCalls) {
    return {
      response,
      parsed,
      verdict: {
        passed: true,
        supported: true,
        matched: [],
        violations: [],
        reason: "tool-call turn (intermediate); not user-facing, gate skipped",
        truth: truthMessage(parsed.text.length),
      },
    };
  }

  const verdict = evaluateResponse(parsed.text, options);
  if (verdict.passed) return { response, verdict, parsed };

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");

  if (parsed.protocol === "openai-sse") {
    headers.set("content-type", "text/event-stream; charset=utf-8");
    return {
      response: new Response(sseBody(verdict.truth), { status: response.status, headers }),
      verdict,
      parsed,
    };
  }

  if (parsed.protocol === "openai-chat" || parsed.protocol === "anthropic" || parsed.protocol === "responses") {
    const body = rewriteJson(raw, verdict.truth);
    if (body !== null) {
      headers.set("content-type", "application/json; charset=utf-8");
      return {
        response: new Response(body, { status: response.status, headers }),
        verdict,
        parsed,
      };
    }
  }

  headers.set("content-type", "text/plain; charset=utf-8");
  return {
    response: new Response(verdict.truth, { status: response.status, headers }),
    verdict,
    parsed,
  };
}
