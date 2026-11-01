// Circuit breaker tests: pure decisions first, then the real plugin hook with a
// fake transport. No provider and no invented evidence.

import test from "node:test";
import assert from "node:assert/strict";
import {
  BREAKER_LIMIT,
  breakerContext,
  decideBreaker,
  readBreakerState,
  retryPrompt,
  statusMessage,
  unresolvedMessage,
} from "../src/zombie/circuitBreaker.ts";

function failure(agent: string, reason = "claim without evidence") {
  return { agent, kind: "response_gate" as const, reason, at: new Date().toISOString() };
}

test("the same agent retries, then the breaker stops after three failures", () => {
  let state = readBreakerState(undefined, "ses_breaker");

  const first = decideBreaker(state, failure("manu"), BREAKER_LIMIT);
  assert.equal(first.decision.action, "retry");
  assert.equal(first.decision.action === "retry" && first.decision.attempt, 1);
  state = first.state;

  const second = decideBreaker(state, failure("manu"), BREAKER_LIMIT);
  assert.equal(second.decision.action, "retry");
  assert.equal(second.decision.action === "retry" && second.decision.attempt, 2);

  const third = decideBreaker(second.state, failure("manu"), BREAKER_LIMIT);
  assert.equal(third.decision.action, "stop");
  assert.equal(third.state.failures.length, 3);
  assert.deepEqual(third.state.agents, ["manu"]);

  const final = unresolvedMessage(third.state, BREAKER_LIMIT);
  assert.match(final, /কাজটি সমাধান হয়নি/);
  assert.match(final, /\bmanu\b/);
  assert.match(final, /দায়িত্ব সরানো হয়নি/);
  assert.match(final, /প্রমাণ দিন/);
  assert.match(final, /নতুন নির্দেশ/);
  assert.match(final, /responseGate/);
});

test("the breaker never hands the task to a different agent", () => {
  const state = {
    sessionID: "ses_skip",
    agents: ["manu"],
    failures: [failure("manu")],
  };
  const { decision } = decideBreaker(state, failure("manu"), 3);
  assert.equal(decision.action, "retry");
  assert.equal(decision.action === "retry" && decision.attempt, 2);
});

test("breaker status and retry prompt carry the failure evidence", () => {
  const reason = "file path does not exist inside allowed root: src/ghost.ts";
  const ctx = breakerContext(
    { protocol: "openai-sse", violations: ["src/ghost.ts"], matched: [] },
    "I fixed it in src/ghost.ts:42",
    { model: "opencode/big-pickle" },
  );
  const record = { ...failure("manu", reason), context: ctx };
  const decision = { action: "retry" as const, attempt: 1, limit: 3 };

  const status = statusMessage(record, decision);
  assert.match(status, /\bmanu\b/);
  assert.match(status, /1\/3/);
  assert.match(status, /does not exist/);
  assert.match(status, /handoff হবে না/);

  const prompt = retryPrompt(record, "I fixed it in src/ghost.ts:42", decision);
  assert.match(prompt, /circuit breaker/);
  assert.match(prompt, /\bmanu\b/);
  assert.match(prompt, /src\/ghost\.ts/);
  assert.match(prompt, /path:line/);
  assert.match(prompt, /UNVERIFIED/);
  assert.match(prompt, /অন্য কোনো এজেন্টে সরাও না/);
});

test("contract and documentation failures use the same-agent breaker", () => {
  let state = readBreakerState(undefined, "ses_contract");
  const contractFailure = {
    agent: "halim",
    kind: "contract_failure" as const,
    reason: "observed output does not match expected (contains)",
    at: new Date().toISOString(),
    context: { detail: "contract=gc-x status=FAIL check=bash verify.sh exit=1" },
  };

  const first = decideBreaker(state, contractFailure, BREAKER_LIMIT);
  assert.equal(first.decision.action, "retry");
  state = first.state;
  const second = decideBreaker(state, { ...contractFailure, kind: "docs_failure" as const, reason: "DOCS_FAIL stale handoff" }, BREAKER_LIMIT);
  assert.equal(second.decision.action, "retry");
  state = second.state;
  const third = decideBreaker(state, contractFailure, BREAKER_LIMIT);
  assert.equal(third.decision.action, "stop");
  assert.deepEqual(third.state.agents, ["halim"], "one agent owns every failure kind");

  const status = statusMessage(contractFailure, { action: "retry", attempt: 1, limit: 3 });
  assert.match(status, /expected বদলে নয়/);
  assert.match(status, /handoff হবে না/);

  const prompt = retryPrompt(contractFailure, "FAIL", { action: "retry", attempt: 1, limit: 3 });
  assert.match(prompt, /contract=gc-x/);
  assert.match(prompt, /expected বদলে নয়/);

  const docsStatus = statusMessage(
    { ...contractFailure, kind: "docs_failure", reason: "DOCS_FAIL stale handoff" },
    { action: "retry", attempt: 2, limit: 3 },
  );
  assert.match(docsStatus, /documentation consistency/);
});
