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

function makeContext(root: string) {
  const tools: any[] = [];
  const skills: any[] = [];
  const hooks: string[] = [];
  const toolHooks: Record<string, (event: any) => any> = {};
  const sessionHooks: Record<string, (event: any) => any> = {};
  const agentSwitches: Array<{ sessionID: string; agent: string }> = [];
  const switchState = { fail: false };
  const synthetics: Array<{ sessionID: string; text: string; description?: string }> = [];
  const prompts: Array<{ sessionID: string; text: string; delivery?: string }> = [];
  const storage = new Map<string, unknown>();
  const deferred = (fn: () => void) => setTimeout(fn, 5);
  const registration = { dispose: async () => undefined };
  const ctx = {
    location: { directory: root },
    provider: { list: async () => ({ data: [] }) },
    model: {
      list: async () => ({
        data: [
          {
            providerID: "opencode",
            modelID: "big-pickle",
            cost: [{ input: 0, output: 0 }],
            status: "active",
            capabilities: { tools: true },
            enabled: true,
          },
        ],
      }),
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
      hook: async (name: string, fn: (event: any) => any) => {
        hooks.push(name);
        sessionHooks[name] = fn;
        return registration;
      },
      switchAgent: async (input: { sessionID: string; agent: string }) => {
        if (switchState.fail) throw new Error("agent not found");
        agentSwitches.push(input);
      },
      synthetic: async (input: { sessionID: string; text: string; description?: string }) => {
        synthetics.push(input);
      },
      prompt: async (input: { sessionID: string; text: string; delivery?: string }) => {
        prompts.push(input);
      },
    },
  };
  return { ctx, tools, skills, hooks, toolHooks, sessionHooks, agentSwitches, synthetics, prompts, storage, switchState };
}

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-test-"));
}

test("setup scaffolds .zombiecoder, writes agent markdown, and registers doors", async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.mkdirSync(path.join(root, ".zombiecoder", "skills"), { recursive: true });
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
    path.join(root, ".zombiecoder", "skills", "sample.md"),
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
  assert.match(manu, /^model: opencode\/big-pickle$/m);
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

  // V2 config is the second agent door: provider, agents, models, permissions.
  const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.equal(config.agents.zombiecoder.mode, "primary");
  assert.equal(config.agents.zombiecoder.model, "opencode/big-pickle");
  assert.equal(config.agents.manu.mode, "primary");
  for (const agent of Object.values(config.agents) as any[]) {
    assert.equal(agent.mode, "primary", "every agent must be a main agent, not a subagent");
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

  assert.equal(fake.tools.length, 10);
  assert.ok(fake.tools.every((tool) => tool.output), "every tool must declare an output schema");
  assert.ok(fake.tools.some((tool) => tool.name === "memory_archive"));
  assert.ok(fake.tools.some((tool) => tool.name === "evidence_gate"), "evidence_gate tool missing");
  assert.ok(fake.tools.some((tool) => tool.name === "syntax_check"), "syntax_check tool missing");
  assert.ok(fake.tools.some((tool) => tool.name === "skill_catalog"), "skill_catalog tool missing");
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

  assert.equal(fake.skills.length, 5);
  assert.ok(
    fake.skills.some(
      (skill: any) => skill.path === path.join(root, ".zombiecoder", "skills", "sample.md"),
    ),
    "the project's own sample skill must be registered",
  );

  const report = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", ".state", "setup-report.json"), "utf8"));
  const toolStep = report.steps.find((step: any) => step.step === "register-tools");
  assert.equal(toolStep.ok, true);
  assert.equal(toolStep.detail, "10 registered");
  assert.ok(fs.existsSync(path.join(root, ".zombiecoder", ".state", "audit.jsonl")));

  await cleanup();
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
    assert.ok(fs.existsSync(path.join(root, ".zombiecoder", "skills")), "core skills should be installed");
    assert.ok(
      fs.existsSync(path.join(root, ".zombiecoder", "skills", "first-principles.md")),
      "first-principles skill missing",
    );
    assert.ok(
      fs.existsSync(path.join(root, ".zombiecoder", "skills", "evidence-before-confidence.md")),
      "evidence skill missing",
    );

    assert.ok(fs.existsSync(path.join(globalDir, "agents", "zombiecoder.md")));
    assert.ok(fs.existsSync(path.join(globalDir, "opencode.json")));
    const config = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode.json"), "utf8"));
    assert.equal(config.agents.zombiecoder.mode, "primary");
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
        agents: { manu: { mode: "primary" } },
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
  assert.equal(after.agents.manu.mode, "primary");
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
  assert.deepEqual(fake.agentSwitches, []);
  assert.equal(fake.prompts.length, 0);
  assert.equal(fake.synthetics.length, 0);

  const first = event("manu", unproven);
  await hook(first);
  assert.match(await first.response.text(), /UNVERIFIED/, "the blocked answer must stay truthful");
  assert.deepEqual(fake.agentSwitches, [{ sessionID: "ses_gate", agent: "jarin" }]);
  assert.equal(fake.prompts.length, 1);
  assert.equal(fake.prompts[0].delivery, "queue");
  assert.match(fake.prompts[0].text, /circuit breaker/);
  assert.match(fake.prompts[0].text, /claim without evidence/);
  assert.match(fake.synthetics[0].text, /Circuit breaker/);
  assert.match(fake.synthetics[0].text, /1\/3/);

  await hook(event("jarin", unproven));
  assert.deepEqual(fake.agentSwitches.at(-1), { sessionID: "ses_gate", agent: "brishti" });
  assert.match(fake.synthetics.at(-1)!.text, /2\/3/);

  const third = event("brishti", unproven);
  await hook(third);
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

  await hook(event("manu", blocked));
  assert.equal((fake.storage.get("agent/breaker/ses_reset") as any).failures.length, 1);

  const good = event("jarin", proven);
  await hook(good);
  assert.match(await good.response.text(), /78\/78 pass/, "a passing answer must not be rewritten");
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
  await hook({
    kind: "primary",
    sessionID: "ses_switch_fail",
    agent: "manu",
    model: { providerID: "opencode", modelID: "big-pickle" },
    response: new Response(blocked, { status: 200, headers: { "content-type": "text/event-stream" } }),
  });

  assert.equal(fake.agentSwitches.length, 0, "the failed switch must not be reported as applied");
  assert.equal(fake.synthetics.length, 1, "the user still gets a status message");
  assert.match(fake.synthetics[0].text, /Circuit breaker/);
  assert.equal(fake.prompts.length, 1, "the retry must still be queued on the current agent");
  assert.match(fake.prompts[0].text, /circuit breaker/);

  await cleanup();
});
