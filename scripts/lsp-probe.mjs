#!/usr/bin/env node
// Probe configured LSP servers with a real JSON-RPC initialize handshake.
//
// Reads only the `lsp` section of the OpenCode config. It never prints provider
// keys, environment variables, or the rest of the config. Exit code 0 means
// every active server answered initialize; 1 means at least one failed.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = `Usage: node scripts/lsp-probe.mjs [options]

Options:
  --config <path>   OpenCode config (default: $OPENCODE_CONFIG, then
                    ~/.config/opencode, ~/.opencode)
  --root <path>     Workspace root URI (default: current directory)
  --timeout <ms>    Per-server initialize timeout (default: 15000)
  --compact         One line per server (no capability list)
  -h, --help        Show this help
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

function option(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

function defaultConfig() {
  const fromEnv = process.env.OPENCODE_CONFIG || process.env.OPENCODE_CONFIG_DIR;
  if (fromEnv && fromEnv.trim()) {
    const value = resolve(fromEnv.trim());
    return value.endsWith(".json") ? value : join(value, "opencode.json");
  }
  const candidates = [
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".opencode", "opencode.json"),
  ];
  return candidates.find((file) => existsSync(file)) ?? candidates[0];
}

const configPath = resolve(option("--config", defaultConfig()));
const root = resolve(option("--root", process.cwd()));
const timeoutMs = Number(option("--timeout", "15000"));
const compact = argv.includes("--compact");

if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
  process.stderr.write("lsp-probe: --timeout must be a number >= 1000\n");
  process.exit(2);
}

function frame(value) {
  const body = JSON.stringify(value);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function stop(child) {
  try {
    child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null }));
    child.stdin.write(frame({ jsonrpc: "2.0", method: "exit", params: null }));
  } catch {
    // The process may already be gone.
  }
}

function probe(name, entry) {
  return new Promise((resolveProbe) => {
    if (!entry || typeof entry !== "object" || !entry.command) {
      resolveProbe({ server: name, ok: false, error: "missing command" });
      return;
    }

    const command = entry.command;
    const child = Array.isArray(command)
      ? spawn(command[0], command.slice(1), { cwd: root, stdio: ["pipe", "pipe", "pipe"] })
      : spawn(command, { cwd: root, shell: true, stdio: ["pipe", "pipe", "pipe"] });

    let buffer = Buffer.alloc(0);
    let stderr = "";
    let done = false;
    const started = Date.now();

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop(child);
      setTimeout(() => child.kill("SIGKILL"), 300).unref();
      resolveProbe({ server: name, duration_ms: Date.now() - started, ...result });
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "timeout waiting for initialize", stderr: stderr.slice(0, 500) });
    }, timeoutMs);

    child.on("error", (error) => finish({ ok: false, error: String(error) }));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString();
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        if (buffer.length < headerEnd + 4 + length) return;
        const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString();
        buffer = buffer.subarray(headerEnd + 4 + length);

        let message;
        try {
          message = JSON.parse(body);
        } catch {
          continue;
        }
        if (message.id !== 1) continue;

        if (message.error) {
          finish({ ok: false, error: message.error, stderr: stderr.slice(0, 500) });
        } else {
          const capabilities = message.result?.capabilities ?? {};
          finish({
            ok: true,
            serverInfo: message.result?.serverInfo ?? null,
            capability_count: Object.keys(capabilities).length,
            capabilities: Object.keys(capabilities).sort(),
          });
        }
        return;
      }
    });

    const rootUri = pathToFileURL(root).href;
    child.stdin.write(
      frame({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          processId: process.pid,
          clientInfo: { name: "zombiecoder-lsp-probe", version: "1.0" },
          rootUri,
          workspaceFolders: [{ uri: rootUri, name: basename(root) }],
          capabilities: {},
        },
      }),
    );
  });
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, config: configPath, error: `cannot read config: ${String(error)}` }, null, 2) + "\n",
  );
  process.exit(2);
}

const lsp = config?.lsp;
if (lsp === true) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        config: configPath,
        root,
        note: "lsp=true enables built-in servers; add explicit entries to probe them",
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

if (!lsp || typeof lsp !== "object" || Array.isArray(lsp)) {
  process.stdout.write(
    JSON.stringify({ ok: false, config: configPath, root, error: "no lsp object in config" }, null, 2) + "\n",
  );
  process.exit(1);
}

const active = Object.entries(lsp).filter(([, entry]) => entry && typeof entry === "object" && !entry.disabled);
if (active.length === 0) {
  process.stdout.write(
    JSON.stringify({ ok: false, config: configPath, root, error: "no active lsp servers" }, null, 2) + "\n",
  );
  process.exit(1);
}

const servers = [];
for (const [name, entry] of active) {
  servers.push(await probe(name, entry));
}

const ok = servers.every((server) => server.ok);
const payload = compact
  ? {
      ok,
      config: configPath,
      root,
      failed: servers.filter((server) => !server.ok).length,
      servers: servers.map(({ server, ok: ready, duration_ms, serverInfo, error }) => ({
        server,
        ok: ready,
        duration_ms,
        serverInfo,
        ...(error ? { error } : {}),
      })),
    }
  : { ok, config: configPath, root, servers };
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
process.exit(ok ? 0 : 1);
