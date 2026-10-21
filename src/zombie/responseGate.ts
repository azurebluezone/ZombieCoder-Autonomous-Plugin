// Response gate — the last line between a model claim and the user.
//
// Structural evidence only: a claim must carry a file path, test result, exit
// code or equivalent artifact inside the allowed project root. The gate cannot
// prove real-world truth, so it must never pretend to. Its guarantee is narrower
// and honest: an unproven claim is replaced by an explicit UNVERIFIED message.
//
// The hook uses the provider protocol only to extract the assistant text and to
// rebuild a valid response. Unsupported protocols are passed through and marked
// NOT_TESTED in the audit log instead of being silently called safe.

import * as path from "node:path";
import { resolveAllowedPath } from "./context.ts";

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
  protocol: "openai-chat" | "openai-sse" | "anthropic" | "responses" | "unknown";
  supported: boolean;
  text: string;
};

const EVIDENCE_PATTERNS: RegExp[] = [
  /\b[\w./\\-]+\.(ts|tsx|js|jsx|py|java|go|rs|php|rb|json|md|css|html|yml|yaml|sh|sql|toml|ini):\d+(?:-\d+)?\b/,
  /\b(?:src|lib|test|tests|__tests__|out|dist|app|components|pages|server|client|docs|tools|tls)\/[\w./\\-]+\b/,
  /\bline[s]?\s+\d+(?:-\d+)?\b/i,
  /\b\d+\s*(?:pass|passed|fail|failed|error|errors|tests?|ok)\b/i,
  /\bexit(?:ed)?\s+(?:with\s+)?(?:code\s+)?\d+\b/i,
  /\b\d+\/\d+\b/,
  /\b(?:npm test|typecheck|integration test|unit test|contract test|live probe|curl\s+-)\b/i,
];

const CLAIM_MARKERS: RegExp[] = [
  /\b(i|we)\s+(fixed|changed|added|removed|updated|implemented|created|deleted|refactored|moved|renamed|replaced|rewrote|wrote|built|installed|configured|enabled|disabled|patched|solved|resolved)\b/i,
  /\b(the|a)\s+(bug|root cause|issue|problem)\s+(is|was|lies|exists)\b/i,
  /\b(root cause|the problem is|the issue is|i found|i discovered|i located)\b/i,
  /\b(cause|caused|causing|breaks|broke|fixes|fixed|patched)\b/i,
  /(?:আমি|আমরা)\s+(?:ঠিক|বদল|যোগ|মুছে|আপডেট|তৈরি|ইনস্টল|কনফিগার|সমাধান|লিখ|শেষ)\S*/,
  /(?:বাগ|সমস্যা|কারণ)\s+(?:হলো|হচ্ছে|এই|ওই)/,
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
  for (const key of ["text", "content", "output_text", "message", "delta"]) {
    if (typeof record[key] === "string") out.push(record[key] as string);
  }
}

export function parseResponseBody(raw: string, contentType = ""): ParsedResponse {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { protocol: "unknown", supported: false, text: "" };

  const looksSse = /text\/event-stream/i.test(contentType) || /^data:/m.test(trimmed);
  if (looksSse) {
    const parts: string[] = [];
    let sawData = false;
    for (const line of trimmed.split(/\r?\n/)) {
      if (!/^data:\s*/.test(line)) continue;
      const data = line.replace(/^data:\s*/, "").trim();
      if (!data || data === "[DONE]") continue;
      sawData = true;
      try {
        collectText(JSON.parse(data), parts);
      } catch {
        parts.push(data);
      }
    }
    return {
      protocol: "openai-sse",
      supported: sawData,
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
      text: parts.join("").trim(),
    };
  } catch {
    return { protocol: "unknown", supported: false, text: trimmed };
  }
}

function pathCandidates(text: string): string[] {
  const pattern =
    /(?:\.{1,2}\/)+[\w./\\-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|php|rb|json|md|css|html|yml|yaml|sh|sql|toml|ini)(?::\d+(?:-\d+)?)?|\b[\w./\\-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|php|rb|json|md|css|html|yml|yaml|sh|sql|toml|ini)(?::\d+(?:-\d+)?)?/g;
  return Array.from(text.matchAll(pattern), (match) => match[0]);
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
  const violations = paths.filter(
    (candidate) => resolveAllowedPath(options.allowedRoot, candidate) === null,
  );
  if (violations.length > 0) {
    return {
      ...base,
      passed: false,
      violations,
      reason: `path outside allowed root: ${violations.join(", ")}`,
    };
  }

  const matched: string[] = [];
  for (const pattern of EVIDENCE_PATTERNS) {
    const match = scannable.match(pattern);
    if (match?.[0]) {
      matched.push(match[0]);
      break;
    }
  }
  if (matched.length > 0) {
    return { ...base, passed: true, matched, reason: `evidence: ${matched[0]}` };
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
    `Model ${originalLength} characters produced করেছে, কিন্তু verifiable evidence নেই —`,
    "কোনো `path:line`, test output, command exit code বা allowed-root file reference পাওয়া যায়নি।",
    "",
    "এই দাবিটির status: `UNVERIFIED`। প্রমাণ চাইলে বলুন: `path:line দেখাও`, `test output দাও`, বা `কোন command চালিয়েছো?`",
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
  } else if (Array.isArray(body?.content)) {
    body.content = [{ type: "text", text: truth }];
  } else if (Array.isArray(body?.output)) {
    body.output = [{ type: "message", content: [{ type: "output_text", text: truth }] }];
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
