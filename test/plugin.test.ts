import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setup, providerConfiguredOnDisk } from "../src/plugin.ts";

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

  for (const file of ["SSOT.md", "syllabus.md", "models.json", "setup-report.json"]) {
    assert.ok(fs.existsSync(path.join(root, ".zombiecoder", file)), `${file} missing`);
  }

  const agents = fs.readdirSync(path.join(root, ".opencode", "agents"));
  assert.equal(agents.length, 9);
  assert.ok(agents.includes("zombiecoder.md"), "renamed agent markdown missing");
  assert.ok(!agents.includes("kobir.md"), "old agent markdown must not survive the rename");
  const manu = fs.readFileSync(path.join(root, ".opencode", "agents", "manu.md"), "utf8");
  assert.match(manu, /^model: opencode\/big-pickle$/m);
  assert.match(manu, /ZombieCoder Shared Rules/);
  assert.match(manu, /^permissions:$/m);

  // V2 config is the second agent door: provider, agents, models, permissions.
  const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.equal(config.agents.zombiecoder.mode, "all");
  assert.equal(config.agents.zombiecoder.model, "opencode/big-pickle");
  assert.equal(config.agents.manu.mode, "subagent");
  assert.ok(Array.isArray(config.agents.manu.permissions));
  assert.equal(config.agents.kobir, undefined);
  assert.ok(config.permissions.some((rule: any) => rule.action === "shell" && rule.effect === "ask"));

  const syllabus = fs.readFileSync(path.join(root, ".zombiecoder", "syllabus.md"), "utf8");
  assert.match(syllabus, /## 2\. Footprint \(auto-discovered\)/);

  assert.equal(fake.tools.length, 6);
  assert.ok(fake.tools.every((tool) => tool.output), "every tool must declare an output schema");
  assert.ok(fake.tools.some((tool) => tool.name === "memory_archive"));
  assert.equal(fake.skills.length, 1);
  assert.equal(fake.skills[0].path, path.join(root, ".zombiecoder", "skills", "sample.md"));

  const report = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "setup-report.json"), "utf8"));
  const toolStep = report.steps.find((step: any) => step.step === "register-tools");
  assert.equal(toolStep.ok, true);
  assert.equal(toolStep.detail, "6 registered");

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
    assert.ok(!fs.existsSync(path.join(root, ".zombiecoder", "skills")), "skills dir must stay lazy");

    assert.ok(fs.existsSync(path.join(globalDir, "agents", "zombiecoder.md")));
    assert.ok(fs.existsSync(path.join(globalDir, "opencode.json")));
    const config = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode.json"), "utf8"));
    assert.equal(config.agents.zombiecoder.mode, "all");
    assert.ok(Array.isArray(config.agents.zombiecoder.permissions));

    const report = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "setup-report.json"), "utf8"));
    assert.equal(report.outputs.install.global, true);
    assert.equal(report.steps.find((s: any) => s.step === "agent-config").ok, true);

    await cleanup();
  } finally {
    if (previous === undefined) delete process.env.ZOMBIECODER_INSTALL_PARENT;
    else process.env.ZOMBIECODER_INSTALL_PARENT = previous;
  }
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
