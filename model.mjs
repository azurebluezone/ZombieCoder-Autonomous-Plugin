#!/usr/bin/env node
/**
 * ZombieCoder runtime model mapper.
 *
 * Interactive:
 *   node --experimental-strip-types model.mjs
 *
 * Non-interactive / CI:
 *   node --experimental-strip-types model.mjs --non-interactive \
 *     --url https://api.example.com/v1 --provider-id example \
 *     --out /tmp/opencode/model-plan.json --json
 *
 * Rules:
 *   - The configured provider is probed at its OWN /v1/models URL.
 *   - An empty, malformed, unreachable or unauthorized provider is not usable.
 *   - The fallback reads `opencode models`, keeps model ids whose name contains
 *     "free", and always keeps the one explicitly allowed baseline id.
 *   - No other model name is hardcoded.
 *   - A missing config/roster is reported, not fatal.
 *   - Secrets are never printed. `--apply` backs up the config first.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";

const BASELINE_MODEL = "opencode/big-pickle"; // the only allowed model-name literal
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(`--${name}`);
}

function arg(name, fallback = "") {
  const eq = `--${name}=`;
  const inline = argv.find((value) => value.startsWith(eq));
  if (inline) return inline.slice(eq.length);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0) {
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) return value;
  }
  return fallback;
}

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sanitizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function baseFromUrl(value) {
  let url = sanitizeUrl(value);
  if (!url) return "";
  url = url.replace(/\/+$/, "");
  if (/\/v1\/models$/i.test(url)) url = url.slice(0, -"/models".length);
  return url;
}

function modelsUrl(value) {
  const base = baseFromUrl(value);
  if (!base) return "";
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

function deriveProviderId(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
  } catch {
    return "custom";
  }
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function stableHash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function modelRef(providerId, modelId) {
  const provider = String(providerId || "").trim();
  const model = String(modelId || "").trim();
  if (!provider || !model) return null;
  return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
}

function assignModels(agents, candidates, baseline = BASELINE_MODEL) {
  const assignment = {};
  if (!agents.length) return assignment;
  const usable = candidates.length ? unique(candidates) : [baseline];
  for (const agent of agents) {
    if (agent.model && agent.model !== baseline && usable.includes(agent.model)) {
      assignment[agent.id] = agent.model;
      continue;
    }
    assignment[agent.id] = usable[stableHash(agent.id) % usable.length];
  }
  return assignment;
}

async function readLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("response too large");
    return text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const headers = { accept: "application/json", ...(options.headers || {}) };
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body,
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!/json/i.test(contentType)) {
      await readLimited(response, 1024).catch(() => "");
      return { ok: false, status: response.status, error: `unexpected content-type: ${contentType || "(missing)"}` };
    }
    const text = await readLimited(response);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, status: response.status, error: "invalid JSON" };
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    const message = error?.name === "AbortError" ? `timeout after ${options.timeoutMs || DEFAULT_TIMEOUT_MS}ms` : String(error?.message || error);
    return { ok: false, status: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function probeProvider(url, apiKey, timeoutMs) {
  const target = modelsUrl(url);
  const result = { url: target, ok: false, status: null, models: [], ms: 0, error: null };
  if (!target) {
    result.error = "no provider URL";
    return result;
  }
  const started = Date.now();
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const response = await fetchJson(target, { headers, timeoutMs });
  result.ms = Date.now() - started;
  result.status = response.status ?? null;
  if (result.status !== null && (result.status < 200 || result.status >= 300)) {
    result.error = `HTTP ${result.status}`;
    return result;
  }
  if (!response.ok) {
    result.error = response.error || "provider response could not be parsed";
    return result;
  }
  const body = response.body;
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
    result.error = "response is not an OpenAI-compatible model list";
    return result;
  }
  const invalid = body.data.filter((item) => !item || typeof item.id !== "string" || !item.id.trim());
  if (invalid.length) {
    result.error = `model list contains ${invalid.length} invalid entr${invalid.length === 1 ? "y" : "ies"}`;
    return result;
  }
  result.models = unique(body.data.map((item) => item.id.trim()));
  if (result.models.length === 0) {
    result.error = "provider returned an empty model list";
    return result;
  }
  result.ok = true;
  return result;
}

function readConfigAgents() {
  const candidates = [
    path.join(os.homedir(), ".opencode", "opencode.json"),
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const raw = parsed?.agents || parsed?.agent || {};
      const agents = Object.entries(raw)
        .filter(([id, value]) => typeof id === "string" && id && value && typeof value === "object")
        .map(([id, value]) => ({ id, model: typeof value.model === "string" ? value.model : "" }));
      if (agents.length) return { agents, source: file, error: null };
    } catch (error) {
      return { agents: [], source: file, error: String(error?.message || error) };
    }
  }
  return { agents: [], source: null, error: "no agents found in opencode.json" };
}

async function readRosterAgents() {
  try {
    const module = await import(new URL("./src/roster.ts", import.meta.url));
    const roster = Array.isArray(module.ROSTER) ? module.ROSTER : [];
    return {
      agents: roster.map((item) => ({ id: item.id, model: item.model })),
      source: "src/roster.ts",
      error: roster.length ? null : "roster is empty",
    };
  } catch (error) {
    return { agents: [], source: "src/roster.ts", error: String(error?.message || error) };
  }
}

function findOpencodeBin() {
  const explicit = arg("opencode-bin", env("ZC_OPENCODE_BIN"));
  if (explicit && fs.existsSync(explicit)) return explicit;
  const pathHit = (process.env.PATH || "").split(path.delimiter).find((dir) => {
    const candidate = path.join(dir, "opencode");
    return fs.existsSync(candidate);
  });
  if (pathHit) return path.join(pathHit, "opencode");
  const cliRoot = path.join(os.homedir(), ".config", "ai.opencode.desktop", "cli");
  try {
    const versions = fs.readdirSync(cliRoot).sort().reverse();
    for (const version of versions) {
      const candidate = path.join(cliRoot, version, "opencode-cli");
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* no desktop CLI */
  }
  return "";
}

