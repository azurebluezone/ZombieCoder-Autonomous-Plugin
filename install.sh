#!/usr/bin/env bash
# ZombieCoder — one script: bootstrap, update, and environment proof.
#
#   curl -fsSL https://raw.githubusercontent.com/azurebluezone/ZombieCoder-Autonomous-Plugin/murubbi/install.sh | bash
#   curl -fsSL ... | bash -s -- --no-lsp
#   ZOMBIECODER_TARBALL=/path/to/source.tar.gz bash install.sh
#
# The script does five things, in this order:
#   1. stages the source in a space-checked temporary directory, never in the
#      working tree and never inside the install root;
#   2. downloads the git tarball when no local tarball was supplied;
#   3. runs the real installer twice, so a second run must produce the same
#      generated state (idempotence);
#   4. verifies the installed files against the downloaded source, the one
#      loader invariant, agent/consent config, LSP, dependencies, the live
#      OpenCode plugin state, and the space delta;
#   5. writes $TARGET/zombiecoder/install-proof.json and exits 0 only for
#      PROOF PASS. A failed check is PROOF FAIL and exit 1.
#
# Running the same command again updates an existing install: generated files
# are overwritten, while unknown keys in opencode.json and user data survive.
#
# Environment:
#   ZOMBIECODER_REPO             default azurebluezone/ZombieCoder-Autonomous-Plugin
#   ZOMBIECODER_REF              default murubbi
#   ZOMBIECODER_DIR              install root, default ~/.opencode
#   ZOMBIECODER_TARBALL          local tarball (offline/test); skips the download
#   ZOMBIECODER_SKIP_INTEGRITY   development only; 1 skips the manifest check
#   ZOMBIECODER_SPACE_BUDGET_MB  maximum target growth accepted by the proof (default 800)
set -euo pipefail

REPO="${ZOMBIECODER_REPO:-azurebluezone/ZombieCoder-Autonomous-Plugin}"
REF="${ZOMBIECODER_REF:-murubbi}"
TARGET_RAW="${ZOMBIECODER_DIR:-$HOME/.opencode}"
TARBALL="${ZOMBIECODER_TARBALL:-}"
ARGS=("$@")
SPACE_BUDGET_MB="${ZOMBIECODER_SPACE_BUDGET_MB:-800}"

say() { printf '%s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*" >&2; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
ZombieCoder install/update/proof

Usage:
  bash install.sh [installer flags]

Installer flags (passed through to bin/install.mjs):
  --no-install           config only; no npm/LSP download
  --no-lsp               no LSP server download or probe
  --force-install        download dependencies again even when satisfied
  --no-space-check       skip the installer's own free-space preflight

Environment:
  ZOMBIECODER_DIR             install root (default ~/.opencode)
  ZOMBIECODER_TARBALL         local tarball; skips the git download
  ZOMBIECODER_REPO/REF        repository and branch for the download
  ZOMBIECODER_SPACE_BUDGET_MB target growth budget accepted by the proof

Proof:
  $ZOMBIECODER_DIR/zombiecoder/install-proof.json
USAGE
}

for arg in "${ARGS[@]+"${ARGS[@]}"}"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --) break ;;
  esac
done

command -v node >/dev/null 2>&1 || die "Node.js পাওয়া যায়নি। https://nodejs.org থেকে 22.6+ LTS ইনস্টল করুন।"
command -v tar >/dev/null 2>&1 || die "tar পাওয়া যায়নি।"
if [ -z "$TARBALL" ]; then
  command -v curl >/dev/null 2>&1 || die "curl পাওয়া যায়নি।"
fi

NODE_VERSION="$(node -p 'process.versions.node')"
node -e '
const [a, b] = process.versions.node.split(".").map(Number);
process.exit(a > 22 || (a === 22 && b >= 6) ? 0 : 1);
' || die "Node.js 22.6+ দরকার। এখন চলছে ${NODE_VERSION}।"

TARGET="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$TARGET_RAW")"
case "$SPACE_BUDGET_MB" in
  ''|*[!0-9]*) die "ZOMBIECODER_SPACE_BUDGET_MB must be a whole number of megabytes." ;;
esac

