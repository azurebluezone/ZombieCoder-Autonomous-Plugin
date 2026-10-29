import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  setup,
  detectInstallLayout,
  providerConfiguredOnDisk,
  persistProviderUrl,
  syncProviderBaseUrl,
} from "../src/plugin.ts";

// Tests must not inherit the developer's installed originUrl. The setup tests
// exercise local model plans, not a live origin handshake.
process.env.ZOMBIECODER_ORIGIN_URL = "off";

type Fake = ReturnType<typeof makeContext>;

const DEFAULT_TEST_MODELS = [
  {
    providerID: "opencode",
    modelID: "big-pickle",
    cost: [{ input: 0, output: 0 }],
    status: "active",
    capabilities: { tools: true },
    enabled: true,
  },
];

function makeContext(root: string, options: { models?: any[] } = {}) {
  const catalog = options.models ?? DEFAULT_TEST_MODELS;
  const tools: any[] = [];
  const skills: any[] = [];
  const hooks: string[] = [];
  const toolHooks: Record<string, (event: any) => any> = {};
  const sessionHooks: Record<string, (event: any) => any> = {};
  const agentSwitches: Array<{ sessionID: string; agent: string }> = [];
  const modelSwitches: Array<{ sessionID: string; model: any }> = [];
  const switchState = { fail: false, failModel: false };
  const synthetics: Array<{ sessionID: string; text: string; description?: string }> = [];
  const prompts: Array<{ sessionID: string; text: string; delivery?: string }> = [];
  const storage = new Map<string, unknown>();
  const sessionLocations = new Map<string, string>();
  const deferred = (fn: () => void) => setTimeout(fn, 5);
  const registration = { dispose: async () => undefined };
  const ctx = {
    location: { directory: root },
    provider: { list: async () => ({ data: [] }) },
    model: {
      list: async () => ({ data: catalog }),
      default: async () => ({ data: { providerID: "opencode", modelID: "big-pickle" } }),
    },
    agent: {
      reload: async () => undefined,
      transform: async (cb: (editor: any) => void) => {
        deferred(() => cb({ get: () => undefined, list: () => [], update: () => undefined }));
        return registration;
      },
    },
    skill: {
      reload: async () => undefined,
      transform: async (cb: (editor: any) => void) => {
        deferred(() => cb({ list: () => skills, add: (skill: any) => skills.push(skill) }));
        return registration;
      },
    },
    tool: {
      reload: async () => undefined,
      hook: async (name: string, fn: (event: any) => any) => {
        hooks.push(name);
        toolHooks[name] = fn;
        return registration;
      },
      transform: async (cb: (editor: any) => void) => {
        deferred(() =>
          cb({
            namespace: () => undefined,
            list: () => tools,
            add: (tool: any) => tools.push(tool),
          }),
        );
        return registration;
      },
    },
    rpc: { register: async () => ({ ...registration, events: { emit: async () => undefined } }) },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
    session: {
      get: async (input: { sessionID: string }) => ({
        location: { directory: sessionLocations.get(input.sessionID) ?? root },
      }),
      hook: async (name: string, fn: (event: any) => any) => {
        hooks.push(name);
        sessionHooks[name] = fn;
        return registration;
      },
      switchAgent: async (input: { sessionID: string; agent: string }) => {
        if (switchState.fail) throw new Error("agent not found");
        agentSwitches.push(input);
      },
      switchModel: async (input: { sessionID: string; model: any }) => {
        if (switchState.failModel) throw new Error("model not found");
        modelSwitches.push(input);
      },
      synthetic: async (input: { sessionID: string; text: string; description?: string }) => {
        synthetics.push(input);
      },
      prompt: async (input: { sessionID: string; text: string; delivery?: string }) => {
        prompts.push(input);
      },
    },
  };
  return {
    ctx,
    tools,
    skills,
    hooks,
    toolHooks,
    sessionHooks,
    agentSwitches,
    modelSwitches,
    synthetics,
    prompts,
    storage,
    switchState,
    sessionLocations,
  };
}

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-test-"));
}

