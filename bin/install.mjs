#!/usr/bin/env node
// ZombieCoder install pipeline — spec §7.
//
// Two install shapes:
//   default (--global) : the OpenCode config directory (Linux/macOS ~/.config/opencode,
//                        Windows %USERPROFILE%\.config\opencode). One install covers
//                        every working directory; no .opencode is created in projects.
//   --dir <path>       : a project-local install in <path>/.opencode.
//   --home             : legacy OS-root install in <home>/.opencode.
//
// In global mode the installer writes:
//   <global>/opencode.json      provider + models + V2 agents + permissions + MCP
//   <global>/agents/*.md        persona markdown (second documented agent door)
//   <global>/plugins/…          plugin runtime + entrypoint
//   <global>/zombiecoder/…      internal config/model-plan/MCP probe state
//
// Per working directory the runtime creates only .zombiecoder (SSOT, syllabus,
// memory, .state). Project config/models/fingerprint/footprint/mcp are not
// created. Skills live once at <install>/zombiecoder/skills, shared by every
// working directory; the installer seeds the offline catalog and the runtime
// `skill_catalog` tool fetches a named skill on demand. No .opencode and no
// skills directory is created in arbitrary working directories.
//
// NO backups, NO .bak files, NO archives: the owner keeps their own. Writes are atomic
// (temp + rename) and existing files are only replaced when the content actually differs.
//
// Usage:
//   node --experimental-strip-types bin/install.mjs
//   node --experimental-strip-types bin/install.mjs --global
//   node --experimental-strip-types bin/install.mjs --dir /path/to/project
//   node --experimental-strip-types bin/install.mjs --home
//   node --experimental-strip-types bin/install.mjs --no-install
//   node --experimental-strip-types bin/install.mjs --no-provider-config
//   node --experimental-strip-types bin/install.mjs --provider-url https://host/v1
//   node --experimental-strip-types bin/install.mjs --provider-id my-gateway
//   node --experimental-strip-types bin/install.mjs --origin-url https://origin.example
//   ZOMBIECODER_PROVIDER_KEY=... node --experimental-strip-types bin/install.mjs
//   node --experimental-strip-types bin/install.mjs --provider-key <key>
//   node --experimental-strip-types bin/install.mjs --config-dir ~/.opencode
//
// --config-dir makes one directory the complete install root: opencode.json,
// agents/, plugins/, node_modules/ and zombiecoder/config.json all live inside
// it. That is different from --dir, which keeps the project's opencode.json at
// the project root and .opencode only for OpenCode-owned files.
//
// The provider API key is read from --provider-key, ZOMBIECODER_PROVIDER_KEY
// (or ZOMBIECODER_API_KEY), or the previous install. It is written to
// opencode.json because OpenCode needs it, and is never printed by this script.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");
const PKG = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));

