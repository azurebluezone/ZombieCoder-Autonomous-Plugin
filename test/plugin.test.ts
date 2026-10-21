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
        void fn;
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
        void fn;
        return registration;
      },
    },
  };
  return { ctx, tools, skills, hooks };
}

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-test-"));
}

test("setup scaffolds .zombiecoder, writes agent markdown, and registers doors", async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.mkdirSync(path.join(root, ".zombiecoder", "skills"), { recursive: true });
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
  assert.match(contextOutput.uiLine, /Context: SSOT OK \| Syllabus OK/);
  assert.ok(contextOutput.packBytes > 0, "context pack must not be empty");
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
