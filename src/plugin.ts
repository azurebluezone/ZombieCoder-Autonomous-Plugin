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
import { ROSTER, GLOBAL_PERMISSIONS, agentMarkdown, renderAgentsConfig, type AgentDef } from "./roster.ts";
import {
  bootstrapDirs,
  agentStoreDir,
  configFile,
  legacyModelPlanFile,
  mcpFile,
  modelPlanFile,
  setupReportFile,
} from "./zombie/paths.ts";
import { ensureDir, readJson, writeJson, writeAtomic, PLUGIN_VERSION } from "./zombie/io.ts";
import { scanProject, type Fingerprint } from "./zombie/scan.ts";
import { writeSsot } from "./zombie/ssot.ts";
import { ensureSyllabus } from "./zombie/syllabus.ts";
import { keepRecent, readRecent, touchIndex } from "./zombie/memory.ts";
import {
  resolveModels,
  cacheModelPlan,
  DEFAULT_CUSTOM_PROVIDER_URL,
  type CatalogDoors,
} from "./zombie/models.ts";
import { probeMcp } from "./zombie/mcp.ts";
import { registerSkills } from "./zombie/skills.ts";
import { registerRpc, registerTools, footprint } from "./zombie/server.ts";

export const PLUGIN_ID = "zombiecoder";
export const DEFAULT_SSOT_REFRESH_MS = 5 * 60 * 1000; // spec §3.3 — every 5 minutes
// OpenCode applies a transform AFTER setup() returns. Waiting inside setup blocks
// the very apply we are waiting for, so registration is reported as "pending" and
// the report is updated when the deferred callback actually fires.
export const TRANSFORM_APPLY_TIMEOUT_MS = 15000;

export type ZombieConfig = {
  customProviderUrl: string;
  customProviderID: string;
  mcpUrl: string;
  opencodeApiUrl: string;
  ssotRefreshMs: number;
  modelStrategy: "auto" | "custom" | "free" | "baseline" | "random";
};

export const DEFAULT_CONFIG: ZombieConfig = {
  customProviderUrl: DEFAULT_CUSTOM_PROVIDER_URL,
  customProviderID: "missionbarisal",
  mcpUrl: "",
  opencodeApiUrl: "http://127.0.0.1:49374",
  ssotRefreshMs: DEFAULT_SSOT_REFRESH_MS,
  modelStrategy: "auto",
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
    const global = path.basename(candidate) !== ".opencode";
    return {
      dir: candidate,
      global,
      configFile: global ? path.join(candidate, "opencode.json") : path.join(path.dirname(candidate), "opencode.json"),
    };
  }
  // Source layout (tests, direct loading): behave like a project install rooted
  // at the location, but never write outside the location.
  const dir = path.join(locationRoot, ".opencode");
  return { dir, global: false, configFile: path.join(locationRoot, "opencode.json") };
}

type Ctx = {
  location?: { directory?: string };
  agent?: {
    reload?: () => Promise<void>;
    transform?: (cb: (editor: any) => void) => Promise<{ dispose: () => Promise<void> }>;
  };
  session?: { hook?: (name: string, cb: (event: any) => any) => Promise<{ dispose: () => Promise<void> }> };
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
  provider?: { list?: (input?: any) => Promise<any> };
  model?: {
    list?: (input?: any) => Promise<any>;
    default?: (input?: any) => Promise<any>;
  };
  rpc?: { register: (definition: any, handlers: any) => Promise<any> };
  storage: { get: (key: string) => Promise<unknown>; set: (key: string, value: any) => Promise<void> };
  event?: { subscribe?: (cb: (event: any) => any) => Promise<{ dispose: () => Promise<void> }> };
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
  if (home) dirs.push(path.join(home, ".config", "opencode"));
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

function loadConfig(projectRoot: string): ZombieConfig {
  // Merge order mirrors OpenCode: shipped default < global ZombieCoder config
  // < this working directory's .zombiecoder/config.json.
  const global = readJson<Partial<ZombieConfig>>(GLOBAL_ZOMBIE_CONFIG) ?? {};
  const existing = readJson<Partial<ZombieConfig>>(configFile(projectRoot));
  const merged: ZombieConfig = { ...DEFAULT_CONFIG, ...global, ...(existing ?? {}) };
  if (!existing) writeJson(configFile(projectRoot), merged);
  return merged;
}

// One-time repair: old builds wrote the model plan to memory.json. Move it to
// models.json so memory/index.json is the only memory door.
export function migrateLegacyPlan(projectRoot: string): string | undefined {
  const legacy = legacyModelPlanFile(projectRoot);
  const target = modelPlanFile(projectRoot);
  if (!fs.existsSync(legacy) || fs.existsSync(target)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(legacy, "utf8"));
    if (data && typeof data === "object" && data.assignment && data.strategy) {
      fs.renameSync(legacy, target);
      return "migrated memory.json -> models.json";
    }
  } catch {
    /* not a plan; leave the file alone */
  }
  return undefined;
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
): { dir: string; written: string[]; unchanged: string[] } {
  ensureDir(dir);
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const a of roster) {
    const file = path.join(dir, a.id + ".md");
    const content = agentMarkdown(a, assignment[a.id]);
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
): string[] {
  const missing: string[] = [];
  for (const a of roster) {
    const file = path.join(dir, a.id + ".md");
    const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const expected = assignment[a.id] ?? a.model;
    if (!raw.includes(`model: ${expected}`)) missing.push(`${a.id}=${expected}`);
    if (!raw.includes("ZombieCoder Shared Rules")) missing.push(`${a.id}=rules`);
  }
  return missing;
}

