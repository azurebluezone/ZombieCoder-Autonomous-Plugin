// Circuit breaker tests: pure decisions first, then the real plugin hook with a
// fake transport. No provider and no invented evidence.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BREAKER_LIMIT,
  breakerContext,
  decideBreaker,
  fallbackPrompt,
  readBreakerState,
  statusMessage,
  unresolvedMessage,
} from "../src/zombie/circuitBreaker.ts";

const ROSTER = [{ id: "manu" }, { id: "jarin" }, { id: "brishti" }, { id: "halim" }];

function failure(agent: string, reason = "claim without evidence") {
  return { agent, kind: "response_gate" as const, reason, at: new Date().toISOString() };
}

test("circuit breaker falls back to the next untried agent and opens after three", () => {
  let state = readBreakerState(undefined, "ses_breaker");

  const first = decideBreaker(state, ROSTER, failure("manu"), BREAKER_LIMIT);
  assert.equal(first.decision.action, "fallback");
  assert.equal(first.decision.action === "fallback" && first.decision.next, "jarin");
  state = first.state;

  const second = decideBreaker(state, ROSTER, failure("jarin"), BREAKER_LIMIT);
  assert.equal(second.decision.action, "fallback");
  assert.equal(second.decision.action === "fallback" && second.decision.next, "brishti");

  const third = decideBreaker(second.state, ROSTER, failure("brishti"), BREAKER_LIMIT);
  assert.equal(third.decision.action, "stop");
  assert.deepEqual(third.state.failures.length, 3);
  assert.deepEqual(third.state.agents, ["manu", "jarin", "brishti"]);

  const final = unresolvedMessage(third.state, BREAKER_LIMIT);
  assert.match(final, /কাজটি সমাধান হয়নি/);
  assert.match(final, /manu.*jarin.*brishti/);
  assert.match(final, /প্রমাণ দিন/);
  assert.match(final, /নতুন নির্দেশ/);
  assert.match(final, /responseGate/);
});

test("circuit breaker never repeats an agent already tried", () => {
  const state = {
    sessionID: "ses_skip",
    agents: ["manu", "jarin"],
    failures: [failure("manu")],
  };
  const { decision } = decideBreaker(state, ROSTER, failure("manu"), 3);
  assert.equal(decision.action, "fallback");
  assert.equal(decision.action === "fallback" && decision.next, "brishti");
});

test("circuit breaker status and fallback prompt carry the failure reason", () => {
  const reason = "file path does not exist inside allowed root: src/ghost.ts";
  const ctx = breakerContext(
    { protocol: "openai-sse", violations: ["src/ghost.ts"], matched: [] },
    "I fixed it in src/ghost.ts:42",
    { model: "opencode/big-pickle" },
  );
  const record = { ...failure("manu", reason), context: ctx };
  const decision = { action: "fallback" as const, next: "jarin", attempt: 1, limit: 3 };

  const status = statusMessage(record, decision);
  assert.match(status, /\bmanu\b/);
  assert.match(status, /\bjarin\b/);
  assert.match(status, /1\/3/);
  assert.match(status, /does not exist/);

  const prompt = fallbackPrompt(record, "I fixed it in src/ghost.ts:42", decision);
  assert.match(prompt, /circuit breaker/);
  assert.match(prompt, /src\/ghost\.ts/);
  assert.match(prompt, /path:line/);
  assert.match(prompt, /UNVERIFIED/);
});

test("an agent outside the roster starts the fallback chain at the first roster slot", () => {
  const state = { sessionID: "ses_build", agents: [], failures: [] };
  const { decision } = decideBreaker(
    state,
    ROSTER,
    failure("build", "claim without evidence"),
    3,
  );
  assert.equal(decision.action, "fallback");
  assert.equal(decision.action === "fallback" && decision.next, "manu");
});