SKIP_INSTALL=0
SKIP_LSP=0
for arg in "${ARGS[@]+"${ARGS[@]}"}"; do
  case "$arg" in
    --no-install) SKIP_INSTALL=1 ;;
    --no-lsp) SKIP_LSP=1 ;;
  esac
done

free_kb() {
  df -Pk "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

fs_type() {
  stat -f -c %T "$1" 2>/dev/null || printf 'unknown'
}

size_bytes() {
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
let bytes = 0;
function walk(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) walk(path.join(target, name));
  } else if (stat.isFile()) {
    bytes += stat.size;
  }
}
walk(root);
console.log(bytes);
' "$1"
}

mb() {
  awk -v bytes="$1" 'BEGIN { printf "%.1f", bytes / 1048576 }'
}

# Staging must survive the tarball plus the extracted tree. Prefer the
# candidate with the most free space: a full root filesystem is exactly the
# failure this script is meant to avoid.
STAGING_MIN_KB=$((64 * 1024))
STAGING_BASE=""
STAGING_KB=0
for base in "${TMPDIR:-}" /tmp /dev/shm; do
  [ -n "$base" ] || continue
  [ -d "$base" ] && [ -w "$base" ] || continue
  available="$(free_kb "$base")"
  case "$available" in
    ''|*[!0-9]*) continue ;;
  esac
  if [ "$available" -ge "$STAGING_MIN_KB" ] && [ "$available" -gt "$STAGING_KB" ]; then
    STAGING_BASE="$base"
    STAGING_KB="$available"
  fi
done
[ -n "$STAGING_BASE" ] || die "কোনো staging directory-তে ৬৪ MB খালি জায়গা নেই (TMPDIR, /tmp, /dev/shm)।"

WORK="$(mktemp -d "$STAGING_BASE/zombiecoder-install.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

SOURCE_KIND="download"
if [ -n "$TARBALL" ]; then
  [ -f "$TARBALL" ] || die "TARBALL পাওয়া যায়নি: $TARBALL"
  cp --reflink=auto "$TARBALL" "$WORK/source.tar.gz" 2>/dev/null || cp "$TARBALL" "$WORK/source.tar.gz"
  SOURCE_KIND="tarball"
  say "▶ source: $TARBALL"
else
  URL="https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}"
  say "▶ download: $URL"
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 600 \
    -o "$WORK/source.tar.gz" "$URL" \
    || die "ডাউনলোড ব্যর্থ। ইন্টারনেট বা ref ($REF) দেখুন।"
fi

TARBALL_BYTES="$(wc -c < "$WORK/source.tar.gz" | tr -d ' ')"
say "▶ staging: $WORK ($(fs_type "$STAGING_BASE"), $(mb "$((STAGING_KB * 1024))") MB free before download)"

tar -xzf "$WORK/source.tar.gz" -C "$WORK" --strip-components=1 \
  || die "tarball খোলা যায়নি।"
rm -f "$WORK/source.tar.gz"
[ -f "$WORK/package.json" ] || die "tarball-এ package.json নেই; ভাঙা ডাউনলোড।"

SOURCE_BYTES="$(size_bytes "$WORK")"
STAGING_FREE_NOW_KB="$(free_kb "$WORK")"
case "$STAGING_FREE_NOW_KB" in
  ''|*[!0-9]*) STAGING_FREE_NOW_KB=0 ;;
esac
if [ "$((STAGING_FREE_NOW_KB * 1024))" -lt "$((SOURCE_BYTES + 8 * 1024 * 1024))" ]; then
  die "staging-এ জায়গা কম: source $(mb "$SOURCE_BYTES") MB, খালি $(mb "$((STAGING_FREE_NOW_KB * 1024))") MB।"
fi
say "▶ source: $(mb "$SOURCE_BYTES") MB staged, $(mb "$TARBALL_BYTES") MB tarball"

INTEGRITY="skipped"
if [ "${ZOMBIECODER_SKIP_INTEGRITY:-0}" = "1" ]; then
  warn "integrity check skip করা হয়েছে (ZOMBIECODER_SKIP_INTEGRITY=1) — শুধু development-এ।"