export function verifyAgentMarkdown(
  projectRoot: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
): string[] {
  return verifyAgentMarkdownAt(path.join(projectRoot, ".opencode", "agents"), roster, assignment);
}

// V2 config agents are the second door. The installer seeds them; the runtime
// refreshes the model after a live probe so the config never points at a dead
// provider. Everything outside `agents` is preserved.
export function syncAgentConfig(
  file: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
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
  const wanted = renderAgentsConfig(roster, assignment);
  const updated: string[] = [];

  // Renamed agent: never leave the old persona behind to compete with the new one.
  for (const id of Object.keys(agents)) {
    if (id === "kobir" && !wanted[id]) delete agents[id];
  }
  for (const [id, entry] of Object.entries(wanted)) {
    const before = JSON.stringify(agents[id] ?? null);
    agents[id] = { ...(agents[id] ?? {}), ...entry };
    if (JSON.stringify(agents[id]) !== before) updated.push(id);
  }

  const next = { ...config, agents };
  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (serialized !== current) writeAtomic(file, serialized);
  return { file, updated };
}

export function verifyAgentConfig(
  file: string,
  roster: AgentDef[],
  assignment: Record<string, string> = {},
): string[] {
  const config = readJson<Record<string, any>>(file);
  if (!config || !config.agents) return ["opencode.json=agents"];
  const missing: string[] = [];
  for (const a of roster) {
    const expected = assignment[a.id] ?? a.model;
    const entry = config.agents[a.id];
    if (!entry) missing.push(`${a.id}=missing`);
    else if (entry.model !== expected) missing.push(`${a.id}=model`);
    else if (!Array.isArray(entry.permissions) || entry.permissions.length === 0) missing.push(`${a.id}=permissions`);
  }
  if (config.agents.kobir) missing.push("stale=kobir");
  return missing;
}

export function updateAgentMetadata(
  projectRoot: string,
  agent: AgentDef,
  sessionID: string,
  model?: string,
): any {
  const dir = agentStoreDir(projectRoot, agent.id);
  const file = path.join(dir, "metadata.json");
  const now = new Date().toISOString();
  const prev = readJson<any>(file) ?? {
    id: agent.id,
    name: agent.name,
    callSign: agent.callSign,
    role: agent.role,
    mission: agent.mission,
    decisionRule: agent.rule,
    firstSeen: now,
    sessions: [],
    updates: 0,
  };
  prev.model = model ?? prev.model ?? agent.model;
  prev.lastSeen = now;
  prev.updates = (prev.updates ?? 0) + 1;
  if (sessionID && Array.isArray(prev.sessions) && !prev.sessions.includes(sessionID)) prev.sessions.push(sessionID);
  writeJson(file, prev);
  return prev;
}

