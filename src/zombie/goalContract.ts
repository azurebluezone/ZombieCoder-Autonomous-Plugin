// Goal contract verification.
//
// `open` pre-registers the outcome. `close` must verify that outcome against a
// real command run, not against the agent's own claim. This module holds the
// pure pieces: parse the recorded contract, run the check command, and match
// the observed output with the declared mode.

import { spawn } from "node:child_process";

export type MatchMode = "contains" | "equals" | "regex" | "json";

export type GoalContractFields = {
  goal: string;
  input: string;
  expected: string;
  check: string;
  pass: string;
  match: MatchMode;
};

export type CheckResult = {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
};

const MATCH_MODES: MatchMode[] = ["contains", "equals", "regex", "json"];

export function normalizeMatch(value: unknown): MatchMode {
  const mode = String(value ?? "").trim().toLowerCase();
  return (MATCH_MODES as string[]).includes(mode) ? (mode as MatchMode) : "contains";
}

/** Compile-time validation so a broken contract fails at open, not at close. */
export function validateExpected(expected: string, mode: MatchMode): string | null {
  const value = String(expected ?? "").trim();
  if (!value) return "expected must not be empty";
  if (mode === "regex") {
    try {
      new RegExp(value);
    } catch (error: any) {
      return `expected is not a valid regex: ${String(error?.message ?? error)}`;
    }
  }
  if (mode === "json") {
    try {
      JSON.parse(value);
    } catch {
      return "expected must be valid JSON for match=json";
    }
  }
  if (!MATCH_MODES.includes(mode)) {
    return `match must be one of: ${MATCH_MODES.join(", ")}`;
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read the open block for `id` from the append-only syllabus. The result block
 * has the same id plus "— result", so the heading must match exactly.
 */
export function parseContract(syllabus: string, id: string): GoalContractFields | null {
  const text = String(syllabus ?? "");
  const key = String(id ?? "").trim();
  if (!key) return null;
  const heading = new RegExp(`^### Goal Contract ${escapeRegex(key)}[ \\t]*$`, "m");
  const match = heading.exec(text);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const next = text.indexOf("\n### ", start + match[0].length);
  const block = text.slice(start, next < 0 ? undefined : next);
  const field = (name: string): string => {
    const line = new RegExp(`^- ${name}: (.*)$`, "m").exec(block);
    if (!line) return "";
    return line[1].replace(/^`+|`+$/g, "").trim();
  };
  return {
    goal: field("goal"),
    input: field("input"),
    expected: field("expected"),
    check: field("check"),
    pass: field("pass"),
    match: normalizeMatch(field("match")),
  };
}

export type OpenContract = {
  /** Contract id returned by open. */
  id: string;
  /** What the user asked for, as recorded at open. */
  goal: string;
  /** Session that opened it (older contracts have no session line). */
  session: string;
};

/**
 * Contracts opened in a session whose result block is still missing. The
 * syllabus is the ledger: open appends a block, close appends `<id> — result`.
 * Anything else (a chat claim, an agent's memory) is not evidence.
 */
export function openContracts(syllabus: string, sessionID?: string): OpenContract[] {
  const wanted = String(sessionID ?? "").trim();
  const text = String(syllabus ?? "");
  const blocks: Array<{ id: string; result: boolean; fields: Record<string, string> }> = [];
  let current: (typeof blocks)[number] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^### Goal Contract (gc-[A-Za-z0-9]+)( — result)?[ \t]*$/.exec(line);
    if (heading) {
      if (current) blocks.push(current);
      current = { id: heading[1], result: Boolean(heading[2]), fields: {} };
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const field = /^- ([a-z]+): (.*)$/.exec(line);
    if (field) current.fields[field[1]] = field[2].replace(/^`+|`+$/g, "").trim();
  }
  if (current) blocks.push(current);
  const closed = new Set(blocks.filter((block) => block.result).map((block) => block.id));
  return blocks
    .filter((block) => !block.result && !closed.has(block.id))
    .filter((block) => block.fields.status === "open")
    .filter((block) => !wanted || block.fields.session === wanted)
    .map((block) => ({
      id: block.id,
      goal: block.fields.goal ?? "",
      session: block.fields.session ?? "",
    }));
}

/** First JSON object/array in the text, balanced and string-aware. */
export function extractJson(text: string): string | null {
  const value = String(text ?? "");
  const start = value.search(/[[{]/);
  if (start < 0) return null;
  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

function canon(value: any): any {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
    return out;
  }
  return value;
}

/** Compare the real output with the pre-registered expectation. */
export function matches(observed: string, expected: string, mode: MatchMode): boolean {
  const out = String(observed ?? "");
  const want = String(expected ?? "");
  switch (mode) {
    case "equals":
      return out.trim() === want.trim();
    case "regex":
      try {
        return new RegExp(want, "m").test(out);
      } catch {
        return false;
      }
    case "json": {
      const extracted = extractJson(out);
      if (!extracted) return false;
      try {
        return JSON.stringify(canon(JSON.parse(extracted))) === JSON.stringify(canon(JSON.parse(want)));
      } catch {
        return false;
      }
    }
    case "contains":
    default:
      return out.includes(want);
  }
}

/**
 * Run the recorded check command in the project root. The agent's own
 * "observed/exitCode" claim is never used for the verdict.
 */
export function runCheck(
  cwd: string,
  command: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<CheckResult> {
  const timeoutMs = Math.max(1, Number(options.timeoutMs ?? 120_000));
  const maxBytes = Math.max(1, Number(options.maxBytes ?? 64 * 1024));
  const commandText = String(command ?? "").trim();
  if (!commandText) {
    return Promise.resolve({
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: "check command is empty",
    });
  }
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    // Detached on POSIX so a timeout can kill the whole process group; killing
    // only the shell leaves the real command running.
    const child = spawn(commandText, {
      cwd,
      shell: true,
      env: process.env,
      detached: process.platform !== "win32",
    });
    const finish = (exitCode: number | null, signal: string | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut, error });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString();
    });
    child.on("error", (error: Error) => finish(null, null, error.message));
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      finish(code, signal ?? null);
    });
  });
}