// Fail early and in plain language: this file imports .ts modules below, and old
// Node versions otherwise die with ERR_UNKNOWN_FILE_EXTENSION.
if (!nodeVersionAtLeast(process.versions.node, "22.6.0")) {
  console.error(
    `ZombieCoder needs Node.js 22.6 or newer (found ${process.version}). ` +
      "Install the LTS build from https://nodejs.org and run the installer again.",
  );
  process.exit(1);
}
function nodeVersionAtLeast(current, minimum) {
  const a = current.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

// Import the runtime's own defaults instead of copying provider URLs, IDs,
// baseline model or API URL into this installer.
const defaults = await import(
  pathToFileURL(path.join(PACKAGE_ROOT, "src", "zombie", "defaults.ts")).href
);
const modelsModule = await import(
  pathToFileURL(path.join(PACKAGE_ROOT, "src", "zombie", "models.ts")).href
);
const { redact } = await import(
  pathToFileURL(path.join(PACKAGE_ROOT, "src", "zombie", "io.ts")).href
);
const {
  DEFAULT_CUSTOM_PROVIDER_URL,
  DEFAULT_CUSTOM_PROVIDER_ID,
  DEFAULT_CUSTOM_PROVIDER_KEY,
  DEFAULT_OPENCODE_API_URL,
  DEFAULT_MCP_URL: DEFAULT_MCP_URL_FROM_DEFAULTS,
  BASELINE_MODEL,
} = defaults;
const { modelRef } = modelsModule;
const { DEFAULT_SKILL_REPO } = await import(
  pathToFileURL(path.join(PACKAGE_ROOT, "src", "zombie", "skillCatalog.ts")).href
);
// LSP detection/config is shared with the tests and the runtime docs.
const { lspPackageList, resolveLspServers, syncLspConfig } = await import(
  pathToFileURL(path.join(PACKAGE_ROOT, "src", "zombie", "lspConfig.ts")).href
);

const argv = process.argv.slice(2);
function flag(name) {
  return argv.indexOf(name) >= 0;
}
function value(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

// --help must be side-effect free. Before this guard, `install.mjs --help`
// performed a full install and overwrote config.
if (flag("--help") || flag("-h")) {
  console.log(`ZombieCoder install — ${PKG.name} v${PKG.version}

Usage:
  node --experimental-strip-types bin/install.mjs [options]

Modes:
  (default)              standard global install in ~/.config/opencode
  --global               explicit global install
  --dir <path>           project-local install in <path>/.opencode
  --home                 legacy OS-root install in ~/.opencode
  --config-dir <path>    self-contained install root

Options:
  --provider-url <url>   OpenAI-compatible gateway URL; "none" disables it
  --provider-id <id>     provider ID used in opencode.json
  --provider-key <key>   provider key; prefer ZOMBIECODER_PROVIDER_KEY
  --model-strategy <s>   auto | custom | free | baseline | random (default: auto)
  --fast                 free/baseline model; disables the custom provider
  --allow-slow           keep a provider even when prompt throughput is below 20 tok/s
  --no-probe-tools       skip the tool-call capability probe
  --mcp-url <url>        optional MCP server URL
  --origin-url <url>     optional public origin handshake URL
  --no-install           skip npm install
  --no-lsp               skip LSP server install + lsp config generation
  --no-provider-config   skip opencode.json provider/agent merge
  --yes, --defaults      non-interactive install
  --help, -h             show this help and exit
  --version, -v          show the package version and exit
`);
  process.exit(0);
}
if (flag("--version") || flag("-v")) {
  console.log(PKG.version);
  process.exit(0);
}

const GLOBAL_DIR = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  "opencode",
);
const HOME_MODE = flag("--home");
const DIR_FLAG = value("--dir", null);
const CONFIG_DIR_FLAG = value("--config-dir", null);
const SELF_MODE = CONFIG_DIR_FLAG !== null;
const GLOBAL_MODE = !SELF_MODE && !HOME_MODE && (flag("--global") || DIR_FLAG === null);

// The owner's rule: one global install, every working directory underneath it.
// os.homedir() and XDG_CONFIG_HOME are resolved per platform, so no OS path is
// hardcoded. --dir keeps the old project-local shape available. --config-dir
// makes that directory the complete root (config + agents + plugins + state).
const TARGET = path.resolve(
  SELF_MODE ? CONFIG_DIR_FLAG : GLOBAL_MODE ? GLOBAL_DIR : HOME_MODE ? os.homedir() : DIR_FLAG,
);
const CONFIG_DIR = SELF_MODE || GLOBAL_MODE ? TARGET : path.join(TARGET, ".opencode");
const ZOMBIE_DIR =
  SELF_MODE || GLOBAL_MODE ? path.join(TARGET, "zombiecoder") : path.join(TARGET, ".zombiecoder");
const PLUGINS_DIR = path.join(CONFIG_DIR, "plugins");
const AGENTS_DIR = path.join(CONFIG_DIR, "agents");
const RUNTIME_ASSETS_DIR = path.join(CONFIG_DIR, "zombiecoder");
const ENTRY = path.join(PLUGINS_DIR, "zombiecoder.ts");
const OPENCODE_JSON = path.join(TARGET, "opencode.json");
const OPENCODE_JSONC = path.join(TARGET, "opencode.jsonc");
const ZOMBIE_CONFIG = path.join(ZOMBIE_DIR, "config.json");

// sudo installs create root-owned files that the normal user cannot update
// later. Warn instead of failing: containers legitimately run as root.
if (typeof process.getuid === "function" && process.getuid() === 0 && !process.env.ZOMBIECODER_ALLOW_ROOT) {
  console.warn(
    `[zc] WARN running as root; ${TARGET} will be owned by root. ` +
      "Run the installer as your normal user instead (set ZOMBIECODER_ALLOW_ROOT=1 to silence).",
  );
}

const DO_INSTALL = !flag("--no-install");
const DO_PROVIDER_CONFIG = !flag("--no-provider-config");
const DO_LSP = !flag("--no-lsp");
const FAST_MODE = flag("--fast");
const ALLOW_SLOW = flag("--allow-slow");
const PROBE_TOOLS = !flag("--no-probe-tools");
const MODEL_STRATEGY_FLAG = value("--model-strategy", null);
const ALLOWED_STRATEGIES = new Set(["auto", "custom", "free", "baseline", "random"]);
if (MODEL_STRATEGY_FLAG !== null && !ALLOWED_STRATEGIES.has(String(MODEL_STRATEGY_FLAG))) {
  console.error(
    `invalid --model-strategy: ${MODEL_STRATEGY_FLAG} (use auto, custom, free, baseline or random)`,
  );
  process.exit(2);
}
const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";
const DEFAULT_PROVIDER_URL = DEFAULT_CUSTOM_PROVIDER_URL;
const DEFAULT_MCP_URL = DEFAULT_MCP_URL_FROM_DEFAULTS;

function cleanUrl(input, fallback) {
  if (input === null || input === undefined) return fallback;
  const value = String(input).trim();
  if (!value || /^(none|skip|no)$/i.test(value)) return "";
  return value;
}

const providerFlag = value("--provider-url", null);
const providerIdFlag = value("--provider-id", null);
const providerKeyFlag = value("--provider-key", null);
const mcpFlag = value("--mcp-url", null);
const originFlag = value("--origin-url", null);

// Environment wins over a previous install, matching the runtime's loadConfig().
const envText = (name) => {
  const raw = process.env[name];
  const text = typeof raw === "string" ? raw.trim() : "";
  return text || null;
};
function readEnvironmentFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

const environmentRoot = SELF_MODE || GLOBAL_MODE || HOME_MODE ? PACKAGE_ROOT : TARGET;
const environmentFile = readEnvironmentFile(path.join(environmentRoot, ".environment"));
const externalProviderKey = "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL";
const externalProviderValue = Object.prototype.hasOwnProperty.call(process.env, externalProviderKey)
  ? String(process.env[externalProviderKey] ?? "")
  : environmentFile[externalProviderKey];
const environmentProviderApiKey = environmentFile.EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY;
const environmentMcpUrl = environmentFile.EXTERNAL_MCP_URL;
const envProviderId = envText("ZOMBIECODER_PROVIDER_ID");
const envProviderUrl = envText("ZOMBIECODER_PROVIDER_URL");
const envMcpUrl = envText("ZOMBIECODER_MCP_URL");
const envOriginUrl = envText("ZOMBIECODER_ORIGIN_URL");

// Re-install should remember the owner's previous answer instead of silently
// resetting it to the shipped default.
function priorConfig() {
  try {
    return JSON.parse(fs.readFileSync(ZOMBIE_CONFIG, "utf8"));
  } catch {
    return {};
  }
}
const previous = priorConfig();
const initialProvider =
  providerFlag !== null
    ? cleanUrl(providerFlag, DEFAULT_PROVIDER_URL)
    : externalProviderValue !== undefined
      ? cleanUrl(externalProviderValue, "")
      : envProviderUrl ??
        (typeof previous.customProviderUrl === "string" &&
        previous.customProviderUrl !== DEFAULT_PROVIDER_URL
          ? previous.customProviderUrl
          : "");
// Per-agent model pins are opt-in and live in the seeded config. Read them at
// each use instead of caching, because the seed step runs later than this line.
function modelPinsEnabled() {
  try {
    return JSON.parse(fs.readFileSync(ZOMBIE_CONFIG, "utf8")).agentModelPins === true;
  } catch {
    return false;
  }
}

const initialMcp =
  mcpFlag !== null
    ? cleanUrl(mcpFlag, DEFAULT_MCP_URL)
    : envText("EXTERNAL_MCP_URL") ??
      envMcpUrl ??
      (typeof environmentMcpUrl === "string" && environmentMcpUrl.trim()
        ? cleanUrl(environmentMcpUrl, "")
        : null) ??
      (typeof previous.mcpUrl === "string" ? previous.mcpUrl : DEFAULT_MCP_URL);
const originProvided = originFlag !== null || envOriginUrl !== null;
const ORIGIN_URL = originProvided
  ? cleanUrl(originFlag ?? envOriginUrl, "")
  : typeof previous.originUrl === "string"
    ? previous.originUrl
    : "";

let PROVIDER_URL = initialProvider;
let MCP_URL = initialMcp;
if (FAST_MODE) PROVIDER_URL = "";
const INSTALL_MODEL_STRATEGY = MODEL_STRATEGY_FLAG ?? (PROVIDER_URL ? "auto" : "free");

// Provider identity and credential, resolved once. A flag wins, then the
// environment, then the previous install, then the shipped default. The key is
// never printed.
const PROVIDER_ID =
  String(
    providerIdFlag ?? envProviderId ?? previous.customProviderID ?? DEFAULT_CUSTOM_PROVIDER_ID,
  ).trim() || DEFAULT_CUSTOM_PROVIDER_ID;
let PROVIDER_KEY =
  providerKeyFlag !== null
    ? String(providerKeyFlag).trim()
    : (envText("EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY") ??
      envText("ZOMBIECODER_PROVIDER_KEY") ??
      envText("ZOMBIECODER_API_KEY") ??
      (typeof environmentProviderApiKey === "string" && environmentProviderApiKey.trim()
        ? environmentProviderApiKey.trim()
        : "")) ||
      DEFAULT_CUSTOM_PROVIDER_KEY ||
      (typeof previous.customProviderApiKey === "string"
        ? previous.customProviderApiKey.trim()
        : "");

// Ask only when a human is actually there. CI and `--yes` use the flags or the
// documented defaults, so an automated install can never hang on a prompt.
const INTERACTIVE = Boolean(process.stdin.isTTY) && !flag("--yes") && !flag("--defaults");
if (INTERACTIVE) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("");
    console.log("ZombieCoder setup — press Enter to accept the bracketed value.");
    if (providerFlag === null) {
      const shown = initialProvider || "none";
      const answer = (
        await rl.question(
          `OpenAI-compatible URL [${shown}] ("none" = OpenCode free models only): `,
        )
      ).trim();
      PROVIDER_URL = cleanUrl(answer, initialProvider);
    }
    if (mcpFlag === null) {
      const shown = initialMcp || "skip";
      const answer = (await rl.question(`MCP URL [${shown}]: `)).trim();
      MCP_URL = cleanUrl(answer, initialMcp);
    }
    console.log("");
  } finally {
    rl.close();
  }
}