test("setup scaffolds .zombiecoder, writes agent markdown, and registers doors", async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.mkdirSync(path.join(root, ".opencode", "zombiecoder", "skills"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".environment"),
    "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL=\n",
  );
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "config.json"),
    JSON.stringify({
      version: "0.0.0-test",
      customProviderUrl: "",
      customProviderID: "missionbarisal",
      mcpUrl: "",
      opencodeApiUrl: "",
      ssotRefreshMs: 300000,
      modelStrategy: "auto",
    }),
  );
  fs.writeFileSync(
    path.join(root, ".opencode", "zombiecoder", "skills", "sample.md"),
    "---\nid: sample\nname: Sample\ndescription: Sample skill\n---\nUse evidence.\n",
  );

  const fake: Fake = makeContext(root);
  const cleanup = await setup(fake.ctx);
  await new Promise((resolve) => setTimeout(resolve, 60));

  for (const file of ["SSOT.md", "syllabus.md"]) {
    assert.ok(fs.existsSync(path.join(root, ".zombiecoder", file)), `${file} missing`);
  }
  for (const file of ["models.json", "fingerprint.json", "footprint.jsonl", "mcp.json"]) {
    assert.ok(!fs.existsSync(path.join(root, ".zombiecoder", file)), `${file} must not be created in the project`);
  }
  assert.ok(fs.existsSync(path.join(root, ".zombiecoder", ".state", "setup-report.json")), "setup report missing");
  assert.ok(fs.existsSync(path.join(root, ".zombiecoder", "memory")), "memory dir missing");
  assert.ok(fs.existsSync(path.join(root, ".zombiecoder", "memory", "index.json")), "memory index missing");

  const agents = fs.readdirSync(path.join(root, ".opencode", "agents"));
  assert.equal(agents.length, 9);
  assert.ok(agents.includes("zombiecoder.md"), "renamed agent markdown missing");
  assert.ok(!agents.includes("kobir.md"), "old agent markdown must not survive the rename");
  const manu = fs.readFileSync(path.join(root, ".opencode", "agents", "manu.md"), "utf8");
  assert.doesNotMatch(manu, /^model:/m, "pins are off by default: markdown must not pin a model");
  assert.match(manu, /ZombieCoder Shared Rules/);
  assert.match(manu, /Cross-Domain Baseline/);
  assert.match(manu, /ভাইয়া/);
  assert.match(manu, /মিথ্যে বলা অপরাধ/);
  assert.match(manu, /UI\/UX/);
  assert.match(manu, /MCP/);
  assert.match(manu, /LSP/);
  assert.match(manu, /SAP/);
  assert.match(manu, /Dependency minimalism/);
  assert.match(manu, /^permissions:$/m);
  assert.match(manu, /Mode protocol \(OpenCode V2\)/);
  assert.match(manu, /current mode: `all`/);
  assert.match(manu, /V2-তে `scout` নেই/);
  assert.match(manu, /নিজের mode নিজে বদলাতে পারো না/);
  // The provider is a third party: owner PII from identity.ts must never ride
  // along in an agent prompt or config. The persona travels, the person does not.
  for (const secret of [
    "Sahon Srabon",
    "+880 1323-626282",
    "infi@zombiecoder.my.id",
    "235 South Pirarbag",
  ]) {
    assert.ok(!manu.includes(secret), `agent markdown leaked identity field: ${secret}`);
  }

  // V2 config is the second agent door: provider, agents, models, permissions.
  const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
  for (const secret of [
    "Sahon Srabon",
    "+880 1323-626282",
    "infi@zombiecoder.my.id",
    "235 South Pirarbag",
  ]) {
    assert.ok(
      !JSON.stringify(config.agents).includes(secret),
      `agent config leaked identity field: ${secret}`,
    );
  }
  // Our plugin must not decorate provider requests with its own identity
  // headers. The model provider sees the bearer token OpenCode already sends,
  // nothing added by ZombieCoder.
  const modelRequest = fake.sessionHooks["model.request"];
  assert.equal(typeof modelRequest, "function", "model.request hook was not registered");
  const requestEvent = {
    sessionID: "ses_headers",
    agent: "manu",
    model: { providerID: "opencode", id: "big-pickle" },
    kind: "primary",
    headers: { authorization: "Bearer test" } as Record<string, string>,
  };
  await modelRequest(requestEvent);
  assert.deepEqual(requestEvent.headers, { authorization: "Bearer test" });
  assert.ok(
    !Object.keys(requestEvent.headers).some((key) => /zombie/i.test(key)),
    "provider request must not carry a ZombieCoder identity header",
  );

  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.equal(config.agents.zombiecoder.mode, "all");
  // Pins off (default): no agent model, one root default. A /models choice still
  // wins for the session, and subagents inherit it.
  assert.equal(config.agents.zombiecoder.model, undefined);
  assert.equal(config.model, "opencode/big-pickle");
  assert.equal(config.agents.manu.mode, "all");
  for (const agent of Object.values(config.agents) as any[]) {
    assert.equal(agent.mode, "all", "every agent must be a main agent, not a subagent");
    assert.ok(
      Array.isArray(agent.permissions) &&
        agent.permissions.some((rule: any) => rule.action === "subagent" && rule.effect === "allow"),
      "every agent must be allowed to delegate",
    );
  }
  assert.ok(Array.isArray(config.agents.manu.permissions));
  assert.equal(config.agents.kobir, undefined);
  assert.ok(config.permissions.some((rule: any) => rule.action === "shell" && rule.effect === "ask"));

  const syllabus = fs.readFileSync(path.join(root, ".zombiecoder", "syllabus.md"), "utf8");
  assert.match(syllabus, /## 2\. Footprint \(auto-discovered\)/);
  assert.match(syllabus, /### Project map \(directory → key files\)/);
  assert.match(syllabus, /Do not create a separate footprint file/);

  const ssot = fs.readFileSync(path.join(root, ".zombiecoder", "SSOT.md"), "utf8");
  assert.match(ssot, /## 7\. Agent team \(shared persona\)/);
  assert.match(ssot, /## 8\. Shared operating rules/);
  assert.match(ssot, /## 9\. Cross-domain baseline/);
  assert.doesNotMatch(ssot, /^## .*Model plan/m);
  assert.doesNotMatch(ssot, /^## .*MCP/m);

  assert.equal(fake.tools.length, 13);
  assert.ok(fake.tools.every((tool) => tool.output), "every tool must declare an output schema");
  assert.ok(fake.tools.some((tool) => tool.name === "memory_archive"));
  assert.ok(fake.tools.some((tool) => tool.name === "evidence_gate"), "evidence_gate tool missing");
  assert.ok(fake.tools.some((tool) => tool.name === "verify_real"), "verify_real tool missing");
  assert.ok(fake.tools.some((tool) => tool.name === "goal_contract"), "goal_contract tool missing");
  assert.ok(fake.tools.some((tool) => tool.name === "syntax_check"), "syntax_check tool missing");
  assert.ok(fake.tools.some((tool) => tool.name === "skill_catalog"), "skill_catalog tool missing");
  const modesTool = fake.tools.find((tool) => tool.name === "agent_modes");
  assert.ok(modesTool, "agent_modes tool missing");
  const modesOutput = (await modesTool.execute({ agent: "manu", next: "subagent" })).output;
  assert.equal(modesOutput.agent.mode, "all");
  assert.equal(modesOutput.plan.ok, true);
  assert.equal(modesOutput.plan.patch.mode, "subagent");
  assert.equal(modesOutput.plan.after.asPrimary, false);
  assert.ok(modesOutput.builtins.some((builtin: any) => builtin.id === "explore"));
  assert.deepEqual(
    modesOutput.modes.map((mode: any) => mode.id),
    ["primary", "subagent", "all"],
  );
  const contextTool = fake.tools.find((tool) => tool.name === "context_status");
  assert.ok(contextTool, "context_status tool missing");
  const contextOutput = (await contextTool.execute({ agent: "manu" })).output;
  assert.equal(contextOutput.allowedRoot, root);
  assert.match(contextOutput.uiLine, /Context: SSOT OK \(manu\) \| Syllabus OK \(halim\)/);
  assert.ok(contextOutput.packBytes > 0, "context pack must not be empty");
  const setupReport = JSON.parse(
    fs.readFileSync(path.join(root, ".zombiecoder", ".state", "setup-report.json"), "utf8"),
  );
  assert.equal(setupReport.outputs.modelStrategy, "free-fallback");
  assert.equal(
    setupReport.steps.find((item: any) => item.step === "memory-index")?.ok,
    true,
  );
  assert.ok(fake.hooks.includes("http.response"), "http.response gate hook missing");
  assert.ok(fake.hooks.includes("context"), "context hook missing");
  const fingerprintTool = fake.tools.find((tool) => tool.name === "project_fingerprint");
  assert.ok(fingerprintTool, "project_fingerprint tool missing");
  const fingerprintOutput = (await fingerprintTool.execute({})).output;
  assert.equal(fingerprintOutput.root, root);
  assert.ok(Array.isArray(fingerprintOutput.files));
  assert.ok(!fs.existsSync(path.join(root, ".zombiecoder", "fingerprint.json")));

  const gateTool = fake.tools.find((tool) => tool.name === "evidence_gate");
  assert.ok(gateTool, "evidence_gate tool missing");
  const claimFile = path.join(root, "claim.json");
  fs.writeFileSync(
    claimFile,
    JSON.stringify({ claim: "The file exists.", evidence: [] }),
  );
  const claimResult = (await gateTool.execute({ file: claimFile, kind: "claim" })).output;
  assert.equal(claimResult.status, "FAIL");
  assert.equal(claimResult.usable, false);
  assert.ok(claimResult.missing.includes("evidence_is_nonempty_array"));

  const verifyTool = fake.tools.find((tool) => tool.name === "verify_real");
  assert.ok(verifyTool, "verify_real tool missing");
  const realInput = path.join(root, "real-input.txt");
  fs.writeFileSync(realInput, "real user data\n");
  const realArtifact = path.join(root, ".zombiecoder", "verify", "run.log");
  fs.mkdirSync(path.dirname(realArtifact), { recursive: true });
  fs.writeFileSync(realArtifact, "processed 1 record\n");
  const verified = (await verifyTool.execute({
    input: realInput,
    artifact: realArtifact,
    command: "cat src/real-input.txt",
    origin: "real_run",
  })).output;
  assert.equal(verified.status, "PASS");
  assert.equal(verified.evidence.origin, "real_run");
  assert.ok(fs.existsSync(verified.recordFile), "verify_real must write a provenance record");

  const missingInput = (await verifyTool.execute({
    input: path.join(root, "src", "ghost.txt"),
    artifact: realArtifact,
  })).output;
  assert.equal(missingInput.status, "NOT_TESTED");
  assert.equal(missingInput.evidence, null);

  const mockInput = path.join(root, "mocks", "payment.mock.ts");
  fs.mkdirSync(path.dirname(mockInput), { recursive: true });
  fs.writeFileSync(mockInput, "// mock\n");
  const standIn = (await verifyTool.execute({
    input: mockInput,
    artifact: realArtifact,
  })).output;
  assert.equal(standIn.status, "NOT_TESTED");
  assert.match(standIn.reason, /stand-in/);

  const goalTool = fake.tools.find((tool) => tool.name === "goal_contract");
  assert.ok(goalTool, "goal_contract tool missing");
  await assert.rejects(
    () =>
      goalTool.execute({
        action: "open",
        goal: "checkout",
        input: "src/real-input.txt",
        expected: "tests pass",
        check: "npm test",
        pass: "green",
      }),
    /observable outcome/,
    "a test status is not an expected outcome",
  );
  await assert.rejects(
    () =>
      goalTool.execute({
        action: "open",
        goal: "checkout",
        input: "src/real-input.txt",
        expected: "not-json",
        check: "node check-order.mjs",
        pass: "json",
        match: "json",
      }),
    /valid JSON/,
    "match=json must reject an invalid expectation at open",
  );

  // The contract's check is a real command; close runs it. The agent's own
  // observed/exitCode is a claim and must never decide PASS.
  fs.writeFileSync(
    path.join(root, "check-order.mjs"),
    'console.log(JSON.stringify({ id: 7, total: 42 }));\n',
  );

  const opened = (await goalTool.execute(
    {
      action: "open",
      goal: "checkout returns an order id",
      input: "check-order.mjs",
      expected: '{"id":7,"total":42}',
      check: "node check-order.mjs",
      pass: "exit 0 and the exact JSON body",
      match: "json",
    },
    { sessionID: "ses_goal" },
  )).output;
  assert.equal(opened.status, "open");
  assert.equal(opened.uiShown, true, "the preview must be pushed to the session UI");
  assert.match(opened.preview, /তুমি চাইছ/);
  assert.match(opened.preview, /\{"id":7,"total":42\}/);
  assert.match(opened.preview, /মিলানোর নিয়ম: json/);
  assert.doesNotMatch(opened.preview, /বাজেট|budget/i, "no time/budget line in the preview");
  const previewCard = fake.synthetics.find(
    (entry) => entry.description === "goal contract preview",
  );
  assert.ok(previewCard, "goal_contract open must show a synthetic preview card");
  assert.match(previewCard.text, /👍 দেখে নাও/);
  assert.match(previewCard.text, /✋ ভুল মনে হলে/);
  assert.doesNotMatch(previewCard.text, /"হ্যাঁ"/, "no confirmation word is requested");
  const syllabusAfterOpen = fs.readFileSync(path.join(root, ".zombiecoder", "syllabus.md"), "utf8");
  assert.match(syllabusAfterOpen, new RegExp(`Goal Contract ${opened.id}`));
  assert.match(syllabusAfterOpen, /expected: \{"id":7,"total":42\}/);
  assert.match(syllabusAfterOpen, /- match: json/);

  // A lying claim (observed 500, exitCode 1) is recorded but ignored.
  const closed = (await goalTool.execute(
    {
      action: "close",
      id: opened.id,
      observed: "HTTP 500 it broke",
      exitCode: 1,
    },
    { sessionID: "ses_goal" },
  )).output;
  assert.equal(closed.status, "PASS", "the real check output wins over the agent claim");
  assert.equal(closed.exitCode, 0);
  assert.match(closed.observed, /"id":7/);
  assert.equal(closed.uiShown, true, "the result must be pushed to the session UI");
  const resultCard = fake.synthetics.find(
    (entry) => entry.description === "goal contract result",
  );
  assert.ok(resultCard, "goal_contract close must show a synthetic result card");
  assert.match(resultCard.text, /PASS/);
  const syllabusAfterClose = fs.readFileSync(path.join(root, ".zombiecoder", "syllabus.md"), "utf8");
  assert.match(syllabusAfterClose, /claimExitCode: 1/);
  assert.match(syllabusAfterClose, /- exitCode: 0/);

  // The real output must match the recorded expectation, not the agent's word.
  const mismatch = (await goalTool.execute(
    {
      action: "open",
      goal: "checkout returns order 999",
      input: "check-order.mjs",
      expected: '{"id":999,"total":0}',
      check: "node check-order.mjs",
      pass: "order 999",
      match: "json",
    },
    { sessionID: "ses_goal" },
  )).output;
  const mismatchClose = (await goalTool.execute({
    action: "close",
    id: mismatch.id,
    observed: '{"id":999,"total":0}',
    exitCode: 0,
  })).output;
  assert.equal(mismatchClose.status, "FAIL");
  assert.match(mismatchClose.reason, /does not match/);

  // A failing command stays FAIL regardless of the agent's exitCode claim.
  const failing = (await goalTool.execute(
    {
      action: "open",
      goal: "failing check",
      input: "check-order.mjs",
      expected: "anything",
      check: 'node -e "process.exit(3)"',
      pass: "must not pass",
    },
    { sessionID: "ses_goal" },
  )).output;
  const failingClose = (await goalTool.execute({
    action: "close",
    id: failing.id,
    observed: "all good",
    exitCode: 0,
  })).output;
  assert.equal(failingClose.status, "FAIL");
  assert.match(failingClose.reason, /exited with 3/);

  await assert.rejects(
    () => goalTool.execute({ action: "close", id: "gc-never", observed: "x", exitCode: 0 }),
    /never opened/,
  );

  assert.equal(fake.skills.length, 5);
  assert.ok(
    fake.skills.some(
      (skill: any) =>
        skill.path === path.join(root, ".opencode", "zombiecoder", "skills", "sample.md"),
    ),
    "the shared sample skill must be registered",
  );
  assert.ok(
    !fs.existsSync(path.join(root, ".zombiecoder", "skills")),
    "no per-project skill tree may be created",
  );

  const report = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", ".state", "setup-report.json"), "utf8"));
  const toolStep = report.steps.find((step: any) => step.step === "register-tools");
  assert.equal(toolStep.ok, true);
  assert.equal(toolStep.detail, "13 registered");
  assert.ok(fs.existsSync(path.join(root, ".zombiecoder", ".state", "audit.jsonl")));

  await cleanup();
});

test("context hook resolves a session's own project root and scaffolds it", async () => {
  const setupRoot = tempProject();
  fs.mkdirSync(path.join(setupRoot, ".zombiecoder"), { recursive: true });
  fs.writeFileSync(path.join(setupRoot, ".environment"), "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL=\n");
  fs.writeFileSync(
    path.join(setupRoot, ".zombiecoder", "config.json"),
    JSON.stringify({
      version: "0.0.0-test",
      customProviderUrl: "",
      customProviderID: "missionbarisal",
      mcpUrl: "",
      opencodeApiUrl: "",
      ssotRefreshMs: 300000,
      modelStrategy: "auto",
    }),
  );

  const fake: Fake = makeContext(setupRoot);
  const cleanup = await setup(fake.ctx);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const secondRoot = tempProject();
  const sessionID = "ses_other_project";
  fake.sessionLocations.set(sessionID, secondRoot);

  const system: any[] = [];
  await fake.sessionHooks.context({
    agent: "manu",
    sessionID,
    system,
    messages: [],
  });

  for (const file of ["SSOT.md", "syllabus.md"]) {
    assert.ok(
      fs.existsSync(path.join(secondRoot, ".zombiecoder", file)),
      `${file} must be scaffolded in the session project`,
    );
  }
  assert.ok(
    fs.existsSync(path.join(secondRoot, ".zombiecoder", "memory", "index.json")),
    "memory index must be scaffolded in the session project",
  );
  assert.ok(
    system.some((part: any) => String(part?.text ?? "").includes("### Agent contract")),
    "the context hook must push the session project pack",
  );

  const contextTool = fake.tools.find((tool) => tool.name === "context_status");
  const contextOutput = (
    await contextTool.execute({ agent: "manu", sessionID }, { sessionID })
  ).output;
  assert.equal(contextOutput.allowedRoot, secondRoot, "context tools must use the session root");

  const workdirTool = fake.tools.find((tool) => tool.name === "get_working_directory");
  const workdirOutput = (await workdirTool.execute({}, { sessionID })).output;
  assert.equal(workdirOutput.root, secondRoot);

  const ssotTool = fake.tools.find((tool) => tool.name === "read_ssot");
  const ssotOutput = (await ssotTool.execute({}, { sessionID })).output;
  assert.equal(ssotOutput.file, path.join(secondRoot, ".zombiecoder", "SSOT.md"));
  assert.doesNotMatch(ssotOutput.markdown, /\(not generated\)/);

  const audit = fs.readFileSync(
    path.join(secondRoot, ".zombiecoder", ".state", "audit.jsonl"),
    "utf8",
  );
  assert.match(audit, /"kind":"context"/);
  assert.match(audit, /"sessionID":"ses_other_project"/);

  await cleanup();
});

test("agentModes config switches a valid mode and rejects unknown ones", async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".environment"),
    "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL=\n",
  );
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "config.json"),
    JSON.stringify({
      version: "0.0.0-test",
      customProviderUrl: "",
      customProviderID: "missionbarisal",
      mcpUrl: "",
      opencodeApiUrl: "",
      ssotRefreshMs: 300000,
      modelStrategy: "free",
      agentModes: { manu: "subagent", jarin: "wizard", kobir: "all" },
    }),
  );
  const fake: Fake = makeContext(root);
  const cleanup = await setup(fake.ctx);
  await new Promise((resolve) => setTimeout(resolve, 30));
  try {
    const manu = fs.readFileSync(path.join(root, ".opencode", "agents", "manu.md"), "utf8");
    assert.match(manu, /^mode: subagent$/m, "valid override must reach the markdown frontmatter");
    assert.match(manu, /current mode: `subagent`/);

    const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
    assert.equal(config.agents.manu.mode, "subagent");
    assert.equal(config.agents.jarin.mode, "all", "an invalid mode must leave the agent untouched");

    const report = JSON.parse(
      fs.readFileSync(path.join(root, ".zombiecoder", ".state", "setup-report.json"), "utf8"),
    );
    assert.equal(report.outputs.agentModes.manu, "subagent");
    const rejected = report.outputs.agentModeRejections ?? [];
    assert.ok(rejected.some((item: any) => item.agent === "jarin"), "invalid mode must be reported");
    assert.ok(rejected.some((item: any) => item.agent === "kobir"), "unknown agent must be reported");
    assert.equal(report.steps.find((item: any) => item.step === "agent-modes")?.ok, true);
  } finally {
    await cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("three consecutive tool errors hand the session to the next roster agent once", async () => {
  const root = tempProject();
  const fake = makeContext(root);
  const cleanup = await setup(fake.ctx);
  const after = fake.toolHooks["execute.after"];
  assert.equal(typeof after, "function", "tool failure hook was not registered");

  const event = (status: "error" | "completed", id: string) => ({
    status,
    sessionID: "ses_failures",
    agent: "manu",
    tool: "read",
    id,
    ...(status === "completed" ? { result: { output: "ok" } } : { error: new Error("failed") }),
  });
  for (let index = 0; index < 2; index++) {
    await after(event("error", `call-${index}`));
  }
  await after(event("completed", "call-success"));
  for (let index = 2; index < 4; index++) {
    await after(event("error", `call-${index}`));
  }
  assert.equal(fake.agentSwitches.length, 0, "a completed tool must reset the consecutive failure count");
  await after(event("error", "call-4"));

  assert.deepEqual(fake.agentSwitches, [{ sessionID: "ses_failures", agent: "jarin" }]);

  await after(event("error", "call-5"));
  assert.equal(fake.agentSwitches.length, 1, "one failed agent must not trigger repeated switches");
  await cleanup();
});

test("session.idle archives the complete OpenCode session context", async () => {
  const root = tempProject();
  assert.equal(fs.existsSync(path.join(root, ".zombiecoder")), false);
  const fake = makeContext(root);
  const queue: any[] = [];
  let wake: (() => void) | undefined;
  let messages: any[] = [
    { id: "user-1", type: "user", text: "Check the source." },
    { id: "assistant-1", type: "assistant", content: [{ type: "text", text: "I will inspect it." }] },
  ];
  const controllerSignal = { current: undefined as AbortSignal | undefined };

  (fake.ctx as any).session.context = async () => messages;
  (fake.ctx as any).event = {
    subscribe: ({ signal }: { signal: AbortSignal }) => {
      controllerSignal.current = signal;
      return {
        async *[Symbol.asyncIterator]() {
          while (!signal.aborted) {
            if (queue.length > 0) {
              yield queue.shift();
              continue;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
          }
        },
      };
    },
  };

  const cleanup = await setup(fake.ctx);
  assert.ok(fs.existsSync(path.join(root, ".zombiecoder", "SSOT.md")));
  assert.ok(fs.existsSync(path.join(root, ".zombiecoder", "syllabus.md")));
  assert.ok(fs.existsSync(path.join(root, ".zombiecoder", "memory", "index.json")));
  await new Promise((resolve) => setTimeout(resolve, 20));
  queue.push({ type: "session.idle", data: { sessionID: "ses_idle" } });
  wake?.();
  await new Promise((resolve) => setTimeout(resolve, 40));

  const { readArchive, readIndex } = await import("../src/zombie/memory.ts");
  assert.equal(readArchive(root, "ses_idle")[0].archived.length, 2);
  assert.equal(readIndex(root).sessions.ses_idle.archivedTotal, 2);

  messages = [...messages, { id: "user-2", type: "user", text: "One more message." }];
  queue.push({ type: "session.idle", data: { sessionID: "ses_idle" } });
  wake?.();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(readArchive(root, "ses_idle").reduce((n: number, row: any) => n + row.archived.length, 0), 3);

  assert.equal(controllerSignal.current?.aborted, false);
  await cleanup();
  assert.equal(controllerSignal.current?.aborted, true);
});

test("context hook archives overflow without waiting for session.idle", async () => {
  const root = tempProject();
  const fake = makeContext(root);
  const cleanup = await setup(fake.ctx);
  const hook = fake.sessionHooks["context"];
  assert.equal(typeof hook, "function", "context hook was not registered");

  const message = (index: number) => ({
    id: `ctx-${index}`,
    role: index % 2 ? "assistant" : "user",
    text: `message ${index}`,
  });
  const first = Array.from({ length: 8 }, (_, index) => message(index));
  const firstEvent = {
    agent: "manu",
    sessionID: "ses_ctx",
    model: { providerID: "opencode", modelID: "big-pickle" },
    messages: first,
    system: [] as Array<{ type: string; text: string }>,
  };
  await hook(firstEvent);

  // The bounded pack and the agent contract must reach the provider through
  // event.system, not just sit in the audit log.
  assert.ok(firstEvent.system.length > 0, "context hook did not inject a system part");
  const injected = firstEvent.system.map((part) => part.text).join("\n");
  assert.match(injected, /Context: SSOT OK \(manu\)/);
  assert.match(injected, /Pack \d+B/);
  assert.match(injected, /Decision rule:/);
  assert.match(injected, /Start every response with "ভাইয়া"/);

  // Builtin OpenCode agents (explore/general/build/plan) have no roster entry.
  // They must still receive the ZombieCoder identity, not a generic prompt.
  const builtinEvent = {
    agent: "explore",
    sessionID: "ses_builtin",
    model: { providerID: "opencode", modelID: "big-pickle" },
    messages: [message(0)],
    system: [] as Array<{ type: string; text: string }>,
  };
  await hook(builtinEvent);
  const builtinText = builtinEvent.system.map((part) => part.text).join("\n");
  assert.match(builtinText, /ZombieCoder identity \(builtin runner: explore\)/);
  assert.match(builtinText, /ZombieCoder Shared Rules/);
  assert.match(builtinText, /Execution Doctrine/);
  assert.match(builtinText, /Start every response with "ভাইয়া"/);
  assert.doesNotMatch(builtinText, /unknown agent/);

  // The audit must record which merge branch ran, not just "context".
  const auditRows = fs
    .readFileSync(path.join(root, ".zombiecoder", ".state", "audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const rosterAudit = auditRows.find((row) => row.sessionID === "ses_ctx" && row.kind === "context");
  const builtinAudit = auditRows.find((row) => row.sessionID === "ses_builtin" && row.kind === "context");
  assert.equal(rosterAudit.persona, "roster", "roster agents keep their own markdown");
  assert.equal(rosterAudit.personaBytes, 0, "roster persona must not be pushed twice");
  assert.equal(builtinAudit.persona, "shared", "builtin runner uses the merged persona");
  assert.ok(builtinAudit.personaBytes > 5000, "the merged persona is the full block");

  const { readArchive, readIndex } = await import("../src/zombie/memory.ts");
  const archivedTexts = () =>
    readArchive(root, "ses_ctx").flatMap((row: any) => row.archived.map((m: any) => m.text));
  assert.deepEqual(archivedTexts(), ["message 0", "message 1", "message 2"]);
  let entry = readIndex(root).sessions.ses_ctx;
  assert.equal(entry.kept, 5);
  assert.equal(entry.archivedTotal, 3);

  await hook({
    agent: "manu",
    sessionID: "ses_ctx",
    model: { providerID: "opencode", modelID: "big-pickle" },
    messages: [...first, message(8)],
    system: [],
  });
  assert.deepEqual(archivedTexts(), ["message 0", "message 1", "message 2", "message 3"]);
  entry = readIndex(root).sessions.ses_ctx;
  assert.equal(entry.kept, 5);
  assert.equal(entry.archivedTotal, 4);

  await cleanup();
});

test("global install writes agents/config at the global root and leaves the working directory .opencode-free", async () => {
  const root = tempProject();
  const globalDir = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "config.json"),
    JSON.stringify({
      version: "0.0.0-test",
      customProviderUrl: "",
      customProviderID: "missionbarisal",
      mcpUrl: "",
      opencodeApiUrl: "",
      ssotRefreshMs: 300000,
      modelStrategy: "auto",
    }),
  );

  const previous = process.env.ZOMBIECODER_INSTALL_PARENT;
  process.env.ZOMBIECODER_INSTALL_PARENT = globalDir;
  try {
    const fake = makeContext(root);
    const cleanup = await setup(fake.ctx);
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.ok(!fs.existsSync(path.join(root, ".opencode")), "global install must not create .opencode in the working directory");
    assert.ok(fs.existsSync(path.join(root, ".zombiecoder", "SSOT.md")));
    assert.ok(
      !fs.existsSync(path.join(root, ".zombiecoder", "skills")),
      "a working directory must not get its own skill tree",
    );
    assert.ok(
      fs.existsSync(path.join(globalDir, "zombiecoder", "skills", "first-principles.md")),
      "first-principles skill missing from the shared install root",
    );
    assert.ok(
      fs.existsSync(path.join(globalDir, "zombiecoder", "skills", "evidence-before-confidence.md")),
      "evidence skill missing from the shared install root",
    );

    assert.ok(fs.existsSync(path.join(globalDir, "agents", "zombiecoder.md")));
    assert.ok(fs.existsSync(path.join(globalDir, "opencode.json")));
    const config = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode.json"), "utf8"));
    assert.equal(config.agents.zombiecoder.mode, "all");
    assert.ok(Array.isArray(config.agents.zombiecoder.permissions));

    const report = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", ".state", "setup-report.json"), "utf8"));
    assert.equal(report.outputs.install.global, true);
    assert.equal(report.steps.find((s: any) => s.step === "agent-config").ok, true);

    await cleanup();
  } finally {
    if (previous === undefined) delete process.env.ZOMBIECODER_INSTALL_PARENT;
    else process.env.ZOMBIECODER_INSTALL_PARENT = previous;
  }
});

test("global install keeps global agent models when a project plan falls back to free models", async () => {
  const root = tempProject();
  const globalDir = tempProject();
  const roster = await import("../src/roster.ts");
  const custom = "missionbarisal/llama3-groq-tool-use:8b";
  const customAssignment = Object.fromEntries(roster.ROSTER.map((agent) => [agent.id, custom]));
  const globalConfig = {
    $schema: "https://opencode.ai/config.json",
    model: custom,
    agents: roster.renderAgentsConfig(roster.ROSTER, customAssignment),
  };
  fs.writeFileSync(path.join(globalDir, "opencode.json"), JSON.stringify(globalConfig, null, 2));

  // This project explicitly disables the custom provider, so its own plan is
  // free-fallback. That must not leak into the installer-owned global config.
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "config.json"),
    JSON.stringify({
      version: "0.0.0-test",
      customProviderUrl: "",
      customProviderID: "missionbarisal",
      mcpUrl: "",
      opencodeApiUrl: "",
      ssotRefreshMs: 300000,
      modelStrategy: "auto",
      agentModelPins: true,
    }),
  );

  const previous = process.env.ZOMBIECODER_INSTALL_PARENT;
  process.env.ZOMBIECODER_INSTALL_PARENT = globalDir;
  try {
    const fake = makeContext(root);
    const cleanup = await setup(fake.ctx);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const after = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode.json"), "utf8"));
    assert.equal(after.agents.zombiecoder.model, custom, "project free plan overwrote the global agent model");
    assert.equal(after.agents.manu.model, custom, "second global agent model overwritten");
    const markdown = fs.readFileSync(path.join(globalDir, "agents", "zombiecoder.md"), "utf8");
    assert.match(markdown, /^model: missionbarisal\/llama3-groq-tool-use:8b$/m);

    const report = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", ".state", "setup-report.json"), "utf8"));
    assert.equal(report.outputs.modelStrategy, "free-fallback");
    assert.equal(report.outputs.agentAssignmentSource, "global opencode.json (installer-owned)");
    assert.equal(report.outputs.bound.includes("global model"), true);

    await cleanup();
  } finally {
    if (previous === undefined) delete process.env.ZOMBIECODER_INSTALL_PARENT;
    else process.env.ZOMBIECODER_INSTALL_PARENT = previous;
  }
});

test("global install falls back to free models when the configured provider is down", async () => {
  const root = tempProject();
  const globalDir = tempProject();
  const roster = await import("../src/roster.ts");
  const custom = "missionbarisal/dead-model";
  const customAssignment = Object.fromEntries(roster.ROSTER.map((agent) => [agent.id, custom]));
  fs.writeFileSync(
    path.join(globalDir, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      model: custom,
      agents: roster.renderAgentsConfig(roster.ROSTER, customAssignment),
    }, null, 2),
  );

  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "config.json"),
    JSON.stringify({
      version: "0.0.0-test",
      customProviderUrl: "http://127.0.0.1:1/v1",
      customProviderID: "missionbarisal",
      mcpUrl: "",
      opencodeApiUrl: "",
      ssotRefreshMs: 300000,
      modelStrategy: "auto",
      agentModelPins: true,
    }),
  );

  const previous = process.env.ZOMBIECODER_INSTALL_PARENT;
  process.env.ZOMBIECODER_INSTALL_PARENT = globalDir;
  try {
    const fake = makeContext(root);
    const cleanup = await setup(fake.ctx);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const after = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode.json"), "utf8"));
    assert.equal(after.agents.zombiecoder.model, "opencode/big-pickle");
    assert.equal(after.agents.manu.model, "opencode/big-pickle");
    const report = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", ".state", "setup-report.json"), "utf8"));
    assert.equal(report.outputs.modelStrategy, "free-fallback");
    assert.match(report.outputs.agentAssignmentSource, /^runtime model plan /);

    await cleanup();
  } finally {
    if (previous === undefined) delete process.env.ZOMBIECODER_INSTALL_PARENT;
    else process.env.ZOMBIECODER_INSTALL_PARENT = previous;
  }
});