else
  say "▶ integrity check"
  node "$WORK/scripts/integrity.mjs" --check >/dev/null \
    || die "integrity manifest মিলছে না। tarball বদলানো বা ভাঙা; ইনস্টল বন্ধ।"
  INTEGRITY="verified"
fi

# Generated state used for the idempotence proof. install-proof.json is not
# part of the state. Network measurements are evidence, not generated
# configuration: probe latency/timestamps are removed so a slow or fast probe
# cannot fake a state change. The deterministic decision fields still count.
state_hash() {
  node --input-type=module - "$1" <<'NODE'
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
const files = [];
function walk(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) walk(path.join(target, name));
  } else if (stat.isFile()) {
    const rel = path.relative(root, target).split(path.sep).join("/");
    if (rel === "zombiecoder/install-proof.json" || rel === "zombiecoder/install-proof.json.tmp") return;
    files.push([rel, target]);
  }
}
for (const rel of [
  "opencode.json",
  "agents",
  "plugins/zombiecoder.ts",
  "plugins/zombiecoder",
  "zombiecoder",
]) {
  walk(path.join(root, rel));
}
files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const digest = crypto.createHash("sha256");
for (const [rel, file] of files) {
  let body = fs.readFileSync(file);
  if (rel === "zombiecoder/models.json") {
    try {
      const plan = JSON.parse(body);
      for (const key of ["generatedAt", "probe", "chatProbe", "toolProbe"]) delete plan[key];
      body = Buffer.from(JSON.stringify(plan));
    } catch {
      /* keep the raw bytes when the plan is not strict JSON */
    }
  }
  if (rel === "zombiecoder/mcp.json") {
    try {
      const probe = JSON.parse(body);
      delete probe.ms;
      delete probe.checkedAt;
      body = Buffer.from(JSON.stringify(probe));
    } catch {
      /* keep the raw bytes when the probe is not strict JSON */
    }
  }
  digest.update(rel);
  digest.update("\0");
  digest.update(crypto.createHash("sha256").update(body).digest("hex"));
  digest.update("\n");
}
console.log(digest.digest("hex"));
NODE
}

MODE="fresh"
if [ -f "$TARGET/opencode.json" ]; then
  MODE="update"
fi
BEFORE_BYTES="$(size_bytes "$TARGET")"
say ""
say "────────────────────────────────────────────────────────────"
say "ZombieCoder — $MODE install"
say "target: $TARGET"
say "────────────────────────────────────────────────────────────"

say "▶ pass 1/2 — overwrite generated files"
node --experimental-strip-types "$WORK/bin/install.mjs" --config-dir "$TARGET" --yes "${ARGS[@]+"${ARGS[@]}"}"
HASH1="$(state_hash "$TARGET")"

say ""
say "▶ pass 2/2 — idempotence check (same flags, same target)"
node --experimental-strip-types "$WORK/bin/install.mjs" --config-dir "$TARGET" --yes "${ARGS[@]+"${ARGS[@]}"}"
HASH2="$(state_hash "$TARGET")"
AFTER_BYTES="$(size_bytes "$TARGET")"

export ZC_TARGET="$TARGET"
export ZC_WORK="$WORK"
export ZC_MODE="$MODE"
export ZC_REPO="$REPO"
export ZC_REF="$REF"
export ZC_SOURCE_KIND="$SOURCE_KIND"
export ZC_HASH1="$HASH1"
export ZC_HASH2="$HASH2"
export ZC_SKIP_INSTALL="$SKIP_INSTALL"
export ZC_SKIP_LSP="$SKIP_LSP"
export ZC_INTEGRITY="$INTEGRITY"
export ZC_TARBALL_BYTES="$TARBALL_BYTES"
export ZC_SOURCE_BYTES="$SOURCE_BYTES"
export ZC_STAGING_BASE="$STAGING_BASE"
export ZC_STAGING_FS="$(fs_type "$STAGING_BASE")"
export ZC_STAGING_FREE_BEFORE="$((STAGING_KB * 1024))"
export ZC_BEFORE_BYTES="$BEFORE_BYTES"
export ZC_AFTER_BYTES="$AFTER_BYTES"
export ZC_SPACE_BUDGET_MB="$SPACE_BUDGET_MB"

say ""
say "▶ environment proof"

