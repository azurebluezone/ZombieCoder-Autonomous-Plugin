#!/usr/bin/env node
// End-to-end installer check.
//
//   node scripts/e2e-install.mjs --quick   # structure, update merge, low-space abort, fallback cleanup, bootstrap
//   node scripts/e2e-install.mjs --full    # adds a real npm + LSP download into /tmp and the audit
//
// Quick mode uses --no-install/--no-lsp so it stays offline and fast. Full mode
// is the real thing: it downloads @opencode/plugin and the LSP servers into a
// temporary root, then runs scripts/audit-install.mjs against the result.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "bin", "install.mjs");
const BOOTSTRAP = path.join(ROOT, "install.sh");
const AUDIT = path.join(ROOT, "scripts", "audit-install.mjs");
const FULL = process.argv.includes("--full");
const KEEP = process.argv.includes("--keep");
const NODE = process.execPath;

const results = [];
function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function run(args, options = {}) {
  return spawnSync(NODE, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 0,
  });
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function installArgs(root, extra = []) {
  return [
    "--experimental-strip-types",
    INSTALLER,
    "--config-dir",
    root,
    "--yes",
    "--fast",
    "--no-probe-tools",
    ...extra,
  ];
}

function assertInstall(root, label) {
  const configFile = path.join(root, "opencode.json");
  const plugin = path.join(root, "plugins", "zombiecoder", "plugin.ts");
  const onboarding = path.join(root, "plugins", "zombiecoder", "zombie", "onboarding.ts");
  const entry = path.join(root, "plugins", "zombiecoder.ts");
  const missing = [configFile, plugin, onboarding, entry].filter((file) => !fs.existsSync(file));
  if (missing.length > 0) return fail(`${label}: files`, missing.join(", "));
  let config;
  try {
    config = readJson(configFile);
  } catch (error) {
    return fail(`${label}: config`, String(error.message ?? error));
  }
  const agentCount = Object.keys(config.agents ?? {}).length;
  if (agentCount !== 9) return fail(`${label}: agents`, `expected 9, found ${agentCount}`);
  const perms = Array.isArray(config.permissions) ? config.permissions : [];
  const consent = perms.filter(
    (rule) => rule.action === "goal_contract.open" || rule.action === "goal_contract.close",
  );
  if (consent.length < 2 || consent.some((rule) => rule.effect !== "ask")) {
    return fail(`${label}: consent rules`, JSON.stringify(consent));
  }
  pass(`${label}: structure`, `9 agents, plugin graph, consent ask rules`);
}

function freshAndUpdate() {
  const root = tempDir("zc-e2e-update-");
  try {
    const first = run(installArgs(root, ["--no-install", "--no-lsp"]), { timeout: 120_000 });
    if (first.status !== 0) {
      return fail("fresh install", `exit ${first.status}: ${(first.stderr || first.stdout).trim().slice(-300)}`);
    }
    assertInstall(root, "fresh install");

    const configFile = path.join(root, "opencode.json");
    const config = readJson(configFile);
    config.zombiecoderSentinel = { keep: true };
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");

    const second = run(installArgs(root, ["--no-install", "--no-lsp"]), { timeout: 120_000 });
    if (second.status !== 0) {
      return fail("update install", `exit ${second.status}: ${(second.stderr || second.stdout).trim().slice(-300)}`);
    }
    const after = readJson(configFile);
    if (after.zombiecoderSentinel?.keep !== true) {
      return fail("update install", "existing opencode.json keys were replaced, not merged");
    }
    assertInstall(root, "update install");
    pass("update merge", "unknown config keys survive a second install");
  } finally {
    if (!KEEP) fs.rmSync(root, { recursive: true, force: true });
  }
}

