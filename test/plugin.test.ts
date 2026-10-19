import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setup } from "../src/plugin.ts";

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
  const manu = fs.readFileSync(path.join(root, ".opencode", "agents", "manu.md"), "utf8");
  assert.match(manu, /^model: opencode\/big-pickle$/m);
  assert.match(manu, /ZombieCoder Shared Rules/);

  assert.equal(fake.tools.length, 5);
  assert.ok(fake.tools.every((tool) => tool.output), "every tool must declare an output schema");
  assert.equal(fake.skills.length, 1);
  assert.equal(fake.skills[0].path, path.join(root, ".zombiecoder", "skills", "sample.md"));

  const report = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "setup-report.json"), "utf8"));
  const toolStep = report.steps.find((step: any) => step.step === "register-tools");
  assert.equal(toolStep.ok, true);
  assert.equal(toolStep.detail, "5 registered");

  await cleanup();
});