if node --experimental-strip-types --input-type=module - <<'NODE'
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const target = process.env.ZC_TARGET;
const work = process.env.ZC_WORK;
const proofFile = path.join(target, "zombiecoder", "install-proof.json");
const checks = [];
const home = os.homedir();
const globalDir = path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode");
const canonicalEntry = path.join(target, "plugins", "zombiecoder.ts");

function record(id, status, detail, evidence = {}) {
  checks.push({ id, status, detail, evidence });
}

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function realpath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

function samePath(left, right) {
  const a = realpath(left);
  const b = realpath(right);
  return Boolean(a && b && a === b);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walk(dir) {
  const out = [];
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return out;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(dir).sort()) out.push(...walk(path.join(dir, name)));
  } else if (stat.isFile()) {
    out.push(dir);
  }
  return out;
}

function graph(root) {
  const map = new Map();
  for (const file of walk(root)) {
    map.set(path.relative(root, file).split(path.sep).join("/"), sha256(file));
  }
  return map;
}

function graphHash(map) {
  const digest = crypto.createHash("sha256");
  for (const [rel, hash] of [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    digest.update(rel);
    digest.update("\0");
    digest.update(hash);
    digest.update("\n");
  }
  return digest.digest("hex");
}

function mb(bytes) {
  return `${(Number(bytes) / 1048576).toFixed(1)} MB`;
}

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: target,
    encoding: "utf8",
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: home },
  });
}

function satisfiesRange(version, range) {
  const parse = (text) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? "").trim());
    return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
  };
  const current = parse(version);
  if (!current) return false;
  const wanted = String(range ?? "").trim();
  if (!wanted || wanted === "*" || wanted === "latest") return true;
  if (wanted.startsWith("^")) {
    const base = parse(wanted.slice(1));
    if (!base || current.major !== base.major) return false;
    if (current.minor !== base.minor) return current.minor > base.minor;
    return current.patch >= base.patch;
  }
  const exact = parse(wanted);
  return Boolean(exact && current.major === exact.major && current.minor === exact.minor && current.patch === exact.patch);
}

const skipInstall = process.env.ZC_SKIP_INSTALL === "1";
const skipLsp = process.env.ZC_SKIP_LSP === "1";

// 1. Integrity manifest.
if (process.env.ZC_INTEGRITY === "verified") {
  record("integrity", "PASS", "SHA-256 manifest matches the downloaded source");
} else {
  record("integrity", "SKIPPED", "ZOMBIECODER_SKIP_INTEGRITY=1 (development only)");
}

// 2. Staging stayed inside the measured free space.
const tarballBytes = Number(process.env.ZC_TARBALL_BYTES || 0);
const sourceBytes = Number(process.env.ZC_SOURCE_BYTES || 0);
const stagingFree = Number(process.env.ZC_STAGING_FREE_BEFORE || 0);
const stagedBytes = tarballBytes + sourceBytes;
if (stagedBytes <= stagingFree) {
  record("staging-budget", "PASS", `${mb(stagedBytes)} staged into ${mb(stagingFree)} free at ${process.env.ZC_STAGING_BASE}`, {
    base: process.env.ZC_STAGING_BASE,
    filesystem: process.env.ZC_STAGING_FS,
    tarballBytes,
    sourceBytes,
    freeBytesBefore: stagingFree,
  });
} else {
  record("staging-budget", "FAIL", `${mb(stagedBytes)} staged into only ${mb(stagingFree)} free`);
}

// 3. opencode.json is strict JSON and readable.
let config = null;
try {
  config = readJson(path.join(target, "opencode.json"));
  record("config-json", "PASS", `agents=${Object.keys(config.agents ?? {}).length}, permissions=${(config.permissions ?? []).length}`);
} catch (error) {
  record("config-json", "FAIL", String(error?.message ?? error));
}

