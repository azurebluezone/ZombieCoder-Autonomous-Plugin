#!/usr/bin/env node
// scripts/setup.mjs
//
// One-command ZombieCoder setup after cloning the repo.
//
//   git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git zombiecoder
//   cd zombiecoder
//   node scripts/setup.mjs --dir /path/to/project
//   npm run setup -- --dir /path/to/project
//
// Steps:
//   1. check Node >= 22.6
//   2. install the global pack (bin/install.mjs --yes) if missing or --force-install
//   3. run scripts/configure.mjs for the target project
//   4. verify SSOT.md, syllabus.md, project map, agent team and global agents
//   5. print a report; --status only verifies and never writes
//
// This file uses only Node built-ins, so it runs on the host Node without a
// type-stripping flag. It spawns configure.mjs with --experimental-strip-types.
// Windows, Linux, macOS. Nothing is deleted.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(SCRIPT_FILE);
const REPO_ROOT = path.dirname(SCRIPTS_DIR);
const TS_FLAG = "--experimental-strip-types";
const MIN_NODE = [22, 6];
const PKG = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;

// Read the expected agent IDs from the runtime roster. setup.mjs deliberately
// runs without the type-stripping flag, so a narrow read of the source of truth
// is used instead of a second hardcoded list.
function expectedAgentIds() {
  try {
    const source = fs.readFileSync(path.join(REPO_ROOT, "src", "roster.ts"), "utf8");
    return [...source.matchAll(/^\s{4}id:\s*"([^"]+)"/gm)].map((match) => match[1]);
  } catch {
    return [];
  }
}
const EXPECTED_AGENT_IDS = expectedAgentIds();

function parseArgs(argv) {
  const out = {
    target: null,
    url: null,
    install: true,
    reload: true,
    force: false,
    forceInstall: false,
    status: false,
    json: false,
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--status") out.status = true;
    else if (a === "--no-install") out.install = false;
    else if (a === "--no-reload") out.reload = false;
    else if (a === "--force") out.force = true;
    else if (a === "--force-install") out.forceInstall = true;
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

function nodeTooOld() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1]);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function readTextIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function fileInfo(file) {
  try {
    const st = fs.statSync(file);
    return { exists: true, bytes: st.size, mtime: st.mtime.toISOString() };
  } catch {
    return { exists: false, bytes: 0, mtime: null };
  }
}

function globalSummary(configDir) {
  const file = path.join(configDir, "opencode.json");
  const cfg = readJsonFile(file);
  const agents = cfg && cfg.agents && typeof cfg.agents === "object" ? cfg.agents : {};
  const ids = Object.keys(agents);
  const expected = EXPECTED_AGENT_IDS;
  const missing = expected.filter((id) => !agents[id]);
  const checked = expected.length > 0 ? expected : ids;
  const allPrimary = checked.length > 0 && checked.every((id) => agents[id]?.mode === "all");
  const canDelegate =
    checked.length > 0 &&
    checked.every(
      (id) =>
        Array.isArray(agents[id]?.permissions) &&
        agents[id].permissions.some((r) => r?.action === "subagent" && r?.effect === "allow"),
    );
  return {
    file,
    exists: fs.existsSync(file),
    agents: ids.length,
    expected: expected.length,
    missing,
    allPrimary,
    canDelegate,
    ok: missing.length === 0 && allPrimary && canDelegate,
  };
}

