import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "audit-install.mjs");

function run(args: string[], home: string): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Minimal install that should pass every structural check. The LSP and local
 * MCP commands point at node itself: the audit checks that the command exists,
 * not that it speaks the protocol.
 */
function makeInstall(root: string): string {
  const configDir = path.join(root, ".opencode");
  fs.mkdirSync(path.join(configDir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(configDir, "agents", "tester.md"), "# tester\n");
  fs.writeFileSync(path.join(configDir, "plugins", "zombiecoder.ts"), "export default {};\n");
  fs.writeFileSync(
    path.join(configDir, "opencode.json"),
    JSON.stringify({
      agents: { tester: { mode: "all" } },
      lsp: { node: { command: [process.execPath, "--version"], extensions: [".ts"] } },
      mcp: { servers: { local: { type: "local", command: [process.execPath, SCRIPT] } } },
      model: "test/model",
    }),
  );
  return configDir;
}

test("audit --help prints usage and exits 0 without reading a config", () => {
  const home = tempDir("zombiecoder-audit-help-");
  try {
    const result = run(["--help"], home);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage: node scripts\/audit-install\.mjs/);
    assert.match(result.stdout, /--config <dir>/);
    assert.match(result.stdout, /--install <dir>/);
    assert.equal(result.stderr, "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("audit rejects an unknown flag with exit 2 and usage on stderr", () => {
  const home = tempDir("zombiecoder-audit-bad-");
  try {
    const result = run(["--bogus"], home);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown argument "--bogus"/);
    assert.match(result.stderr, /^Usage:/m);
    assert.equal(result.stdout, "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("audit rejects a flag without a directory", () => {
  const home = tempDir("zombiecoder-audit-missing-");
  try {
    const result = run(["--config"], home);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--config needs a directory/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("audit accepts both --flag value and --flag=value, and defaults --install to --config", () => {
  const home = tempDir("zombiecoder-audit-ok-");
  try {
    const configDir = makeInstall(home);

    const spaced = run(["--config", configDir], home);
    assert.equal(spaced.status, 0, spaced.stdout + spaced.stderr);
    assert.match(spaced.stdout, /agents=1 lsp=1\/1 mcp=1 entrypoint=ok/);
    assert.match(spaced.stdout, /PASS install configuration complete/);

    const equals = run([`--config=${configDir}`, `--install=${configDir}`], home);
    assert.equal(equals.status, 0, equals.stdout + equals.stderr);
    assert.match(equals.stdout, new RegExp(`config=${configDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("audit fails with exit 2 when the config directory has no opencode.json", () => {
  const home = tempDir("zombiecoder-audit-empty-");
  try {
    const result = run(["--config", home], home);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /FAIL no opencode\.json\/jsonc under/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