// 4. The entrypoint is generated, inside the target, and its graph exists.
try {
  if (!exists(canonicalEntry)) throw new Error(`${canonicalEntry} missing`);
  const text = fs.readFileSync(canonicalEntry, "utf8");
  if (!text.includes("GENERATED by zombiecoder-opencode")) throw new Error("entrypoint is not generated by ZombieCoder");
  if (!text.includes("./zombiecoder/plugin.ts")) throw new Error("entrypoint does not import ./zombiecoder/plugin.ts");
  if (!exists(path.join(target, "plugins", "zombiecoder", "plugin.ts"))) throw new Error("plugin graph is missing");
  record("entrypoint", "PASS", `one generated loader at ${canonicalEntry}`, {
    realpath: realpath(canonicalEntry),
  });
} catch (error) {
  record("entrypoint", "FAIL", String(error?.message ?? error));
}

// 5. Installed plugin graph is byte-for-byte the downloaded source.
try {
  const source = new Map();
  for (const file of ["plugin.ts", "roster.ts"]) {
    source.set(file, sha256(path.join(work, "src", file)));
  }
  for (const [rel, hash] of graph(path.join(work, "src", "zombie"))) {
    source.set(`zombie/${rel}`, hash);
  }
  const installed = graph(path.join(target, "plugins", "zombiecoder"));
  const missing = [...source.keys()].filter((rel) => !installed.has(rel));
  const extra = [...installed.keys()].filter((rel) => !source.has(rel));
  const different = [...source.entries()].filter(([rel, hash]) => installed.has(rel) && installed.get(rel) !== hash).map(([rel]) => rel);
  if (missing.length || extra.length || different.length) {
    record("source-fidelity", "FAIL", `missing=${missing.length}, extra=${extra.length}, different=${different.length}`, {
      missing,
      extra,
      different,
    });
  } else {
    record("source-fidelity", "PASS", `${source.size} files match, graph ${graphHash(source).slice(0, 16)}`, {
      files: source.size,
      graphSha256: graphHash(source),
    });
  }
} catch (error) {
  record("source-fidelity", "FAIL", String(error?.message ?? error));
}

// 6. Exactly one generated loader survives across the roots OpenCode scans.
try {
  const liveTarget = samePath(target, path.join(home, ".opencode")) || samePath(target, globalDir);
  const candidates = liveTarget
    ? [
        canonicalEntry,
        path.join(globalDir, "plugins", "zombiecoder.ts"),
        path.join(home, ".opencode", "plugins", "zombiecoder.ts"),
      ]
    : [canonicalEntry];
  const generated = new Set();
  const handwritten = [];
  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    const text = fs.readFileSync(candidate, "utf8");
    if (text.includes("GENERATED by zombiecoder-opencode")) {
      generated.add(realpath(candidate));
    } else {
      handwritten.push(candidate);
    }
  }
  const canonicalReal = realpath(canonicalEntry);
  if (generated.size === 1 && generated.has(canonicalReal)) {
    record("single-loader", "PASS", `one generated loader: ${canonicalEntry}`, {
      generated: [...generated],
      handwritten,
      scanned: candidates,
    });
  } else {
    record("single-loader", "FAIL", `${generated.size} generated loader(s); expected exactly ${canonicalEntry}`, {
      generated: [...generated],
      handwritten,
      scanned: candidates,
    });
  }
} catch (error) {
  record("single-loader", "FAIL", String(error?.message ?? error));
}

// 7. Every roster agent has a config entry and a markdown file.
try {
  if (!config) throw new Error("opencode.json is unreadable");
  const roster = await import(pathToFileURL(path.join(target, "plugins", "zombiecoder", "roster.ts")).href);
  const ids = roster.ROSTER.map((agent) => agent.id);
  const missingConfig = ids.filter((id) => !config.agents?.[id]);
  const missingMarkdown = ids.filter((id) => {
    const file = path.join(target, "agents", `${id}.md`);
    return !exists(file) || fs.statSync(file).size === 0;
  });
  if (ids.length !== 9 || missingConfig.length || missingMarkdown.length) {
    record("agents", "FAIL", `roster=${ids.length}, missing config=${missingConfig.length}, missing markdown=${missingMarkdown.length}`, {
      ids,
      missingConfig,
      missingMarkdown,
    });
  } else {
    record("agents", "PASS", `${ids.length} roster agents with config and markdown`);
  }
} catch (error) {
  record("agents", "FAIL", String(error?.message ?? error));
}