function runCommand(command, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!command) {
      resolve({ ok: false, code: null, stdout: "", stderr: "", error: "command missing" });
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let total = 0;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, code: null, stdout, stderr, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      total += chunk.length;
      if (total <= MAX_RESPONSE_BYTES) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      total += chunk.length;
      if (total <= MAX_RESPONSE_BYTES) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr, error: String(error?.message || error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr, error: code === 0 ? null : `exit ${code}` });
    });
  });
}

async function readOpencodeModels() {
  const bin = findOpencodeBin();
  if (!bin) return { ok: false, bin: null, models: [], error: "opencode binary not found" };
  const result = await runCommand(bin, ["models"], 20000);
  if (!result.ok) return { ok: false, bin, models: [], error: result.error || "opencode models failed" };
  const models = unique(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[^\s]+\/[^\s]+$/.test(line)),
  );
  return { ok: models.length > 0, bin, models, error: models.length ? null : "opencode models returned nothing" };
}

function fallbackModels(catalog) {
  const free = catalog.filter((id) => /free/i.test(id));
  return unique([...free, BASELINE_MODEL]);
}

async function mcpRpc(url, payload, sessionId, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
    const nextSession = response.headers.get("mcp-session-id") || sessionId || null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!payload.id) return { response: null, sessionId: nextSession };
    const contentType = response.headers.get("content-type") || "";
    const text = await readLimited(response, 1024 * 1024);
    if (contentType.includes("text/event-stream")) {
      for (const event of text.split(/\r?\n\r?\n/)) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (parsed?.id === payload.id) return { response: parsed, sessionId: nextSession };
      }
      throw new Error("no JSON-RPC response in SSE stream");
    }
    return { response: JSON.parse(text), sessionId: nextSession };
  } finally {
    clearTimeout(timer);
  }
}

async function probeMcp(url, timeoutMs) {
  const result = { configured: Boolean(url), url: url ? sanitizeUrl(url) : null, ok: false, protocolVersion: null, server: null, tools: [], error: null };
  if (!url) return result;
  if (!/^https?:\/\//i.test(url)) {
    result.error = "MCP URL must start with http:// or https://";
    return result;
  }
  let sessionId = null;
  let id = 1;
  try {
    let initialized = null;
    let lastError = null;
    for (const protocolVersion of ["2025-03-26", "2024-11-05"]) {
      try {
        const call = await mcpRpc(url, {
          jsonrpc: "2.0",
          id: id++,
          method: "initialize",
          params: {
            protocolVersion,
            capabilities: {},
            clientInfo: { name: "zombiecoder-model-mapper", version: "1" },
          },
        }, sessionId, timeoutMs);
        sessionId = call.sessionId;
        initialized = call.response;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!initialized) throw lastError || new Error("initialize failed");
    if (initialized.error) throw new Error(initialized.error.message || "initialize error");
    result.protocolVersion = initialized.result?.protocolVersion || null;
    result.server = initialized.result?.serverInfo && typeof initialized.result.serverInfo === "object"
      ? initialized.result.serverInfo
      : null;
    await mcpRpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, timeoutMs).catch(() => undefined);
    const listed = await mcpRpc(url, { jsonrpc: "2.0", id: id++, method: "tools/list", params: {} }, sessionId, timeoutMs);
    if (listed.response?.error) throw new Error(listed.response.error.message || "tools/list error");
    const tools = Array.isArray(listed.response?.result?.tools) ? listed.response.result.tools : [];
    result.tools = tools.map((tool) => tool?.name).filter((name) => typeof name === "string" && name);
    result.ok = true;
    return result;
  } catch (error) {
    result.error = String(error?.message || error);
    return result;
  }
}