const report = {
  target: TARGET,
  mode: SELF_MODE || GLOBAL_MODE ? "global" : HOME_MODE ? "home" : "project",
  steps: [],
};
let mcpProbe = null;
let providerProbe = null;
let chatProbe = null;
let toolProbe = null;
let providerSlow = false;
let providerReachable = false;
let candidates = [];
let installAssignment = {};

async function step(name, fn) {
  try {
    const detail = await fn();
    report.steps.push({ step: name, ok: true, detail: typeof detail === "string" ? detail : undefined });
    return detail;
  } catch (error) {
    const message = redact(String(error?.message ?? error));
    report.steps.push({ step: name, ok: false, error: message });
    console.error(`  FAIL  ${name}: ${message}`);
    return undefined;
  }
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      throw new Error(
        `cannot write ${dir} (${error.code}). If an earlier sudo install created it, ` +
          `fix ownership first: sudo chown -R "$USER" "${dir}" — then run the installer as your normal user.`,
      );
    }
    throw error;
  }
}

function writeIfChanged(file, content) {
  ensureDir(path.dirname(file));
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === content) return false;
  // Preserve an existing mode: opencode.json and zombiecoder/config.json carry
  // the provider key and must not become world-readable after an install.
  let mode = 0o644;
  try {
    if (fs.existsSync(file)) mode = fs.statSync(file).mode & 0o777;
  } catch {
    /* keep the default */
  }
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode });
  fs.renameSync(tmp, file);
  return true;
}

function secureSecretFile(file) {
  // POSIX mode 600; on Windows chmod is best-effort and may be a no-op.
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}

function mergeJson(file, patch) {
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const merged = { ...existing, ...patch };
  merged.dependencies = { ...(existing.dependencies ?? {}), ...(patch.dependencies ?? {}) };
  merged.scripts = { ...(existing.scripts ?? {}), ...(patch.scripts ?? {}) };
  writeIfChanged(file, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

// A git checkout may carry executable bits from the author's machine (or an
// umask 000 shell). Installed runtime files are read-only data, so normalize
// them: 0644 files, 0755 directories. Best effort on Windows.
function normalizeModes(dir, fileMode = 0o644, dirMode = 0o755) {
  let files = 0;
  const walk = (current) => {
    try {
      fs.chmodSync(current, dirMode);
    } catch {
      /* best effort */
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          fs.chmodSync(full, fileMode);
          files += 1;
        } catch {
          /* best effort */
        }
      }
    }
  };
  walk(dir);
  return files;
}

function listFiles(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), r));
    else out.push(r);
  }
  return out;
}

// A self-contained ~/.opencode install still needs the global loader at
// ~/.config/opencode. Make that loader point at one copy instead of leaving
// stale regular files behind. Only the documented default root is linked.
// Windows symlinks need Developer Mode/Administrator; a junction needs neither.
// If even a junction is denied, copy instead so the install still completes.
// Linux/macOS keep real symlinks. The step detail reports any copies so a stale
// copy after an update is visible instead of silently wrong.
function linkEntry(source, link) {
  const isDir = fs.statSync(source).isDirectory();
  try {
    fs.symlinkSync(
      source,
      link,
      isDir ? (process.platform === "win32" ? "junction" : "dir") : "file",
    );
    return "symlink";
  } catch {
    if (isDir) {
      try {
        fs.symlinkSync(source, link, "junction");
        return "junction";
      } catch {
        /* fall through to copy */
      }
    }
    try {
      fs.cpSync(source, link, { recursive: true, force: true });
      return "copy";
    } catch (copyError) {
      throw new Error(
        `cannot link or copy ${source} -> ${link}: ${copyError?.message ?? copyError}. ` +
          `Check ownership of ${path.dirname(link)} (sudo chown -R "$USER" ...), ` +
          "or enable symlinks with Windows Developer Mode.",
      );
    }
  }
}

function linkSelfContainedGlobal() {
  if (!SELF_MODE) return "skipped (not --config-dir)";
  const selfRoot = path.resolve(TARGET);
  const defaultSelfRoot = path.resolve(path.join(os.homedir(), ".opencode"));
  if (selfRoot !== defaultSelfRoot) return "skipped (not the default ~/.opencode root)";
  const globalDir = path.resolve(GLOBAL_DIR);
  if (globalDir === selfRoot) return "not needed (target is the global directory)";

  ensureDir(globalDir);
  const items = ["opencode.json", "agents", "plugins", "zombiecoder", "node_modules", "package.json"];
  const linked = [];
  const modes = [];
  const backups = path.join(globalDir, ".backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const item of items) {
    const source = path.join(selfRoot, item);
    if (!fs.existsSync(source)) continue;
    const link = path.join(globalDir, item);
    let current = null;
    try {
      current = fs.readlinkSync(link);
    } catch {
      /* regular file/directory or absent */
    }
    if (current && path.resolve(path.dirname(link), current) === source) {
      linked.push(item);
      modes.push("symlink");
      continue;
    }
    if (fs.existsSync(link) || current) {
      ensureDir(backups);
      fs.renameSync(link, path.join(backups, `${item}-${stamp}`));
    }
    modes.push(linkEntry(source, link));
    linked.push(item);
  }
  const copied = modes.filter((mode) => mode === "copy").length;
  const suffix = copied
    ? ` (${copied} copied: symlink not permitted — enable Developer Mode, or re-run the installer after every update)`
    : "";
  return `${linked.length} linked: ${linked.sort().join(", ")}${suffix}`;
}

// OpenAI-compatible gateways disagree about the envelope. A `data` array of ids is
// the one thing every implementation returns, so that is what we accept.
async function probeProviderModels(url, timeoutMs = 5000, apiKey = "") {
  const base = String(url).replace(/\/+$/, "");
  const target = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  const headers = {};
  if (String(apiKey).trim()) headers.authorization = `Bearer ${String(apiKey).trim()}`;
  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    });
    if (!response.ok) return { ok: false, url: target, models: [], error: `HTTP ${response.status}` };
    const body = await response.json();
    if (!Array.isArray(body?.data)) {
      return { ok: false, url: target, models: [], error: "response has no data[]" };
    }
    const models = body.data.map((m) => m?.id).filter((id) => typeof id === "string");
    return { ok: true, url: target, models, error: models.length ? undefined : "empty model list" };
  } catch (error) {
    return { ok: false, url: target, models: [], error: String(error?.message ?? error) };
  }
}