// 8. Consent is still "ask" for both sides of the goal contract.
try {
  if (!config) throw new Error("opencode.json is unreadable");
  const rules = Array.isArray(config.permissions) ? config.permissions : [];
  const problems = [];
  for (const action of ["goal_contract.open", "goal_contract.close"]) {
    const matching = rules.filter((rule) => rule.action === action);
    if (matching.length === 0) problems.push(`${action}: missing`);
    for (const rule of matching) {
      if (rule.effect !== "ask") problems.push(`${action}: effect=${rule.effect}`);
    }
  }
  if (problems.length) {
    record("consent", "FAIL", problems.join("; "));
  } else {
    record("consent", "PASS", "goal_contract.open and goal_contract.close are ask");
  }
} catch (error) {
  record("consent", "FAIL", String(error?.message ?? error));
}

// 9. Dependencies are present and satisfy package.json.
if (skipInstall) {
  record("dependencies", "SKIPPED", "--no-install");
} else {
  try {
    const wanted = readJson(path.join(work, "package.json")).dependencies?.["@opencode/plugin"] ?? "";
    const installed = readJson(path.join(target, "node_modules", "@opencode", "plugin", "package.json")).version ?? "";
    if (!satisfiesRange(installed, wanted)) {
      record("dependencies", "FAIL", `installed ${installed || "(missing)"} does not satisfy ${wanted || "(no range)"}`);
    } else {
      record("dependencies", "PASS", `@opencode/plugin ${installed} satisfies ${wanted}`);
    }
  } catch (error) {
    record("dependencies", "FAIL", String(error?.message ?? error));
  }
}

// 10. The installer's own structural audit.
if (skipInstall || skipLsp) {
  record("audit", "SKIPPED", skipInstall ? "--no-install" : "--no-lsp");
} else {
  try {
    const result = runNode(path.join(work, "scripts", "audit-install.mjs"), ["--config", target, "--install", target]);
    const output = String(result.stdout || result.stderr || "").trim();
    const last = output.split("\n").slice(-1)[0] || "(no output)";
    if (result.status !== 0) {
      record("audit", "FAIL", `exit ${result.status}: ${last}`, { output: output.slice(-2000) });
    } else {
      record("audit", "PASS", last);
    }
  } catch (error) {
    record("audit", "FAIL", String(error?.message ?? error));
  }
}

// 11. Every configured LSP command exists.
if (skipInstall || skipLsp) {
  record("lsp-config", "SKIPPED", skipInstall ? "--no-install" : "--no-lsp");
} else {
  try {
    if (!config) throw new Error("opencode.json is unreadable");
    const entries = Object.entries(config.lsp ?? {}).filter(([, entry]) => entry && typeof entry === "object" && !entry.disabled);
    const missing = entries.filter(([, entry]) => {
      const command = Array.isArray(entry.command) ? entry.command[0] : entry.command;
      return !command || !exists(command);
    });
    if (entries.length === 0) {
      record("lsp-config", "FAIL", "no active LSP server in opencode.json");
    } else if (missing.length) {
      record("lsp-config", "FAIL", `${missing.length}/${entries.length} commands missing`, { missing: missing.map(([name]) => name) });
    } else {
      record("lsp-config", "PASS", `${entries.length}/${entries.length} LSP commands exist`);
    }
  } catch (error) {
    record("lsp-config", "FAIL", String(error?.message ?? error));
  }
}

// 12. Every LSP server answers a real initialize handshake.
if (skipInstall || skipLsp) {
  record("lsp-probe", "SKIPPED", skipInstall ? "--no-install" : "--no-lsp");
} else {
  try {
    const result = runNode(path.join(work, "scripts", "lsp-probe.mjs"), [
      "--config",
      path.join(target, "opencode.json"),
      "--root",
      target,
      "--compact",
      "--timeout",
      "20000",
    ]);
    const output = String(result.stdout || "").trim();
    let payload = null;
    try {
      payload = JSON.parse(output);
    } catch {
      /* keep the raw output in the failure detail */
    }
    if (result.status !== 0 || !payload?.ok) {
      record("lsp-probe", "FAIL", `exit ${result.status}: ${String(result.stderr || output).trim().slice(-500)}`);
    } else {
      record("lsp-probe", "PASS", `${payload.servers?.length ?? 0} servers initialized`, {
        servers: payload.servers?.map((server) => ({ server: server.server, ok: server.ok })),
      });
    }
  } catch (error) {
    record("lsp-probe", "FAIL", String(error?.message ?? error));
  }
}

