#!/usr/bin/env node
// Direct LSP diagnostics probe.
//
// Starts one configured language server, opens a file's current text (plus an
// optional injected line) with textDocument/didOpen, and waits for a real
// textDocument/publishDiagnostics notification. The file on disk is never
// modified. This probe is manual evidence: it proves the server binary and
// config work, not that OpenCode's editor UI is wired to them.
//
// Usage:
//   node scripts/lsp-diagnostics.mjs --file src/zombie/lsp.ts
//   node scripts/lsp-diagnostics.mjs --file src/zombie/lsp.ts \
//     --inject 'const __probe: number = "x";' --expect "not assignable"
//   npm run lsp:diagnostics -- --file src/zombie/lsp.ts --compact

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = `Usage: node scripts/lsp-diagnostics.mjs --file <path> [options]

Options:
  --config <path>   OpenCode config (default: $OPENCODE_CONFIG,
                    then ~/.config/opencode/opencode.json, ~/.opencode/opencode.json)
  --root <path>     Workspace root (default: current directory)
  --server <name>   LSP server key (default: derived from the file extension)
  --inject <text>   Append this text to the in-memory document (disk untouched)
  --expect <text>   Require one diagnostic message to contain this text
  --timeout <ms>    Wait for publishDiagnostics (default: 25000)
  --compact         One-line JSON result
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
const file = option("--file", "");
const inject = option("--inject", "");
const expect = option("--expect", "");
const timeoutMs = Number(option("--timeout", "25000"));
const compact = argv.includes("--compact");

if (!file) {
  process.stderr.write("lsp-diagnostics: --file is required\n");
  process.exit(2);
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
  process.stderr.write("lsp-diagnostics: --timeout must be a number >= 1000\n");
  process.exit(2);
}

const absoluteFile = resolve(file);
if (!existsSync(absoluteFile)) {
  process.stderr.write(`lsp-diagnostics: file not found: ${absoluteFile}\n`);
  process.exit(2);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, config: configPath, error: `cannot read config: ${String(error)}` }, null, 2) + "\n");
  process.exit(2);
}

const lsp = config?.lsp;
if (!lsp || typeof lsp !== "object" || Array.isArray(lsp)) {
  process.stdout.write(JSON.stringify({ ok: false, config: configPath, error: "no lsp object in config" }, null, 2) + "\n");
  process.exit(1);
}

const extension = extname(absoluteFile).toLowerCase();
const requested = option("--server", "");
const serverName =
  requested ||
  Object.entries(lsp).find(([, entry]) => Array.isArray(entry?.extensions) && entry.extensions.includes(extension))?.[0] ||
  "";
const entry = serverName ? lsp[serverName] : null;
if (!entry || !Array.isArray(entry.command)) {
  process.stdout.write(
    JSON.stringify({ ok: false, config: configPath, file: absoluteFile, error: `no lsp server for ${extension || "this file"}` }, null, 2) + "\n",
  );
  process.exit(1);
}

const languageId =
  {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".py": "python",
    ".pyi": "python",
    ".sh": "shellscript",
    ".bash": "shellscript",
    ".zsh": "shellscript",
    ".ksh": "shellscript",
    ".json": "json",
    ".jsonc": "jsonc",
    ".css": "css",
    ".scss": "scss",
    ".less": "less",
    ".html": "html",
    ".htm": "html",
    ".md": "markdown",
    ".mdx": "mdx",
  }[extension] ?? "plaintext";

const onDisk = readFileSync(absoluteFile, "utf8");
const text = inject ? `${onDisk}\n${inject}\n` : onDisk;
const uri = pathToFileURL(absoluteFile).href;
const command = entry.command;
const child = spawn(command[0], command.slice(1), { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
const started = Date.now();
const notifications = [];
let stderr = "";
let buffer = Buffer.alloc(0);
let settled = false;
let serverInfo = null;
let timer;

function frame(value) {
  const body = JSON.stringify(value);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function send(value) {
  try {
    child.stdin.write(frame(value));
  } catch {
    /* The child may already be gone. */
  }
}

function finish(result) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  const diagnostics = notifications.flatMap((notification) => notification.items ?? []);
  const matched = expect ? diagnostics.some((item) => String(item?.message ?? "").includes(expect)) : null;
  const ok = Boolean(result.ok) && (expect ? matched === true : true);
  const payload = {
    ok,
    capturedAt: new Date().toISOString(),
    duration_ms: Date.now() - started,
    config: configPath,
    root,
    file: absoluteFile,
    server: serverName,
    pid: child.pid,
    ppid: process.pid,
    cmd: command.join(" "),
    injected: Boolean(inject),
    expect: expect || null,
    matched,
    serverInfo,
    diagnostics,
    stderr: stderr.slice(0, 1000),
    error: result.error ?? null,
  };
  process.stdout.write(JSON.stringify(payload, null, compact ? 0 : 2) + "\n");
  send({ jsonrpc: "2.0", id: 99, method: "shutdown", params: null });
  send({ jsonrpc: "2.0", method: "exit", params: null });
  setTimeout(() => child.kill("SIGKILL"), 300).unref();
  process.exitCode = ok ? 0 : 1;
}

child.on("error", (error) => finish({ ok: false, error: String(error) }));
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
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

    if (message.method === "textDocument/publishDiagnostics") {
      if (message.params?.uri !== uri) continue;
      notifications.push({
        at: Date.now() - started,
        version: message.params.version ?? null,
        items: message.params.diagnostics ?? [],
      });
      if ((message.params.diagnostics ?? []).length > 0) {
        finish({ ok: true });
      }
      continue;
    }

    if (message.id === 1) {
      if (message.error) {
        finish({ ok: false, error: JSON.stringify(message.error) });
        return;
      }
      serverInfo = message.result?.serverInfo ?? null;
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
      send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId, version: 1, text } },
      });
    }
  }
});

timer = setTimeout(() => {
  finish({ ok: false, error: `timeout waiting for publishDiagnostics (${timeoutMs}ms)` });
}, timeoutMs);

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    processId: process.pid,
    clientInfo: { name: "zombiecoder-lsp-diagnostics", version: "1.0" },
    rootUri: pathToFileURL(root).href,
    workspaceFolders: [{ uri: pathToFileURL(root).href, name: basename(root) }],
    capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true } } },
  },
});
