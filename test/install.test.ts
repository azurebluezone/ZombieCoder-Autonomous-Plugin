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

        // The bundled MCP servers answered a real tools/list handshake.
        assert.match(result.stdout, /verify MCP tools \(stdio\).*image-brand=6/);
        // Native global skill: SKILL.md, not only the legacy flat file.
        const nativeSkill = path.join(
          root,
          ".opencode",
          "skills",
          "first-principles",
          "SKILL.md",
        );
        assert.ok(fs.existsSync(nativeSkill), "native first-principles/SKILL.md missing");
        assert.match(fs.readFileSync(nativeSkill, "utf8"), /^name: first-principles$/m);
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
        assert.equal(config.agents.manu.mode, "all");
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
    for (const item of ["opencode.json", "agents", "zombiecoder", "node_modules", "package.json"]) {
      const link = path.join(canonical, item);
      if (process.platform !== "win32") {
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${item} should link into the self-contained root`);
      }
      assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(selfRoot, item)));
    }
    // Both config roots are scanned; linking plugins would register the same
    // entry twice ("Duplicate plugin ID"). The self-contained root keeps it.
    assert.equal(fs.existsSync(path.join(canonical, "plugins")), false, "plugins must not be linked");
    assert.ok(fs.existsSync(path.join(selfRoot, "plugins", "zombiecoder.ts")));
    assert.match(result.stdout, /link self-contained root to global loader/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer retires a generated legacy home plugin entry instead of loading it twice", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-duplicate-home-"));
  const legacyRoot = path.join(home, ".opencode");
  const legacyEntry = path.join(legacyRoot, "plugins", "zombiecoder.ts");
  const legacyDir = path.join(legacyRoot, "plugins", "zombiecoder");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    legacyEntry,
    '// GENERATED by zombiecoder-opencode — do not hand edit.\nexport { default } from "./zombiecoder/plugin.ts";\n',
  );
  fs.writeFileSync(path.join(legacyDir, "marker.txt"), "legacy copy\n");
  const result = await runInstaller(
    ["--global", "--yes", "--no-install", "--no-lsp", "--provider-url", "none"],
    {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    const globalEntry = path.join(home, ".config", "opencode", "plugins", "zombiecoder.ts");
    assert.ok(fs.existsSync(globalEntry), "the global entrypoint must exist");
    assert.equal(fs.existsSync(legacyEntry), false, "the legacy entrypoint must not register a second plugin");
    const backups = fs
      .readdirSync(path.join(legacyRoot, ".backups"))
      .filter((name) => name.startsWith("duplicate-plugin-"));
    assert.equal(backups.length, 1, "the legacy entry must be backed up exactly once");
    const backup = path.join(legacyRoot, ".backups", backups[0]);
    assert.ok(fs.existsSync(path.join(backup, "zombiecoder.ts")));
    assert.ok(fs.existsSync(path.join(backup, "zombiecoder", "marker.txt")));
    assert.match(result.stdout, /retired/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer replaces a symlinked legacy plugin directory with one real canonical copy", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-symlink-home-"));
  const legacyRoot = path.join(home, ".opencode");
  const legacyPlugins = path.join(legacyRoot, "plugins");
  const canonicalRoot = path.join(home, ".config", "opencode");
  const canonicalPlugins = path.join(canonicalRoot, "plugins");
  fs.mkdirSync(path.join(legacyPlugins, "zombiecoder"), { recursive: true });
  fs.writeFileSync(
    path.join(legacyPlugins, "zombiecoder.ts"),
    '// GENERATED by zombiecoder-opencode — do not hand edit.\nexport { default } from "./zombiecoder/plugin.ts";\n',
  );
  fs.writeFileSync(path.join(legacyPlugins, "zombiecoder", "marker.txt"), "legacy copy\n");
  fs.mkdirSync(canonicalRoot, { recursive: true });
  fs.symlinkSync(legacyPlugins, canonicalPlugins, "dir");

  const result = await runInstaller(
    ["--global", "--yes", "--no-install", "--no-lsp", "--provider-url", "none"],
    {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    assert.equal(fs.lstatSync(canonicalPlugins).isSymbolicLink(), false, "the canonical plugins path must become real");
    assert.ok(fs.existsSync(path.join(canonicalPlugins, "zombiecoder.ts")));
    assert.ok(fs.existsSync(path.join(canonicalPlugins, "zombiecoder", "plugin.ts")));
    assert.equal(fs.existsSync(path.join(legacyPlugins, "zombiecoder.ts")), false);
    const backups = fs
      .readdirSync(path.join(legacyRoot, ".backups"))
      .filter((name) => name.startsWith("duplicate-plugin-"));
    assert.equal(backups.length, 1);
    const backup = path.join(legacyRoot, ".backups", backups[0]);
    assert.ok(fs.existsSync(path.join(backup, "plugins.symlink")));
    assert.ok(fs.existsSync(path.join(backup, "zombiecoder.ts")));
    assert.ok(fs.existsSync(path.join(backup, "zombiecoder", "marker.txt")));
    assert.match(result.stdout, /retired/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer leaves a hand-written legacy plugin entry alone", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-handwritten-home-"));
  const legacyEntry = path.join(home, ".opencode", "plugins", "zombiecoder.ts");
  fs.mkdirSync(path.dirname(legacyEntry), { recursive: true });
  fs.writeFileSync(legacyEntry, "// my own plugin\nexport default {};\n");
  const result = await runInstaller(
    ["--global", "--yes", "--no-install", "--no-lsp", "--provider-url", "none"],
    {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    assert.equal(fs.readFileSync(legacyEntry, "utf8"), "// my own plugin\nexport default {};\n");
    assert.match(result.stdout, /kept \(not generated/i);
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
    // Pins off (default): one root default, no per-agent model. The agent models
    // the fixture wrote are removed so they cannot override a /models choice.
    assert.equal(config.model, BASELINE);
    for (const agent of roster.ROSTER) {
      assert.equal(config.agents[agent.id].model, undefined);
    }
    const state = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"));
    assert.equal(state.customProviderUrl, "");
    assert.equal(state.modelStrategy, "free");
    const plan = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "models.json"), "utf8"));
    assert.equal(plan.strategy, "free-fallback");
    assert.match(result.stdout, /modelStrategy: free/);
    const markdown = fs.readFileSync(path.join(root, ".opencode", "agents", "manu.md"), "utf8");
    assert.doesNotMatch(markdown, /^model:/m, "pins off: markdown must not pin a model");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer keeps per-agent model pins when agentModelPins is true", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-pins-"));
  const roster = await import("../src/roster.ts");
  const assignment = Object.fromEntries(
    roster.ROSTER.map((agent, index) => [agent.id, `opencode/free-model-${index + 1}`]),
  );
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
  fs.writeFileSync(
    path.join(root, "opencode.json"),
    JSON.stringify({ agents: roster.renderAgentsConfig(roster.ROSTER, assignment, true) }, null, 2),
  );
  const result = await runInstaller(
    ["--dir", root, "--yes", "--no-install"],
    {
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
      EXTERNAL_MCP_URL: null,
      ZOMBIECODER_PROVIDER_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
    // Pins on: the agent -> model mapping is authoritative, so no root model.
    assert.equal(config.model, undefined);
    for (const agent of roster.ROSTER) {
      assert.equal(config.agents[agent.id].model, assignment[agent.id]);
    }
    const markdown = fs.readFileSync(path.join(root, ".opencode", "agents", "manu.md"), "utf8");
    assert.match(markdown, /^model: opencode\/free-model-1$/m);
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
        assert.equal(config.agents.manu.model, undefined);
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
        assert.equal(config.agents.manu.model, undefined);
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
        assert.equal(config.agents.manu.model, undefined);
        assert.deepEqual(Object.keys(config.providers.missionbarisal.models), ["live-model"]);
        assert.ok(!("old-model" in config.providers.missionbarisal.models));
        const zombiecoder = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(zombiecoder.modelStrategy, "free");
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
        assert.equal(config.agents.manu.model, undefined);
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

test("installer copies and registers the in-repo MCP servers", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [] }));
    },
    async (base) => {
      const result = await installProject(base);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(
          fs.readFileSync(path.join(result.root, "opencode.json"), "utf8"),
        );
        for (const name of ["image-brand", "public-api"]) {
          const entry = config.mcp?.servers?.[name];
          assert.ok(entry, `mcp.${name} missing`);
          assert.equal(entry.type, "local");
          assert.ok(
            fs.existsSync(entry.command[1]),
            `mcp.${name} command points at a missing file: ${entry.command[1]}`,
          );
          assert.match(entry.command[1], new RegExp(`[\\\\/]mcp[\\\\/]${name}[\\\\/]server\\.mjs$`));
        }
      } finally {
        fs.rmSync(result.root, { recursive: true, force: true });
      }
    },
  );
});
