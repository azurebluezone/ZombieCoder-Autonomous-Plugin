// Circuit breaker for agent turns.
//
// A blocked answer is a failure, not a dead end. The same agent retries with
// the failure evidence attached; after the limit the breaker stops and tells
// the user what is missing. There is deliberately no cross-agent fallback:
// handing the task to someone else is how accountability disappears.

export const BREAKER_LIMIT = 3;

export type BreakerFailureKind =
  | "response_gate"
  | "tool_error"
  | "provider_error"
  | "contract_failure"
  | "docs_failure";

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
  /** Agents that failed, oldest first. Usually one; kept for audit compatibility. */
  agents: string[];
  failures: BreakerFailure[];
};

export type BreakerDecision =
  | { action: "retry"; attempt: number; limit: number }
  | { action: "stop"; limit: number; tried: string[] };

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

export function decideBreaker(
  state: BreakerState,
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
  return {
    state: next,
    decision: { action: "retry", attempt: failures.length, limit: cappedLimit },
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

function kindGuidance(kind: BreakerFailureKind): string {
  switch (kind) {
    case "contract_failure":
      return "goal contract-এর observed output আর expected মিলেনি। expected বদলে নয় — আসল output/আচরণ ঠিক করো, অথবা ভিন্ন check দিয়ে নতুন contract খোলো।";
    case "docs_failure":
      return "documentation consistency check fail করেছে। stale claim মুছে code-এর বাস্তব আচরণ লেখো; test চুপ করিয়ে দিও না।";
    default:
      return "প্রমাণ ছাড়া দাবি বা tool error। একই কাজ নিজে শেষ করো; প্রমাণ ছাড়া PASS বলো না।";
  }
}

export function statusMessage(
  failure: BreakerFailure,
  decision: Extract<BreakerDecision, { action: "retry" }>,
): string {
  return [
    `**Circuit breaker:** \`${failure.agent}\` এই attempt-এ আটকে গেছে — ${failure.reason}`,
    "",
    `একই এজেন্ট আবার চেষ্টা করবে (প্রয়াস ${decision.attempt}/${decision.limit})। অন্য এজেন্টে handoff হবে না; কাজ ও দায়িত্ব একই এজেন্টের।`,
    kindGuidance(failure.kind),
  ].join("\n");
}

export function retryPrompt(
  failure: BreakerFailure,
  blockedText: string,
  decision: Extract<BreakerDecision, { action: "retry" }>,
): string {
  return [
    "[zombiecoder circuit breaker]",
    `আগের attempt (\`${failure.agent}\`) প্রমাণ ছাড়া আটকে গেছে: ${failure.reason}`,
    failure.context?.violations?.length
      ? `সমস্যাযুক্ত path: ${failure.context.violations.join(", ")}`
      : "",
    failure.context?.detail ? `failure detail: ${failure.context.detail}` : "",
    "",
    kindGuidance(failure.kind),
    "",
    "আগের উত্তরটি (কাটা):",
    preview(blockedText) || "(খালি)",
    "",
    `তুমি এখনো \`${failure.agent}\`, প্রয়াস ${decision.attempt}/${decision.limit}।`,
    "একই কাজটি নিজে শেষ করো, অন্য কোনো এজেন্টে সরাও না। প্রতিটি দাবির সাথে যাচাইযোগ্য প্রমাণ দাও: `path:line` (ফাইল ও লাইন সত্যিই আছে), test output-এর count, অথবা exit code।",
    "প্রমাণ না থাকলে স্পষ্ট লিখো UNVERIFIED — ভুয়া success দাবি কোরো না।",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function unresolvedMessage(state: BreakerState, limit: number = BREAKER_LIMIT): string {
  const last = state.failures[state.failures.length - 1];
  const agent = last?.agent ? `\`${last.agent}\`` : "(অজানা এজেন্ট)";
  const attempts = Math.max(limit, state.failures.length);
  return [
    "**কাজটি সমাধান হয়নি — circuit breaker খুলে গেছে।**",
    "",
    `${agent} ${attempts} বার চেষ্টা করেছে। কোনো অন্য এজেন্টে দায়িত্ব সরানো হয়নি।`,
    last ? `শেষ failure: ${last.reason}` : "",
    last?.context?.detail ? `শেষ detail: ${last.context.detail}` : "",
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