function chatEndpoint(url) {
  const base = String(url).replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

// /v1/models only proves that a gateway is alive. It does not prove that the
// model can answer, that tools work, or that prompt processing is fast enough
// for an agent. The installer probes all three and records the evidence.
async function probeChatCompletion(url, model, apiKey = "", timeoutMs = 30000) {
  const target = chatEndpoint(url);
  const headers = { "content-type": "application/json" };
  if (String(apiKey).trim()) headers.authorization = `Bearer ${String(apiKey).trim()}`;
  const started = Date.now();
  try {
    const response = await fetch(target, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
        max_tokens: 8,
        temperature: 0,
      }),
    });
    const text = await response.text();
    const ms = Date.now() - started;
    if (!response.ok) {
      return { ok: false, status: response.status, ms, model, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, status: response.status, ms, model, error: "response is not JSON" };
    }
    const message = body?.choices?.[0]?.message;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    const usage = body?.usage ?? {};
    const timings = body?.timings ?? {};
    // Prefer the server's prompt-processing counters. `usage.prompt_tokens` can
    // include cached tokens, which makes a slow CPU model look fast on a warm
    // cache. `timings.prompt_n` is the work that actually happened this call.
    const promptTokens = Number(timings.prompt_n ?? usage.prompt_tokens ?? 0) || 0;
    const promptMs = Number(timings.prompt_ms ?? 0) || 0;
    const tokensPerSecond =
      promptTokens > 0 && promptMs > 0
        ? promptTokens / (promptMs / 1000)
        : promptTokens > 0 && ms > 0
          ? promptTokens / (ms / 1000)
          : null;
    return {
      ok: content.length > 0,
      status: response.status,
      ms,
      model,
      contentBytes: content.length,
      promptTokens,
      promptMs,
      tokensPerSecond: tokensPerSecond === null ? null : Math.round(tokensPerSecond * 10) / 10,
      error: content.length > 0 ? undefined : "empty assistant content",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      ms: Date.now() - started,
      model,
      error: String(error?.message ?? error),
    };
  }
}

async function probeToolCall(url, model, apiKey = "", timeoutMs = 45000) {
  const target = chatEndpoint(url);
  const headers = { "content-type": "application/json" };
  if (String(apiKey).trim()) headers.authorization = `Bearer ${String(apiKey).trim()}`;
  const started = Date.now();
  try {
    const response = await fetch(target, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Use get_time. Do not explain." }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_time",
              description: "Get the current time",
              parameters: { type: "object", properties: {}, required: [] },
            },
          },
        ],
        tool_choice: "auto",
        max_tokens: 32,
        temperature: 0,
      }),
    });
    const text = await response.text();
    const ms = Date.now() - started;
    if (!response.ok) {
      return { ok: false, status: response.status, ms, model, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, status: response.status, ms, model, error: "response is not JSON" };
    }
    const message = body?.choices?.[0]?.message;
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const names = calls
      .map((call) => call?.function?.name)
      .filter((name) => typeof name === "string");
    return {
      ok: names.length > 0,
      status: response.status,
      ms,
      model,
      tools: names,
      error: names.length > 0 ? undefined : "model did not return a tool call",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      ms: Date.now() - started,
      model,
      error: String(error?.message ?? error),
    };
  }
}

