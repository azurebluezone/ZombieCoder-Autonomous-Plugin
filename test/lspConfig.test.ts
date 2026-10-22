import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LSP_SERVERS,
  lspPackageList,
  resolveLspServers,
  syncLspConfig,
} from "../src/zombie/lspConfig.ts";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeBin(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, process.platform === "win32" ? name + ".cmd" : name);
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", "utf8");
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
}

test("resolveLspServers finds binaries in the install-root lsp dir", () => {
  const root = tempDir("zombiecoder-lsp-");
  try {
    const bins = path.join(root, "lsp", "node_modules", ".bin");
    for (const server of LSP_SERVERS) fakeBin(bins, server.bin);
    const resolved = resolveLspServers(root, { dirs: [bins], env: {} });
    assert.deepEqual(resolved.missing, []);
    assert.deepEqual(Object.keys(resolved.servers).sort(), ["bash", "json", "python", "typescript"]);
    assert.equal(resolved.servers.typescript.command[0], path.join(bins, "typescript-language-server"));
    assert.deepEqual(resolved.servers.typescript.command.slice(1), ["--stdio"]);
    assert.ok(resolved.servers.typescript.extensions.includes(".ts"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("syncLspConfig writes lsp entries, preserves existing ones, and is idempotent", () => {
  const root = tempDir("zombiecoder-lsp-config-");
  try {
    const bins = path.join(root, "lsp", "node_modules", ".bin");
    fakeBin(bins, "typescript-language-server");
    const configFile = path.join(root, "opencode.json");
    fs.writeFileSync(
      configFile,
      JSON.stringify({ $schema: "https://opencode.ai/config.json", agents: { manu: {} }, lsp: { custom: { command: ["x"] } } }),
      "utf8",
    );

    const first = syncLspConfig(configFile, root);
    assert.equal(first.updated, true);
    assert.deepEqual(first.servers, ["typescript"]);
    assert.ok(first.missing.includes("python"));

    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    assert.deepEqual(config.lsp.custom, { command: ["x"] });
    assert.equal(config.lsp.typescript.command[0], path.join(bins, "typescript-language-server"));
    assert.deepEqual(config.agents, { manu: {} });

    const second = syncLspConfig(configFile, root);
    assert.equal(second.updated, false, "a second sync must not rewrite the file");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("syncLspConfig leaves lsp=true and invalid JSON untouched", () => {
  const root = tempDir("zombiecoder-lsp-skip-");
  try {
    const configFile = path.join(root, "opencode.json");
    fs.writeFileSync(configFile, JSON.stringify({ lsp: true }), "utf8");
    const builtIn = syncLspConfig(configFile, root);
    assert.equal(builtIn.updated, false);
    assert.match(String(builtIn.skipped), /lsp=true/);
    assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), { lsp: true });

    fs.writeFileSync(configFile, "{ not json", "utf8");
    const broken = syncLspConfig(configFile, root);
    assert.equal(broken.updated, false);
    assert.match(String(broken.skipped), /not strict JSON/);
    assert.equal(fs.readFileSync(configFile, "utf8"), "{ not json");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lspPackageList keeps the documented TypeScript pin", () => {
  const packages = lspPackageList();
  assert.ok(packages.includes("typescript@5.9.3"));
  assert.ok(packages.includes("pyright"));
  assert.equal(new Set(packages).size, packages.length);
});