function askHidden(question) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      process.stdout.write(question);
      let value = "";
      const onData = (chunk) => {
        value += chunk.toString("utf8");
        if (value.includes("\n") || value.includes("\r")) {
          process.stdin.off("data", onData);
          process.stdin.pause();
          resolve(value.split(/\r?\n/)[0]);
        }
      };
      process.stdin.resume();
      process.stdin.on("data", onData);
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function promptRuntime(initial) {
  if (initial.nonInteractive) return initial;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const url = initial.url || (await rl.question("OpenAI-compatible URL (blank = fallback only): ")).trim();
    const providerId = initial.providerId || (await rl.question(`Provider id (optional, default ${deriveProviderId(url)}): `)).trim() || deriveProviderId(url);
    const mcpUrl = initial.mcpUrl || (await rl.question("MCP URL (optional, blank = none): ")).trim();
    rl.close();
    const apiKey = initial.apiKey || (await askHidden("API key (optional, hidden, blank = none): ")).trim();
    return { ...initial, url, providerId, mcpUrl, apiKey };
  } finally {
    rl.close();
  }
}


function readExistingProviderId(url) {
  const configPath = findConfigPath();
  if (!configPath || !url) return "";
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const providers = parsed?.providers || parsed?.provider || {};
    for (const [id, provider] of Object.entries(providers)) {
      const base = provider?.settings?.baseURL || provider?.settings?.baseUrl || provider?.baseURL || provider?.baseUrl;
      if (typeof base === "string" && baseFromUrl(base) === baseFromUrl(url)) return id;
    }
  } catch {
    /* config shape is not a reason to fail the mapper */
  }
  return "";
}

