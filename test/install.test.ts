import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "bin", "install.mjs");
const BASELINE = "opencode/big-pickle";

function withServer(
  handler: http.RequestListener,
  run: (base: string) => Promise<void>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", async () => {
      const info = server.address();
      const port = typeof info === "object" && info ? info.port : 0;
      const base = `http://127.0.0.1:${port}/v1`;
      try {
        await run(base);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

function runInstaller(
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", INSTALLER, ...args],
      { cwd: ROOT },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function installProject(
  base: string,
  extra: string[] = [],
): Promise<{ root: string; status: number | null; stdout: string; stderr: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-install-"));
  const result = await runInstaller([
    "--dir",
    root,
    "--yes",
    "--no-install",
    "--provider-url",
    base,
    ...extra,
  ]);
  return { root, ...result };
}

test("installer never writes provider/undefined when /models is empty", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [] }));
    },
    async (base) => {
      const result = await installProject(base);
      const { root } = result;
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(config.model, BASELINE);
        assert.ok(!String(config.model).endsWith("/undefined"));
        assert.equal(config.providers.missionbarisal.settings.apiKey, undefined);
        const zombiecoder = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(zombiecoder.installMode, "project");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

test("installer --config-dir creates a complete self-contained config root", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [] }));
    },
    async (base) => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-config-root-"));
      const configDir = path.join(parent, ".opencode");
      const result = await runInstaller([
        "--config-dir",
        configDir,
        "--yes",
        "--no-install",
        "--provider-url",
        base,
      ]);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        assert.ok(fs.existsSync(path.join(configDir, "opencode.json")));
        assert.ok(fs.existsSync(path.join(configDir, "agents", "manu.md")));
        assert.ok(fs.existsSync(path.join(configDir, "plugins", "zombiecoder.ts")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "config.json")));
        assert.ok(!fs.existsSync(path.join(parent, "opencode.json")));
        const config = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"));
        assert.equal(config.model, BASELINE);
        assert.equal(config.agents.manu.mode, "primary");
        const state = JSON.parse(
          fs.readFileSync(path.join(configDir, "zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(state.installMode, "global");
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});

test("installer replaces a previous free baseline when the provider becomes live", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "live-model" }] }));
    },
    async (base) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-upgrade-"));
      fs.writeFileSync(
        path.join(root, "opencode.json"),
        JSON.stringify({ model: BASELINE }, null, 2),
      );
      const result = await runInstaller([
        "--dir",
        root,
        "--yes",
        "--no-install",
        "--provider-url",
        base,
      ]);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(config.model, "missionbarisal/live-model");
        assert.equal(config.agents.manu.model, "missionbarisal/live-model");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

test("installer passes the provider key to the probe and to opencode.json", async () => {
  let authorization = "";
  await withServer(
    (req, res) => {
      authorization = String(req.headers.authorization ?? "");
      if (authorization !== "Bearer gateway-key") {
        res.writeHead(401, { "content-type": "application/json" }).end(
          JSON.stringify({ error: { message: "unauthorized" } }),
        );
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "live-model" }] }));
    },
    async (base) => {
      const result = await installProject(base, ["--provider-key", "gateway-key"]);
      const { root } = result;
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(authorization, "Bearer gateway-key");
        assert.equal(config.providers.missionbarisal.settings.apiKey, "gateway-key");
        assert.equal(config.model, "missionbarisal/live-model");
        assert.equal(config.agents.manu.model, "missionbarisal/live-model");
        const zombiecoder = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(zombiecoder.customProviderApiKey, "gateway-key");
        assert.ok(!result.stdout.includes("gateway-key"), "installer printed the key");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