test("an old kobir syllabus is upgraded with the footprint and keeps every lesson", async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  const old = [
    "# Syllabus — agent knowledge for this project",
    "",
    "## 1. Scope",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Working directory | `" + root + "` |",
    "",
    "## 2. Agents bound to this project",
    "",
    "- `kobir`",
    "",
    "## 3. Standing rules",
    "",
    "1. Evidence before confidence.",
    "",
    "## 4. Lessons (append-only)",
    "",
    "### Existing lesson",
    "",
    "Keep this lesson.",
    "",
    "---",
    "",
    "_— ZombieCoder Syllabus · v0.1.0 · generated 2026-01-01T00:00:00.000Z_",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, ".zombiecoder", "syllabus.md"), old);

  const { scanProject } = await import("../src/zombie/scan.ts");
  const { ensureSyllabus } = await import("../src/zombie/syllabus.ts");
  const result = ensureSyllabus(root, scanProject(root), ["zombiecoder"]);
  const text = fs.readFileSync(result.file, "utf8");

  assert.equal(result.upgraded, true);
  assert.match(text, /## 2\. Footprint \(auto-discovered\)/);
  assert.match(text, /## 3\. Agents bound to this project/);
  assert.match(text, /- `zombiecoder`/);
  assert.doesNotMatch(text, /- `kobir`/);
  assert.match(text, /### Existing lesson/);
  assert.match(text, /Keep this lesson\./);
  assert.equal((text.match(/^### Existing lesson$/gm) ?? []).length, 1, "lesson duplicated");
});

test("providerConfiguredOnDisk inherits a provider from an ancestor opencode.json", () => {
  const ancestor = tempProject();
  const child = path.join(ancestor, "packages", "app");
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(
    path.join(ancestor, "opencode.json"),
    JSON.stringify({ providers: { "zc-ancestor-A": { models: {} } } }),
  );

  assert.equal(providerConfiguredOnDisk(child, "zc-ancestor-A"), true, "ancestor provider not detected");
  assert.equal(providerConfiguredOnDisk(child, "zc-ancestor-B"), false, "unknown provider falsely detected");

  fs.rmSync(ancestor, { recursive: true, force: true });
});

test("detectInstallLayout treats a .opencode root with its own config as self-contained", () => {
  const root = tempProject();
  const configDir = path.join(root, ".opencode");
  fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "zombiecoder"), { recursive: true });
  fs.writeFileSync(path.join(configDir, "opencode.json"), "{}");
  fs.writeFileSync(path.join(configDir, "zombiecoder", "config.json"), "{}");
  process.env.ZOMBIECODER_INSTALL_PARENT = configDir;
  try {
    const layout = detectInstallLayout(root);
    assert.equal(layout.dir, configDir);
    assert.equal(layout.global, true);
    assert.equal(layout.configFile, path.join(configDir, "opencode.json"));
  } finally {
    delete process.env.ZOMBIECODER_INSTALL_PARENT;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("origin handshake persistence changes only the URL and keeps the key + mode", () => {
  const root = tempProject();
  const file = path.join(root, "zombiecoder", "config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      customProviderUrl: "https://old.example/v1",
      customProviderApiKey: "zc-test-key",
      originUrl: "https://origin.example",
    }),
    { mode: 0o600 },
  );

  const result = persistProviderUrl("https://new.example/v1", [file]);
  assert.equal(result.updated, true);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.customProviderUrl, "https://new.example/v1");
  assert.equal(after.customProviderApiKey, "zc-test-key");
  assert.equal(after.originUrl, "https://origin.example");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, "secret config mode must be preserved");
  fs.rmSync(root, { recursive: true, force: true });
});

test("syncProviderBaseUrl touches only settings.baseURL", () => {
  const root = tempProject();
  const file = path.join(root, "opencode.json");
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        providers: {
          missionbarisal: {
            settings: { baseURL: "https://old.example/v1", apiKey: "zc-test-key" },
            models: { m1: { name: "m1" } },
          },
        },
        agents: { manu: { mode: "all" } },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  const result = syncProviderBaseUrl(file, "missionbarisal", "https://new.example/v1");
  assert.equal(result.updated, true);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.providers.missionbarisal.settings.baseURL, "https://new.example/v1");
  assert.equal(after.providers.missionbarisal.settings.apiKey, "zc-test-key");
  assert.deepEqual(after.providers.missionbarisal.models, { m1: { name: "m1" } });
  assert.equal(after.agents.manu.mode, "all");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, "provider config mode must be preserved");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a gate-blocked answer escalates through three agents and then opens the breaker", async () => {
  const root = tempProject();
  const fake = makeContext(root);
  const cleanup = await setup(fake.ctx);
  const hook = fake.sessionHooks["http.response"];
  assert.equal(typeof hook, "function", "http.response hook was not registered");

  const sse = (chunks: string[]) => chunks.join("\n") + "\n";
  const delta = (value: unknown) => `data: ${JSON.stringify(value)}`;
  const unproven = sse([
    delta({ choices: [{ delta: { role: "assistant", content: "I fixed the login bug, the issue was the poll timer and the stale HTML." } }] }),
    delta({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "data: [DONE]",
  ]);
  const toolTurn = sse([
    delta({ choices: [{ delta: { role: "assistant", content: "I fixed the login bug in src/ghost.ts." } }] }),
    delta({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "edit", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }),
    "data: [DONE]",
  ]);

  const event = (agent: string, body: string, sessionID = "ses_gate") => ({
    kind: "primary",
    sessionID,
    agent,
    model: { providerID: "opencode", modelID: "big-pickle" },
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  });

  // An intermediate tool turn must never trip the breaker.
  const toolEvent = event("manu", toolTurn, "ses_tool");
  await hook(toolEvent);
  await toolEvent.response.text();
  await (toolEvent as any).zombiecoderSettled;
  assert.deepEqual(fake.agentSwitches, []);
  assert.equal(fake.prompts.length, 0);
  assert.equal(fake.synthetics.length, 0);

  const first = event("manu", unproven);
  await hook(first);
  assert.match(await first.response.text(), /UNVERIFIED/, "the blocked answer must stay truthful");
  await (first as any).zombiecoderSettled;
  assert.deepEqual(fake.agentSwitches, [{ sessionID: "ses_gate", agent: "jarin" }]);
  assert.equal(
    fake.modelSwitches.length,
    0,
    "pins off by default: switching agent must leave the /models choice untouched",
  );
  assert.equal(fake.prompts.length, 1);
  assert.equal(fake.prompts[0].delivery, "queue");
  assert.match(fake.prompts[0].text, /circuit breaker/);
  assert.match(fake.prompts[0].text, /claim without evidence/);
  assert.match(fake.synthetics[0].text, /Circuit breaker/);
  assert.match(fake.synthetics[0].text, /1\/3/);

  const second = event("jarin", unproven);
  await hook(second);
  await second.response.text();
  await (second as any).zombiecoderSettled;
  assert.deepEqual(fake.agentSwitches.at(-1), { sessionID: "ses_gate", agent: "brishti" });
  assert.match(fake.synthetics.at(-1)!.text, /2\/3/);

  const third = event("brishti", unproven);
  await hook(third);
  await third.response.text();
  await (third as any).zombiecoderSettled;
  assert.equal(fake.agentSwitches.length, 2, "the third failure must not switch agent again");
  assert.equal(fake.prompts.length, 2, "the third failure must not queue another attempt");
  const last = fake.synthetics.at(-1)!;
  assert.match(last.text, /কাজটি সমাধান হয়নি/);
  assert.match(last.text, /manu.*jarin.*brishti/);
  assert.match(last.text, /প্রমাণ দিন/);

  const breaker = fake.storage.get("agent/breaker/ses_gate") as any;
  assert.equal(breaker.failures.length, 3);
  assert.deepEqual(breaker.agents, ["manu", "jarin", "brishti"]);
  assert.match(breaker.failures[0].context.blockedPreview, /I fixed the login bug/);

  await cleanup();
});

test("pins on: the breaker moves the model with the agent, never a random one", async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "config.json"),
    JSON.stringify({
      version: "0.0.0-test",
      customProviderUrl: "",
      customProviderID: "missionbarisal",
      mcpUrl: "",
      opencodeApiUrl: "",
      ssotRefreshMs: 300000,
      modelStrategy: "free",
      agentModelPins: true,
    }),
  );
  const fake = makeContext(root, {
    models: [
      {
        providerID: "opencode",
        modelID: "big-pickle",
        cost: [{ input: 0, output: 0 }],
        status: "active",
        capabilities: { tools: true },
        enabled: true,
      },
      {
        providerID: "opencode",
        modelID: "second-free",
        cost: [{ input: 0, output: 0 }],
        status: "active",
        capabilities: { tools: true },
        enabled: true,
      },
    ],
  });
  const cleanup = await setup(fake.ctx);
  const hook = fake.sessionHooks["http.response"];
  assert.equal(typeof hook, "function", "http.response hook was not registered");

  const unproven =
    [
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "I fixed the login bug, the issue was the poll timer and the stale HTML." } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ].join("\n") + "\n";

  const event = {
    kind: "primary",
    sessionID: "ses_pins",
    agent: "manu",
    model: { providerID: "opencode", modelID: "big-pickle" },
    response: new Response(unproven, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  };
  await hook(event);
  await event.response.text();
  await (event as any).zombiecoderSettled;

  assert.deepEqual(fake.agentSwitches, [{ sessionID: "ses_pins", agent: "jarin" }]);
  const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
  const pinned = config.agents.jarin.model as string;
  assert.equal(pinned, "opencode/second-free", "the pinned mapping must resolve deterministically");
  assert.equal(fake.modelSwitches.length, 1, "pins on: the model must follow the agent");
  // Model.Ref wire shape is { id, providerID, variant? } — not
  // { providerID, model }. Verified against @opencode/schema/dist/model.d.ts.
  assert.deepEqual(fake.modelSwitches[0], {
    sessionID: "ses_pins",
    model: { providerID: "opencode", id: "second-free" },
  });

  await cleanup();
});

