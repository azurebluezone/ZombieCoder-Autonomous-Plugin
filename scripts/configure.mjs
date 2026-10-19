#!/usr/bin/env node
// scripts/configure.mjs
//
// ZombieCoder cross-platform project configurator.
//
// One command, Windows / Linux / macOS:
//   node --experimental-strip-types scripts/configure.mjs [target-dir]
//   npm run configure -- [target-dir]
//
// For the target project it:
//   1. verifies the global install (9 agents, mode: all, subagent allow)
//   2. creates .zombiecoder/{memory,.state}
//   3. asks the running OpenCode server to reload the location
//      (the plugin's setup() then writes SSOT.md + syllabus.md)
//   4. if OpenCode is not running, generates SSOT.md + syllabus.md directly
//   5. writes .zombiecoder/.state/configure-report.json + an audit line
//
// Nothing is deleted. Existing syllabus lessons are preserved. The direct
// generation reuses the plugin's own scan/SSOT/syllabus modules, so there is
// exactly one source of truth for the format.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const REPO_ROOT = path.dirname(SCRIPT_DIR);
const TS_FLAG = "--experimental-strip-types";
const DEFAULT_API = "http://127.0.0.1:49374";

// Node < 23.6 needs the flag to import .ts modules. Re-exec once with it so the
// same command works on both Node eras and on both operating systems.
if (!hasNativeTypescript() && !process.env.ZC_CONFIGURE_CHILD) {
  const result = spawnSync(process.execPath, [TS_FLAG, SCRIPT_FILE, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, ZC_CONFIGURE_CHILD: "1" },
  });
  process.exit(typeof result.status === "number" ? result.status : 1);
}

function hasNativeTypescript() {
  const feature = process.features && process.features.typescript;
  return feature === "strip" || feature === "transform" || feature === true;
}

function parseArgs(argv) {
  const out = { target: null, url: null, install: true, reload: true, force: false, json: false, help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--no-install") out.install = false;
    else if (a === "--no-reload") out.reload = false;
    else if (a === "--force") out.force = true;
    else if (a === "--dir") out.target = argv[i + 1] ?? null;
    else if (a.startsWith("--dir=")) out.target = a.slice("--dir=".length);
    else if (a === "--url") out.url = argv[i + 1] ?? null;
    else if (a.startsWith("--url=")) out.url = a.slice("--url=".length);
    else rest.push(a);
  }
  if (!out.target && rest.length > 0) out.target = rest[0];
  return out;
}

function globalConfigDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) return path.join(path.resolve(xdg.trim()), "opencode");
  return path.join(os.homedir(), ".config", "opencode");
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function readServicePassword(configDir) {
  const data = readJsonFile(path.join(configDir, "service.json"));
  return typeof data?.password === "string" && data.password ? data.password : null;
}

function readApiUrl(configDir, override) {
  if (override) return override;
  if (process.env.OPENCODE_API_URL) return process.env.OPENCODE_API_URL;
  const local = readJsonFile(path.join(configDir, "zombiecoder", "config.json"));
  if (typeof local?.opencodeApiUrl === "string" && local.opencodeApiUrl.trim()) {
    return local.opencodeApiUrl.trim();
  }
  return DEFAULT_API;
}

function globalAgentReport(configDir) {
  const file = path.join(configDir, "opencode.json");
  if (!fs.existsSync(file)) return { ok: false, reason: "opencode.json missing" };
  const cfg = readJsonFile(file);
  if (!cfg || typeof cfg.agents !== "object") return { ok: false, reason: "agents block missing" };
  const ids = Object.keys(cfg.agents);
  const badMode = ids.filter((id) => cfg.agents[id]?.mode !== "all");
  const badPerm = ids.filter(
    (id) =>
      !Array.isArray(cfg.agents[id]?.permissions) ||
      !cfg.agents[id].permissions.some((r) => r?.action === "subagent" && r?.effect === "allow"),
  );
  return { ok: ids.length >= 9 && badMode.length === 0 && badPerm.length === 0, count: ids.length, badMode, badPerm };
}

function hasSourceGraph(dir) {
  return [
    path.join(dir, "zombie", "scan.ts"),
    path.join(dir, "zombie", "ssot.ts"),
    path.join(dir, "zombie", "syllabus.ts"),
    path.join(dir, "roster.ts"),
  ].every((f) => fs.existsSync(f));
}

