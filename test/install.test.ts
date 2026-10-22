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
  env: Record<string, string | null> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
      if (value === null) delete childEnv[key];
      else childEnv[key] = value;
    }
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", INSTALLER, ...args],
      { cwd: ROOT, env: childEnv },
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

test("installer --help exits without touching the target", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-help-"));
  const configDir = path.join(parent, ".opencode");
  const result = await runInstaller(["--help", "--config-dir", configDir]);
  try {
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.ok(!fs.existsSync(configDir), "--help created an install root");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

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

test("installer generates lsp config from resolvable server binaries", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-install-lsp-"));
  const configDir = path.join(parent, ".opencode");
  const bins = path.join(configDir, "lsp", "node_modules", ".bin");
  fs.mkdirSync(bins, { recursive: true });
  for (const name of [
    "typescript-language-server",
    "pyright-langserver",
    "bash-language-server",
    "vscode-json-language-server",
  ]) {
    const file = path.join(bins, process.platform === "win32" ? name + ".cmd" : name);
    fs.writeFileSync(file, "\n", "utf8");
    if (process.platform !== "win32") fs.chmodSync(file, 0o755);
  }
  const result = await runInstaller(
    ["--config-dir", configDir, "--yes", "--no-install", "--provider-url", "none"],
    { HOME: parent, XDG_CONFIG_HOME: path.join(parent, ".config") },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    assert.match(result.stdout, /sync LSP config/);
    const config = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"));
    for (const id of ["typescript", "python", "bash", "json"]) {
      assert.ok(config.lsp?.[id], `lsp.${id} missing`);
    }
    assert.equal(
      config.lsp.typescript.command[0],
      path.join(bins, process.platform === "win32" ? "typescript-language-server.cmd" : "typescript-language-server"),
    );
    assert.deepEqual(config.lsp.typescript.command.slice(1), ["--stdio"]);
    assert.ok(config.lsp.typescript.extensions.includes(".ts"));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
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
        "--origin-url",
        "https://origin.example",
      ]);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        assert.ok(fs.existsSync(path.join(configDir, "opencode.json")));
        assert.ok(fs.existsSync(path.join(configDir, "agents", "manu.md")));
        assert.ok(fs.existsSync(path.join(configDir, "plugins", "zombiecoder.ts")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "config.json")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "tools", "evidence_gate.py")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "tls", "nginx.conf.template")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "docs", "100c-runtime-template.md")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "model.mjs")));
        assert.ok(!fs.existsSync(path.join(parent, "opencode.json")));
        const config = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"));
        assert.equal(config.model, BASELINE);
        assert.equal(config.agents.manu.mode, "primary");
        const state = JSON.parse(
          fs.readFileSync(path.join(configDir, "zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(state.installMode, "global");
        assert.equal(state.originUrl, "https://origin.example");
        if (process.platform !== "win32") {
          assert.equal(fs.statSync(path.join(configDir, "opencode.json")).mode & 0o777, 0o600);
          assert.equal(
            fs.statSync(path.join(configDir, "zombiecoder", "config.json")).mode & 0o777,
            0o600,
          );
          assert.equal(
            fs.statSync(path.join(configDir, "plugins", "zombiecoder", "plugin.ts")).mode & 0o777,
            0o644,
            "installed runtime files must not stay world-writable",
          );
        }
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});

test("installer links a self-contained home to OpenCode's canonical loader", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-link-home-"));
  const selfRoot = path.join(home, ".opencode");
  const canonical = path.join(home, ".config", "opencode");
  fs.mkdirSync(path.join(selfRoot, "node_modules"), { recursive: true });
  const result = await runInstaller(
    ["--config-dir", selfRoot, "--yes", "--no-install", "--provider-url", "none"],
    { HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    for (const item of ["opencode.json", "agents", "plugins", "zombiecoder", "node_modules", "package.json"]) {
      const link = path.join(canonical, item);
      if (process.platform !== "win32") {
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${item} should link into the self-contained root`);
      }
      assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(selfRoot, item)));
    }
    assert.match(result.stdout, /link self-contained root to global loader/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer uses free agent assignments when the project environment URL is empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-free-env-"));
  const roster = await import("../src/roster.ts");
  const assignment = Object.fromEntries(
    roster.ROSTER.map((agent, index) => [agent.id, `opencode/free-model-${index + 1}`]),
  );
  fs.writeFileSync(
    path.join(root, ".environment"),
    "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL=\n",
  );
  fs.writeFileSync(
    path.join(root, "opencode.json"),
    JSON.stringify({ agents: roster.renderAgentsConfig(roster.ROSTER, assignment) }, null, 2),
  );
  const result = await runInstaller(
    ["--dir", root, "--yes", "--no-install"],
    { EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null, ZOMBIECODER_PROVIDER_URL: null },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
    assert.equal(config.model, undefined);
    for (const agent of roster.ROSTER) {
      assert.equal(config.agents[agent.id].model, assignment[agent.id]);
    }
    const state = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"));
    assert.equal(state.customProviderUrl, "");
    assert.equal(state.modelStrategy, "free");
    const plan = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "models.json"), "utf8"));
    assert.equal(plan.strategy, "free-fallback");
    assert.match(result.stdout, /modelStrategy: free/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer reads the compatible URL from the project .environment file", async () => {
  await withServer(
    providerHandler,
    async (base) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-environment-url-"));
      const apiKey = "project-provider-secret-123";
      fs.writeFileSync(
        root + "/.environment",
        [
          `EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL=${base}`,
          `EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY=${apiKey}`,
          "",
        ].join("\n"),
      );
      const result = await runInstaller(
        ["--dir", root, "--yes", "--no-install"],
        { EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null, ZOMBIECODER_PROVIDER_URL: null },
      );
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(config.providers.missionbarisal.settings.baseURL, base);
        assert.equal(config.providers.missionbarisal.settings.apiKey, apiKey);
        assert.equal(config.agents.manu.model, "missionbarisal/live-model");
        const state = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"));
        assert.equal(state.customProviderUrl, base);
        assert.equal(state.customProviderApiKey, apiKey);
        assert.equal(state.modelStrategy, "auto");
        assert.ok(!result.stdout.includes(apiKey));
        assert.ok(!result.stderr.includes(apiKey));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

test("installer reads and registers the MCP URL from the project .environment file", async () => {
  await withServer(
    (req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += String(chunk)));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        res.setHeader("content-type", "application/json");
        if (body.method === "notifications/initialized") {
          res.statusCode = 202;
          res.end();
          return;
        }
        const result =
          body.method === "initialize"
            ? {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "test-mcp", version: "1.0.0" },
              }
            : { tools: [{ name: "example" }] };
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      });
    },
    async (base) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-environment-mcp-"));
      fs.writeFileSync(root + "/.environment", `EXTERNAL_MCP_URL=${base}\n`);
      const result = await runInstaller(
        ["--dir", root, "--yes", "--no-install"],
        { EXTERNAL_MCP_URL: null, ZOMBIECODER_MCP_URL: null },
      );
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(config.mcp.servers.zombiecoder.url, base);
        const state = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"));
        assert.equal(state.mcpUrl, base);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

function providerHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === "POST" && String(req.url ?? "").endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* fall through to a plain chat answer */
      }
      res.setHeader("content-type", "application/json");
      if (Array.isArray(body.tools)) {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "get_time", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "pong" } }],
          usage: { prompt_tokens: 10 },
          timings: { prompt_n: 10, prompt_ms: 1 },
        }),
      );
    });
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: [{ id: "live-model" }] }));
}

test("installer replaces a previous free baseline when the provider becomes live", async () => {
  await withServer(
    providerHandler,
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

function slowProviderHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === "POST" && String(req.url ?? "").endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* ignore */
      }
      res.setHeader("content-type", "application/json");
      if (Array.isArray(body.tools)) {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "get_time", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "pong" } }],
          usage: { prompt_tokens: 10 },
          timings: { prompt_n: 10, prompt_ms: 2500 },
        }),
      );
    });
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: [{ id: "live-model" }] }));
}

test("a slow provider is saved but not selected, and stale models are removed", async () => {
  await withServer(
    slowProviderHandler,
    async (base) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-slow-"));
      fs.writeFileSync(
        path.join(root, "opencode.json"),
        JSON.stringify(
          {
            model: "missionbarisal/old-model",
            providers: {
              missionbarisal: {
                settings: { baseURL: "http://old.test/v1", apiKey: "old-key" },
                models: { "old-model": { name: "old-model" } },
              },
            },
            agents: { manu: { model: "missionbarisal/old-model" } },
          },
          null,
          2,
        ),
      );
      const result = await runInstaller([
        "--dir",
        root,
        "--yes",
        "--no-install",
        "--provider-url",
        base,
        "--provider-key",
        "test-key",
      ]);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        assert.match(result.stdout, /slow prompt processing/);
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(config.model, BASELINE);
        assert.equal(config.agents.manu.model, BASELINE);
        assert.deepEqual(Object.keys(config.providers.missionbarisal.models), ["live-model"]);
        assert.ok(!("old-model" in config.providers.missionbarisal.models));
        const zombiecoder = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(zombiecoder.modelStrategy, "baseline");
        const plan = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "models.json"), "utf8"),
        );
        assert.equal(plan.providerUsable, false);
        assert.equal(plan.providerSlow, true);
        assert.equal(plan.assignment.manu, BASELINE);
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
      providerHandler(req, res);
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
        if (process.platform !== "win32") {
          assert.equal(fs.statSync(path.join(root, "opencode.json")).mode & 0o777, 0o600);
          assert.equal(
            fs.statSync(path.join(root, ".zombiecoder", "config.json")).mode & 0o777,
            0o600,
          );
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
