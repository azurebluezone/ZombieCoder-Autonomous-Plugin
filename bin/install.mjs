#!/usr/bin/env node
// ZombieCoder install pipeline — spec §7.
//
// What it does, in order:
//   1. scaffold <target>/.opencode  {agents, plugins, skills}
//   2. copy the plugin runtime import graph into .opencode/plugins/zombiecoder/
//   3. ensure @opencode/plugin is declared in .opencode/package.json (merge, never clobber)
//   4. npm install in .opencode
//   5. seed .zombiecoder/config.json  (the core config: custom provider URL, MCP URL, API URL)
//   6. probe MCP (if a URL was supplied) and write .zombiecoder/mcp.json
//   7. merge opencode.json (custom provider + verified MCP) so the live runtime can see the URL
//   8. write the agent markdown (resolved models if a plan exists, else baseline)
//   9. write the entrypoint LAST, so OpenCode never boots a half-finished install
//
// NO backups, NO .bak files, NO archives: the owner keeps their own. Writes are atomic
// (temp + rename) and existing files are only replaced when the content actually differs.
//
// Usage:
//   node --experimental-strip-types bin/install.mjs
//   node --experimental-strip-types bin/install.mjs --dir /path/to/project
//   node --experimental-strip-types bin/install.mjs --dir X --no-install
//   node --experimental-strip-types bin/install.mjs --dir X --no-provider-config
//   node --experimental-strip-types bin/install.mjs --dir X --provider-url https://host/v1

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

// The owner's rule: the runtime lives at the OS root working directory
// (/home/<user>), so that is the default. Pass --dir to install into a specific
// project instead. Every install is still explicit in the printed target line.
const TARGET = path.resolve(value("--dir", os.homedir()));
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
    return JSON.parse(fs.readFileSync(path.join(TARGET, ".zombiecoder", "config.json"), "utf8"));
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

const report = { target: TARGET, steps: [] };
let mcpProbe = null;

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
console.log(`target: ${TARGET}`);
console.log("=".repeat(72));

const opencodeDir = path.join(TARGET, ".opencode");
const pluginsDir = path.join(opencodeDir, "plugins");
const agentsDir = path.join(opencodeDir, "agents");
const skillsDir = path.join(opencodeDir, "skills");
const zombieDir = path.join(TARGET, ".zombiecoder");
const pluginFolder = path.join(pluginsDir, "zombiecoder");

// ---- 1. scaffold ---------------------------------------------------------------
await step("scaffold .opencode", () => {
  for (const d of [opencodeDir, pluginsDir, agentsDir, skillsDir, zombieDir]) ensureDir(d);
  return [".opencode", ".opencode/plugins", ".opencode/agents", ".opencode/skills", ".zombiecoder"].join(", ");
});

// ---- 2. copy the runtime import graph -----------------------------------------
await step("copy plugin source graph", () => {
  // Only the runtime graph is deployed. The old documentation generators
  // (src/agents.ts, ethics.ts, generate.ts, identity.ts, runtime.ts) are not part of it
  // and must not ship into .opencode/plugins as dead weight.
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
  const file = path.join(opencodeDir, "package.json");
  const dep = PKG.dependencies?.["@opencode/plugin"] ?? "beta";
  const merged = mergeJson(file, {
    name: "zombiecoder-opencode-runtime",
    private: true,
    type: "module",
    dependencies: { "@opencode/plugin": dep },
  });
  return `.opencode/package.json -> @opencode/plugin@${merged.dependencies["@opencode/plugin"]}`;
});

// ---- 4. npm install ----------------------------------------------------------
if (DO_INSTALL) {
  await step("npm install", () => {
    const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: opencodeDir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`npm exited ${result.status}: ${(result.stderr || "").trim().split("\n").slice(-4).join(" ")}`);
    }
    if (!fs.existsSync(path.join(opencodeDir, "node_modules", "@opencode", "plugin"))) {
      throw new Error("@opencode/plugin not present after npm install");
    }
    const tail = (result.stdout || "").trim().split("\n").slice(-1)[0] ?? "";
    return `@opencode/plugin resolved ${tail}`;
  });
} else {
  report.steps.push({ step: "npm install", ok: true, detail: "skipped (--no-install)" });
}

// ---- 5. core config ----------------------------------------------------------
await step("seed .zombiecoder/config.json", () => {
  const file = path.join(zombieDir, "config.json");
  if (fs.existsSync(file)) {
    let current;
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return "kept existing config.json (not strict JSON; not modified)";
    }
    const next = {
      ...current,
      version: PKG.version,
      customProviderUrl: PROVIDER_URL,
      customProviderID: current.customProviderID ?? PROVIDER_ID,
      mcpUrl: MCP_URL,
    };
    const changed = writeIfChanged(file, JSON.stringify(next, null, 2) + "\n");
    return changed ? "updated existing config.json" : "kept existing config.json";
  }
  const config = {
    version: PKG.version,
    customProviderUrl: PROVIDER_URL,
    customProviderID: PROVIDER_ID,
    mcpUrl: MCP_URL,
    opencodeApiUrl: "http://127.0.0.1:49374",
    ssotRefreshMs: 300000,
    modelStrategy: "auto",
    createdAt: new Date().toISOString(),
  };
  writeIfChanged(file, JSON.stringify(config, null, 2) + "\n");
  return "written";
});

