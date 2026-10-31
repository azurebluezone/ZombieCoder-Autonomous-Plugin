import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { toolSpecs, type SurfaceDeps } from "../src/zombie/server.ts";

type Counters = { agents: number; skills: number; providers: number; tools: number };

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function depsFor(root: string, counters: Counters = { agents: 0, skills: 0, providers: 0, tools: 0 }): SurfaceDeps {
  return {
    projectRoot: () => root,
    installRoot: () => root,
    storage: { get: async () => null, set: async () => undefined },
    refreshSsot: () => ({ sha256: "", file: "", bytes: 0 }),
    modelPlan: () => ({}),
    reloadAgents: async () => {
      counters.agents += 1;
    },
    reloadSkills: async () => {
      counters.skills += 1;
    },
    reloadProviders: async () => {
      counters.providers += 1;
    },
    reloadTools: async () => {
      counters.tools += 1;
    },
  };
}

function spec(name: string, deps: SurfaceDeps) {
  const found = toolSpecs(deps).find((entry) => entry.name === name);
  assert.ok(found, `${name} tool missing`);
  return found;
}

function listen(server: net.Server | http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
}

function close(server: net.Server | http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("reload calls every door and reports a missing door", async () => {
  const counters = { agents: 0, skills: 0, providers: 0, tools: 0 };
  const deps = depsFor(tempDir("zc-reload-"), counters);
  const all = await spec("reload", deps).run({ target: "all" });
  assert.equal(all.ok, true);
  assert.deepEqual(counters, { agents: 1, skills: 1, providers: 1, tools: 1 });

  const partial = depsFor(tempDir("zc-reload-missing-"));
  delete partial.reloadAgents;
  const missing = await spec("reload", partial).run({ target: "agents" });
  assert.equal(missing.ok, false);
  assert.match(missing.results[0].error, /not available/);
});

test("http_probe returns status, body hash and redacts sensitive headers", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", authorization: "Bearer secret" });
    response.end("probe-ok");
  });
  const port = await listen(server);
  try {
    const out = await spec("http_probe", depsFor(tempDir("zc-http-"))).run({
      url: `http://127.0.0.1:${port}/`,
      timeout_ms: 2000,
    });
    assert.equal(out.status, 200);
    assert.equal(out.body_preview, "probe-ok");
    assert.equal(out.bytes, 8);
    assert.match(out.sha256, /^[a-f0-9]{64}$/);
    assert.equal(out.headers.authorization, "<redacted>");
  } finally {
    await close(server);
  }
});

test("patch_preview is dry by default and backs up on apply", () => {
  const root = tempDir("zc-patch-");
  const file = path.join(root, "sample.ts");
  fs.writeFileSync(file, "const a = 1;\nconst b = 2;\n");
  const deps = depsFor(root);

  const preview = spec("patch_preview", deps).run({
    file: "sample.ts",
    old_string: "const b = 2;",
    new_string: "const b = 3;",
  });
  assert.equal(preview.applied, false);
  assert.equal(preview.matches, 1);
  assert.deepEqual(preview.diff, ["- const b = 2;", "+ const b = 3;"]);
  assert.equal(fs.readFileSync(file, "utf8"), "const a = 1;\nconst b = 2;\n");

  const applied = spec("patch_preview", deps).run({
    file: "sample.ts",
    old_string: "const b = 2;",
    new_string: "const b = 3;",
    apply: true,
  });
  assert.equal(applied.applied, true);
  assert.ok(applied.backup && fs.existsSync(applied.backup));
  assert.equal(fs.readFileSync(applied.backup, "utf8"), "const a = 1;\nconst b = 2;\n");
  assert.equal(fs.readFileSync(file, "utf8"), "const a = 1;\nconst b = 3;\n");

  const absent = spec("patch_preview", deps).run({
    file: "sample.ts",
    old_string: "missing",
    new_string: "x",
  });
  assert.equal(absent.matches, 0);
  assert.match(absent.error, /not found/);
});

test("env_get reports presence without leaking the value", () => {
  process.env.ZC_TEST_SECRET = "super-secret-value-123";
  try {
    const out = spec("env_get", depsFor(tempDir("zc-env-"))).run({ name: "ZC_TEST_SECRET" });
    assert.equal(out.present, true);
    assert.equal(out.length, 22);
    assert.match(out.sha256_12, /^[a-f0-9]{12}$/);
    assert.ok(!JSON.stringify(out).includes("super-secret-value-123"));

    const absent = spec("env_get", depsFor(tempDir("zc-env-"))).run({ name: "ZC_TEST_MISSING" });
    assert.equal(absent.present, false);
  } finally {
    delete process.env.ZC_TEST_SECRET;
  }
});

test("service_probe reaches a live port and reports a closed one", async () => {
  const live = net.createServer((socket) => socket.end());
  const livePort = await listen(live);

  const closed = net.createServer();
  const closedPort = await listen(closed);
  await close(closed);

  try {
    const deps = depsFor(tempDir("zc-service-"));
    const open = await spec("service_probe", deps).run({ host: "127.0.0.1", port: livePort });
    assert.equal(open.reachable, true);

    const down = await spec("service_probe", deps).run({ host: "127.0.0.1", port: closedPort, timeout_ms: 500 });
    assert.equal(down.reachable, false);
  } finally {
    await close(live);
  }
});