function lowSpaceAbort() {
  const parent = tempDir("zc-e2e-lowspace-");
  const root = path.join(parent, "install");
  try {
    // Dependencies must be "needed" or the planner has nothing to refuse; the
    // abort happens before the first write, so npm never runs here.
    const result = run(installArgs(root, ["--keep-cache"]), {
      timeout: 60_000,
      env: { ZOMBIECODER_FAKE_FREE_BYTES: String(100 * 1024 * 1024) },
    });
    if (result.status !== 3) {
      return fail("low-space abort", `expected exit 3, got ${result.status}`);
    }
    if (fs.existsSync(root)) {
      return fail("low-space abort", "the installer wrote the target before the space check");
    }
    if (!/জায়গা|space/i.test(result.stderr + result.stdout)) {
      return fail("low-space abort", "no human-readable space message");
    }
    pass("low-space abort", "exit 3 before any write, with space numbers");
  } finally {
    if (!KEEP) fs.rmSync(parent, { recursive: true, force: true });
  }
}

function bootstrap() {
  const work = tempDir("zc-e2e-boot-");
  const tar = path.join(work, "source.tar.gz");
  const root = path.join(work, "install");
  try {
    const packed = spawnSync(
      "tar",
      [
        "-czf",
        tar,
        "-C",
        ROOT,
        "--exclude=.git",
        "--exclude=node_modules",
        "--exclude=.zombiecoder",
        "--exclude=.backups",
        "--exclude=.opencode",
        "--exclude=*.log",
        ".",
      ],
      { encoding: "utf8" },
    );
    if (packed.status !== 0) {
      return fail("remote bootstrap", `tar failed: ${(packed.stderr || "").trim().slice(-200)}`);
    }
    const result = spawnSync("bash", [BOOTSTRAP, "--no-install", "--no-lsp"], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        ZOMBIECODER_TARBALL: tar,
        ZOMBIECODER_DIR: root,
        ZOMBIECODER_SKIP_INTEGRITY: "1",
      },
      timeout: 120_000,
    });
    if (result.status !== 0) {
      return fail("remote bootstrap", `exit ${result.status}: ${(result.stderr || result.stdout).trim().slice(-300)}`);
    }
    assertInstall(root, "remote bootstrap");
  } finally {
    if (!KEEP) fs.rmSync(work, { recursive: true, force: true });
  }
}