// ---- 6. probe MCP ------------------------------------------------------------
await step("probe MCP", async () => {
  if (!MCP_URL) return "skipped (no MCP URL)";
  const { probeMcp } = await import("../src/zombie/mcp.ts");
  mcpProbe = await probeMcp(MCP_URL, { timeoutMs: 6000 });
  writeIfChanged(path.join(zombieDir, "mcp.json"), JSON.stringify(mcpProbe, null, 2) + "\n");
  if (!mcpProbe.ok) throw new Error(`MCP unreachable: ${mcpProbe.error}`);
  const names = mcpProbe.tools.map((tool) => tool.name).join(", ");
  return `${mcpProbe.tools.length} tool(s)${names ? `: ${names}` : ""}`;
});

// ---- 7. merge opencode.json --------------------------------------------------
await step("sync opencode.json", async () => {
  if (!DO_PROVIDER_CONFIG) return "skipped (--no-provider-config)";
  const file = path.join(TARGET, "opencode.json");
  const jsonc = path.join(TARGET, "opencode.jsonc");
  if (!fs.existsSync(file) && fs.existsSync(jsonc)) {
    return "skipped (opencode.jsonc is present; add the provider by hand)";
  }
  let existing = {};
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return "skipped (opencode.json is not strict JSON; add the provider by hand)";
    }
  }

  const seeded = JSON.parse(fs.readFileSync(path.join(zombieDir, "config.json"), "utf8"));
  const providerUrl = PROVIDER_URL;
  const providerID = seeded.customProviderID || PROVIDER_ID;
  if (!providerUrl && !mcpProbe?.ok && !fs.existsSync(file)) {
    return "nothing to write (free models, no MCP)";
  }
  const probe = providerUrl ? await probeProviderModels(providerUrl) : null;

  const next = { ...existing };
  if (!next.$schema) next.$schema = "https://opencode.ai/config.json";

  if (providerUrl) {
    next.providers = { ...(existing.providers ?? {}) };
    const previous = next.providers[providerID] ?? {};
    const models = { ...(previous.models ?? {}) };
    if (probe?.ok) {
      for (const id of probe.models) {
        models[id] = { ...(providerEntry(providerUrl, [id]).models[id]), ...(models[id] ?? {}) };
      }
    }
    next.providers[providerID] = {
      ...providerEntry(providerUrl, []),
      ...previous,
      settings: {
        ...(previous.settings ?? {}),
        baseURL: providerUrl,
        apiKey: previous.settings?.apiKey ?? "public",
      },
      models,
    };
  }

  // Only register an MCP server we actually reached. A dead default URL in
  // opencode.json slows every boot and teaches the user to ignore errors.
  if (mcpProbe?.ok) {
    next.mcp = { ...(existing.mcp ?? {}) };
    next.mcp.servers = { ...(next.mcp.servers ?? {}) };
    // We own this entry, so a new verified URL replaces the old URL while any
    // user-supplied headers/options on the same entry are preserved.
    next.mcp.servers.zombiecoder = {
      ...(next.mcp.servers.zombiecoder ?? {}),
      type: "remote",
      url: MCP_URL,
    };
  }

  writeIfChanged(file, JSON.stringify(next, null, 2) + "\n");
  const providerSummary = !providerUrl
    ? "custom provider disabled (OpenCode free models)"
    : probe?.ok
      ? `provider ${providerID} with ${probe.models.length} model(s) from ${probe.url}`
      : `provider ${providerID} saved (probe failed: ${probe?.error ?? "not probed"})`;
  const mcpSummary = mcpProbe?.ok ? `MCP zombiecoder (${mcpProbe.tools.length} tools)` : "MCP not registered";
  return `${providerSummary}; ${mcpSummary}`;
});

// ---- 8. agent markdown --------------------------------------------------------
// The roster lives in TS. We do not duplicate it here: import the real module.
// If the runtime already resolved models (plugin loaded during an update), write
// the SAME assignment instead of clobbering it with the static baseline.
await step("write agent markdown", async () => {
  const mod = await import(path.join(PACKAGE_ROOT, "src", "roster.ts"));
  let assignment = {};
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(zombieDir, "models.json"), "utf8"));
    if (plan?.assignment && typeof plan.assignment === "object") assignment = plan.assignment;
  } catch {
    /* no plan yet — baseline models are still valid */
  }
  let written = 0;
  for (const agent of mod.ROSTER) {
    const file = path.join(agentsDir, agent.id + ".md");
    if (writeIfChanged(file, mod.agentMarkdown(agent, assignment[agent.id]))) written += 1;
  }
  const resolved = Object.keys(assignment).length > 0 ? "resolved" : "baseline";
  return `${mod.ROSTER.length} agents (${written} changed, ${resolved} models)`;
});

// ---- 9. entrypoint LAST -------------------------------------------------------
// OpenCode watches .opencode/plugins/. Writing the entrypoint only after deps,
// config, provider/MCP, and agent markdown are ready prevents a mid-install
// plugin boot that sees half an install (and then gets clobbered by our writes).
await step("write entrypoint", () => {
  const entry = path.join(pluginsDir, "zombiecoder.ts");
  const body = [
    "// GENERATED by zombiecoder-opencode — do not hand edit.",
    "// OpenCode discovers top-level files in .opencode/plugins/ and follows this",
    "// import graph into ./zombiecoder/ (source of truth: Plugins/src).",
    'export { default } from "./zombiecoder/plugin.ts";',
    'export { setup, PLUGIN_ID } from "./zombiecoder/plugin.ts";',
    "",
  ].join("\n");
  return writeIfChanged(entry, body) ? "written" : "unchanged";
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
console.log(`layout: ${TARGET}/.opencode/{agents,plugins,skills} + ${TARGET}/.zombiecoder`);
console.log("next: boot OpenCode in that directory so the plugin's setup() runs.");
console.log("-".repeat(72));
process.exit(failed.length ? 1 : 0);