function resolveSourceRoot(configDir) {
  const candidates = [
    path.join(REPO_ROOT, "src"),
    path.join(configDir, "plugins", "zombiecoder"),
    path.join(configDir, "plugins", "zombiecoder", "src"),
  ];
  return candidates.find(hasSourceGraph) ?? null;
}

function runInstaller() {
  const installer = path.join(REPO_ROOT, "bin", "install.mjs");
  if (!fs.existsSync(installer)) {
    return { ok: false, reason: "bin/install.mjs not found (run from the ZombieCoder repo)" };
  }
  const result = spawnSync(process.execPath, [TS_FLAG, installer, "--yes"], { stdio: "inherit" });
  return { ok: result.status === 0, status: result.status };
}

function ensureDirs(target) {
  const dirs = [
    path.join(target, ".zombiecoder"),
    path.join(target, ".zombiecoder", "memory"),
    path.join(target, ".zombiecoder", ".state"),
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
  return dirs;
}

async function reloadLocation(apiUrl, password, target) {
  const url = apiUrl.replace(/\/+$/, "") + "/api/location/reload";
  const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify({ directory: target }),
    signal: AbortSignal.timeout(10000),
  });
  return { ok: response.status >= 200 && response.status < 300, status: response.status, url };
}

async function waitForFresh(files, sinceMs, timeoutMs) {
  const start = Date.now();
  const fresh = () =>
    files.every((f) => {
      try {
        return fs.statSync(f).mtimeMs >= sinceMs;
      } catch {
        return false;
      }
    });
  while (Date.now() - start < timeoutMs) {
    if (fresh()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return fresh();
}

async function generateDirect(sourceRoot, target) {
  const load = (rel) => import(pathToFileURL(path.join(sourceRoot, rel)).href);
  const scanMod = await load(path.join("zombie", "scan.ts"));
  const ssotMod = await load(path.join("zombie", "ssot.ts"));
  const syllabusMod = await load(path.join("zombie", "syllabus.ts"));
  const pathsMod = await load(path.join("zombie", "paths.ts"));
  const memoryMod = await load(path.join("zombie", "memory.ts"));
  const rosterMod = await load(path.join("roster.ts"));

  for (const dir of pathsMod.bootstrapDirs(target)) fs.mkdirSync(dir, { recursive: true });
  const fingerprint = scanMod.scanProject(target);
  const ssotWrite = ssotMod.writeSsot(target, fingerprint);
  const syllabusWrite = syllabusMod.ensureSyllabus(target, fingerprint, rosterMod.ROSTER.map((a) => a.id));
  const memoryIndex = memoryMod.writeIndex(target, memoryMod.readIndex(target));
  return {
    sourceRoot,
    scan: { files: fingerprint.totalFiles, dirs: fingerprint.totalDirs, bytes: fingerprint.totalBytes },
    ssot: ssotWrite,
    syllabus: syllabusWrite,
    memory: { sessions: Object.keys(memoryIndex.sessions ?? {}).length },
  };
}

function writeReport(target, report) {
  const stateDir = path.join(target, ".zombiecoder", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "configure-report.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );
  fs.appendFileSync(
    path.join(stateDir, "audit.jsonl"),
    JSON.stringify({
      ts: new Date().toISOString(),
      agent: "configure",
      kind: "configure",
      platform: process.platform,
      target: report.target,
      ok: report.ok,
    }) + "\n",
    "utf8",
  );
}

function printSummary(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines = [];
  lines.push(`ZombieCoder configure — ${report.ok ? "OK" : "FAILED"}`);
  lines.push(`  platform : ${report.platform} (${report.arch})`);
  lines.push(`  node     : ${report.node}`);
  lines.push(`  target   : ${report.target}`);
  lines.push(`  config   : ${report.configDir}`);
  for (const step of report.steps) {
    lines.push(`  [${step.ok ? "ok" : "!!"}] ${step.step}`);
  }
  if (report.created) {
    lines.push(`  created  : SSOT=${report.created.ssot} syllabus=${report.created.syllabus}`);
  }
  console.log(lines.join("\n"));
}

function printHelp() {
  console.log(`ZombieCoder project configurator

Usage:
  node --experimental-strip-types scripts/configure.mjs [target-dir] [options]
  npm run configure -- [target-dir]

Options:
  --dir <path>   target project (default: current working directory)
  --url <url>    OpenCode API base (default: global config, then ${DEFAULT_API})
  --no-install   never run the global installer automatically
  --no-reload    skip the OpenCode location reload; generate SSOT/syllabus directly
  --force        always regenerate SSOT/syllabus, even if reload already wrote them
  --json         machine-readable output
  -h, --help     this text

What it does:
  1. verifies the global install (9 agents, mode:all, subagent allow)
  2. creates .zombiecoder/{memory,.state}
  3. asks the running OpenCode server to reload the location
  4. if OpenCode is not running, generates SSOT.md and syllabus.md directly
  5. writes .zombiecoder/.state/configure-report.json + an audit line

Nothing is deleted. Existing syllabus lessons are preserved.
Works on Windows, Linux and macOS.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const target = path.resolve(args.target || process.cwd());
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`[zc-configure] target is not a directory: ${target}`);
    return 2;
  }

  const configDir = globalConfigDir();
  const startedAt = new Date().toISOString();
  const report = {
    tool: "zombiecoder-configure",
    version: "0.1.0",
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    target,
    configDir,
    startedAt,
    steps: [],
    ok: false,
  };

  let global = globalAgentReport(configDir);
  report.steps.push({ step: "check-global", ok: global.ok, detail: global });
  if (!global.ok && args.install) {
    const installed = runInstaller();
    report.steps.push({ step: "install-global", ok: installed.ok, detail: installed });
    global = globalAgentReport(configDir);
    report.steps.push({ step: "recheck-global", ok: global.ok, detail: global });
  }

  const dirs = ensureDirs(target);
  report.steps.push({ step: "bootstrap-dirs", ok: true, detail: dirs.map((d) => path.relative(target, d)) });

  const ssotFile = path.join(target, ".zombiecoder", "SSOT.md");
  const syllabusFile = path.join(target, ".zombiecoder", "syllabus.md");
  const startedMs = Date.now();
  let reloadWroteFresh = false;

  if (args.reload) {
    const password = readServicePassword(configDir);
    if (password) {
      const apiUrl = readApiUrl(configDir, args.url);
      try {
        const reload = await reloadLocation(apiUrl, password, target);
        report.steps.push({ step: "reload-location", ok: reload.ok, detail: { url: reload.url, status: reload.status } });
        if (reload.ok) reloadWroteFresh = await waitForFresh([ssotFile, syllabusFile], startedMs, 8000);
      } catch (error) {
        report.steps.push({
          step: "reload-location",
          ok: false,
          detail: { url: apiUrl, error: String(error?.message ?? error) },
        });
      }
    } else {
      report.steps.push({ step: "reload-location", ok: false, detail: "service.json password not found" });
    }
  } else {
    report.steps.push({ step: "reload-location", ok: false, detail: "skipped (--no-reload)" });
  }

  if (args.force || !reloadWroteFresh) {
    const sourceRoot = resolveSourceRoot(configDir);
    if (!sourceRoot) {
      report.steps.push({
        step: "generate-direct",
        ok: false,
        detail: "source graph not found; run from the ZombieCoder repo or install globally",
      });
      report.finishedAt = new Date().toISOString();
      writeReport(target, report);
      printSummary(report, args.json);
      return 1;
    }
    try {
      const generated = await generateDirect(sourceRoot, target);
      report.steps.push({ step: "generate-direct", ok: true, detail: generated });
    } catch (error) {
      report.steps.push({ step: "generate-direct", ok: false, detail: String(error?.stack ?? error) });
      report.finishedAt = new Date().toISOString();
      writeReport(target, report);
      printSummary(report, args.json);
      return 1;
    }
  } else {
    report.steps.push({ step: "generate-direct", ok: true, detail: "skipped (reload already wrote SSOT + syllabus)" });
  }

  report.created = { ssot: fs.existsSync(ssotFile), syllabus: fs.existsSync(syllabusFile) };
  report.ok = report.created.ssot && report.created.syllabus;
  report.finishedAt = new Date().toISOString();
  writeReport(target, report);
  printSummary(report, args.json);
  return report.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[zc-configure] fatal: ${error?.stack ?? error}`);
    process.exitCode = 1;
  });
