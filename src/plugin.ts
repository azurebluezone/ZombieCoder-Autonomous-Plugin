// ZombieCoder plugin — the adapter half of the pack.
//
// Design rule from the owner, applied literally:
//   "নিয়ম তাদেরটাই মানবো, শুধু আমাদের স্বাদটুকু এখানে যুক্ত করে দিচ্ছি।"
//
// So: every mechanism below is an OpenCode door (agent / session / tool / skill /
// catalog / rpc / storage / location). Our own content — SSOT, syllabus, memory,
// footprint, personas, model plan — is the only thing we bring.
//
// Setup NEVER throws. If a door is missing on some build, that step is recorded as
// failed in .zombiecoder/setup-report.json and the rest still runs. A plugin that
// breaks the editor is worse than a plugin that degrades.

import { Plugin } from "@opencode/plugin";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROSTER,
  GLOBAL_PERMISSIONS,
  LEGACY_AGENT_IDS,
  BASELINE_MODEL,
  mergeAgentPersona,
  agentMarkdown,
  renderAgentsConfig,
  type AgentDef,
} from "./roster.ts";
import { bootstrapDirs, configFile, setupReportFile } from "./zombie/paths.ts";
import {
  ensureDir,
  readEnvironmentFile,
  readJson,
  writeJson,
  writeAtomic,
  redact,
  PLUGIN_VERSION,
} from "./zombie/io.ts";
import { scanProject } from "./zombie/scan.ts";
import { writeSsot } from "./zombie/ssot.ts";
import { ensureSyllabus, readSyllabus, recordProjectFootprint } from "./zombie/syllabus.ts";
import {
  archiveSessionSnapshot,
  keepRecent,
  readIndex,
  readRecent,
  roleOf,
  textOf,
  touchIndex,
  writeIndex,
} from "./zombie/memory.ts";
import {
  resolveModels,
  normalizeModelRef,
  type CatalogDoors,
  type ModelStrategy,
} from "./zombie/models.ts";
import {
  DEFAULT_CUSTOM_PROVIDER_ID,
  DEFAULT_CUSTOM_PROVIDER_KEY,
  DEFAULT_CUSTOM_PROVIDER_URL,
  DEFAULT_MCP_URL,
  DEFAULT_OPENCODE_API_URL,
  DEFAULT_ORIGIN_URL,
  DEFAULT_SSOT_REFRESH_MS,
} from "./zombie/defaults.ts";
import { fetchOriginHandshake } from "./zombie/origin.ts";
import { applyModeOverrides } from "./zombie/modes.ts";
import { probeMcp } from "./zombie/mcp.ts";
import { registerSkills } from "./zombie/skills.ts";
import { ensureSharedSkills, DEFAULT_SKILL_REPO } from "./zombie/skillCatalog.ts";
import { buildContextPack } from "./zombie/context.ts";
import { openContracts } from "./zombie/goalContract.ts";
import { applyResponseGate } from "./zombie/responseGate.ts";
import {
  BREAKER_LIMIT,
  breakerContext,
  decideBreaker,
  fallbackPrompt,
  readBreakerState,
  statusMessage,
  unresolvedMessage,
} from "./zombie/circuitBreaker.ts";
import { registerRpc, registerTools, audit } from "./zombie/server.ts";

export const PLUGIN_ID = "zombiecoder";
export { DEFAULT_SSOT_REFRESH_MS }; // spec §3.3 — every 5 minutes; one definition in defaults.ts
// OpenCode applies a transform AFTER setup() returns. Waiting inside setup blocks
// the very apply we are waiting for, so registration is reported as "pending" and
// the report is updated when the deferred callback actually fires.
export const TRANSFORM_APPLY_TIMEOUT_MS = 15000;

// Tools that change the project. A read-only investigation may run before a
// goal contract; a write may not.
const MUTATING_TOOLS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"]);

export type ZombieConfig = {
  customProviderUrl: string;
  customProviderID: string;
  customProviderApiKey: string;
  baselineModel: string;
  mcpUrl: string;
  opencodeApiUrl: string;
  originUrl: string;
  ssotRefreshMs: number;
  modelStrategy: ModelStrategy;
  // Hard response gate: an unproven claim is replaced by an explicit UNVERIFIED
  // message before the user sees it. Set false only for diagnosis.
  responseGate: boolean;
  // Register the shared skill store at setup. Skills are never copied into the
  // working directory; a new skill arrives through `skill_catalog`.
  autoSkills: boolean;
  // Git source for the runtime skill catalog.
  skillRepo: string;
  // Owner-requested OpenCode agent modes: { "<agentID>": "primary" | "subagent" | "all" }.
  // Validated by modes.ts; a typo is rejected in the setup report, never guessed.
  agentModes: Record<string, string>;
  // Per-agent model pins. false (default) leaves agent entries without `model`,
  // so the model selected in /models governs the session and subagents inherit
  // it. true restores the fixed agent -> model mapping for a multi-model gateway.
  agentModelPins: boolean;
};

export const DEFAULT_CONFIG: ZombieConfig = {
  customProviderUrl: DEFAULT_CUSTOM_PROVIDER_URL,
  customProviderID: DEFAULT_CUSTOM_PROVIDER_ID,
  customProviderApiKey: DEFAULT_CUSTOM_PROVIDER_KEY,
  baselineModel: BASELINE_MODEL,
  mcpUrl: DEFAULT_MCP_URL,
  opencodeApiUrl: DEFAULT_OPENCODE_API_URL,
  originUrl: DEFAULT_ORIGIN_URL,
  ssotRefreshMs: DEFAULT_SSOT_REFRESH_MS,
  modelStrategy: "auto",
  responseGate: true,
  autoSkills: true,
  skillRepo: DEFAULT_SKILL_REPO,
  agentModes: {},
  agentModelPins: false,
};

// Where the plugin itself lives decides where OpenCode-owned files belong.
//   global : ~/.config/opencode/plugins/zombiecoder/plugin.ts -> ~/.config/opencode
//   project: <project>/.opencode/plugins/zombiecoder/plugin.ts -> <project>/.opencode
// The working directory is never assumed to be the install root.
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_PARENT = path.resolve(PLUGIN_DIR, "../..");
export const GLOBAL_CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  "opencode",
);
export const GLOBAL_ZOMBIE_CONFIG = path.join(GLOBAL_CONFIG_DIR, "zombiecoder", "config.json");
// A self-contained install (--config-dir) stores its config beside the plugin
// graph. Read it as a fallback so /home/<user>/.opencode works without
// duplicating the file into ~/.config/opencode.
const INSTALL_ZOMBIE_CONFIG = path.join(PLUGIN_PARENT, "zombiecoder", "config.json");

export type InstallLayout = {
  dir: string;
  global: boolean;
  configFile: string;
};

export function detectInstallLayout(locationRoot: string): InstallLayout {
  const forced = process.env.ZOMBIECODER_INSTALL_PARENT;
  const candidate = forced ? path.resolve(forced) : PLUGIN_PARENT;
  const entry = path.join(candidate, "plugins", "zombiecoder.ts");
  const looksLikeInstall =
    Boolean(forced) ||
    fs.existsSync(entry) ||
    (path.basename(candidate) === ".opencode" && fs.existsSync(path.join(candidate, "plugins")));
  if (looksLikeInstall) {
    // Self-contained install (--config-dir): the config lives inside the same
    // directory as agents/ and plugins/, even when that directory is named
    // .opencode. The old project shape keeps opencode.json at the project root.
    const selfContained =
      fs.existsSync(path.join(candidate, "opencode.json")) ||
      fs.existsSync(path.join(candidate, "zombiecoder", "config.json"));
    const global = selfContained || path.basename(candidate) !== ".opencode";
    return {
      dir: candidate,
      global,
      configFile: global
        ? path.join(candidate, "opencode.json")
        : path.join(path.dirname(candidate), "opencode.json"),
    };
  }
  // Source layout (tests, direct loading): behave like a project install rooted
  // at the location, but never write outside the location.
  const dir = path.join(locationRoot, ".opencode");
  return { dir, global: false, configFile: path.join(locationRoot, "opencode.json") };
}

