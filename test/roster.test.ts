// The merge point has to answer one question: whichever agent is running, does
// it carry the ZombieCoder persona exactly once? Roster agents already do (the
// generated markdown embeds it); builtin OpenCode runners do not.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ROSTER,
  SHARED_EXECUTION,
  SHARED_PERSONA,
  SHARED_RULES,
  agentMarkdown,
  mergeAgentPersona,
} from "../src/roster.ts";

test("mergeAgentPersona gives every builtin runner the full shared persona", () => {
  for (const id of ["build", "plan", "general", "explore"]) {
    const persona = mergeAgentPersona(id);
    assert.equal(persona.kind, "shared", `${id} must get the shared persona`);
    assert.match(persona.text, new RegExp(`builtin runner: ${id}`));
    assert.ok(persona.text.includes(SHARED_RULES), `${id}: shared rules missing`);
    assert.ok(persona.text.includes(SHARED_EXECUTION), `${id}: execution doctrine missing`);
    assert.equal(persona.bytes, Buffer.byteLength(persona.text, "utf8"));
    assert.ok(persona.bytes > 5000, `${id}: persona should be the full block`);
  }
  assert.equal(mergeAgentPersona("my-custom-agent").kind, "shared");
});

test("roster agents are not duplicated; hidden builtins get nothing", () => {
  for (const agent of ROSTER) {
    const persona = mergeAgentPersona(agent.id);
    assert.equal(persona.kind, "roster", `${agent.id}: roster markdown already has the rules`);
    assert.equal(persona.text, "");
    assert.equal(persona.bytes, 0);
  }
  for (const id of ["title", "summary", "compaction", "unknown", "", "   "]) {
    const persona = mergeAgentPersona(id);
    assert.equal(persona.kind, "none", `${JSON.stringify(id)} must stay on the short contract`);
    assert.equal(persona.bytes, 0);
  }
});

test("the roster markdown embeds the shared rules exactly once", () => {
  const markdown = agentMarkdown(ROSTER[0]);
  assert.ok(markdown.includes(SHARED_RULES));
  assert.equal(
    markdown.split("ZombieCoder Shared Rules").length - 1,
    1,
    "the shared block must not be duplicated in a roster prompt",
  );
  assert.ok(SHARED_PERSONA.startsWith(SHARED_RULES));
});

test("shared rules carry assembly, precision, runtime-gap and escalation duties", () => {
  assert.match(SHARED_PERSONA, /Assembly first, not invention/);
  assert.match(SHARED_PERSONA, /Precise input/);
  assert.match(SHARED_PERSONA, /Focus on the work/);
  assert.match(SHARED_PERSONA, /websearch/);
  assert.match(SHARED_PERSONA, /append_syllabus/);
  assert.match(SHARED_PERSONA, /skill_catalog/);
  assert.match(SHARED_PERSONA, /circuit breaker/);
  assert.match(SHARED_PERSONA, /goal_contract.*FAIL/);
  assert.match(SHARED_PERSONA, /user-কে সরাসরি বলো/);
  assert.match(SHARED_PERSONA, /মিথ্যা বলা অন্যায়/);
  assert.match(SHARED_PERSONA, /No mock, no demo, no watermark/);
});
