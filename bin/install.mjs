#!/usr/bin/env node
// ZombieCoder install pipeline — spec §7.
//
// What it does, in order:
//   1. scaffold <target>/.opencode  {agents, plugins, skills}
//   2. copy the plugin runtime import graph into .opencode/plugins/zombiecoder/
//   3. write the single-file entrypoint .opencode/plugins/zombiecoder.ts
//   4. ensure @opencode/plugin is declared in .opencode/package.json (merge, never clobber)
//   5. npm install in .opencode
//   6. seed .zombiecoder/config.json  (the core config: custom provider URL, MCP URL, API URL)
//   7. merge opencode.json (custom provider + MCP) so the live runtime can see the URL
//   8. write the agent markdown straight away, so the folder exists even before first run
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

const TARGET = path.resolve(value("--dir", os.homedir()));
const DO_INSTALL = !flag("--no-install");
const DO_PROVIDER_CONFIG = !flag("--no-provider-config");
const PROVIDER_URL = value("--provider-url", null);
const MCP_URL = value("--mcp-url", null);
const PROVIDER_ID = "missionbarisal";
const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";

const report = { target: TARGET, steps: [] };

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

// ---- 3. entrypoint ------------------------------------------------------------
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

// ---- 4. declare the dependency ------------------------------------------------
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

// ---- 5. npm install ----------------------------------------------------------
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

// ---- 6. core config ----------------------------------------------------------
await step("seed .zombiecoder/config.json", () => {
  const file = path.join(zombieDir, "config.json");
  if (fs.existsSync(file)) return "kept existing config.json";
  const config = {
    version: PKG.version,
    customProviderUrl: PROVIDER_URL ?? "https://gpu.zombiecoder.my.id/v1",
    customProviderID: "missionbarisal",
    mcpUrl: MCP_URL ?? "http://127.0.0.1:5000/mcp",
    opencodeApiUrl: "http://127.0.0.1:49374",
    ssotRefreshMs: 300000,
    modelStrategy: "auto",
    createdAt: new Date().toISOString(),
  };
  writeIfChanged(file, JSON.stringify(config, null, 2) + "\n");
  return "written";
});

// ---- 7. opencode.json: make the URL visible to the live runtime --------------
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
  const providerUrl = PROVIDER_URL ?? seeded.customProviderUrl;
  const mcpUrl = MCP_URL ?? seeded.mcpUrl;
  const probe = await probeProviderModels(providerUrl);

  const next = { ...existing };
  if (!next.$schema) next.$schema = "https://opencode.ai/config.json";

  next.providers = { ...(existing.providers ?? {}) };
  const previous = next.providers[PROVIDER_ID] ?? {};
  const models = { ...(previous.models ?? {}) };
  if (probe.ok) {
    for (const id of probe.models) {
      models[id] = { ...(providerEntry(providerUrl, [id]).models[id]), ...(models[id] ?? {}) };
    }
  }
  next.providers[PROVIDER_ID] = {
    ...providerEntry(providerUrl, []),
    ...previous,
    settings: {
      ...(previous.settings ?? {}),
      baseURL: providerUrl,
      apiKey: previous.settings?.apiKey ?? "public",
    },
    models,
  };

  next.mcp = { ...(existing.mcp ?? {}) };
  next.mcp.servers = { ...(next.mcp.servers ?? {}) };
  if (!next.mcp.servers.zombiecoder) {
    next.mcp.servers.zombiecoder = { type: "remote", url: mcpUrl };
  }

  writeIfChanged(file, JSON.stringify(next, null, 2) + "\n");
  return probe.ok
    ? `provider ${PROVIDER_ID} with ${probe.models.length} model(s) from ${probe.url}; MCP zombiecoder`
    : `provider ${PROVIDER_ID} saved (probe failed: ${probe.error}); MCP zombiecoder`;
});

// ---- 8. agent markdown now, not later ----------------------------------------
// The roster lives in TS. We do not duplicate it here: import the real module.
await step("write agent markdown", async () => {
  const mod = await import(path.join(PACKAGE_ROOT, "src", "roster.ts"));
  let written = 0;
  for (const agent of mod.ROSTER) {
    const file = path.join(agentsDir, agent.id + ".md");
    if (writeIfChanged(file, mod.agentMarkdown(agent))) written += 1;
  }
  return `${mod.ROSTER.length} agents (${written} changed)`;
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