// A global install is installer-owned. A project's free-fallback plan must never
// rewrite the global agents to free models — otherwise the last project opened
// silently changes the model for every other project.
export function globalAgentAssignment(
  configFile: string,
  roster: AgentDef[],
): Record<string, string> {
  const config = readJson<Record<string, any>>(configFile) ?? {};
  const out: Record<string, string> = {};
  for (const a of roster) {
    const model = config.agents?.[a.id]?.model;
    if (typeof model === "string" && model.length > 0) out[a.id] = model;
  }
  return out;
}

type Ctx = {
  location?: { directory?: string };
  agent?: {
    reload?: () => Promise<void>;
    transform?: (cb: (editor: any) => void) => Promise<{ dispose: () => Promise<void> }>;
  };
  session?: {
    context?: (input: { sessionID: string }) => Promise<any[]>;
    switchAgent?: (input: { sessionID: string; agent: string }) => Promise<void>;
    // V2 exposes a session model switch ("Switch the model used by subsequent
    // provider turns"). Switching an agent alone never changes the model.
    // Wire shape is Model.Ref: { id, providerID, variant? } — verified against
    // @opencode/plugin/dist/promise/session.d.ts:143 and @opencode/schema
    // model.d.ts (Ref). `model` is NOT the model-id field; sending it returns
    // InvalidRequestError.
    switchModel?: (input: {
      sessionID: string;
      model: { id: string; providerID: string; variant?: string };
    }) => Promise<void>;
    hook?: (name: string, cb: (event: any) => any) => Promise<{ dispose: () => Promise<void> }>;
  };
  tool?: {
    hook?: (name: string, cb: (event: any) => any) => Promise<{ dispose: () => Promise<void> }>;
    transform?: (cb: (editor: any) => void) => Promise<{ dispose: () => Promise<void> }>;
    reload?: () => Promise<void>;
  };
  skill?: {
    transform: (cb: (editor: any) => void) => Promise<{ dispose: () => Promise<void> }>;
    reload?: () => Promise<void>;
  };
  catalog?: CatalogDoors;
  // OpenCode 2.x exposes provider/model as sibling domains. Older betas exposed
  // a single `catalog`; both are read below so the pack survives either surface.
  provider?: { list?: (input?: any) => Promise<any>; reload?: () => Promise<void> };
  model?: {
    list?: (input?: any) => Promise<any>;
    default?: (input?: any) => Promise<any>;
    reload?: () => Promise<void>;
  };
  rpc?: { register: (definition: any, handlers: any) => Promise<any> };
  storage: { get: (key: string) => Promise<unknown>; set: (key: string, value: any) => Promise<void> };
  event?: { subscribe?: (options?: { signal?: AbortSignal }) => AsyncIterable<any> };
};

type Report = {
  plugin: string;
  version: string;
  startedAt: string;
  finishedAt: string;
  root: string;
  steps: { step: string; ok: boolean; detail?: string; error?: string }[];
  outputs: Record<string, unknown>;
};

// Evidence that the installer already exposed this provider to OpenCode. The
// catalog can lag behind setup; this file cannot.
//
// OpenCode merges configuration from the current directory up to the filesystem
// root, plus the user global config and the system config. A working directory
// under an installed root (e.g. /home/<user>) inherits the provider from an
// ancestor `opencode.json`, so checking only the location root would wrongly
// fall back to free models. We mirror OpenCode's search order here.
export function providerConfigCandidates(projectRoot: string): string[] {
  const dirs: string[] = [];
  let dir = path.resolve(projectRoot);
  for (;;) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    dirs.push(path.join(home, ".config", "opencode"));
    dirs.push(path.join(home, ".opencode"));
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) dirs.push(path.join(xdg, "opencode"));
  if (process.platform === "win32") {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "opencode"));
    if (process.env.ProgramData) dirs.push(path.join(process.env.ProgramData, "opencode"));
  } else {
    dirs.push("/etc/opencode");
  }
  return dirs;
}