// 13. The running OpenCode instance loads exactly one active zombiecoder.
async function livePlugin() {
  if (!samePath(target, path.join(home, ".opencode")) && !samePath(target, globalDir)) {
    return record("live-plugin", "NOT_TESTED", `isolated target ${target}; live API was not touched`);
  }
  if (skipInstall) {
    return record("live-plugin", "NOT_TESTED", "--no-install");
  }
  const stateHome = process.env.XDG_STATE_HOME || path.join(home, ".local", "state");
  const serviceFile = path.join(stateHome, "opencode", "service.json");
  if (!exists(serviceFile)) {
    return record("live-plugin", "NOT_TESTED", `no running service file at ${serviceFile}`);
  }
  let service;
  try {
    service = readJson(serviceFile);
  } catch (error) {
    return record("live-plugin", "NOT_TESTED", `unreadable service file: ${String(error?.message ?? error)}`);
  }
  let origin;
  try {
    origin = new URL(service.url).origin;
  } catch (error) {
    return record("live-plugin", "NOT_TESTED", `invalid service URL: ${String(error?.message ?? error)}`);
  }
  const authorization = "Basic " + Buffer.from(`opencode:${service.password}`).toString("base64");
  const headers = { authorization };
  const summarize = (body) =>
    (body.data ?? [])
      .filter((plugin) => plugin.id === "zombiecoder")
      .map((plugin) => ({
        status: plugin.state?.status ?? null,
        path: plugin.source?.path ?? null,
      }));
  const activeAtCanonical = (hits) =>
    hits.length === 1 &&
    hits[0].status === "active" &&
    hits[0].path &&
    samePath(hits[0].path, canonicalEntry);
  let reloadStatus = null;
  let last = null;
  let before = null;
  try {
    // Record the pre-reload state, then reload unconditionally: an update must
    // make the running process rebuild from the files on disk, not keep serving
    // the previous module graph because the entry path happens to be unchanged.
    const beforeResponse = await fetch(`${origin}/api/plugin`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!beforeResponse.ok) throw new Error(`GET /api/plugin -> ${beforeResponse.status}`);
    before = summarize(await beforeResponse.json());

    const reload = await fetch(`${origin}/api/location/reload`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(60000),
    });
    reloadStatus = reload.status;
    if (!reload.ok) {
      return record("live-plugin", "NOT_TESTED", `reload unavailable (${reload.status}); restart OpenCode and rerun`, {
        server: origin,
        reloadStatus,
        before,
      });
    }

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const response = await fetch(`${origin}/api/plugin`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`GET /api/plugin -> ${response.status}`);
      last = summarize(await response.json());
      if (activeAtCanonical(last)) {
        return record("live-plugin", "PASS", `reload ${reloadStatus}, one active zombiecoder at ${canonicalEntry}`, {
          server: origin,
          reloadStatus,
          before,
          plugins: last,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    record("live-plugin", "FAIL", `reload ${reloadStatus}, no single active zombiecoder at ${canonicalEntry}`, {
      server: origin,
      reloadStatus,
      before,
      plugins: last,
    });
  } catch (error) {
    if (reloadStatus === null) {
      record("live-plugin", "NOT_TESTED", `live API unavailable: ${String(error?.message ?? error)}`, {
        server: origin,
      });
    } else {
      record("live-plugin", "FAIL", `live API failed after reload ${reloadStatus}: ${String(error?.message ?? error)}`, {
        server: origin,
        reloadStatus,
        before,
        plugins: last,
      });
    }
  }
}
await livePlugin();

// 14. Second installer pass produced the same generated state.
const hash1 = process.env.ZC_HASH1;
const hash2 = process.env.ZC_HASH2;
if (hash1 && hash1 === hash2) {
  record("idempotence", "PASS", `H1 = H2 = ${hash1}`, { hash: hash1 });
} else {
  record("idempotence", "FAIL", `H1=${hash1 || "(missing)"} H2=${hash2 || "(missing)"}`, { hash1, hash2 });
}

// 15. Target growth stayed inside the declared budget.
const before = Number(process.env.ZC_BEFORE_BYTES || 0);
const after = Number(process.env.ZC_AFTER_BYTES || 0);
const budget = Number(process.env.ZC_SPACE_BUDGET_MB || 800) * 1048576;
const delta = Math.max(0, after - before);
if (delta <= budget) {
  record("space-delta", "PASS", `${mb(delta)} growth (${mb(before)} -> ${mb(after)}), budget ${mb(budget)}`, {
    beforeBytes: before,
    afterBytes: after,
    deltaBytes: delta,
    budgetBytes: budget,
  });
} else {
  record("space-delta", "FAIL", `${mb(delta)} growth exceeds ${mb(budget)} budget`);
}

// 16. The staging tree is gone before the proof is written.
let cleanupError = null;
try {
  fs.rmSync(work, { recursive: true, force: true });
} catch (error) {
  cleanupError = String(error?.message ?? error);
}
if (!exists(work) && !cleanupError) {
  record("staging-cleanup", "PASS", `removed ${work}`);
} else {
  record("staging-cleanup", "FAIL", cleanupError || `still exists: ${work}`);
}

const failed = checks.filter((check) => check.status === "FAIL");
const skipped = checks.filter((check) => check.status === "SKIPPED");
const untested = checks.filter((check) => check.status === "NOT_TESTED");
const proof = {
  schema: "zombiecoder.install-proof/1",
  generatedAt: new Date().toISOString(),
  install: {
    mode: process.env.ZC_MODE,
    target,
    repo: process.env.ZC_REPO,
    ref: process.env.ZC_REF,
    sourceKind: process.env.ZC_SOURCE_KIND,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  idempotence: {
    hash1,
    hash2,
    equal: Boolean(hash1 && hash1 === hash2),
    normalized: [
      "zombiecoder/install-proof.json excluded",
      "zombiecoder/models.json: generatedAt, probe, chatProbe, toolProbe excluded",
      "zombiecoder/mcp.json: ms, checkedAt excluded",
    ],
  },
  space: {
    staging: {
      base: process.env.ZC_STAGING_BASE,
      filesystem: process.env.ZC_STAGING_FS,
      freeBytesBefore: stagingFree,
      tarballBytes,
      sourceBytes,
      cleaned: !exists(work) && !cleanupError,
    },
    target: {
      beforeBytes: before,
      afterBytes: after,
      deltaBytes: delta,
      budgetBytes: budget,
    },
  },
  checks,
  summary: {
    total: checks.length,
    pass: checks.filter((check) => check.status === "PASS").length,
    fail: failed.length,
    skipped: skipped.length,
    notTested: untested.length,
  },
  verdict: failed.length ? "FAIL" : "PASS",
};
fs.mkdirSync(path.dirname(proofFile), { recursive: true });
fs.writeFileSync(`${proofFile}.tmp`, `${JSON.stringify(proof, null, 2)}\n`);
fs.renameSync(`${proofFile}.tmp`, proofFile);

for (const check of checks) {
  console.log(`  ${check.status.padEnd(10)} ${check.id}${check.detail ? ` — ${check.detail}` : ""}`);
}
console.log("-".repeat(72));
console.log(
  `PROOF ${proof.verdict} — ${proof.summary.pass}/${proof.summary.total} passed, ` +
    `${proof.summary.fail} failed, ${proof.summary.skipped} skipped, ${proof.summary.notTested} not tested`,
);
console.log(`proof: ${proofFile}`);
process.exit(failed.length ? 1 : 0);
NODE
then
  say ""
  say "✅ install/update/proof শেষ।"
  say "   proof: $TARGET/zombiecoder/install-proof.json"
  say "   OpenCode বন্ধ করে আবার খুলুন — নতুন plugin load হবে।"
  say "   আবার চালালে একই জায়গায় update হবে (config merge হয়, মুছে যায় না)।"
else
  say ""
  say "✖ PROOF FAIL — উপরের ব্যর্থ check দেখুন: $TARGET/zombiecoder/install-proof.json"
  exit 1
fi
