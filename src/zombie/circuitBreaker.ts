// Circuit breaker for agent turns.
//
// A blocked answer is a failure, not a dead end. Each failure is recorded with
// its reason and the context it left behind, the session is handed to the next
// roster agent, and after three failed agents the breaker opens with a message
// the user can act on. Nothing here invents evidence: the fallback prompt asks
// for proof, and the final message says plainly that the task is unresolved.

export const BREAKER_LIMIT = 3;

export type BreakerFailureKind = "response_gate" | "tool_error" | "provider_error";

export type BreakerContext = {
  model?: string;
  protocol?: string;
  violations?: string[];
  matched?: string[];
  blockedChars?: number;
  blockedPreview?: string;
  detail?: string;
};

export type BreakerFailure = {
  agent: string;
  kind: BreakerFailureKind;
  reason: string;
  at: string;
  context?: BreakerContext;
};

export type BreakerState = {
  sessionID: string;
  /** Agents already tried, oldest first. */
  agents: string[];
  failures: BreakerFailure[];
};

export type BreakerDecision =
  | { action: "fallback"; next: string; attempt: number; limit: number }
  | { action: "stop"; limit: number; tried: string[] };

export type RosterEntry = { id: string };

const PREVIEW_LIMIT = 240;

function preview(text: string): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LIMIT ? `${flat.slice(0, PREVIEW_LIMIT)}…` : flat;
}

export function readBreakerState(raw: unknown, sessionID: string): BreakerState {
  const value = raw as Partial<BreakerState> | undefined;
  const failures = Array.isArray(value?.failures)
    ? value!.failures.filter((item): item is BreakerFailure => Boolean(item && typeof item === "object"))
    : [];
  const agents = Array.isArray(value?.agents)
    ? value!.agents.filter((item): item is string => typeof item === "string")
    : [];
  return { sessionID, agents, failures };
}

// Walk the roster forward from the current agent, skipping anyone already tried.
// Wrapping keeps the chain predictable: manu -> jarin -> brishti -> ...
export function nextUntriedAgent(
  roster: readonly RosterEntry[],
  current: string,
  tried: readonly string[],
): string | undefined {
  if (roster.length === 0) return undefined;
  const done = new Set(tried);
  const start = roster.findIndex((agent) => agent.id === current);
  // An agent outside the roster (e.g. built-in "build") starts the chain at the
  // first roster slot instead of silently skipping it.
  const base = start < 0 ? -1 : start;
  for (let step = 1; step <= roster.length; step++) {
    const candidate = roster[(base + step) % roster.length];
    if (!done.has(candidate.id)) return candidate.id;
  }
  return undefined;
}

export function decideBreaker(
  state: BreakerState,
  roster: readonly RosterEntry[],
  failure: BreakerFailure,
  limit: number = BREAKER_LIMIT,
): { state: BreakerState; decision: BreakerDecision } {
  const agents = state.agents.includes(failure.agent)
    ? [...state.agents]
    : [...state.agents, failure.agent];
  const failures = [...state.failures, failure];
  const next: BreakerState = { sessionID: state.sessionID, agents, failures };
  const cappedLimit = Math.max(1, limit);

  if (failures.length >= cappedLimit) {
    return { state: next, decision: { action: "stop", limit: cappedLimit, tried: agents } };
  }
  const candidate = nextUntriedAgent(roster, failure.agent, agents);
  if (!candidate) {
    return { state: next, decision: { action: "stop", limit: cappedLimit, tried: agents } };
  }
  return {
    state: next,
    decision: { action: "fallback", next: candidate, attempt: failures.length, limit: cappedLimit },
  };
}

export function breakerContext(
  verdict: { protocol?: string; violations?: string[]; matched?: string[] },
  text: string,
  extra: { model?: string; detail?: string } = {},
): BreakerContext {
  return {
    model: extra.model,
    protocol: verdict.protocol,
    violations: verdict.violations?.slice(0, 5),
    matched: verdict.matched?.slice(0, 5),
    blockedChars: text.length,
    blockedPreview: preview(text),
    detail: extra.detail,
  };
}

export function statusMessage(
  failure: BreakerFailure,
  decision: Extract<BreakerDecision, { action: "fallback" }>,
): string {
  return [
    `**Circuit breaker:** \`${failure.agent}\` এই turn-এ আটকে গেছে — ${failure.reason}`,
    "",
    `ফলব্যাক: \`${decision.next}\` (প্রয়াস ${decision.attempt}/${decision.limit})। কাজ থেমে যায়নি, পরের এজেন্ট একই কাজ প্রমাণসহ শেষ করবে।`,
  ].join("\n");
}

export function fallbackPrompt(
  failure: BreakerFailure,
  blockedText: string,
  decision: Extract<BreakerDecision, { action: "fallback" }>,
): string {
  return [
    "[zombiecoder circuit breaker]",
    `আগের attempt (\`${failure.agent}\`) প্রমাণ ছাড়া আটকে গেছে: ${failure.reason}`,
    failure.context?.violations?.length
      ? `সমস্যাযুক্ত path: ${failure.context.violations.join(", ")}`
      : "",
    "",
    "আগের উত্তরটি (কাটা):",
    preview(blockedText) || "(খালি)",
    "",
    `তুমি এখন \`${decision.next}\`, প্রয়াস ${decision.attempt}/${decision.limit}।`,
    "একই কাজটি শেষ করো, কিন্তু প্রতিটি দাবির সাথে যাচাইযোগ্য প্রমাণ দাও: `path:line` (ফাইল ও লাইন সত্যিই আছে), test output-এর count, অথবা exit code।",
    "প্রমাণ না থাকলে স্পষ্ট লিখো UNVERIFIED — ভুয়া success দাবি কোরো না।",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function unresolvedMessage(state: BreakerState, limit: number = BREAKER_LIMIT): string {
  const tried = state.agents.length > 0 ? state.agents.map((agent) => `\`${agent}\``).join(" → ") : "(কেউ না)";
  const last = state.failures[state.failures.length - 1];
  return [
    "**কাজটি সমাধান হয়নি — circuit breaker খুলে গেছে।**",
    "",
    `${Math.max(limit, state.failures.length)}টি এজেন্ট চেষ্টা করেছে: ${tried}।`,
    last ? `শেষ failure: \`${last.agent}\` — ${last.reason}` : "",
    "",
    "**ভাইয়া, এখন কী করবেন:**",
    "1. **প্রমাণ দিন** — `path:line`, test output বা exit code; আমি সেটা দিয়ে আবার চালাব।",
    "2. **কাজটা ছোট করুন** — এক ফাইল/এক behavior-এ ভাগ করুন, যাতে প্রতিটি ধাপ যাচাই করা যায়।",
    "3. **নতুন নির্দেশ দিন** — নতুন session-এ শুরু করুন; আগের অনুমান সত্য ধরে নেওয়া হবে না।",
    "4. **Gate বন্ধ করে diagnosis** — config-এ `\"responseGate\": false` দিন, শুধু ত্রুটি খুঁজতে; success দাবি তখনো প্রমাণ ছাড়া নয়।",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
