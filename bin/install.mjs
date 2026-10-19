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
// memory, footprint, models). Skills are lazy: .zombiecoder/skills appears only
// when a skill is actually added. No .opencode in arbitrary working directories.
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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");
const PKG = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));

const argv = process.argv.slice(2);
function flag(name) {
  return argv.indexOf(name) >= 0;
}
function value(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const GLOBAL_DIR = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  "opencode",
);
const HOME_MODE = flag("--home");
const DIR_FLAG = value("--dir", null);
const GLOBAL_MODE = !HOME_MODE && (flag("--global") || DIR_FLAG === null);

// The owner's rule: one global install, every working directory underneath it.
// os.homedir() and XDG_CONFIG_HOME are resolved per platform, so no OS path is
// hardcoded. --dir keeps the old project-local shape available.
const TARGET = path.resolve(
  GLOBAL_MODE ? GLOBAL_DIR : HOME_MODE ? os.homedir() : DIR_FLAG,
);
const CONFIG_DIR = GLOBAL_MODE ? TARGET : path.join(TARGET, ".opencode");
const ZOMBIE_DIR = GLOBAL_MODE ? path.join(TARGET, "zombiecoder") : path.join(TARGET, ".zombiecoder");
const PLUGINS_DIR = path.join(CONFIG_DIR, "plugins");
const AGENTS_DIR = path.join(CONFIG_DIR, "agents");
const ENTRY = path.join(PLUGINS_DIR, "zombiecoder.ts");
const OPENCODE_JSON = path.join(TARGET, "opencode.json");
const OPENCODE_JSONC = path.join(TARGET, "opencode.jsonc");
const ZOMBIE_CONFIG = path.join(ZOMBIE_DIR, "config.json");

const DO_INSTALL = !flag("--no-install");
const DO_PROVIDER_CONFIG = !flag("--no-provider-config");
const PROVIDER_ID = "missionbarisal";
const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";
const DEFAULT_PROVIDER_URL =
  process.env.ZOMBIECODER_PROVIDER_URL ?? "https://gpu.zombiecoder.my.id/v1";
const DEFAULT_MCP_URL = "";

function cleanUrl(input, fallback) {
  if (input === null || input === undefined) return fallback;
  const value = String(input).trim();
  if (!value || /^(none|skip|no)$/i.test(value)) return "";
  return value;
}

const providerFlag = value("--provider-url", null);
const mcpFlag = value("--mcp-url", null);

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
    : typeof previous.customProviderUrl === "string"
      ? previous.customProviderUrl
      : DEFAULT_PROVIDER_URL;
const initialMcp =
  mcpFlag !== null
    ? cleanUrl(mcpFlag, DEFAULT_MCP_URL)
    : typeof previous.mcpUrl === "string"
      ? previous.mcpUrl
      : DEFAULT_MCP_URL;

let PROVIDER_URL = initialProvider;
let MCP_URL = initialMcp;

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

const report = { target: TARGET, mode: GLOBAL_MODE ? "global" : HOME_MODE ? "home" : "project", steps: [] };
let mcpProbe = null;
let providerProbe = null;
let providerReachable = false;
let installAssignment = {};

async function step(name, fn) {
  try {
    const detail = await fn();
    report.steps.push({ step: name, ok: true, detail: typeof detail === "string" ? detail : undefined });
    return detail;
  } catch (error) {
    report.steps.push({ step: name, ok: false, error: String(error?.message ?? error) });
    console.error(`  FAIL  ${name}: ${error?.message ?? error}`);
    return undefined;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfChanged(file, content) {
  ensureDir(path.dirname(file));
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === content) return false;
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o644 });
  fs.renameSync(tmp, file);
  return true;
}