export async function setup(rawCtx: unknown): Promise<() => Promise<void>> {
  const ctx = rawCtx as Ctx;
  const startedAt = new Date().toISOString();
  let root = ctx?.location?.directory;
  if (!root || typeof root !== "string") root = process.cwd();
  const layout = detectInstallLayout(root);

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
      const message = String(error?.message ?? error);
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
      const message = String(error?.message ?? error);
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

  const config = step("load-config", () => loadConfig(root!)) ?? DEFAULT_CONFIG;

  const migrated = step("migrate-legacy-plan", () => migrateLegacyPlan(root!));
  if (migrated) report.outputs.migrated = migrated;

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
      providerConfigured: providerConfiguredOnDisk(root!, config.customProviderID),
      randomize: config.modelStrategy === "random",
    });
    cacheModelPlan(root!, resolved);
    return resolved;
  });
  report.outputs.modelStrategy = plan?.strategy;
  report.outputs.modelAssignment = plan?.assignment;
  report.outputs.customProviderReachable = plan?.probe?.ok ?? false;

  // ---- §6/§7 MCP probe ------------------------------------------------------
  // The installer can prove an MCP URL once, but the runtime must prove it again:
  // the server may have moved, or the project may have received config later.
  let mcpProbe: Awaited<ReturnType<typeof probeMcp>> | undefined;
  const mcp = await stepAsync("probe-mcp", async () => {
    if (!config.mcpUrl) return "skipped (no MCP URL)";
    mcpProbe = await probeMcp(config.mcpUrl);
    writeJson(mcpFile(root!), mcpProbe);
    if (!mcpProbe.ok) throw new Error(mcpProbe.error ?? "MCP probe failed");
    const names = mcpProbe.tools.map((tool) => tool.name).join(", ");
    return `${mcpProbe.tools.length} tool(s)${names ? `: ${names}` : ""}`;
  });
  report.outputs.mcpUrl = config.mcpUrl || null;
  report.outputs.mcpReachable = mcpProbe?.ok ?? false;
  report.outputs.mcpTools = mcpProbe?.tools.map((tool) => tool.name) ?? [];

  const writeSsotNow = (): { file: string; sha256: string; bytes: number } => {
    const fp = scanProject(root!);
    const written = writeSsot(root!, fp, {
      agentCount: ROSTER.length,
      agentIds: ROSTER.map((a) => a.id),
      modelStrategy: plan?.strategy ?? "unknown",
      modelAssignment: plan?.assignment ?? {},
      customProviderUrl: config.customProviderUrl,
      customProviderReachable: plan?.probe?.ok ?? false,
      mcpUrl: config.mcpUrl,
      mcpReachable: mcpProbe?.ok ?? false,
      mcpTools: mcpProbe?.tools.map((tool) => tool.name) ?? [],
    });
    return { file: written.file, sha256: written.sha256, bytes: written.bytes };
  };

  // ---- §3.2 first scan + SSOT ----------------------------------------------
  const ssot = step("write-ssot", writeSsotNow);
  report.outputs.ssot = ssot;

  // ---- §4 syllabus ----------------------------------------------------------
  const fingerprint: Fingerprint | undefined = step("rescan-for-syllabus", () => scanProject(root!));
  const syllabus = step("ensure-syllabus", () =>
    ensureSyllabus(root!, fingerprint ?? scanProject(root!), ROSTER.map((a) => a.id)),
  );
  report.outputs.syllabus = syllabus;

  // ---- §1 agent doors + model binding --------------------------------------
  // Two documented doors, both written at the install root (never in an
  // arbitrary working directory):
  //   <install>/agents/*.md          persona + frontmatter
  //   <install>/opencode.json agents V2 config (model + permissions + system)
  // The editor transform sees no IDs at this point, so pretending it bound them
  // would be a lie in the report.
  const agentsDir = path.join(layout.dir, "agents");
  const folder = step("agent-folder", () => ensureAgentFolderAt(agentsDir, ROSTER, plan?.assignment ?? {}));
  report.outputs.agentFolder = folder;

  const agentConfig = step("agent-config", () =>
    syncAgentConfig(layout.configFile, ROSTER, plan?.assignment ?? {}),
  );
  report.outputs.agentConfig = agentConfig;

  await stepAsync("agent-reload", async () => {
    await ctx.agent?.reload?.();
    return "reloaded";
  });

  const bound = step("agent-bind", () => {
    const missing = verifyAgentMarkdownAt(agentsDir, ROSTER, plan?.assignment ?? {});
    if (!agentConfig?.skipped) missing.push(...verifyAgentConfig(layout.configFile, ROSTER, plan?.assignment ?? {}));
    if (missing.length > 0) {
      throw new Error(`agent binding incomplete: ${missing.join(", ")}`);
    }
    return `${ROSTER.length} agents carry resolved model + shared rules (markdown + config)`;
  });
  report.outputs.bound = bound;

  // ---- §6 skills ------------------------------------------------------------
  const skills = step("register-skills", () => {
    const registration = registerSkills(ctx.skill, root!);
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
    projectRoot: () => root!,
    storage: ctx.storage,
    refreshSsot: writeSsotNow,
    modelPlan: () => plan,
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
  if (ctx.session?.hook) {
    const contextHook = await stepAsync("hook-context", () =>
      ctx.session!.hook!("context", async (event: any) => {
        const projectRoot = root!;
        const agentID = String(event?.agent ?? "unknown");
        const sessionID = String(event?.sessionID ?? "unknown");
        const def = ROSTER.find((a) => a.id === agentID);
        const model = event?.model ? `${event.model.providerID}/${event.model.id}` : undefined;
        if (def) updateAgentMetadata(projectRoot, def, sessionID, model);

        const recent = await readRecent(ctx.storage, sessionID);
        if (Array.isArray(event?.system) && typeof event.system.push === "function") {
          event.system.push({
            type: "text",
            text: [
              `ZombieCoder — agent: ${agentID}${def ? ` (${def.role})` : ""}`,
              `Working directory: ${projectRoot}`,
              `SSOT: ${projectRoot}/.zombiecoder/SSOT.md`,
              `Syllabus: ${projectRoot}/.zombiecoder/syllabus.md`,
              def ? `Decision rule: ${def.rule}` : "Decision rule: unknown agent",
              recent.length
                ? `Recent exchanges kept for this session:\n${recent.map((m) => `- ${m.text}`).join("\n")}`
                : "No kept exchanges yet for this session.",
              "Evidence before confidence. No evidence means no verified answer.",
            ].join("\n"),
          });
        }

        footprint(projectRoot, agentID, {
          kind: "context",
          sessionID,
          model,
          kept: recent.length,
          messages: Array.isArray(event?.messages) ? event.messages.length : 0,
        });
      }),
    );
    if (contextHook) cleanups.push(() => contextHook.dispose());

    const compactionHook = await stepAsync("hook-compaction", () =>
      ctx.session!.hook!("compaction", async (event: any) => {
        const projectRoot = root!;
        const agentID = String(event?.agent ?? "unknown");
        const sessionID = String(event?.sessionID ?? "unknown");
        const messages = Array.isArray(event?.messages) ? event.messages : [];
        const result = await keepRecent(ctx.storage, projectRoot, sessionID, messages);
        footprint(projectRoot, agentID, {
          kind: "compaction",
          sessionID,
          kept: result.kept,
          archived: result.archived,
          archiveFile: result.archiveFile,
        });
      }),
    );
    if (compactionHook) cleanups.push(() => compactionHook.dispose());

    const modelHook = await stepAsync("hook-model-request", () =>
      ctx.session!.hook!("model.request", (event: any) => {
        footprint(root!, String(event?.agent ?? "unknown"), {
          kind: "model.request",
          sessionID: event?.sessionID,
          model: event?.model ? `${event.model.providerID}/${event.model.id}` : undefined,
          requestKind: event?.kind,
        });
      }),
    );
    if (modelHook) cleanups.push(() => modelHook.dispose());

    // Session index bookkeeping: the first time we see a session, record it.
    const sessionHook = await stepAsync("hook-session-index", () =>
      ctx.session!.hook!("prompt", (event: any) => {
        const sessionID = String(event?.sessionID ?? "unknown");
        touchIndex(root!, sessionID, { kept: 0 });
      }),
    );
    if (sessionHook) cleanups.push(() => sessionHook.dispose());
  } else {
    report.steps.push({ step: "hook-context", ok: false, error: "ctx.session.hook not available" });
  }

  // ---- per-agent tool footprint --------------------------------------------
  if (ctx.tool?.hook) {
    const toolHook = await stepAsync("hook-tool-after", () =>
      ctx.tool!.hook!("execute.after", (event: any) => {
        footprint(root!, String(event?.agent ?? "unknown"), {
          kind: "tool",
          sessionID: event?.sessionID,
          tool: event?.tool,
          callID: event?.id,
          status: event?.status ?? "unknown",
        });
      }),
    );
    if (toolHook) cleanups.push(() => toolHook.dispose());
  }

  // ---- §3.3 refresh cycle ---------------------------------------------------
  // Their door (config.watcher) has no interval knob — only an ignore list. So the
  // timer lives in our own process, and we say so rather than pretending it is theirs.
  const timer = setInterval(() => {
    try {
      const written = writeSsotNow();
      footprint(root!, "plugin", { kind: "ssot.refresh", sha256: written.sha256, bytes: written.bytes });
    } catch (error: any) {
      console.error(`[zombiecoder] ssot refresh failed: ${String(error?.message ?? error)}`);
    }
  }, config.ssotRefreshMs || DEFAULT_SSOT_REFRESH_MS);
  if (typeof (timer as any).unref === "function") (timer as any).unref();
  cleanups.push(() => clearInterval(timer));
  report.outputs.refreshMs = config.ssotRefreshMs;

  // ---- report + footprint ---------------------------------------------------
  report.steps.push({ step: "write-report", ok: true, detail: "written" });
  persistReport();
  try {
    footprint(root!, "plugin", {
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