function targetVerify(target) {
  const zd = path.join(target, ".zombiecoder");
  const ssotFile = path.join(zd, "SSOT.md");
  const syllabusFile = path.join(zd, "syllabus.md");
  const ssot = fileInfo(ssotFile);
  const syllabus = fileInfo(syllabusFile);
  const memoryIndex = fileInfo(path.join(zd, "memory", "index.json"));
  const ssotText = readTextIfExists(ssotFile) ?? "";
  const syllabusText = readTextIfExists(syllabusFile) ?? "";
  return {
    zombiecoder: zd,
    ssot,
    syllabus,
    memoryIndex,
    setupReport: fileInfo(path.join(zd, ".state", "setup-report.json")),
    configureReport: fileInfo(path.join(zd, ".state", "configure-report.json")),
    hasProjectMap: syllabusText.includes("### Project map"),
    hasAgentTeam: ssotText.includes("## 7. Agent team"),
    ok: ssot.exists && syllabus.exists && memoryIndex.exists,
  };
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function runNode(script, args) {
  return spawnSync(process.execPath, [TS_FLAG, script, ...args], { stdio: "inherit" });
}

function runNodeCapture(script, args) {
  return spawnSync(process.execPath, [TS_FLAG, script, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function fmtFile(info) {
  return info.exists ? `EXISTS ${info.bytes} B  ${info.mtime}` : "MISSING";
}

function printStatusHuman(report) {
  const p = report.project;
  console.log(`ZombieCoder status — ${p.ok ? "configured" : "NOT configured"}`);
  console.log(`  platform : ${report.platform} (${report.arch})`);
  console.log(`  node     : ${report.node}`);
  console.log(`  target   : ${report.target}`);
  console.log(
    `  global   : agents=${report.global.agents} mode:all=${report.global.allPrimary ? "yes" : "no"} delegate=${report.global.canDelegate ? "yes" : "no"}`,
  );
  console.log(`  SSOT.md              : ${fmtFile(p.ssot)}`);
  console.log(`  syllabus.md          : ${fmtFile(p.syllabus)}`);
  console.log(`  memory/index.json    : ${fmtFile(p.memoryIndex)}`);
  console.log(`  Project map          : ${p.hasProjectMap ? "yes" : "no"}`);
  console.log(`  Agent team (SSOT)    : ${p.hasAgentTeam ? "yes" : "no"}`);
  console.log(`  .state/setup-report  : ${fmtFile(p.setupReport)}`);
  console.log(`  .state/configure     : ${fmtFile(p.configureReport)}`);
}

function printSetupHuman(report) {
  console.log(`ZombieCoder setup — ${report.ok ? "OK" : "FAILED"}`);
  console.log(`  platform : ${report.platform} (${report.arch})`);
  console.log(`  node     : ${report.node}`);
  console.log(`  target   : ${report.target}`);
  console.log(`  config   : ${report.configDir}`);
  for (const step of report.steps) console.log(`  [${step.ok ? "ok" : "!!"}] ${step.step}`);
  const p = report.project;
  console.log(`  project  : SSOT=${p.ssot.exists ? p.ssot.bytes + "B" : "missing"} syllabus=${p.syllabus.exists ? p.syllabus.bytes + "B" : "missing"} map=${p.hasProjectMap ? "yes" : "no"} team=${p.hasAgentTeam ? "yes" : "no"}`);
  console.log(`  global   : agents=${report.global.agents} mode:all=${report.global.allPrimary ? "yes" : "no"} delegate=${report.global.canDelegate ? "yes" : "no"}`);
}

function printHelp() {
  console.log(`ZombieCoder setup

Usage:
  git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git zombiecoder
  cd zombiecoder
  node scripts/setup.mjs --dir /path/to/project
  npm run setup -- --dir /path/to/project

Options:
  --dir <path>       target project (default: current working directory)
  --url <url>        OpenCode API base (default: global config, then OPENCODE_API_URL)
  --no-install       never run the global installer
  --no-reload        skip the OpenCode location reload in configure
  --force            always regenerate SSOT/syllabus in configure
  --force-install    reinstall the global pack even if it looks present
  --status           only verify and print; never writes anything
  --json             machine-readable output
  -h, --help         this text

Steps:
  1. check Node >= 22.6
  2. install the global pack (${EXPECTED_AGENT_IDS.length} roster agents, mode:all, subagent allow)
  3. configure the target project (SSOT.md + syllabus.md, via reload or direct)
  4. verify and report

Works on Windows, Linux, macOS. Nothing is deleted.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (nodeTooOld()) {
    console.error(`[zc-setup] Node ${process.versions.node} is too old; need >= ${MIN_NODE.join(".")}`);
    return 2;
  }

  const target = path.resolve(args.target || process.cwd());
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`[zc-setup] target is not a directory: ${target}`);
    return 2;
  }

  const configDir = globalConfigDir();

  if (args.status) {
    const report = {
      tool: "zombiecoder-setup",
      mode: "status",
      version: VERSION,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      target,
      configDir,
      global: globalSummary(configDir),
      project: targetVerify(target),
    };
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printStatusHuman(report);
    return report.project.ok ? 0 : 1;
  }

  const installer = path.join(REPO_ROOT, "bin", "install.mjs");
  const configureScript = path.join(SCRIPTS_DIR, "configure.mjs");
  const startedAt = new Date().toISOString();
  const steps = [{ step: "check-node", ok: true, detail: process.version }];

  const globalBefore = globalSummary(configDir);
  if (args.install && (!globalBefore.ok || args.forceInstall)) {
    if (!fs.existsSync(installer)) {
      steps.push({ step: "install-global", ok: false, detail: "bin/install.mjs not found" });
    } else {
      const result = runNode(installer, ["--yes"]);
      steps.push({ step: "install-global", ok: result.status === 0, detail: { status: result.status } });
    }
  } else {
    steps.push({
      step: "install-global",
      ok: globalBefore.ok,
      detail: args.install ? "already installed" : "skipped (--no-install)",
    });
  }
  const globalAfter = globalSummary(configDir);

  let configure = null;
  if (!fs.existsSync(configureScript)) {
    steps.push({ step: "configure-project", ok: false, detail: "scripts/configure.mjs not found" });
  } else {
    const cfgArgs = ["--dir", target];
    if (args.url) cfgArgs.push("--url", args.url);
    if (!args.install) cfgArgs.push("--no-install");
    if (!args.reload) cfgArgs.push("--no-reload");
    if (args.force) cfgArgs.push("--force");

    if (args.json) {
      const result = runNodeCapture(configureScript, [...cfgArgs, "--json"]);
      configure = parseJson(result.stdout);
      steps.push({
        step: "configure-project",
        ok: result.status === 0,
        detail: configure ? { ok: configure.ok } : { status: result.status },
      });
    } else {
      const result = runNode(configureScript, cfgArgs);
      steps.push({ step: "configure-project", ok: result.status === 0, detail: { status: result.status } });
    }
  }

  const project = targetVerify(target);
  steps.push({
    step: "verify-project",
    ok: project.ok,
    detail: { ssot: project.ssot, syllabus: project.syllabus, projectMap: project.hasProjectMap, agentTeam: project.hasAgentTeam },
  });

  const report = {
    tool: "zombiecoder-setup",
    mode: "setup",
    version: VERSION,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    target,
    configDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
    global: globalAfter,
    project,
    configure,
    ok: project.ok && (globalAfter.ok || !args.install),
  };

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printSetupHuman(report);
  return report.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[zc-setup] fatal: ${error?.stack ?? error}`);
    process.exitCode = 1;
  });