test("a passing final answer resets the breaker for the next question", async () => {
  const root = tempProject();
  const fake = makeContext(root);
  const cleanup = await setup(fake.ctx);
  const hook = fake.sessionHooks["http.response"];

  const chunk = (value: unknown) => `data: ${JSON.stringify(value)}`;
  const blocked = [
    chunk({ choices: [{ delta: { role: "assistant", content: "I fixed the login bug, the issue was the poll timer and the stale HTML." } }] }),
    "data: [DONE]",
    "",
  ].join("\n");
  const proven = [
    chunk({ choices: [{ delta: { role: "assistant", content: "The fix is verified: npm test reports 78/78 pass." } }] }),
    "data: [DONE]",
    "",
  ].join("\n");
  const event = (agent: string, body: string) => ({
    kind: "primary",
    sessionID: "ses_reset",
    agent,
    model: { providerID: "opencode", modelID: "big-pickle" },
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
  });

  const blockedEvent = event("manu", blocked);
  await hook(blockedEvent);
  await blockedEvent.response.text();
  await (blockedEvent as any).zombiecoderSettled;
  assert.equal((fake.storage.get("agent/breaker/ses_reset") as any).failures.length, 1);

  const good = event("jarin", proven);
  await hook(good);
  assert.match(await good.response.text(), /78\/78 pass/, "a passing answer must not be rewritten");
  await (good as any).zombiecoderSettled;
  const state = fake.storage.get("agent/breaker/ses_reset") as any;
  assert.equal(state.failures.length, 0, "a completed task must clear the failure count");
  assert.deepEqual(state.agents, []);
  assert.equal(fake.agentSwitches.length, 1, "the reset itself must not switch agent");

  await cleanup();
});

test("a failed agent switch still keeps the task moving on the current agent", async () => {
  const root = tempProject();
  const fake = makeContext(root);
  const cleanup = await setup(fake.ctx);
  const hook = fake.sessionHooks["http.response"];
  fake.switchState.fail = true;

  const blocked = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "I fixed the login bug, the issue was the poll timer and the stale HTML." } }] })}`,
    "data: [DONE]",
    "",
  ].join("\n");
  const switchEvent: any = {
    kind: "primary",
    sessionID: "ses_switch_fail",
    agent: "manu",
    model: { providerID: "opencode", modelID: "big-pickle" },
    response: new Response(blocked, { status: 200, headers: { "content-type": "text/event-stream" } }),
  };
  await hook(switchEvent);
  await switchEvent.response.text();
  await switchEvent.zombiecoderSettled;

  assert.equal(fake.agentSwitches.length, 0, "the failed switch must not be reported as applied");
  assert.equal(fake.synthetics.length, 1, "the user still gets a status message");
  assert.match(fake.synthetics[0].text, /Circuit breaker/);
  assert.equal(fake.prompts.length, 1, "the retry must still be queued on the current agent");
  assert.match(fake.prompts[0].text, /circuit breaker/);

  await cleanup();
});