function findConfigPath() {
  const candidates = [
    path.join(os.homedir(), ".opencode", "opencode.json"),
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function applyPlan(plan) {
  const configPath = findConfigPath();
  if (!configPath) return { applied: 0, path: null, backup: null, error: "opencode.json not found" };
  let realPath;
  try {
    realPath = fs.realpathSync(configPath);
  } catch (error) {
    return { applied: 0, path: configPath, backup: null, error: `cannot resolve config path: ${error.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(realPath, "utf8"));
  } catch (error) {
    return { applied: 0, path: realPath, backup: null, error: `invalid JSON: ${error.message}` };
  }
  const agents = parsed?.agents || parsed?.agent;
  if (!agents || typeof agents !== "object") {
    return { applied: 0, path: realPath, backup: null, error: "config has no agents object" };
  }
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const backup = `${realPath}.bak-model-${stamp}`;
  fs.copyFileSync(realPath, backup);
  fs.chmodSync(backup, 0o600);
  let applied = 0;
  for (const [id, model] of Object.entries(plan.mapping)) {
    const entry = agents[id];
    if (entry && typeof entry === "object") {
      entry.model = model;
      applied += 1;
    }
  }
  const temp = `${realPath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, realPath);
  return { applied, path: realPath, backup, error: null };
}

async function main() {
  if (flag("help") || flag("h")) {
    process.stdout.write(`ZombieCoder runtime model mapper

Interactive:
  node --experimental-strip-types model.mjs

Non-interactive:
  node model.mjs --non-interactive --url <openai-compatible-url> [--api-key <key>] [--mcp <url>] [--provider-id <id>] [--out <plan.json>] [--apply] [--json]

Secrets: prefer ZC_API_KEY / OPENAI_API_KEY over --api-key. The mapper never prints the key.
`);
    return;
  }
  const nonInteractive = flag("non-interactive") || flag("ci");
  let initial = {
    nonInteractive,
    url: arg("url", env("ZC_OPENAI_URL") || env("OPENAI_BASE_URL")),
    apiKey: arg("api-key", env("ZC_API_KEY") || env("OPENAI_API_KEY")),
    mcpUrl: arg("mcp", env("ZC_MCP_URL")),
    providerId: arg("provider-id", env("ZC_PROVIDER_ID") || env("ZOMBIECODER_PROVIDER_ID")),
    timeoutMs: Number(arg("timeout", env("ZC_PROBE_TIMEOUT_MS") || String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS,
    out: arg("out", env("ZC_MODEL_PLAN_OUT")),
    json: flag("json"),
    apply: flag("apply"),
  };
  initial = await promptRuntime(initial);
  initial.url = baseFromUrl(initial.url);
  initial.providerId = initial.providerId || readExistingProviderId(initial.url) || deriveProviderId(initial.url);
  initial.timeoutMs = Math.max(500, Math.min(60000, initial.timeoutMs));

  const warnings = [];
  let agentState = readConfigAgents();
  if (!agentState.agents.length) {
    const rosterState = await readRosterAgents();
    if (rosterState.agents.length) {
      agentState = { ...rosterState, error: null };
      warnings.push(`agent roster loaded from ${rosterState.source}`);
    } else {
      warnings.push(`no agents available: ${agentState.error}; mapping will be empty`);
    }
  }

  const provider = await probeProvider(initial.url, initial.apiKey, initial.timeoutMs);
  let source = "provider";
  let candidates = provider.models.map((model) => modelRef(initial.providerId, model)).filter(Boolean);
  let fallback = null;

  if (!provider.ok || candidates.length === 0) {
    source = "opencode-free-fallback";
    fallback = await readOpencodeModels();
    const fallbackList = fallbackModels(fallback.models);
    candidates = fallbackList;
    if (!fallback.ok) warnings.push(`OpenCode fallback incomplete: ${fallback.error}`);
    if (provider.error) warnings.push(`provider fallback: ${provider.error}`);
  }

  if (candidates.length === 0) {
    candidates = [BASELINE_MODEL];
    source = "baseline";
    warnings.push("no provider and no fallback catalog; using the allowed baseline only");
  }

  const mapping = assignModels(agentState.agents, candidates);
  const mcp = await probeMcp(initial.mcpUrl, initial.timeoutMs);
  const evidenceStatus = provider.ok && source === "provider"
    ? "LIVE_PROBE_PASSED"
    : fallback?.ok
      ? "SOURCE_VERIFIED"
      : "NOT_TESTED";

  const plan = {
    generatedAt: new Date().toISOString(),
    source,
    runtime: {
      providerUrl: initial.url || null,
      providerId: initial.providerId,
      modelsUrl: provider.url || null,
      apiKeyProvided: Boolean(initial.apiKey),
      mcpConfigured: Boolean(initial.mcpUrl),
    },
    provider: {
      ok: provider.ok,
      status: provider.status,
      ms: provider.ms,
      modelCount: provider.models.length,
      models: provider.models,
      error: provider.error,
    },
    fallback: fallback
      ? { ok: fallback.ok, bin: fallback.bin, catalogCount: fallback.models.length, selected: fallbackModels(fallback.models), error: fallback.error }
      : null,
    agents: { count: agentState.agents.length, source: agentState.source, error: agentState.error || null },
    candidates,
    mapping,
    mcp,
    evidence: {
      status: evidenceStatus,
      providerPayloadValidated: provider.ok,
      fallbackCatalogRead: Boolean(fallback?.ok),
      mappingDeterministic: true,
      gate: "FAIL unless the provider payload or the fallback catalog was actually read",
    },
    warnings,
  };

  let applied = null;
  if (initial.apply) {
    applied = applyPlan(plan);
    if (applied.error) warnings.push(`apply skipped: ${applied.error}`);
    else plan.evidence.applied = applied;
  }

  if (initial.out) {
    const out = path.resolve(initial.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  }

  if (initial.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    const summary = {
      source: plan.source,
      evidence: plan.evidence.status,
      provider: plan.provider,
      fallback: plan.fallback ? { ok: plan.fallback.ok, selected: plan.fallback.selected } : null,
      agents: plan.agents,
      candidates: plan.candidates,
      mapping: plan.mapping,
      mcp: { configured: plan.mcp.configured, ok: plan.mcp.ok, tools: plan.mcp.tools.length, error: plan.mcp.error },
      applied: plan.evidence.applied || null,
      warnings: plan.warnings,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", error: String(error?.message || error) })}\n`);
  process.exit(1);
});