export function providerConfiguredOnDisk(projectRoot: string, providerID: string): boolean {
  // jsonc is only checked for the provider key; comments are not parsed here.
  const matched = new RegExp(`"${providerID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
  for (const dir of providerConfigCandidates(projectRoot)) {
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      try {
        if (matched.test(fs.readFileSync(path.join(dir, name), "utf8"))) return true;
      } catch {
        /* file absent or unreadable */
      }
    }
  }
  return false;
}

function envOverride(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function originEnvOverride(): string | undefined {
  const value = envOverride("ZOMBIECODER_ORIGIN_URL");
  if (value === undefined) return undefined;
  // `off`/`none` lets a caller disable an originUrl that came from a global
  // config file, without editing that file.
  if (/^(off|none|false|no|0)$/i.test(value)) return "";
  return value;
}

function loadConfig(projectRoot: string): ZombieConfig {
  // Merge order mirrors OpenCode: shipped default < global ZombieCoder config
  // < optional manual .zombiecoder/config.json. We never auto-create the project
  // file: global config is the source, and the project stays clean. Deployment
  // environment variables win over every file, so a key never has to be written
  // into a checked-in config.
  const global =
    readJson<Partial<ZombieConfig>>(INSTALL_ZOMBIE_CONFIG) ??
    readJson<Partial<ZombieConfig>>(GLOBAL_ZOMBIE_CONFIG) ??
    {};
  const existing = readJson<Partial<ZombieConfig>>(configFile(projectRoot));
  const merged = { ...DEFAULT_CONFIG, ...global, ...(existing ?? {}) };
  const projectEnvironment = readEnvironmentFile(path.join(projectRoot, ".environment"));
  const externalUrlPresent =
    Object.prototype.hasOwnProperty.call(process.env, "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL") ||
    Object.prototype.hasOwnProperty.call(projectEnvironment, "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL");
  const externalUrl = Object.prototype.hasOwnProperty.call(
    process.env,
    "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL",
  )
    ? String(process.env.EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL ?? "").trim()
    : String(projectEnvironment.EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL ?? "").trim();
  const externalApiKey =
    envOverride("EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY") ??
    envOverride("ZOMBIECODER_PROVIDER_KEY") ??
    envOverride("ZOMBIECODER_API_KEY") ??
    projectEnvironment.EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY;
  const externalMcpUrl =
    envOverride("EXTERNAL_MCP_URL") ??
    envOverride("ZOMBIECODER_MCP_URL") ??
    projectEnvironment.EXTERNAL_MCP_URL;
  const env: Record<string, string | undefined> = {
    customProviderUrl: envOverride("ZOMBIECODER_PROVIDER_URL"),
    customProviderID: envOverride("ZOMBIECODER_PROVIDER_ID"),
    customProviderApiKey: externalApiKey,
    baselineModel: envOverride("ZOMBIECODER_BASELINE_MODEL"),
    mcpUrl: externalMcpUrl,
    originUrl: originEnvOverride(),
    opencodeApiUrl: envOverride("OPENCODE_API_URL") ?? envOverride("OPENCODE_BASE"),
    modelStrategy: envOverride("ZOMBIECODER_MODEL_STRATEGY") as ModelStrategy | undefined,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  if (externalUrlPresent) {
    merged.customProviderUrl = externalUrl;
    if (!env.modelStrategy) merged.modelStrategy = externalUrl ? "auto" : "free";
  } else if (
    merged.customProviderUrl === DEFAULT_CUSTOM_PROVIDER_URL &&
    merged.modelStrategy === "auto"
  ) {
    merged.customProviderUrl = "";
    if (!env.modelStrategy) merged.modelStrategy = "free";
  }
  return merged;
}

// Spec §3.1 — create the layout only when it is not already there.
export function ensureZombieDirs(projectRoot: string): string[] {
  const created: string[] = [];
  for (const dir of bootstrapDirs(projectRoot)) {
    const existed = fs.existsSync(dir);
    ensureDir(dir);
    if (!existed) created.push(dir);
  }
  return created;
}

// Spec §1 — OpenCode reads <project>/.opencode/agents/*.md. The editor has no `add`,
// so the file is the only door. Frontmatter delimiters are mandatory; without them the
// whole file (frontmatter included) leaks into the agent's system prompt.
export function ensureAgentFolderAt(
  dir: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
  pins = true,
): { dir: string; written: string[]; unchanged: string[] } {
  ensureDir(dir);
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const a of roster) {
    const file = path.join(dir, a.id + ".md");
    const content = agentMarkdown(a, assignment[a.id], pins);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (current === content) {
      unchanged.push(file);
      continue;
    }
    writeAtomic(file, content);
    written.push(file);
  }
  return { dir, written, unchanged };
}

// Backward-compatible wrapper for callers that still think in project roots.
export function ensureAgentFolder(
  projectRoot: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
): { dir: string; written: string[]; unchanged: string[] } {
  return ensureAgentFolderAt(path.join(projectRoot, ".opencode", "agents"), roster, assignment);
}

// The markdown file is one documented door. Verify the files we wrote instead
// of trusting the deferred editor, which does not expose these IDs at setup time.
export function verifyAgentMarkdownAt(
  dir: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
  pins = true,
): string[] {
  const missing: string[] = [];
  for (const a of roster) {
    const file = path.join(dir, a.id + ".md");
    const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (pins) {
      const expected = assignment[a.id] ?? a.model;
      if (!raw.includes(`model: ${expected}`)) missing.push(`${a.id}=${expected}`);
    } else if (/^model:/m.test(raw)) {
      missing.push(`${a.id}=pinned-model`);
    }
    if (!raw.includes("ZombieCoder Shared Rules")) missing.push(`${a.id}=rules`);
  }
  return missing;
}

export function verifyAgentMarkdown(
  projectRoot: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
  pins = true,
): string[] {
  return verifyAgentMarkdownAt(path.join(projectRoot, ".opencode", "agents"), roster, assignment, pins);
}

// V2 config agents are the second door. The installer seeds them; the runtime
// refreshes the model after a live probe so the config never points at a dead
// provider. Everything outside `agents` is preserved.
export function syncAgentConfig(
  file: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
  pins = true,
  defaultModel?: string,
): { file: string; updated: string[]; skipped?: string } {
  const jsonc = file.replace(/\.json$/, ".jsonc");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!current && fs.existsSync(jsonc)) {
    return { file: jsonc, updated: [], skipped: "opencode.jsonc is present; agent config not written" };
  }
  const existing = readJson<Record<string, any>>(file);
  if (existing === undefined && current.trim().length > 0) {
    return { file, updated: [], skipped: "opencode.json is not strict JSON; agent config not written" };
  }
  const config: Record<string, any> = existing ?? { $schema: "https://opencode.ai/config.json" };
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json";

  // V2 permissions. Our defaults come first; rules already in the user's file
  // stay after them so the owner's later rule still wins.
  const existingPermissions = Array.isArray(config.permissions) ? config.permissions : [];
  const known = new Set(GLOBAL_PERMISSIONS.map((rule) => JSON.stringify(rule)));
  config.permissions = [
    ...GLOBAL_PERMISSIONS,
    ...existingPermissions.filter((rule: any) => !known.has(JSON.stringify(rule))),
  ];

  const agents: Record<string, any> = { ...(config.agents ?? {}) };
  const wanted = renderAgentsConfig(roster, assignment, pins);
  const updated: string[] = [];

  // Renamed agent: never leave the old persona behind to compete with the new one.
  for (const id of Object.keys(agents)) {
    if ((LEGACY_AGENT_IDS as readonly string[]).includes(id) && !wanted[id]) delete agents[id];
  }
  for (const [id, entry] of Object.entries(wanted)) {
    const before = JSON.stringify(agents[id] ?? null);
    agents[id] = { ...(agents[id] ?? {}), ...entry };
    // Pins off: an older install may still carry `model` on the agent. Leaving it
    // would silently override the owner's /models choice, so drop it here.
    if (!pins) delete agents[id].model;
    if (JSON.stringify(agents[id]) !== before) updated.push(id);
  }

  const next: Record<string, any> = { ...config, agents };
  // With no pins, the root `model` is the only default. A session that picked a
  // model still wins (OpenCode docs), and subagents inherit the session model.
  if (!pins && defaultModel) next.model = defaultModel;
  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (serialized !== current) writeAtomic(file, serialized);
  return { file, updated };
}

export function verifyAgentConfig(
  file: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
  pins = true,
): string[] {
  const config = readJson<Record<string, any>>(file);
  if (!config || !config.agents) return ["opencode.json=agents"];
  const missing: string[] = [];
  for (const a of roster) {
    const expected = assignment[a.id] ?? a.model;
    const entry = config.agents[a.id];
    if (!entry) missing.push(`${a.id}=missing`);
    else if (pins && entry.model !== expected) missing.push(`${a.id}=model`);
    else if (!pins && entry.model !== undefined) missing.push(`${a.id}=pinned-model`);
    else if (!Array.isArray(entry.permissions) || entry.permissions.length === 0) missing.push(`${a.id}=permissions`);
  }
  for (const id of LEGACY_AGENT_IDS) {
    if (config.agents[id]) missing.push(`stale=${id}`);
  }
  return missing;
}

// URL-only origin handshake writes exactly one value: the provider base URL.
// The API key stays wherever the owner put it and is never read or sent here.
export function persistProviderUrl(
  url: string,
  candidates: string[] = [INSTALL_ZOMBIE_CONFIG, GLOBAL_ZOMBIE_CONFIG],
): { file: string; updated: boolean; skipped?: string } {
  for (const file of candidates) {
    const current = readJson<Record<string, any>>(file);
    if (current === undefined) continue;
    if (current.customProviderUrl === url) return { file, updated: false };
    current.customProviderUrl = url;
    writeAtomic(file, JSON.stringify(current, null, 2) + "\n");
    return { file, updated: true };
  }
  return { file: "", updated: false, skipped: "no zombie config file found" };
}

// Keep OpenCode's own provider entry in step with the origin URL. Models and
// permissions are preserved; only settings.baseURL is touched.
export function syncProviderBaseUrl(
  file: string,
  providerID: string,
  baseURL: string,
): { file: string; updated: boolean; skipped?: string } {
  const jsonc = file.replace(/\.json$/, ".jsonc");
  if (!fs.existsSync(file) && fs.existsSync(jsonc)) {
    return { file: jsonc, updated: false, skipped: "opencode.jsonc is present; provider URL not written" };
  }
  const config = readJson<Record<string, any>>(file);
  if (!config) return { file, updated: false, skipped: "opencode.json is missing or not strict JSON" };
  const provider = config.providers?.[providerID];
  if (!provider) return { file, updated: false, skipped: `provider ${providerID} not present` };
  provider.settings = provider.settings ?? {};
  if (provider.settings.baseURL === baseURL) return { file, updated: false };
  provider.settings.baseURL = baseURL;
  writeAtomic(file, JSON.stringify(config, null, 2) + "\n");
  return { file, updated: true };
}

export async function setup(rawCtx: unknown): Promise<() => Promise<void>> {
  const ctx = rawCtx as Ctx;
  const startedAt = new Date().toISOString();
  let root = ctx?.location?.directory;
  if (!root || typeof root !== "string") root = process.cwd();
  root = path.resolve(root);
  const layout = detectInstallLayout(root);

  // A global plugin instance is loaded once, but sessions can live in other
  // project directories. Setup-time `ctx.location` is therefore only the
  // fallback: resolve the real root from the session on first use.
  const resolvedSessionRoots = new Map<string, string>();
  const scaffoldedRoots = new Set<string>();
  const projectRoots = new Set<string>([root]);

  const normalizeProjectRoot = (value: string): string => path.resolve(String(value));

  const scaffoldProject = (projectRoot: string): string => {
    const normalized = normalizeProjectRoot(projectRoot);
    if (scaffoldedRoots.has(normalized)) return normalized;
    ensureZombieDirs(normalized);
    writeIndex(normalized, readIndex(normalized));
    const fingerprint = scanProject(normalized);
    writeSsot(normalized, fingerprint);
    ensureSyllabus(normalized, fingerprint, ROSTER.map((a) => a.id));
    // New directory (or changed tree): leave one lesson with the footprint and the
    // failures carried over from the previous audit trail. Deduped by marker.
    recordProjectFootprint(normalized, fingerprint);
    scaffoldedRoots.add(normalized);
    projectRoots.add(normalized);
    return normalized;
  };

  const resolveSessionRoot = async (sessionID: string): Promise<string> => {
    const id = String(sessionID ?? "").trim();
    if (!id || id === "unknown") return root!;
    const cached = resolvedSessionRoots.get(id);
    if (cached) return cached;
    let resolved = root!;
    try {
      const info = await (ctx.session as any)?.get?.({ sessionID: id });
      const directory = info?.location?.directory;
      if (typeof directory === "string" && directory.trim().length > 0) {
        resolved = normalizeProjectRoot(directory);
      }
    } catch (error: any) {
      // The session door is optional on older builds; the setup root remains
      // the safe fallback and the failure is visible in the audit below.
      console.error(`[zombiecoder] session root lookup failed for ${id}: ${String(error?.message ?? error)}`);
    }
    resolvedSessionRoots.set(id, resolved);
    projectRoots.add(resolved);
    return resolved;
  };

  // A write that lands before any goal contract is a process violation, not a
  // detail: the user was promised a pre-work card. We cannot rewind the write,
  // so we make it visible (card + audit) exactly once per session.
  const warnMissingGoalContract = async (input: {
    projectRoot: string;
    sessionID: string;
    agentID: string;
    tool: string;
  }): Promise<void> => {
    const { projectRoot, sessionID, agentID } = input;
    if (!sessionID || sessionID === "unknown") return;
    const tool = String(input.tool ?? "").trim().toLowerCase();
    if (!MUTATING_TOOLS.has(tool)) return;
    const key = `goal/warned/${sessionID}`;
    if (await ctx.storage.get(key)) return;
    const syllabus = readSyllabus(projectRoot) ?? "";
    if (openContracts(syllabus, sessionID).length > 0) return;
    await ctx.storage.set(key, { at: new Date().toISOString(), tool });
    audit(projectRoot, agentID, { kind: "goal.missing", sessionID, tool });
    const door = (ctx as any).session?.synthetic;
    if (typeof door !== "function") return;
    try {
      await door({
        sessionID,
        description: "goal contract missing",
        text: [
          "🧭 goal contract ছাড়া কাজ শুরু হয়েছে",
          "",
          `টুল: \`${tool}\` — এটা চালানোর আগে \`goal_contract open\` হওয়া দরকার ছিল।`,
          "",
          "এখনই খুলে নাও: আসল input → চোখে দেখা expected output → check command → pass criteria।",
          "শেষে `goal_contract close` নিজেই চেক চালিয়ে PASS/FAIL দেবে; মুখের দাবি নয়।",
        ].join("\n"),
      });
    } catch {
      /* best-effort card; the audit row above is the durable record */
    }
  };

  const report: Report = {
    plugin: PLUGIN_ID,
    version: PLUGIN_VERSION,
    startedAt,
    finishedAt: startedAt,
    root,
    steps: [],
    outputs: { install: layout },
  };
  const cleanups: (() => Promise<void> | void)[] = [];

  const step = (name: string, fn: () => any): any => {
    try {
      const value = fn();
      report.steps.push({ step: name, ok: true, detail: typeof value === "string" ? value : undefined });
      return value;
    } catch (error: any) {
      const message = redact(String(error?.message ?? error));
      report.steps.push({ step: name, ok: false, error: message });
      // Loud, never silent: the console is the fallback when disk write fails.
      console.error(`[zombiecoder] step failed: ${name}: ${message}`);
      return undefined;
    }
  };

  const stepAsync = async (name: string, fn: () => Promise<any>): Promise<any> => {
    try {
      const value = await fn();
      report.steps.push({ step: name, ok: true, detail: typeof value === "string" ? value : undefined });
      return value;
    } catch (error: any) {
      const message = redact(String(error?.message ?? error));
      report.steps.push({ step: name, ok: false, error: message });
      console.error(`[zombiecoder] step failed: ${name}: ${message}`);
      return undefined;
    }
  };

  // A deferred transform is not a setup failure. It is a two-phase write:
  // register now, apply after setup returns, then update the durable report.
  const persistReport = (): void => {
    report.finishedAt = new Date().toISOString();
    try {
      writeJson(setupReportFile(root!), report);
    } catch (error: any) {
      console.error(`[zombiecoder] report write failed: ${String(error?.message ?? error)}`);
    }
  };

  const updateStep = (name: string, patch: { ok?: boolean; detail?: string; error?: string }): void => {
    const item = report.steps.find((entry) => entry.step === name);
    if (item) Object.assign(item, patch);
    else report.steps.push({ step: name, ok: patch.ok ?? true, detail: patch.detail, error: patch.error });
    persistReport();
  };

  const watchTransform = <T,>(
    name: string,
    promise: Promise<T | null>,
    onValue: (value: T) => void,
    failure: () => string,
  ): void => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      updateStep(name, { ok: false, error: `transform did not apply within ${TRANSFORM_APPLY_TIMEOUT_MS}ms` });
    }, TRANSFORM_APPLY_TIMEOUT_MS);
    if (typeof (timer as any).unref === "function") (timer as any).unref();
    cleanups.push(() => clearTimeout(timer));
    promise
      .then((value) => {
        settled = true;
        clearTimeout(timer);
        if (value === null) updateStep(name, { ok: false, error: failure() });
        else onValue(value);
      })
      .catch((error: any) => {
        settled = true;
        clearTimeout(timer);
        updateStep(name, { ok: false, error: String(error?.message ?? error) });
      });
  };

  // ---- §3.1 layout ----------------------------------------------------------
  const created = step("bootstrap-dirs", () => ensureZombieDirs(root!));
  report.outputs.createdDirs = created ?? [];
  step("memory-index", () => {
    writeIndex(root!, readIndex(root!));
    return "memory/index.json ready";
  });

  const config = step("load-config", () => loadConfig(root!)) ?? DEFAULT_CONFIG;

  // ---- §0 URL-only origin handshake ----------------------------------------
  // Optional. When config.originUrl / ZOMBIECODER_ORIGIN_URL is set, read the
  // public /gateway_url.json document and, only if it advertises a different
  // base URL, update that URL here. No key, cookie or browser session is read
  // or sent. Failure is recorded and the configured URL continues to be used.
  const origin = await stepAsync("origin-handshake", async () => {
    if (!config.originUrl) return "skipped (no origin URL)";
    const handshake = await fetchOriginHandshake(config.originUrl);
    if (!handshake.ok || !handshake.baseUrl) throw new Error(handshake.error ?? "origin handshake failed");
    const changed = handshake.baseUrl !== config.customProviderUrl;
    if (changed) {
      config.customProviderUrl = handshake.baseUrl;
      report.outputs.originPersisted = persistProviderUrl(handshake.baseUrl);
      report.outputs.originProviderConfig = syncProviderBaseUrl(
        layout.configFile,
        config.customProviderID,
        handshake.baseUrl,
      );
      await ctx.provider?.reload?.();
      await ctx.model?.reload?.();
    }
    return `${handshake.baseUrl}${handshake.authRequired ? " (auth required)" : ""}${changed ? " (updated)" : ""}`;
  });
  report.outputs.originUrl = config.originUrl || null;
  report.outputs.originHandshake = origin;

  // ---- §2 model plan --------------------------------------------------------
  const plan = await stepAsync("resolve-models", async () => {
    // OpenCode 2.x: ctx.provider + ctx.model. Older betas: ctx.catalog.
    const providerDoor = ctx.provider ?? ctx.catalog?.provider;
    const modelDoor = ctx.model ?? ctx.catalog?.model;
    const doors: CatalogDoors | undefined =
      providerDoor || modelDoor ? { provider: providerDoor, model: modelDoor } : undefined;
    const resolved = await resolveModels(doors, ROSTER, {
      customProviderUrl: config.customProviderUrl,
      customProviderID: config.customProviderID,
      customProviderApiKey: config.customProviderApiKey,
      providerConfigured: providerConfiguredOnDisk(root!, config.customProviderID),
      strategy: config.modelStrategy,
      baselineModel: config.baselineModel,
    });
    return resolved;
  });
  report.outputs.modelStrategy = plan?.strategy;
  report.outputs.modelAssignment = plan?.assignment;
  report.outputs.customProviderReachable = plan?.probe?.ok ?? false;

  // Global install: the installer owns <global>/opencode.json and <global>/agents.
  // Merge the global models over the project plan so a project that fell back to
  // free models cannot rewrite the global agents. Project installs keep the
  // project plan.
  const globalAssignment = layout.global ? globalAgentAssignment(layout.configFile, ROSTER) : {};
  // A live provider plan (or a free-model plan) is newer evidence than the
  // installer-owned assignment. In global mode the plan is computed from the
  // same config file, so a free mapping is the owner's current choice and must
  // reach the agents instead of being masked by the installer's old baseline.
  // Explicit `modelStrategy: "free"` is an owner choice and wins in global mode.
  // A plain `auto` fallback (provider disabled) still must not rewrite the
  // installer-owned global agents.
  const explicitFree = ["free", "random"].includes(String(config.modelStrategy ?? "").toLowerCase());
  const runtimePlanWins =
    plan?.strategy === "custom-provider" ||
    (plan?.strategy === "free-fallback" && (Boolean(plan?.customProviderUrl) || explicitFree));
  const agentAssignment = layout.global
    ? runtimePlanWins
      ? (plan?.assignment ?? {})
      : { ...(plan?.assignment ?? {}), ...globalAssignment }
    : (plan?.assignment ?? {});
  report.outputs.agentAssignment = agentAssignment;
  report.outputs.agentAssignmentSource = layout.global
    ? runtimePlanWins
      ? `runtime model plan (${plan?.strategy})`
      : "global opencode.json (installer-owned)"
    : "project model plan";

  // ---- §6/§7 MCP probe ------------------------------------------------------
  // The installer can prove an MCP URL once, but the runtime must prove it again:
  // the server may have moved, or the project may have received config later.
  let mcpProbe: Awaited<ReturnType<typeof probeMcp>> | undefined;
  const mcp = await stepAsync("probe-mcp", async () => {
    if (!config.mcpUrl) return "skipped (no MCP URL)";
    mcpProbe = await probeMcp(config.mcpUrl);
    if (!mcpProbe.ok) throw new Error(mcpProbe.error ?? "MCP probe failed");
    const names = mcpProbe.tools.map((tool) => tool.name).join(", ");
    return `${mcpProbe.tools.length} tool(s)${names ? `: ${names}` : ""}`;
  });
  report.outputs.mcpUrl = config.mcpUrl || null;
  report.outputs.mcpReachable = mcpProbe?.ok ?? false;
  report.outputs.mcpTools = mcpProbe?.tools.map((tool) => tool.name) ?? [];

  const writeSsotNow = (): { file: string; sha256: string; bytes: number } => {
    const written = writeSsot(root!, scanProject(root!));
    return { file: written.file, sha256: written.sha256, bytes: written.bytes };
  };

  // ---- §3.2 first scan + SSOT ----------------------------------------------
  const fingerprint = step("scan-project", () => scanProject(root!));
  report.outputs.scan = fingerprint
    ? {
        files: fingerprint.totalFiles,
        dirs: fingerprint.totalDirs,
        bytes: fingerprint.totalBytes,
        languages: fingerprint.languages.length,
      }
    : null;
  const ssot = step("write-ssot", () => writeSsot(root!, fingerprint ?? scanProject(root!)));
  report.outputs.ssot = ssot;

  // ---- §4 syllabus ----------------------------------------------------------
  const syllabus = step("ensure-syllabus", () =>
    ensureSyllabus(root!, fingerprint ?? scanProject(root!), ROSTER.map((a) => a.id)),
  );
  report.outputs.syllabus = syllabus;
  scaffoldedRoots.add(root);

  // ---- §1 agent doors + model binding --------------------------------------
  // Two documented doors, both written at the install root (never in an
  // arbitrary working directory):
  //   <install>/agents/*.md          persona + frontmatter
  //   <install>/opencode.json agents V2 config (model + permissions + system)
  // The editor transform sees no IDs at this point, so pretending it bound them
  // would be a lie in the report.
  //
  // Agent modes are config-level. `agentModes` in zombiecoder/config.json is the
  // switch door: validated here, written to both files, and reloaded below.
  const modePlan = step("agent-modes", () => {
    const result = applyModeOverrides(ROSTER, config.agentModes);
    report.outputs.agentModes = result.applied;
    if (result.rejected.length > 0) report.outputs.agentModeRejections = result.rejected;
    return result;
  });
  const effectiveRoster: AgentDef[] = modePlan?.agents ?? ROSTER;

  const agentsDir = path.join(layout.dir, "agents");
  const modelPins = config.agentModelPins === true;
  // Never write a non-reference ("inherit", "") as the root model.
  const defaultModel =
    normalizeModelRef(plan?.defaultModel) ?? normalizeModelRef(config.baselineModel) ?? BASELINE_MODEL;
  const folder = step("agent-folder", () =>
    ensureAgentFolderAt(agentsDir, effectiveRoster, agentAssignment, modelPins),
  );
  report.outputs.agentFolder = folder;

  const agentConfig = step("agent-config", () =>
    syncAgentConfig(layout.configFile, effectiveRoster, agentAssignment, modelPins, defaultModel),
  );
  report.outputs.agentConfig = agentConfig;

  await stepAsync("agent-reload", async () => {
    await ctx.agent?.reload?.();
    return "reloaded";
  });

  const bound = step("agent-bind", () => {
    const missing = verifyAgentMarkdownAt(agentsDir, effectiveRoster, agentAssignment, modelPins);
    if (!agentConfig?.skipped) {
      missing.push(...verifyAgentConfig(layout.configFile, effectiveRoster, agentAssignment, modelPins));
    }
    if (missing.length > 0) {
      throw new Error(`agent binding incomplete: ${missing.join(", ")}`);
    }
    return modelPins
      ? `${effectiveRoster.length} agents carry ${layout.global ? "global" : "project"} model + shared rules (markdown + config)`
      : `${effectiveRoster.length} agents inherit the session model + shared rules (no per-agent pin)`;
  });
  report.outputs.bound = bound;

  // ---- §6 skills ------------------------------------------------------------
  // Skills live once at <install>/zombiecoder/skills. The installer seeds the
  // offline catalog there; setup only makes sure the core set exists and then
  // registers the shared store. A user-named skill is fetched on demand by the
  // skill_catalog tool, never by writing into this working directory.
  const skillCatalog = await stepAsync("prepare-skills", async () => {
    if (!config.autoSkills) return "skipped (autoSkills=false)";
    const result = await ensureSharedSkills(layout.dir, undefined, {
      repoUrl: config.skillRepo,
      download: false,
    });
    const copied = result.results.filter((item) => item.copied).length;
    const failed = result.results.filter((item) => item.error).length;
    return `${copied} new, ${result.ids.length} shared${failed ? `, ${failed} unavailable` : ""} (${result.skillsDir})`;
  });
  report.outputs.skillCatalog = skillCatalog;

  const skills = step("register-skills", () => {
    const registration = registerSkills(ctx.skill, layout.dir);
    cleanups.push(registration.release);
    report.outputs.skills = "pending (applies after setup returns)";
    watchTransform(
      "register-skills",
      registration.applied,
      (result) => {
        report.outputs.skills = `${result.registered.length} registered${
          result.error ? ` (${result.error})` : ""
        }`;
        updateStep("register-skills", {
          ok: !result.error || result.registered.length > 0,
          detail: `${result.registered.length} registered${
            result.skipped.length ? `, ${result.skipped.length} skipped` : ""
          }`,
          error: result.error,
        });
      },
      () => "skill transform callback did not fire",
    );
    return "registered (apply pending)";
  });
  report.outputs.skills = skills;

  // ---- §6/§7 control surface ------------------------------------------------
  const deps = {
    projectRoot: (sessionID?: string) => {
      const id = String(sessionID ?? "").trim();
      return (id && resolvedSessionRoots.get(id)) || root!;
    },
    installRoot: () => layout.dir,
    storage: ctx.storage,
    refreshSsot: writeSsotNow,
    modelPlan: () => plan,
    reloadSkills: async () => {
      await ctx.skill?.reload?.();
    },
    reloadAgents: async () => {
      await ctx.agent?.reload?.();
    },
    reloadProviders: async () => {
      await ctx.provider?.reload?.();
      await ctx.model?.reload?.();
    },
    reloadTools: async () => {
      await ctx.tool?.reload?.();
    },
    synthetic: async (input: { sessionID: string; text: string; description?: string }) => {
      const door = (ctx as any).session?.synthetic;
      if (typeof door !== "function") throw new Error("session.synthetic unavailable");
      await door(input);
    },
  };

  const rpc = await stepAsync("register-rpc", () => registerRpc(ctx.rpc, deps));
  report.outputs.rpc = rpc;

  const tools = step("register-tools", () => {
    const registration = registerTools(ctx.tool, deps);
    cleanups.push(registration.release);
    report.outputs.tools = "pending (applies after setup returns)";
    watchTransform(
      "register-tools",
      registration.applied,
      (result) => {
        report.outputs.tools = `${result.registered.length} registered${
          result.error ? ` (${result.error})` : ""
        }`;
        updateStep("register-tools", {
          ok: !result.error || result.registered.length > 0,
          detail: `${result.registered.length} registered`,
          error: result.error,
        });
      },
      () => "tool transform callback did not fire",
    );
    return "registered (apply pending)";
  });
  report.outputs.tools = tools;

  // ---- §5 memory + per-agent footprint -------------------------------------
  // Agent switch != model switch. OpenCode V2 keeps the session model when the
  // primary agent changes ("Selecting a primary agent by ID does not change
  // that model"), so a session that picked MiMo in /models still runs MiMo after
  // the breaker moves manu -> jarin. The only honest ways to change the model
  // are (a) an explicit session.switchModel call, owned here, or (b) a subagent
  // child session with its own configured model.
  //
  // Policy: move the model ONLY when the owner opted into per-agent pins
  // (agentModelPins=true) and the next agent has a different resolved model.
  // Never pick a random model as a failure response — an unreproducible fallback
  // is not evidence.
  const modelRefOf = (ref?: string): { providerID: string; id: string } | null => {
    if (typeof ref !== "string") return null;
    const slash = ref.indexOf("/");
    if (slash <= 0 || slash === ref.length - 1) return null;
    return { providerID: ref.slice(0, slash), id: ref.slice(slash + 1) };
  };
  const switchAgentModel = async (args: {
    sessionID: string;
    from: string;
    to: string;
    current?: string;
    projectRoot: string;
  }): Promise<{ switched: boolean; model?: string; reason?: string }> => {
    const { sessionID, from, to, current, projectRoot } = args;
    if (config.agentModelPins !== true) {
      return { switched: false, reason: "agentModelPins=false (session model governs)" };
    }
    const target = agentAssignment[to];
    const ref = modelRefOf(target);
    if (!ref) return { switched: false, reason: `no pinned model for ${to}` };
    if (current && current === target) return { switched: false, reason: "model already selected" };
    const door = (ctx.session as any)?.switchModel;
    if (typeof door !== "function") {
      return { switched: false, reason: "session.switchModel unavailable" };
    }
    try {
      await door({ sessionID, model: ref });
      audit(projectRoot, "plugin", {
        kind: "agent.model.switch",
        sessionID,
        from,
        to,
        model: target,
        ok: true,
      });
      return { switched: true, model: target };
    } catch (error: any) {
      const reason = redact(String(error?.message ?? error));
      audit(projectRoot, "plugin", {
        kind: "agent.model.switch",
        sessionID,
        from,
        to,
        model: target,
        ok: false,
        error: reason,
      });
      return { switched: false, reason };
    }
  };

  if (ctx.session?.hook) {
    const contextHook = await stepAsync("hook-context", () =>
      ctx.session!.hook!("context", async (event: any) => {
        const agentID = String(event?.agent ?? "unknown");
        const sessionID = String(event?.sessionID ?? "unknown");
        const projectRoot = await resolveSessionRoot(sessionID);
        try {
          scaffoldProject(projectRoot);
        } catch (error: any) {
          console.error(
            `[zombiecoder] project scaffold failed for ${projectRoot}: ${String(error?.message ?? error)}`,
          );
        }
        const def = ROSTER.find((a) => a.id === agentID);
        const modelID = event?.model?.modelID ?? event?.model?.id;
        const model =
          event?.model?.providerID && modelID
            ? `${event.model.providerID}/${modelID}`
            : undefined;

        // `session.idle` is not a dependable archive trigger in this runtime: the
        // event stream is subscribed, yet no idle snapshot has ever landed in the
        // audit (both projects had time_idle set and zero session.archive rows).
        // The `context` hook fires on every model request and carries the full
        // message list, so archive the overflow here. Idempotent by message id.
        const messages = Array.isArray(event?.messages) ? event.messages : [];
        if (messages.length > 0) {
          const memory = await keepRecent(ctx.storage, projectRoot, sessionID, messages);
          if (memory.archived > 0) {
            audit(projectRoot, agentID, {
              kind: "memory.keep",
              sessionID,
              kept: memory.kept,
              archived: memory.archived,
              archiveFile: memory.archiveFile,
            });
          }
        }

        const recent = await readRecent(ctx.storage, sessionID);
        // The focus resolver needs the sentence the user just wrote, not the whole
        // transcript. Walk backwards to the last user turn in the hook payload.
        let userMessage = "";
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (String(roleOf(messages[i]) ?? "").toLowerCase() !== "user") continue;
          userMessage = textOf(messages[i]);
          break;
        }
        const pack = buildContextPack(projectRoot, agentID, recent, userMessage, sessionID);
        // One merge point for every agent. Roster agents already carry the
        // shared rules in their markdown; builtin runners (build/plan/general/
        // explore) do not, so they get the identity header + full persona here.
        const persona = mergeAgentPersona(agentID);
        if (Array.isArray(event?.system) && typeof event.system.push === "function") {
          event.system.push({
            type: "text",
            text: [
              pack.text,
              "",
              ...(persona.text ? [persona.text, ""] : []),
              "### Agent contract",
              def
                ? `Decision rule: ${def.rule}`
                : `Decision rule: no specialist roster entry for "${agentID}"; the shared ZombieCoder contract above is authoritative.`,
              'Start every response with "ভাইয়া". Chat in Bengali; code and shortcuts in English.',
              "Read SSOT and syllabus before acting. The footprint lives inside syllabus.md — never create a separate footprint file.",
              "All agents are main agents and may delegate to each other with only the necessary context.",
              "Evidence before confidence. No evidence means no verified answer.",
              `Context ownership: SSOT=${pack.owners.ssot.agent}, Syllabus=${pack.owners.syllabus.agent}, Memory=${pack.owners.memory.agent}, Skills=${pack.owners.skills.agent}, Gate=${pack.owners.gate.agent}.`,
              `Before substantive work, call \`context_status\` and show its uiLine. Make this the first visible line after \"ভাইয়া\" so the user sees who manages SSOT, syllabus and memory: ${pack.uiLine}`,
            ].join("\n"),
          });
        }

        audit(projectRoot, agentID, {
          kind: "context",
          sessionID,
          model,
          kept: recent.length,
          messages: Array.isArray(event?.messages) ? event.messages.length : 0,
          contextPackBytes: pack.bytes,
          ssotBytes: pack.ssot.bytes,
          syllabusBytes: pack.syllabus.bytes,
          ssotExcerptBytes: pack.ssotExcerptBytes,
          syllabusExcerptBytes: pack.syllabusExcerptBytes,
          memoryArchives: pack.memory.archives,
          uiLine: pack.uiLine,
          persona: persona.kind,
          personaBytes: persona.bytes,
        });
      }),
    );
    if (contextHook) cleanups.push(() => contextHook.dispose());

    const compactionHook = await stepAsync("hook-compaction", () =>
      ctx.session!.hook!("compaction", async (event: any) => {
        const agentID = String(event?.agent ?? "unknown");
        const sessionID = String(event?.sessionID ?? "unknown");
        const projectRoot = await resolveSessionRoot(sessionID);
        const messages = Array.isArray(event?.messages) ? event.messages : [];
        const result = await keepRecent(ctx.storage, projectRoot, sessionID, messages);
        audit(projectRoot, agentID, {
          kind: "compaction",
          sessionID,
          kept: result.kept,
          archived: result.archived,
          archiveFile: result.archiveFile,
        });
      }),
    );
    if (compactionHook) cleanups.push(() => compactionHook.dispose());

    step("archive-session-idle", () => {
      if (!ctx.event?.subscribe || !ctx.session?.context) {
        return "skipped (session event/context API unavailable)";
      }
      const controller = new AbortController();
      const task = (async () => {
        try {
          for await (const event of ctx.event!.subscribe!({ signal: controller.signal })) {
            if (event?.type !== "session.idle") continue;
            const sessionID = String(event?.data?.sessionID ?? "").trim();
            if (!sessionID) continue;
            const projectRoot = await resolveSessionRoot(sessionID);
            try {
              const messages = await ctx.session!.context!({ sessionID });
              const result = await archiveSessionSnapshot(ctx.storage, projectRoot, sessionID, messages);
              audit(projectRoot, "plugin", {
                kind: "session.archive",
                sessionID,
                kept: result.kept,
                archived: result.archived,
                archiveFile: result.archiveFile,
                ok: true,
              });
            } catch (error: any) {
              const message = redact(String(error?.message ?? error));
              audit(projectRoot, "plugin", {
                kind: "session.archive",
                sessionID,
                ok: false,
                error: message,
              });
              console.error(`[zombiecoder] session archive failed for ${sessionID}: ${message}`);
            }
          }
        } catch (error: any) {
          if (!controller.signal.aborted) {
            const message = redact(String(error?.message ?? error));
            audit(root!, "plugin", { kind: "session.archive.subscription", ok: false, error: message });
            console.error(`[zombiecoder] session archive subscription failed: ${message}`);
          }
        }
      })();
      cleanups.push(async () => {
        controller.abort();
        await task;
      });
      return "subscribed to session.idle";
    });

    const modelHook = await stepAsync("hook-model-request", () =>
      ctx.session!.hook!("model.request", async (event: any) => {
        const projectRoot = await resolveSessionRoot(String(event?.sessionID ?? "unknown"));
        audit(projectRoot, String(event?.agent ?? "unknown"), {
          kind: "model.request",
          sessionID: event?.sessionID,
          model:
            event?.model?.providerID && (event?.model?.modelID ?? event?.model?.id)
              ? `${event.model.providerID}/${event.model.modelID ?? event.model.id}`
              : undefined,
          requestKind: event?.kind,
        });
      }),
    );
    if (modelHook) cleanups.push(() => modelHook.dispose());

    // Session index bookkeeping: the first time we see a session, record it.
    const sessionHook = await stepAsync("hook-session-index", () =>
      ctx.session!.hook!("prompt", async (event: any) => {
        const sessionID = String(event?.sessionID ?? "unknown");
        const projectRoot = await resolveSessionRoot(sessionID);
        try {
          scaffoldProject(projectRoot);
        } catch (error: any) {
          console.error(
            `[zombiecoder] project scaffold failed for ${projectRoot}: ${String(error?.message ?? error)}`,
          );
        }
        // An empty patch only refreshes updatedAt; it must not reset the kept
        // count written by the compaction hook.
        touchIndex(projectRoot, sessionID, {});
      }),
    );
    if (sessionHook) cleanups.push(() => sessionHook.dispose());

    // ---- circuit breaker ---------------------------------------------------
    // A blocked answer is a recorded failure, not a dead end. The session moves
    // to the next roster agent (queued prompt) up to BREAKER_LIMIT times, then
    // the breaker opens with an actionable message instead of silently stopping.
    const breakerInflight = new Set<string>();

    const escalateGateBlock = async (input: {
      sessionID: string;
      agentID: string;
      model?: string;
      protocol: string;
      blockedText: string;
      verdict: { reason: string; violations: string[]; matched: string[] };
    }) => {
      const { sessionID, agentID, model } = input;
      if (!sessionID || sessionID === "unknown") return;
      if (breakerInflight.has(sessionID)) return;
      const projectRoot = await resolveSessionRoot(sessionID);
      const session = ctx.session as any;
      const available = Boolean(session?.synthetic && session?.prompt && session?.switchAgent);
      const failure = {
        agent: agentID,
        kind: "response_gate" as const,
        reason: input.verdict.reason,
        at: new Date().toISOString(),
        context: breakerContext(input.verdict, input.blockedText, {
          model,
          detail: `protocol=${input.protocol}`,
        }),
      };
      const key = `agent/breaker/${sessionID}`;
      breakerInflight.add(sessionID);
      try {
        const state = readBreakerState(await ctx.storage.get(key), sessionID);
        const { state: nextState, decision } = decideBreaker(state, ROSTER, failure, BREAKER_LIMIT);
        await ctx.storage.set(key, nextState);
        audit(projectRoot, "plugin", {
          kind: "agent.failure",
          sessionID,
          agent: agentID,
          model,
          source: "response_gate",
          reason: failure.reason,
          violations: failure.context?.violations,
          failures: nextState.failures.length,
          limit: BREAKER_LIMIT,
        });
        if (!available) {
          audit(projectRoot, "plugin", {
            kind: "agent.escalation",
            sessionID,
            from: agentID,
            ok: false,
            reason: "session.synthetic/prompt/switchAgent unavailable",
          });
          return;
        }
        if (decision.action === "stop") {
          await session.synthetic({
            sessionID,
            text: unresolvedMessage(nextState, decision.limit),
            description: "zombiecoder circuit breaker",
          });
          audit(projectRoot, "plugin", {
            kind: "agent.breaker.open",
            sessionID,
            agent: agentID,
            tried: nextState.agents,
            failures: nextState.failures.length,
          });
          return;
        }
        // If the switch itself fails, keep the task moving on the current agent
        // rather than leaving the user with only the UNVERIFIED replacement.
        let switched = true;
        try {
          await session.switchAgent({ sessionID, agent: decision.next });
        } catch (switchError: any) {
          switched = false;
          audit(projectRoot, "plugin", {
            kind: "agent.escalation.switch",
            sessionID,
            from: agentID,
            to: decision.next,
            ok: false,
            error: redact(String(switchError?.message ?? switchError)),
          });
        }
        // The persona changed; the model did not unless the owner pinned models.
        const modelSwitch = switched
          ? await switchAgentModel({
              sessionID,
              from: agentID,
              to: decision.next,
              current: model,
              projectRoot,
            })
          : { switched: false, reason: "agent switch failed" };
        await session.synthetic({
          sessionID,
          text: statusMessage(failure, decision),
          description: "zombiecoder circuit breaker",
        });
        await session.prompt({
          sessionID,
          text: fallbackPrompt(failure, input.blockedText, decision),
          delivery: "queue",
        });
        audit(projectRoot, "plugin", {
          kind: "agent.escalation",
          sessionID,
          from: agentID,
          to: switched ? decision.next : agentID,
          attempt: decision.attempt,
          limit: decision.limit,
          ok: switched,
          reason: failure.reason,
          model: modelSwitch.switched ? modelSwitch.model : model,
          modelSwitch: modelSwitch.switched ? "switched" : modelSwitch.reason,
        });
      } catch (error: any) {
        audit(projectRoot, "plugin", {
          kind: "agent.escalation",
          sessionID,
          from: agentID,
          ok: false,
          error: redact(String(error?.message ?? error)),
        });
      } finally {
        breakerInflight.delete(sessionID);
      }
    };

    // Hard response gate: only the primary assistant answer is gated. Title,
    // compaction and generate calls are internal and must stay untouched.
    if (config.responseGate !== false) {
      const responseHook = await stepAsync("hook-response-gate", () =>
        ctx.session!.hook!("http.response", async (event: any) => {
          if (event?.kind !== "primary") return;
          if (!(event?.response instanceof Response)) return;
          if (event.response.status >= 400) return;
          const modelID = event?.model?.modelID ?? event?.model?.id;
          const model =
            event?.model?.providerID && modelID
              ? `${event.model.providerID}/${modelID}`
              : undefined;
          const projectRoot = await resolveSessionRoot(String(event?.sessionID ?? "unknown"));
          try {
            scaffoldProject(projectRoot);
          } catch (error: any) {
            console.error(
              `[zombiecoder] project scaffold failed for ${projectRoot}: ${String(error?.message ?? error)}`,
            );
          }
          try {
            const result = await applyResponseGate(event.response, { allowedRoot: projectRoot });
            event.response = result.response;

            // A passing final answer closes the incident: the next user question
            // must not inherit an old failure count.
            const resetBreaker = async () => {
              const breakerKey = `agent/breaker/${String(event?.sessionID ?? "unknown")}`;
              const previous = readBreakerState(
                await ctx.storage.get(breakerKey),
                String(event?.sessionID ?? "unknown"),
              );
              if (previous.failures.length > 0) {
                await ctx.storage.set(breakerKey, {
                  sessionID: previous.sessionID,
                  agents: [],
                  failures: [],
                });
                audit(projectRoot, "plugin", {
                  kind: "agent.breaker.reset",
                  sessionID: previous.sessionID,
                  failures: previous.failures.length,
                });
              }
            };

            // Streamed answers are never buffered and never replaced: the text
            // already reached the user. The verdict is only known when the body
            // ends, so audit and escalate there instead of delaying the stream.
            if (result.streamed) {
              const settlement = result.settled.then(async ({ verdict, parsed }) => {
                audit(projectRoot, String(event?.agent ?? "unknown"), {
                  kind: "response.gate",
                  sessionID: event?.sessionID,
                  model,
                  passed: verdict.passed,
                  supported: verdict.supported,
                  protocol: parsed.protocol,
                  toolCalls: parsed.toolCalls,
                  reason: verdict.reason,
                  matched: verdict.matched,
                  violations: verdict.violations,
                  streamed: true,
                });
                if (!verdict.passed) {
                  await escalateGateBlock({
                    sessionID: String(event?.sessionID ?? "unknown"),
                    agentID: String(event?.agent ?? "unknown"),
                    model,
                    protocol: parsed.protocol,
                    blockedText: parsed.text,
                    verdict,
                  });
                } else if (!parsed.toolCalls) {
                  await resetBreaker();
                }
              });
              settlement.catch((error: any) => {
                audit(projectRoot, "plugin", {
                  kind: "response.gate.error",
                  sessionID: event?.sessionID,
                  error: String(error?.message ?? error),
                });
              });
              // Exposed so callers (and tests) can await the deferred work.
              (event as any).zombiecoderSettled = settlement;
              return;
            }

            audit(projectRoot, String(event?.agent ?? "unknown"), {
              kind: "response.gate",
              sessionID: event?.sessionID,
              model,
              passed: result.verdict.passed,
              supported: result.verdict.supported,
              protocol: result.parsed.protocol,
              toolCalls: result.parsed.toolCalls,
              reason: result.verdict.reason,
              matched: result.verdict.matched,
              violations: result.verdict.violations,
            });
            if (!result.verdict.passed) {
              await escalateGateBlock({
                sessionID: String(event?.sessionID ?? "unknown"),
                agentID: String(event?.agent ?? "unknown"),
                model,
                protocol: result.parsed.protocol,
                blockedText: result.parsed.text,
                verdict: result.verdict,
              });
            } else if (!result.parsed.toolCalls) {
              await resetBreaker();
            }
          } catch (error: any) {
            audit(projectRoot, String(event?.agent ?? "unknown"), {
              kind: "response.gate.error",
              sessionID: event?.sessionID,
              model,
              error: String(error?.message ?? error),
            });
          }
        }),
      );
      if (responseHook) cleanups.push(() => responseHook.dispose());
    }
  } else {
    report.steps.push({ step: "hook-context", ok: false, error: "ctx.session.hook not available" });
  }

  // ---- per-agent tool footprint --------------------------------------------
  if (ctx.tool?.hook) {
    const toolHook = await stepAsync("hook-tool-after", () =>
      ctx.tool!.hook!("execute.after", async (event: any) => {
        const agentID = String(event?.agent ?? "unknown");
        const sessionID = String(event?.sessionID ?? "unknown");
        const projectRoot = await resolveSessionRoot(sessionID);
        const failureKey = `agent/failures/${sessionID}/${agentID}`;
        const previous = (await ctx.storage.get(failureKey)) as
          | { count?: number; escalated?: boolean }
          | undefined;
        const failed = event?.status === "error";
        const count = failed ? Math.max(0, Number(previous?.count) || 0) + 1 : 0;
        if (failed || previous) {
          await ctx.storage.set(failureKey, { count, escalated: previous?.escalated ?? false });
        }
        audit(projectRoot, String(event?.agent ?? "unknown"), {
          kind: "tool",
          sessionID,
          tool: event?.tool,
          callID: event?.id,
          status: event?.status ?? "unknown",
          consecutiveFailures: count,
        });

        // The pre-work card is only honest if the agent actually opened a
        // contract. Weak/free models ignore the prompt rule, so a write that
        // lands without one gets a visible warning card and an audit row.
        await warnMissingGoalContract({
          projectRoot,
          sessionID,
          agentID,
          tool: String(event?.tool ?? ""),
        });

        if (!failed || count < 3 || previous?.escalated) return;

        const index = ROSTER.findIndex((agent) => agent.id === agentID);
        const next = index >= 0 ? ROSTER[(index + 1) % ROSTER.length] : ROSTER[0];
        await ctx.storage.set(failureKey, { count, escalated: true });
        if (!ctx.session?.switchAgent) {
          audit(projectRoot, "plugin", {
            kind: "agent.escalation",
            sessionID,
            from: agentID,
            to: next.id,
            ok: false,
            reason: "session.switchAgent unavailable",
          });
          console.error(`[zombiecoder] cannot switch agent after repeated tool failures: ${agentID} -> ${next.id}`);
          return;
        }
        try {
          await ctx.session.switchAgent({ sessionID, agent: next.id });
          const modelSwitch = await switchAgentModel({
            sessionID,
            from: agentID,
            to: next.id,
            projectRoot,
          });
          audit(projectRoot, "plugin", {
            kind: "agent.escalation",
            sessionID,
            from: agentID,
            to: next.id,
            ok: true,
            reason: "three consecutive tool execution errors",
            model: modelSwitch.switched ? modelSwitch.model : undefined,
            modelSwitch: modelSwitch.switched ? "switched" : modelSwitch.reason,
          });
        } catch (error: any) {
          audit(projectRoot, "plugin", {
            kind: "agent.escalation",
            sessionID,
            from: agentID,
            to: next.id,
            ok: false,
            error: redact(String(error?.message ?? error)),
          });
          console.error(`[zombiecoder] agent switch failed: ${redact(String(error?.message ?? error))}`);
        }
      }),
    );
    if (toolHook) cleanups.push(() => toolHook.dispose());
  }

  // ---- §3.3 refresh cycle ---------------------------------------------------
  // Their door (config.watcher) has no interval knob — only an ignore list. So the
  // timer lives in our own process, and we say so rather than pretending it is theirs.
  const timer = setInterval(() => {
    for (const projectRoot of projectRoots) {
      try {
        const written = writeSsot(projectRoot, scanProject(projectRoot));
        audit(projectRoot, "plugin", {
          kind: "ssot.refresh",
          sha256: written.sha256,
          bytes: written.bytes,
        });
      } catch (error: any) {
        console.error(
          `[zombiecoder] ssot refresh failed for ${projectRoot}: ${String(error?.message ?? error)}`,
        );
      }
    }
  }, config.ssotRefreshMs || DEFAULT_SSOT_REFRESH_MS);
  if (typeof (timer as any).unref === "function") (timer as any).unref();
  cleanups.push(() => clearInterval(timer));
  report.outputs.refreshMs = config.ssotRefreshMs;

  // ---- report + footprint ---------------------------------------------------
  report.steps.push({ step: "write-report", ok: true, detail: "written" });
  persistReport();
  try {
    audit(root!, "plugin", {
      kind: "setup",
      ok: report.steps.filter((s) => s.ok).length,
      failed: report.steps.filter((s) => !s.ok).length,
      modelStrategy: report.outputs.modelStrategy,
      root,
    });
  } catch {
    /* the report on disk is the durable record */
  }

  return async () => {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch {
        /* cleanup must never throw during shutdown */
      }
    }
  };
}

export default Plugin.define({ id: PLUGIN_ID, setup });