function mergeJson(file, patch) {
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const merged = { ...existing, ...patch };
  merged.dependencies = { ...(existing.dependencies ?? {}), ...(patch.dependencies ?? {}) };
  merged.scripts = { ...(existing.scripts ?? {}), ...(patch.scripts ?? {}) };
  writeIfChanged(file, JSON.stringify(merged, null, 2) + "\n");
  return merged;
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

// OpenAI-compatible gateways disagree about the envelope. A `data` array of ids is
// the one thing every implementation returns, so that is what we accept.
async function probeProviderModels(url, timeoutMs = 5000) {
  const base = String(url).replace(/\/+$/, "");
  const target = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
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

function providerEntry(baseURL, modelIDs) {
  const models = {};
  for (const id of modelIDs) {
    models[id] = {
      name: id,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
    };
  }
  return {
    name: "ZombieCoder Gateway",
    package: OPENAI_COMPATIBLE_PACKAGE,
    settings: { baseURL, apiKey: "public" },
    models,
  };
}

console.log("=".repeat(72));
console.log(`ZombieCoder install — ${PKG.name} v${PKG.version}`);
console.log(
  `target: ${TARGET}  [${GLOBAL_MODE ? "global OpenCode config" : HOME_MODE ? `${process.platform} home/.opencode` : "project .opencode"}]`,
);
console.log("=".repeat(72));

// ---- 1. scaffold ---------------------------------------------------------------
await step("scaffold install root", () => {
  // Skills are intentionally absent: the folder appears only when a skill is added.
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
  const files = listFiles(pluginFolder);
  return `${files.length} files: ${files.sort().join(", ")}`;
});

// ---- 3. declare the dependency ------------------------------------------------
await step("declare @opencode/plugin dependency", () => {
  const file = path.join(CONFIG_DIR, "package.json");
  const dep = PKG.dependencies?.["@opencode/plugin"] ?? "beta";
  const merged = mergeJson(file, {
    name: "zombiecoder-opencode-runtime",
    private: true,
    type: "module",
    dependencies: { "@opencode/plugin": dep },
  });
  return `${path.relative(TARGET, file)} -> @opencode/plugin@${merged.dependencies["@opencode/plugin"]}`;
});

// ---- 4. npm install ----------------------------------------------------------
if (DO_INSTALL) {
  await step("npm install", () => {
    const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: CONFIG_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
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
    installMode: GLOBAL_MODE ? "global" : "home",
    customProviderUrl: PROVIDER_URL,
    customProviderID: existing.customProviderID ?? PROVIDER_ID,
    mcpUrl: MCP_URL,
    opencodeApiUrl: existing.opencodeApiUrl ?? "http://127.0.0.1:49374",
    ssotRefreshMs: existing.ssotRefreshMs ?? 300000,
    modelStrategy: existing.modelStrategy ?? "auto",
    createdAt: existing.createdAt ?? new Date().toISOString(),
  };
  writeIfChanged(ZOMBIE_CONFIG, JSON.stringify(next, null, 2) + "\n");
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

  if (PROVIDER_URL) {
    providerProbe = await probeProviderModels(PROVIDER_URL);
    providerReachable = Boolean(providerProbe?.ok);
  }
  const candidates = providerReachable
    ? providerProbe.models.map((id) => `${PROVIDER_ID}/${id}`)
    : [];
  if (Object.keys(installAssignment).length === 0) {
    installAssignment = assignModels(roster.ROSTER, candidates);
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    strategy: providerReachable ? "custom-provider" : "baseline",
    customProviderUrl: PROVIDER_URL,
    customProviderID: PROVIDER_ID,
    probe: providerProbe,
    candidates,
    assignment: installAssignment,
  };
  writeIfChanged(path.join(ZOMBIE_DIR, "models.json"), JSON.stringify(plan, null, 2) + "\n");

  const summary = !PROVIDER_URL
    ? "custom provider disabled (OpenCode free models)"
    : providerReachable
      ? `${providerProbe.models.length} model(s) from ${providerProbe.url}`
      : `probe failed: ${providerProbe?.error ?? "not probed"}`;
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
    const models = { ...(previousProvider.models ?? {}) };
    if (providerProbe?.ok) {
      for (const id of providerProbe.models) {
        models[id] = { ...(providerEntry(PROVIDER_URL, [id]).models[id]), ...(models[id] ?? {}) };
      }
    }
    next.providers[providerID] = {
      ...providerEntry(PROVIDER_URL, []),
      ...previousProvider,
      settings: {
        ...(previousProvider.settings ?? {}),
        baseURL: PROVIDER_URL,
        apiKey: previousProvider.settings?.apiKey ?? "public",
      },
      models,
    };
  }

  // V2 agents: description, mode, model, system prompt, ordered permission rules.
  // Existing non-roster agents are preserved; `kobir` is removed after the rename.
  const agents = { ...(existing.agents ?? {}) };
  for (const id of Object.keys(agents)) {
    if (id === "kobir" && !roster.ROSTER.some((a) => a.id === "kobir")) delete agents[id];
  }
  for (const [id, entry] of Object.entries(roster.renderAgentsConfig(roster.ROSTER, installAssignment))) {
    agents[id] = { ...(agents[id] ?? {}), ...entry };
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

  // Default agent + default model. The model is provider/model in V2.
  next.default_agent = "zombiecoder";
  const firstCandidate = providerReachable ? `${providerID}/${providerProbe.models[0]}` : null;
  next.model = existing.model ?? firstCandidate ?? roster.BASELINE_MODEL;

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
  const providerSummary = !PROVIDER_URL
    ? "custom provider disabled (OpenCode free models)"
    : providerReachable
      ? `provider ${providerID} with ${providerProbe.models.length} model(s)`
      : `provider ${providerID} saved (probe failed: ${providerProbe?.error ?? "not probed"})`;
  const mcpSummary = mcpProbe?.ok ? `MCP zombiecoder (${mcpProbe.tools.length} tools)` : "MCP not registered";
  return `${providerSummary}; ${roster.ROSTER.length} agents + ${next.permissions.length} permission rules; ${mcpSummary}`;
});

// ---- 9. agent markdown --------------------------------------------------------
await step("write agent markdown", async () => {
  const mod = await import(path.join(PACKAGE_ROOT, "src", "roster.ts"));
  let written = 0;
  for (const agent of mod.ROSTER) {
    const file = path.join(AGENTS_DIR, agent.id + ".md");
    if (writeIfChanged(file, mod.agentMarkdown(agent, installAssignment[agent.id]))) written += 1;
  }
  // Remove the old Kobir file after the rename so two personas cannot coexist.
  const stale = path.join(AGENTS_DIR, "kobir.md");
  let pruned = 0;
  if (fs.existsSync(stale)) {
    fs.rmSync(stale, { force: true });
    pruned = 1;
  }
  const resolved = Object.keys(installAssignment).length > 0 ? "resolved" : "baseline";
  return `${mod.ROSTER.length} agents (${written} changed, ${pruned} stale pruned, ${resolved} models)`;
});

// ---- 10. seed .zombiecoder (project installs only) ---------------------------
await step("seed .zombiecoder SSOT + syllabus + memory", async () => {
  if (GLOBAL_MODE) {
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
  const ssot = writeSsot(TARGET, fp, {
    agentCount: roster.ROSTER.length,
    agentIds,
    modelStrategy: providerReachable ? "custom-provider" : "baseline",
    modelAssignment: installAssignment,
    customProviderUrl: PROVIDER_URL,
    customProviderReachable: providerReachable,
    mcpUrl: MCP_URL,
    mcpReachable: Boolean(mcpProbe?.ok),
    mcpTools: mcpProbe?.tools?.map((tool) => tool.name) ?? [],
  });
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
if (GLOBAL_MODE) {
  console.log(`global: ${TARGET}/{opencode.json,agents,plugins,zombiecoder}`);
  console.log("per-directory: each working directory gets only .zombiecoder");
  console.log("  (SSOT, syllabus, memory, footprint, models); no .opencode is created there.");
  console.log("skills: .zombiecoder/skills is created only when a skill is added.");
} else {
  console.log(`project: ${TARGET}/.opencode/{agents,plugins} + ${TARGET}/.zombiecoder`);
  console.log("per-directory: nested working directories still get their own .zombiecoder.");
}
console.log("next: open any working directory so the plugin's setup() runs.");
console.log("-".repeat(72));
process.exit(failed.length ? 1 : 0);