function providerEntry(baseURL, modelIDs, apiKey = "", tools = true) {
  const models = {};
  for (const id of modelIDs) {
    models[id] = {
      name: id,
      capabilities: { tools: Boolean(tools), input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
    };
  }
  const settings = { baseURL };
  if (String(apiKey).trim()) settings.apiKey = String(apiKey).trim();
  return {
    name: defaults.DEFAULT_PROVIDER_NAME,
    package: OPENAI_COMPATIBLE_PACKAGE,
    settings,
    models,
  };
}

console.log("=".repeat(72));
console.log(`ZombieCoder install — ${PKG.name} v${PKG.version}`);
console.log(
  `target: ${TARGET}  [${
    SELF_MODE
      ? "self-contained config root"
      : GLOBAL_MODE
        ? "global OpenCode config"
        : HOME_MODE
          ? `${process.platform} home/.opencode`
          : "project .opencode"
  }]`,
);
console.log("=".repeat(72));

// ---- 1. scaffold ---------------------------------------------------------------
await step("scaffold install root", () => {
  // Project skills are created by the plugin's first setup, not by the global
  // installer. The global install only seeds the runtime catalog.
  for (const d of [TARGET, CONFIG_DIR, PLUGINS_DIR, AGENTS_DIR, ZOMBIE_DIR]) ensureDir(d);
  return [
    path.relative(TARGET, CONFIG_DIR) || ".",
    path.relative(TARGET, PLUGINS_DIR),
    path.relative(TARGET, AGENTS_DIR),
    path.relative(TARGET, ZOMBIE_DIR),
  ].join(", ");
});

// ---- 2. copy the runtime import graph -----------------------------------------
const pluginFolder = path.join(PLUGINS_DIR, "zombiecoder");
await step("copy plugin source graph", () => {
  const entries = ["plugin.ts", "roster.ts", "zombie"];
  ensureDir(pluginFolder);
  for (const entry of entries) {
    const from = path.join(PACKAGE_ROOT, "src", entry);
    if (!fs.existsSync(from)) throw new Error(`missing source entry: src/${entry}`);
    fs.cpSync(from, path.join(pluginFolder, entry), { recursive: true, force: true });
  }
  const normalized = normalizeModes(pluginFolder);
  const files = listFiles(pluginFolder);
  return `${files.length} files: ${files.sort().join(", ")} (${normalized} modes normalized to 0644)`;
});

// ---- 2b. runtime assets ------------------------------------------------------
// These are not imported by plugin.ts, but the evidence gate, model mapper,
// scanner and TLS template must travel with the install instead of staying only
// in the source checkout.
await step("copy runtime assets", () => {
  const assets = [
    ["model.mjs", "model.mjs", 0o755],
    ["tools/evidence_gate.py", "tools/evidence_gate.py", 0o755],
    ["tools/hulia_100c.py", "tools/hulia_100c.py", 0o755],
    ["tools/origin_profile.py", "tools/origin_profile.py", 0o755],
    ["tools/render_nginx.py", "tools/render_nginx.py", 0o755],
    ["tools/tls_verify.py", "tools/tls_verify.py", 0o755],
    ["tls/nginx.conf.template", "tls/nginx.conf.template", 0o644],
    ["docs/100c-runtime-template.md", "docs/100c-runtime-template.md", 0o644],
    ["docs/skill-map.md", "docs/skill-map.md", 0o644],
    ["doc/identity.js", "docs/identity.js", 0o644],
    ["doc/ethics.js", "docs/ethics.js", 0o644],
    ["doc/runtime-operations.js", "docs/runtime-operations.js", 0o644],
    ["doc/index.js", "docs/index.js", 0o644],
  ];
  ensureDir(RUNTIME_ASSETS_DIR);
  for (const [fromRel, toRel, mode] of assets) {
    const from = path.join(PACKAGE_ROOT, fromRel);
    if (!fs.existsSync(from)) throw new Error(`missing runtime asset: ${fromRel}`);
    const to = path.join(RUNTIME_ASSETS_DIR, toRel);
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
    fs.chmodSync(to, mode);
  }

  // Research corpora are documentation, not prompts, but agents retrieve them on
  // demand from the installed docs tree. Copy every markdown file so the corpus
  // stays available offline with the runtime.
  const researchSource = path.join(PACKAGE_ROOT, "docs", "skills-research");
  if (fs.existsSync(researchSource)) {
    for (const name of fs.readdirSync(researchSource)) {
      if (!name.endsWith(".md")) continue;
      const to = path.join(RUNTIME_ASSETS_DIR, "docs", "skills-research", name);
      ensureDir(path.dirname(to));
      fs.copyFileSync(path.join(researchSource, name), to);
      fs.chmodSync(to, 0o644);
    }
  }

  // Seed the runtime skill catalog. The plugin copies only the skills a project
  // needs; keeping the full catalog here means setup is offline and fast.
  const skillSource = path.join(PACKAGE_ROOT, "docs", "skills");
  const skillTarget = path.join(RUNTIME_ASSETS_DIR, "skills-catalog");
  let skillFiles = 0;
  if (fs.existsSync(skillSource)) {
    ensureDir(skillTarget);
    for (const entry of fs.readdirSync(skillSource, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      fs.copyFileSync(path.join(skillSource, entry.name), path.join(skillTarget, entry.name));
      fs.chmodSync(path.join(skillTarget, entry.name), 0o644);
      skillFiles += 1;
    }
  }
  return `${assets.length + skillFiles} files -> ${path.relative(TARGET, RUNTIME_ASSETS_DIR)}/{docs,tools,tls,model.mjs,skills-catalog}`;
});

// ---- 3. declare the dependency ------------------------------------------------
await step("declare @opencode/plugin dependency", () => {
  const file = path.join(CONFIG_DIR, "package.json");
  const dep = PKG.dependencies?.["@opencode/plugin"] ?? "beta";
  const merged = mergeJson(file, {
    name: "zombiecoder-opencode-runtime",
    version: PKG.version,
    private: true,
    type: "module",
    dependencies: { "@opencode/plugin": dep },
  });
  return `${path.relative(TARGET, file)} -> @opencode/plugin@${merged.dependencies["@opencode/plugin"]}`;
});

// ---- 4. npm install ----------------------------------------------------------
if (DO_INSTALL) {
  await step("npm install", () => {
    // Windows resolves npm through npm.cmd, and spawning a .cmd file needs a
    // shell. Without this, a fresh Windows install fails here.
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npm, ["install", "--no-audit", "--no-fund"], {
      cwd: CONFIG_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      throw new Error(`npm exited ${result.status}: ${(result.stderr || "").trim().split("\n").slice(-4).join(" ")}`);
    }
    if (!fs.existsSync(path.join(CONFIG_DIR, "node_modules", "@opencode", "plugin"))) {
      throw new Error("@opencode/plugin not present after npm install");
    }
    const tail = (result.stdout || "").trim().split("\n").slice(-1)[0] ?? "";
    return `@opencode/plugin resolved ${tail}`;
  });
} else {
  report.steps.push({ step: "npm install", ok: true, detail: "skipped (--no-install)" });
}

// ---- 4b. LSP toolchain -------------------------------------------------------
// The config is generated below, but a config with no binary is a dead end.
// Install the four language servers into <install>/lsp once, then let
// syncLspConfig() point opencode.json at the resolved absolute paths.
if (DO_LSP) {
  await step("install LSP servers", () => {
    const before = resolveLspServers(CONFIG_DIR);
    if (before.missing.length === 0) {
      return `4/4 already resolvable (${Object.keys(before.servers).join(", ")})`;
    }
    if (!DO_INSTALL) {
      return `skipped npm (--no-install); missing ${before.missing.join(", ")}`;
    }
    const dir = path.join(CONFIG_DIR, "lsp");
    ensureDir(dir);
    const manifest = path.join(dir, "package.json");
    if (!fs.existsSync(manifest)) {
      fs.writeFileSync(
        manifest,
        JSON.stringify({ name: "zombiecoder-lsp", private: true, type: "module" }, null, 2) + "\n",
      );
    }
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(
      npm,
      ["install", "--no-audit", "--no-fund", "--save-exact", ...lspPackageList()],
      {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        shell: process.platform === "win32",
        timeout: 300000,
      },
    );
    if (result.error) {
      throw new Error(`LSP npm install failed: ${String(result.error.message ?? result.error)}`);
    }
    if (result.status !== 0) {
      const tail = (result.stderr || "").trim().split("\n").slice(-4).join(" ");
      throw new Error(`LSP npm exited ${result.status}: ${tail}`);
    }
    const after = resolveLspServers(CONFIG_DIR);
    if (after.missing.length > 0) {
      throw new Error(`LSP binaries still missing after npm install: ${after.missing.join(", ")}`);
    }
    return `installed ${lspPackageList().length} package(s); 4/4 resolvable`;
  });
} else {
  report.steps.push({ step: "install LSP servers", ok: true, detail: "skipped (--no-lsp)" });
}

// ---- 5. core config ----------------------------------------------------------
await step("seed zombiecoder config", () => {
  const existing = fs.existsSync(ZOMBIE_CONFIG)
    ? (() => {
        try {
          return JSON.parse(fs.readFileSync(ZOMBIE_CONFIG, "utf8"));
        } catch {
          return null;
        }
      })()
    : {};
  if (existing === null) return "kept existing config (not strict JSON; not modified)";
  const next = {
    ...existing,
    version: PKG.version,
    installMode: SELF_MODE || GLOBAL_MODE ? "global" : HOME_MODE ? "home" : "project",
    customProviderUrl: PROVIDER_URL,
    customProviderID: PROVIDER_ID,
    customProviderApiKey: PROVIDER_KEY,
    mcpUrl: MCP_URL,
    originUrl: ORIGIN_URL,
    opencodeApiUrl: existing.opencodeApiUrl ?? DEFAULT_OPENCODE_API_URL,
    ssotRefreshMs: existing.ssotRefreshMs ?? defaults.DEFAULT_SSOT_REFRESH_MS,
    modelStrategy: INSTALL_MODEL_STRATEGY,
    responseGate: existing.responseGate ?? true,
    autoSkills: existing.autoSkills ?? true,
    agentModelPins: existing.agentModelPins ?? false,
    skillRepo: existing.skillRepo ?? DEFAULT_SKILL_REPO,
    createdAt: existing.createdAt ?? new Date().toISOString(),
  };
  writeIfChanged(ZOMBIE_CONFIG, JSON.stringify(next, null, 2) + "\n");
  secureSecretFile(ZOMBIE_CONFIG);
  return path.relative(TARGET, ZOMBIE_CONFIG);
});

// ---- 6. probe MCP ------------------------------------------------------------
await step("probe MCP", async () => {
  if (!MCP_URL) return "skipped (no MCP URL)";
  const { probeMcp } = await import("../src/zombie/mcp.ts");
  mcpProbe = await probeMcp(MCP_URL, { timeoutMs: 6000 });
  writeIfChanged(path.join(ZOMBIE_DIR, "mcp.json"), JSON.stringify(mcpProbe, null, 2) + "\n");
  if (!mcpProbe.ok) throw new Error(`MCP unreachable: ${mcpProbe.error}`);
  const names = mcpProbe.tools.map((tool) => tool.name).join(", ");
  return `${mcpProbe.tools.length} tool(s)${names ? `: ${names}` : ""}`;
});

// ---- 7. probe provider + resolve this install's model plan -------------------
await step("probe provider + assign models", async () => {
  const roster = await import(path.join(PACKAGE_ROOT, "src", "roster.ts"));
  const { assignModels } = await import(path.join(PACKAGE_ROOT, "src", "zombie", "models.ts"));

  // A re-install over a live location keeps the runtime's resolved plan.
  try {
    const previousPlan = JSON.parse(fs.readFileSync(path.join(ZOMBIE_DIR, "models.json"), "utf8"));
    if (previousPlan?.assignment && typeof previousPlan.assignment === "object") {
      installAssignment = previousPlan.assignment;
    }
  } catch {
    /* no plan yet */
  }

  // Without a configured compatible URL, use the OpenCode free-model plan.
  const effectiveStrategy = INSTALL_MODEL_STRATEGY;
  const freeMode = effectiveStrategy === "free";
  let priorFreeAssignment = {};
  if (freeMode) {
    try {
      const current = JSON.parse(fs.readFileSync(OPENCODE_JSON, "utf8"));
      for (const agent of roster.ROSTER) {
        const ref = current?.agents?.[agent.id]?.model;
        if (typeof ref === "string" && ref.startsWith("opencode/")) {
          priorFreeAssignment[agent.id] = ref;
        }
      }
    } catch {
      /* no current opencode.json; leave the assignment empty */
    }
    installAssignment = priorFreeAssignment;
    candidates = Object.values(priorFreeAssignment);
  }

  if (PROVIDER_URL && !freeMode) {
    providerProbe = await probeProviderModels(PROVIDER_URL, 5000, PROVIDER_KEY);
    // `ok` with an empty list is not a usable provider. Treating it as one was
    // what produced the `provider/undefined` default model.
    providerReachable = Boolean(providerProbe?.ok && providerProbe.models.length > 0);

    if (providerReachable) {
      const primaryModel = providerProbe.models[0];
      chatProbe = await probeChatCompletion(PROVIDER_URL, primaryModel, PROVIDER_KEY, 30000);
      if (PROBE_TOOLS && chatProbe?.ok) {
        toolProbe = await probeToolCall(PROVIDER_URL, primaryModel, PROVIDER_KEY, 45000);
      }
      const tps = chatProbe?.tokensPerSecond;
      providerSlow =
        Boolean(chatProbe?.ok) &&
        typeof tps === "number" &&
        tps > 0 &&
        tps < 20;
      // A live /v1/models list is not enough. The model must answer, and (when
      // probed) it must return a tool call. A slow CPU model is not usable for
      // OpenCode's multi-thousand-token agent prompts; fall back unless the
      // owner explicitly asks to keep it.
      if (!chatProbe?.ok) providerReachable = false;
      else if (providerSlow && !ALLOW_SLOW) providerReachable = false;
      else if (toolProbe && !toolProbe.ok) providerReachable = false;
    }
  }

  // A dead/slow provider must not inherit the previous install's model refs.
  if (!providerReachable && !freeMode) installAssignment = {};

  candidates = providerReachable
    ? providerProbe.models
        .map((id) => modelRef(PROVIDER_ID, id))
        .filter((ref) => typeof ref === "string")
    : [];

  // Reuse a previous assignment only while every model still exists on the
  // provider we just probed. A changed URL/ID must not inherit stale refs.
  if (Object.keys(installAssignment).length > 0 && providerReachable) {
    const allowed = new Set(candidates);
    installAssignment = Object.fromEntries(
      Object.entries(installAssignment).filter(([, ref]) => allowed.has(ref)),
    );
  }
  if (!freeMode && Object.keys(installAssignment).length === 0) {
    installAssignment = assignModels(roster.ROSTER, candidates, false, BASELINE_MODEL);
  }

  // A dead or slow provider must not be recorded as a deliberate baseline pin.
  // "free-fallback" tells the runtime resolver to spread the OpenCode free
  // catalog across the roster at first setup instead of freezing one model.
  const strategy = freeMode || !providerReachable ? "free-fallback" : "custom-provider";
  const plan = {
    generatedAt: new Date().toISOString(),
    strategy,
    customProviderUrl: PROVIDER_URL,
    customProviderID: PROVIDER_ID,
    probe: providerProbe,
    chatProbe,
    toolProbe,
    providerSlow,
    providerUsable: providerReachable,
    candidates,
    assignment: installAssignment,
  };
  writeIfChanged(path.join(ZOMBIE_DIR, "models.json"), JSON.stringify(plan, null, 2) + "\n");

  // Persist the decision so the runtime resolver does not re-adopt a model the
  // installer just proved unusable. `--model-strategy` always wins.
  const configStrategy =
    MODEL_STRATEGY_FLAG ??
    (freeMode ? "free" : providerReachable ? "auto" : "free");
  try {
    const seeded = JSON.parse(fs.readFileSync(ZOMBIE_CONFIG, "utf8"));
    if (seeded.modelStrategy !== configStrategy) {
      seeded.modelStrategy = configStrategy;
      writeIfChanged(ZOMBIE_CONFIG, JSON.stringify(seeded, null, 2) + "\n");
      secureSecretFile(ZOMBIE_CONFIG);
    }
  } catch {
    /* step 5 already reported a malformed config; do not mask it here */
  }

  const summary = freeMode
    ? `modelStrategy: free — gateway probe skipped; ${new Set(Object.values(installAssignment)).size} free model(s) kept`
    : !PROVIDER_URL
    ? "custom provider disabled (free/baseline models)"
    : providerReachable
      ? `${providerProbe.models.length} model(s) from ${providerProbe.url}; chat ok${
          chatProbe?.tokensPerSecond ? ` (${chatProbe.tokensPerSecond} tok/s prompt)` : ""
        }; tools ${toolProbe ? (toolProbe.ok ? "ok" : "failed") : "not probed"}`
      : providerSlow
        ? `provider not usable (slow prompt processing${
            chatProbe?.tokensPerSecond ? `: ${chatProbe.tokensPerSecond} tok/s < 20` : ""
          }); free-model mapping resolved at first setup`
        : `provider not usable: ${
            chatProbe?.error ?? toolProbe?.error ?? providerProbe?.error ?? "not probed"
          }; free-model mapping resolved at first setup`;
  return `${summary}; ${new Set(Object.values(installAssignment)).size} model(s) assigned`;
});

// ---- 8. opencode.json: provider + V2 agents + permissions + MCP --------------
await step("sync opencode.json (providers, agents, permissions, MCP)", async () => {
  if (!DO_PROVIDER_CONFIG) return "skipped (--no-provider-config)";
  if (!fs.existsSync(OPENCODE_JSON) && fs.existsSync(OPENCODE_JSONC)) {
    return "skipped (opencode.jsonc is present; add the provider by hand)";
  }
  let existing = {};
  if (fs.existsSync(OPENCODE_JSON)) {
    try {
      existing = JSON.parse(fs.readFileSync(OPENCODE_JSON, "utf8"));
    } catch {
      return "skipped (opencode.json is not strict JSON; add the provider by hand)";
    }
  }

  const roster = await import(path.join(PACKAGE_ROOT, "src", "roster.ts"));
  const seeded = JSON.parse(fs.readFileSync(ZOMBIE_CONFIG, "utf8"));
  const providerID = seeded.customProviderID || PROVIDER_ID;
  const next = { ...existing };
  if (!next.$schema) next.$schema = "https://opencode.ai/config.json";

  if (PROVIDER_URL) {
    next.providers = { ...(existing.providers ?? {}) };
    const previousProvider = next.providers[providerID] ?? {};
    const liveModels =
      providerProbe?.ok && providerProbe.models.length > 0 ? providerProbe.models : null;
    const models = {};
    if (liveModels) {
      // The live /v1/models answer is the authority. A previous install may
      // still contain a model that the gateway has retired; keeping it is how
      // the config ended up with a stale Qwen entry next to the real Llama.
      const toolsCapability = toolProbe ? Boolean(toolProbe.ok) : true;
      const fresh = providerEntry(PROVIDER_URL, liveModels, PROVIDER_KEY, toolsCapability);
      for (const id of liveModels) {
        models[id] = { ...(previousProvider.models?.[id] ?? {}), ...fresh.models[id] };
      }
    } else {
      Object.assign(models, previousProvider.models ?? {});
    }
    const settings = {
      ...(previousProvider.settings ?? {}),
      baseURL: PROVIDER_URL,
    };
    if (PROVIDER_KEY) settings.apiKey = PROVIDER_KEY;
    next.providers[providerID] = {
      ...providerEntry(PROVIDER_URL, [], PROVIDER_KEY),
      ...previousProvider,
      settings,
      models,
    };
  } else if (next.providers?.[providerID]) {
    // No provider URL configured: keep no dead endpoint behind. Only the
    // installer-generated OpenAI-compatible entry is removed; a catalog provider
    // the owner configured by hand is never touched.
    const entry = next.providers[providerID];
    if (entry?.package === "@opencode/ai/providers/openai-compatible") {
      delete next.providers[providerID];
      if (Object.keys(next.providers).length === 0) delete next.providers;
    }
  }

  // The runtime resolves the free catalog at setup and may already have written a
  // spread of free models into opencode.json. A dead provider probe only yields
  // baseline placeholders, so re-read the file and keep every model ref that does
  // not belong to the dead provider. Without this, every reinstall flattens the
  // whole team back onto one model — the observed bug.
  if (!providerReachable) {
    const kept = { ...installAssignment };
    try {
      const current = JSON.parse(fs.readFileSync(OPENCODE_JSON, "utf8"));
      for (const agent of roster.ROSTER) {
        const ref = current?.agents?.[agent.id]?.model;
        if (typeof ref === "string" && ref.length > 0 && !ref.startsWith(`${providerID}/`)) {
          kept[agent.id] = ref;
        }
      }
    } catch {
      /* no readable opencode.json; keep the placeholder plan */
    }
    installAssignment = kept;
  }

  // V2 agents: description, mode, model, system prompt, ordered permission rules.
  // Existing non-roster agents are preserved; legacy personas are removed.
  const agents = { ...(existing.agents ?? {}) };
  for (const id of Object.keys(agents)) {
    if (
      roster.LEGACY_AGENT_IDS.includes(id) &&
      !roster.ROSTER.some((a) => a.id === id)
    ) {
      delete agents[id];
    }
  }
  // Per-agent model pins are opt-in. With pins off (default) the agent entries
  // carry no `model`: the model chosen in /models governs the session and a
  // subagent inherits it. With pins on, the fixed agent -> model mapping wins.
  const modelPins = modelPinsEnabled();
  for (const [id, entry] of Object.entries(
    roster.renderAgentsConfig(roster.ROSTER, installAssignment, modelPins),
  )) {
    agents[id] = { ...(agents[id] ?? {}), ...entry };
    if (!modelPins) delete agents[id].model;
  }
  next.agents = agents;

  // V2 permissions. Global rules first; the owner's existing rules are appended
  // after ours so their later rules keep the final say.
  const existingPermissions = Array.isArray(existing.permissions) ? existing.permissions : [];
  const knownPermissions = new Set(roster.GLOBAL_PERMISSIONS.map((rule) => JSON.stringify(rule)));
  next.permissions = [
    ...roster.GLOBAL_PERMISSIONS,
    ...existingPermissions.filter((rule) => !knownPermissions.has(JSON.stringify(rule))),
  ];

  // Default agent + default model. The model is provider/model in V2. A model is
  // only selected from the gateway when the installer proved it usable; a slow
  // or tool-less provider falls back to the baseline free model.
  next.default_agent = "zombiecoder";
  const firstCandidate = providerReachable
    ? modelRef(providerID, providerProbe.models[0])
    : null;
  const existingModel = typeof existing.model === "string" ? existing.model : null;
  const effectiveStrategy = INSTALL_MODEL_STRATEGY;
  if (!modelPins) {
    // No per-agent pin: the root `model` is the single default. A session that
    // picks another model in /models still wins, and subagents inherit it.
    next.model = providerReachable ? firstCandidate ?? BASELINE_MODEL : BASELINE_MODEL;
  } else if (effectiveStrategy === "free") {
    // Pins on: per-agent models are authoritative, so a global `model` would
    // defeat the agent -> model mapping.
    delete next.model;
  } else if (providerReachable) {
    next.model =
      existingModel && candidates.includes(existingModel)
        ? existingModel
        : firstCandidate ?? BASELINE_MODEL;
  } else {
    next.model = BASELINE_MODEL;
  }

  // Only register an MCP server we actually reached. A dead default URL in
  // opencode.json slows every boot and teaches the user to ignore errors.
  if (mcpProbe?.ok) {
    next.mcp = { ...(existing.mcp ?? {}) };
    next.mcp.servers = { ...(next.mcp.servers ?? {}) };
    next.mcp.servers.zombiecoder = {
      ...(next.mcp.servers.zombiecoder ?? {}),
      type: "remote",
      url: MCP_URL,
    };
  }

  writeIfChanged(OPENCODE_JSON, JSON.stringify(next, null, 2) + "\n");
  secureSecretFile(OPENCODE_JSON);
  const providerSummary = !PROVIDER_URL
    ? "custom provider disabled (free/baseline models)"
    : providerReachable
      ? `provider ${providerID} with ${providerProbe.models.length} live model(s); chat ok; tools ${
          toolProbe ? (toolProbe.ok ? "ok" : "failed") : "not probed"
        }`
      : providerSlow
        ? `provider ${providerID} saved but not selected (slow${
            chatProbe?.tokensPerSecond ? `: ${chatProbe.tokensPerSecond} tok/s < 20` : ""
          })`
        : `provider ${providerID} saved but not selected: ${
            chatProbe?.error ?? toolProbe?.error ?? providerProbe?.error ?? "not probed"
          }`;
  const mcpSummary = mcpProbe?.ok ? `MCP zombiecoder (${mcpProbe.tools.length} tools)` : "MCP not registered";
  return `${providerSummary}; ${roster.ROSTER.length} agents + ${next.permissions.length} permission rules; ${mcpSummary}`;
});

// ---- 8b. LSP config ----------------------------------------------------------
// Generate the `lsp` section from binaries that actually resolve. Existing
// entries and the owner's other keys are preserved.
if (DO_LSP) {
  await step("sync LSP config", () => {
    const sync = syncLspConfig(OPENCODE_JSON, CONFIG_DIR);
    if (sync.skipped) return `skipped (${sync.skipped})`;
    const configured = sync.servers.length;
    if (configured === 0) {
      return `0 configured; missing ${sync.missing.join(", ")} (run without --no-lsp)`;
    }
    return `${configured}/4 configured${sync.updated ? " (written)" : " (unchanged)"}${
      sync.missing.length ? `; missing ${sync.missing.join(", ")}` : ""
    }`;
  });
} else {
  report.steps.push({ step: "sync LSP config", ok: true, detail: "skipped (--no-lsp)" });
}

// ---- 9. agent markdown --------------------------------------------------------
await step("write agent markdown", async () => {
  const mod = await import(path.join(PACKAGE_ROOT, "src", "roster.ts"));
  let written = 0;
  for (const agent of mod.ROSTER) {
    const file = path.join(AGENTS_DIR, agent.id + ".md");
    if (writeIfChanged(file, mod.agentMarkdown(agent, installAssignment[agent.id], modelPinsEnabled()))) written += 1;
  }
  // Remove legacy persona files after a rename so two personas cannot coexist.
  let pruned = 0;
  for (const id of mod.LEGACY_AGENT_IDS) {
    if (mod.ROSTER.some((agent) => agent.id === id)) continue;
    const stale = path.join(AGENTS_DIR, id + ".md");
    if (fs.existsSync(stale)) {
      fs.rmSync(stale, { force: true });
      pruned += 1;
    }
  }
  const resolved = Object.keys(installAssignment).length > 0 ? "resolved" : "baseline";
  return `${mod.ROSTER.length} agents (${written} changed, ${pruned} stale pruned, ${resolved} models)`;
});

// ---- 10. seed .zombiecoder (project installs only) ---------------------------
await step("seed .zombiecoder SSOT + syllabus + memory", async () => {
  if (SELF_MODE || GLOBAL_MODE) {
    return "skipped (global install: .zombiecoder is created per working directory on first boot)";
  }
  const { bootstrapDirs } = await import(path.join(PACKAGE_ROOT, "src", "zombie", "paths.ts"));
  const { scanProject } = await import(path.join(PACKAGE_ROOT, "src", "zombie", "scan.ts"));
  const { writeSsot } = await import(path.join(PACKAGE_ROOT, "src", "zombie", "ssot.ts"));
  const { ensureSyllabus } = await import(path.join(PACKAGE_ROOT, "src", "zombie", "syllabus.ts"));
  const roster = await import(path.join(PACKAGE_ROOT, "src", "roster.ts"));

  for (const dir of bootstrapDirs(TARGET)) ensureDir(dir);

  const fp = scanProject(TARGET);
  const agentIds = roster.ROSTER.map((a) => a.id);
  // writeSsot() takes exactly (projectRoot, fingerprint); the old third argument
  // was silently ignored. Keep the SSOT free of installer-only metadata.
  const ssot = writeSsot(TARGET, fp);
  const syllabus = ensureSyllabus(TARGET, fp, agentIds);
  return `SSOT ${ssot.bytes}B, syllabus ${syllabus.created ? "seeded" : "kept"}, memory dir ready`;
});

// ---- 11. entrypoint LAST ------------------------------------------------------
// Writing the entrypoint only after deps, config, provider/MCP, and agent
// markdown are ready prevents a mid-install plugin boot that sees half an install.
await step("write entrypoint", () => {
  const body = [
    "// GENERATED by zombiecoder-opencode — do not hand edit.",
    "// OpenCode discovers top-level files in the plugins/ directory and follows",
    "// this import graph into ./zombiecoder/ (source of truth: Plugins/src).",
    'export { default } from "./zombiecoder/plugin.ts";',
    'export { setup, PLUGIN_ID } from "./zombiecoder/plugin.ts";',
    "",
  ].join("\n");
  return writeIfChanged(ENTRY, body) ? "written" : "unchanged";
});

// ---- 12. one self-contained root for the global loader -----------------------
await step("link self-contained root to global loader", linkSelfContainedGlobal);

// ---- report ------------------------------------------------------------------
const failed = report.steps.filter((s) => !s.ok);
console.log("");
for (const s of report.steps) {
  console.log(`  ${s.ok ? "OK  " : "FAIL"}  ${s.step}${s.detail ? ` — ${s.detail}` : ""}`);
}
console.log("");
if (!fs.existsSync(path.join(pluginFolder, "plugin.ts"))) {
  console.log("  WARN  plugin.ts is missing from the copied graph");
}
console.log("-".repeat(72));
console.log(`installed: ${report.steps.length - failed.length}/${report.steps.length} steps ok`);
if (SELF_MODE || GLOBAL_MODE) {
  console.log(`global: ${TARGET}/{opencode.json,agents,plugins,zombiecoder}`);
  console.log("per-directory: each working directory gets only .zombiecoder");
  console.log("  (SSOT, syllabus, memory, .state); no .opencode is created there.");
  console.log("  no per-project config.json/models.json/fingerprint.json/footprint.jsonl/mcp.json.");
  console.log("skills: shared at <install>/zombiecoder/skills (not per working directory);");
  console.log("        `skill_catalog` action=install fetches a named skill from git on demand.");
  console.log("lsp: opencode.json `lsp` generated from installed server binaries;");
  console.log("     verify with `npm run lsp:probe`.");
} else {
  console.log(`project: ${TARGET}/.opencode/{agents,plugins} + ${TARGET}/.zombiecoder`);
  console.log("per-directory: nested working directories still get their own .zombiecoder.");
}
console.log("next: open any working directory so the plugin's setup() runs.");
console.log("-".repeat(72));
process.exit(failed.length ? 1 : 0);