function duplicateLegacyPlugin() {
  const home = tempDir("zc-e2e-dup-home-");
  const legacyRoot = path.join(home, ".opencode");
  const legacyPlugins = path.join(legacyRoot, "plugins");
  const legacyEntry = path.join(legacyPlugins, "zombiecoder.ts");
  const legacyDir = path.join(legacyPlugins, "zombiecoder");
  const canonicalRoot = path.join(home, ".config", "opencode");
  const canonicalPlugins = path.join(canonicalRoot, "plugins");
  const globalEntry = path.join(canonicalPlugins, "zombiecoder.ts");
  try {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      legacyEntry,
      '// GENERATED by zombiecoder-opencode — do not hand edit.\nexport { default } from "./zombiecoder/plugin.ts";\n',
    );
    fs.writeFileSync(path.join(legacyDir, "marker.txt"), "legacy copy\n");
    fs.mkdirSync(canonicalRoot, { recursive: true });
    fs.symlinkSync(legacyPlugins, canonicalPlugins, "dir");

    const result = run(
      [
        "--experimental-strip-types",
        INSTALLER,
        "--global",
        "--yes",
        "--fast",
        "--no-probe-tools",
        "--provider-url",
        "none",
        "--no-install",
        "--no-lsp",
      ],
      { timeout: 120_000, env: { HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") } },
    );
    if (result.status !== 0) {
      return fail(
        "legacy duplicate cleanup",
        `exit ${result.status}: ${(result.stderr || result.stdout).trim().slice(-300)}`,
      );
    }
    if (!fs.existsSync(globalEntry)) {
      return fail("legacy duplicate cleanup", "the global entrypoint was not written");
    }
    if (fs.lstatSync(canonicalPlugins).isSymbolicLink()) {
      return fail("legacy duplicate cleanup", "the canonical plugins path is still a symlink");
    }
    if (fs.existsSync(legacyEntry)) {
      return fail("legacy duplicate cleanup", "the legacy entrypoint still loads a second plugin");
    }
    const backupRoot = path.join(legacyRoot, ".backups");
    const backups = fs.existsSync(backupRoot)
      ? fs.readdirSync(backupRoot).filter((name) => name.startsWith("duplicate-plugin-"))
      : [];
    if (backups.length !== 1) {
      return fail("legacy duplicate cleanup", `expected one backup, found ${backups.length}`);
    }
    const backup = path.join(backupRoot, backups[0]);
    if (!fs.existsSync(path.join(backup, "plugins.symlink"))) {
      return fail("legacy duplicate cleanup", "the replaced plugins symlink is missing from the backup");
    }
    if (!fs.existsSync(path.join(backup, "zombiecoder.ts"))) {
      return fail("legacy duplicate cleanup", "the moved entrypoint is missing from the backup");
    }
    if (!fs.existsSync(path.join(backup, "zombiecoder", "marker.txt"))) {
      return fail("legacy duplicate cleanup", "the moved plugin graph is missing from the backup");
    }
    if (!/retired/i.test(result.stdout)) {
      return fail("legacy duplicate cleanup", "the installer did not report the retirement");
    }
    pass("legacy duplicate cleanup", "symlinked legacy entry retired with a backup, one real loader remains");
  } finally {
    if (!KEEP) fs.rmSync(home, { recursive: true, force: true });
  }
}

function fullInstall() {
  const root = tempDir("zc-e2e-full-");
  // A real fresh computer has no ~/.opencode/lsp to borrow from. Isolate HOME so
  // the download path is exercised instead of reusing the host install.
  const home = tempDir("zc-e2e-home-");
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    npm_config_cache: path.join(home, ".npm"),
  };
  try {
    console.log("  ... real npm install + LSP download (this is the slow part)");
    const first = run(installArgs(root, []), { timeout: 15 * 60_000, env });
    if (first.status !== 0) {
      return fail("full install", `exit ${first.status}: ${(first.stderr || first.stdout).trim().slice(-500)}`);
    }
    assertInstall(root, "full install");
    for (const dep of ["@opencode/plugin"]) {
      if (!fs.existsSync(path.join(root, "node_modules", ...dep.split("/")))) {
        return fail("full install", `${dep} missing after npm install`);
      }
    }
    const lsp = path.join(root, "lsp", "node_modules", ".bin");
    if (!fs.existsSync(lsp) || fs.readdirSync(lsp).length === 0) {
      return fail("full install", "LSP binaries missing");
    }
    pass("full dependencies", "@opencode/plugin + LSP binaries downloaded");

    const audit = run([AUDIT, "--config", root], { timeout: 120_000, env });
    if (audit.status !== 0) {
      return fail("full audit", `exit ${audit.status}: ${(audit.stdout || audit.stderr).trim().slice(-400)}`);
    }
    pass("full audit", String(audit.stdout || "").trim().split("\n").slice(-1)[0] || "PASS");

    const again = run(installArgs(root, []), { timeout: 10 * 60_000, env });
    if (again.status !== 0) {
      return fail("full update", `exit ${again.status}: ${(again.stderr || again.stdout).trim().slice(-400)}`);
    }
    if (!/already satisfied/i.test(again.stdout)) {
      return fail("full update", "dependencies were downloaded again instead of reusing the satisfied install");
    }
    pass("full update", "second run reused dependencies and passed");
  } finally {
    if (!KEEP) {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

console.log("ZombieCoder installer E2E" + (FULL ? " (full, network)" : " (quick)"));
console.log("=".repeat(64));
freshAndUpdate();
lowSpaceAbort();
duplicateLegacyPlugin();
bootstrap();
if (FULL) fullInstall();

const failed = results.filter((entry) => !entry.ok);
console.log("-".repeat(64));
if (failed.length > 0) {
  console.log(`E2E FAIL — ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`E2E PASS — ${results.length}/${results.length} checks`);
