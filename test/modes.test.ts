import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_MODES,
  BUILTIN_AGENTS,
  MODE_REGISTRY,
  applyModeOverrides,
  isAgentMode,
  modeProtocol,
  planModeSwitch,
} from "../src/zombie/modes.ts";
import { ROSTER, agentMarkdown, agentSystemPrompt } from "../src/roster.ts";

test("the registry contains only OpenCode V2 modes", () => {
  assert.deepEqual([...AGENT_MODES], ["primary", "subagent", "all"]);
  assert.equal(isAgentMode("build"), false, "build is a builtin agent, not a mode");
  assert.equal(isAgentMode("code"), false, "V2 has no agent mode called code");
  assert.equal(isAgentMode("wizard"), false);
});

test("builtin agents are the documented V2 set and never invent scout", () => {
  const ids = BUILTIN_AGENTS.map((agent) => agent.id);
  assert.ok(ids.includes("build"));
  assert.ok(ids.includes("plan"));
  assert.ok(ids.includes("general"));
  assert.ok(ids.includes("explore"));
  assert.ok(!ids.includes("scout"), "V2 has no scout agent");
  for (const id of ["compaction", "title", "summary"]) {
    assert.equal(BUILTIN_AGENTS.find((agent) => agent.id === id)?.hidden, true);
  }
  assert.equal(BUILTIN_AGENTS.find((agent) => agent.id === "general")?.canLaunchSubagents, false);
});

test("planModeSwitch refuses an unknown mode and a subagent-only default agent", () => {
  const unknown = planModeSwitch({ agent: { id: "manu", mode: "all" }, next: "builder" as any });
  assert.equal(unknown.ok, false);
  assert.match(unknown.blocked[0], /unknown mode/);

  const blocked = planModeSwitch({
    agent: { id: "zombiecoder", mode: "all" },
    next: "subagent",
    defaultAgentId: "zombiecoder",
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.blocked[0], /default_agent/);

  const invalidFrom = planModeSwitch({ agent: { id: "manu", mode: "ghost" as any }, next: "all" });
  assert.equal(invalidFrom.ok, false);
});

test("planModeSwitch returns the exact patch and honest warnings", () => {
  const toSubagent = planModeSwitch({
    agent: { id: "jarin", mode: "all" },
    next: "subagent",
    sessionRunning: true,
  });
  assert.equal(toSubagent.ok, true);
  assert.equal(toSubagent.changed, true);
  assert.equal(toSubagent.requiresReload, true);
  assert.equal(toSubagent.patch.mode, "subagent");
  assert.equal(toSubagent.patch.frontmatter, "mode: subagent");
  assert.equal(toSubagent.after.asPrimary, false);
  assert.equal(toSubagent.after.asSubagent, true);
  assert.equal(toSubagent.after.inPicker, false);
  assert.ok(toSubagent.warnings.some((warning) => /picker/.test(warning)));

  const toPrimary = planModeSwitch({ agent: { id: "jarin", mode: "all" }, next: "primary" });
  assert.equal(toPrimary.after.asSubagent, false);
  assert.ok(toPrimary.warnings.some((warning) => /subagent/.test(warning)));

  const same = planModeSwitch({ agent: { id: "manu", mode: "all" }, next: "all" });
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);
  assert.equal(same.requiresReload, false);

  const invalid = planModeSwitch({ agent: { id: "manu", mode: "subagent" }, next: "primary" });
  assert.equal(invalid.ok, true);
  assert.equal(invalid.after.inPicker, true);
});

test("applyModeOverrides switches only valid ids and modes", () => {
  const result = applyModeOverrides(ROSTER, {
    manu: "subagent",
    jarin: "wizard",
    kobir: "all",
    nila: "primary",
  });
  assert.equal(result.applied.manu, "subagent");
  assert.equal(result.applied.nila, "primary");
  assert.equal(result.agents.find((agent) => agent.id === "manu")?.mode, "subagent");
  assert.equal(result.agents.find((agent) => agent.id === "nila")?.mode, "primary");
  assert.equal(result.agents.find((agent) => agent.id === "jarin")?.mode, "all");
  assert.equal(result.rejected.length, 2);
  assert.ok(result.rejected.some((item) => item.agent === "jarin"));
  assert.ok(result.rejected.some((item) => item.agent === "kobir"));
  assert.equal(ROSTER.find((agent) => agent.id === "manu")?.mode, "all", "input roster must not mutate");
});

test("every persona carries the mode protocol and matches its frontmatter", () => {
  for (const agent of ROSTER) {
    const prompt = agentSystemPrompt(agent);
    assert.match(prompt, /Mode protocol \(OpenCode V2\)/);
    assert.match(prompt, new RegExp("current mode: `" + agent.mode + "`"));
    assert.match(prompt, /scout/);
    assert.match(agentMarkdown(agent), new RegExp("^mode: " + agent.mode + "$", "m"));
    assert.ok(MODE_REGISTRY[agent.mode], "agent mode must exist in the registry");
  }
  assert.match(modeProtocol("subagent"), /picker/);
  assert.match(modeProtocol("primary"), /ডাকা যায় না/);
});
