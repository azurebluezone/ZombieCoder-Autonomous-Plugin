// Spec §6 + §7 — the in-plugin control surface.
//
// Two documented OpenCode doors are used, nothing invented:
//   ctx.rpc.register  -> reachable over HTTP at POST /api/rpc/{rpcID}/{method}
//   ctx.tool.transform -> tools the agents themselves can call
//
// Every handler is pure: it reads the working directory, returns data, and never
// mutates OpenCode's own state. The single exception is `syllabus_append`, which is
// append-only by construction.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { auditFile, memoryDir, ssotFile, syllabusFile } from "./paths.ts";
import { appendJsonl, readJsonl, readText, redactValue, PLUGIN_VERSION } from "./io.ts";
import { readArchive, readIndex, readRecent, archiveSummary, type StorageLike } from "./memory.ts";
import { appendSyllabus, readSyllabus } from "./syllabus.ts";
import { scanProject } from "./scan.ts";
import { keepTransform, type TransformDoor } from "./transform.ts";
import { buildContextPack } from "./context.ts";
import { syntaxCheck } from "./lsp.ts";
import {
  autoInstallSkills,
  installSharedSkill,
  listSkillCatalog,
} from "./skillCatalog.ts";
import { ROSTER } from "../roster.ts";
import { AGENT_MODES, BUILTIN_AGENTS, MODE_REGISTRY, planModeSwitch, type AgentMode } from "./modes.ts";

export const RPC_ID = "zombiecoder";
export const TOOL_NAMESPACE = { name: "zombiecoder", description: "ZombieCoder project control surface" };

export type RpcLike = {
  register: (definition: any, handlers: any) => Promise<{ dispose: () => Promise<void>; events?: { emit: (...a: any[]) => Promise<void> } }>;
};

export type ToolLike = {
  transform?: (cb: (editor: any) => void) => Promise<{ dispose: () => Promise<void> }>;
  reload?: () => Promise<void>;
};

export type SurfaceDeps = {
  projectRoot: () => string;
  /** OpenCode config directory: the shared skill store lives under it. */
  installRoot: () => string;
  storage: StorageLike;
  refreshSsot: () => { sha256: string; file: string; bytes: number };
  modelPlan: () => unknown;
  /** Reload the skill registry after a project skill is added. */
  reloadSkills?: () => Promise<void>;
};

const obj = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  additionalProperties: false,
});

// The installer places the Python verifier at <install-root>/zombiecoder/tools.
// Source checkouts keep it at <repo-root>/tools. Resolve both shapes instead of
// hardcoding one machine's home directory.
const INSTALL_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SOURCE_ROOT = path.resolve(import.meta.dirname, "..", "..");

function evidenceGateScript(projectRoot: string): string | null {
  const candidates = [
    path.join(INSTALL_ROOT, "zombiecoder", "tools", "evidence_gate.py"),
    path.join(INSTALL_ROOT, "tools", "evidence_gate.py"),
    path.join(SOURCE_ROOT, "tools", "evidence_gate.py"),
    path.join(projectRoot, ".opencode", "zombiecoder", "tools", "evidence_gate.py"),
    path.join(projectRoot, ".zombiecoder", "tools", "evidence_gate.py"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// `events` is required by Rpc.Definition, so it is declared empty rather than omitted.
export function rpcDefinition() {
  return {
    id: RPC_ID,
    methods: {
      working_directory: {
        input: obj({}),
        output: obj({ root: { type: "string" } }),
      },
      status: {
        input: obj({}),
        output: obj({
          version: { type: "string" },
          root: { type: "string" },
          agents: { type: "number" },
          ssotFile: { type: "string" },
          syllabusFile: { type: "string" },
        }),
      },
      ssot: {
        input: obj({}),
        output: obj({ file: { type: "string" }, markdown: { type: "string" } }),
      },
      ssot_refresh: {
        input: obj({}),
        output: obj({ file: { type: "string" }, sha256: { type: "string" }, bytes: { type: "number" } }),
      },
      syllabus: {
        input: obj({}),
        output: obj({ file: { type: "string" }, markdown: { type: "string" } }),
      },
      syllabus_append: {
        input: obj({ topic: { type: "string" }, summary: { type: "string" } }),
        output: obj({ file: { type: "string" }, bytes: { type: "number" } }),
      },
      memory: {
        input: obj({ sessionID: { type: "string" } }),
        output: obj({ recent: { type: "array" }, summary: { type: "string" } }),
      },
      memory_index: {
        input: obj({}),
        output: obj({ index: { type: "object" } }),
      },
      audit: {
        input: obj({ limit: { type: "number" } }),
        output: obj({ entries: { type: "array" } }),
      },
      models: {
        input: obj({}),
        output: obj({ plan: { type: "object" } }),
      },
      fingerprint: {
        input: obj({}),
        output: obj({ fingerprint: { type: "object" } }),
      },
      context_status: {
        input: obj({ agent: { type: "string" }, sessionID: { type: "string" } }),
        output: obj({
          uiLine: { type: "string" },
          packBytes: { type: "number" },
          allowedRoot: { type: "string" },
          ssot: { type: "object" },
          syllabus: { type: "object" },
          ssotExcerptBytes: { type: "number" },
          syllabusExcerptBytes: { type: "number" },
          memory: { type: "object" },
          owners: { type: "object" },
        }),
      },
      agents: {
        input: obj({}),
        output: obj({ agents: { type: "array" } }),
      },
    },
    events: {},
  };
}

export async function registerRpc(rpc: RpcLike | undefined, deps: SurfaceDeps): Promise<{ ok: boolean; error?: string }> {
  if (!rpc || typeof rpc.register !== "function") return { ok: false, error: "ctx.rpc not available" };
  try {
    const handlers = {
      working_directory: async () => ({ root: deps.projectRoot() }),

      status: async () => ({
        version: PLUGIN_VERSION,
        root: deps.projectRoot(),
        agents: ROSTER.length,
        ssotFile: ssotFile(deps.projectRoot()),
        syllabusFile: syllabusFile(deps.projectRoot()),
      }),

      ssot: async () => ({
        file: ssotFile(deps.projectRoot()),
        markdown: readText(ssotFile(deps.projectRoot())) ?? "(SSOT not generated yet)",
      }),

      ssot_refresh: async () => {
        const written = deps.refreshSsot();
        return { file: written.file, sha256: written.sha256, bytes: written.bytes };
      },

      syllabus: async () => ({
        file: syllabusFile(deps.projectRoot()),
        markdown: readSyllabus(deps.projectRoot()) ?? "(syllabus not seeded yet)",
      }),

      syllabus_append: async (input: { topic: string; summary: string }) => {
        if (!input?.topic || !input?.summary) throw new Error("topic and summary are required");
        const result = appendSyllabus(deps.projectRoot(), input.topic, input.summary, auditFile(deps.projectRoot()));
        return { file: result.file, bytes: result.bytes };
      },

      memory: async (input: { sessionID: string }) => {
        const sessionID = input?.sessionID ?? "unknown";
        return {
          recent: await readRecent(deps.storage, sessionID),
          summary: archiveSummary(deps.projectRoot(), sessionID),
        };
      },

      memory_index: async () => ({ index: readIndex(deps.projectRoot()) }),

      audit: async (input: { limit?: number }) => ({
        entries: readJsonl(auditFile(deps.projectRoot()), input?.limit ?? 50),
      }),

      models: async () => ({
        plan: deps.modelPlan() ?? {},
      }),

      fingerprint: async () => ({
        fingerprint: scanProject(deps.projectRoot()),
      }),

      context_status: async (input: { agent?: string; sessionID?: string }) => {
        const sessionID = String(input?.sessionID ?? "").trim();
        const recent = sessionID ? await readRecent(deps.storage, sessionID) : [];
        const pack = buildContextPack(deps.projectRoot(), String(input?.agent ?? "unknown"), recent);
        return {
          uiLine: pack.uiLine,
          packBytes: pack.bytes,
          allowedRoot: pack.allowedRoot,
          ssot: pack.ssot,
          syllabus: pack.syllabus,
          ssotExcerptBytes: pack.ssotExcerptBytes,
          syllabusExcerptBytes: pack.syllabusExcerptBytes,
          memory: pack.memory,
          owners: pack.owners,
        };
      },

      agents: async () =>
        ROSTER.map((a) => ({
          id: a.id,
          name: a.name,
          callSign: a.callSign,
          role: a.role,
          mode: a.mode,
          model: a.model,
        })),
    };

    const registration = await rpc.register(rpcDefinition(), handlers);
    // Keep the registration for the lifetime of the plugin; nothing to dispose eagerly.
    void registration;
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

// ---- agent-callable tools (spec names `get_working_directory` explicitly) ----

type ToolSpec = {
  name: string;
  description: string;
  input: Record<string, unknown>;
  run: (input: any) => any;
};

export function toolSpecs(deps: SurfaceDeps): ToolSpec[] {
  const empty = { type: "object" as const, properties: {}, additionalProperties: false };
  return [
    {
      name: "get_working_directory",
      description: "Return the working directory the ZombieCoder plugin is bound to, plus the .zombiecoder layout.",
      input: empty,
      run: () => ({
        root: deps.projectRoot(),
        zombiecoder: deps.projectRoot() + "/.zombiecoder",
        ssot: ssotFile(deps.projectRoot()),
        syllabus: syllabusFile(deps.projectRoot()),
        memory: memoryDir(deps.projectRoot()),
      }),
    },
    {
      name: "read_ssot",
      description: "Read the generated Single Source of Truth for this project.",
      input: empty,
      run: () => ({ file: ssotFile(deps.projectRoot()), markdown: readText(ssotFile(deps.projectRoot())) ?? "(not generated)" }),
    },
    {
      name: "read_syllabus",
      description: "Read the append-only syllabus for this project.",
      input: empty,
      run: () => ({ file: syllabusFile(deps.projectRoot()), markdown: readSyllabus(deps.projectRoot()) ?? "(not seeded)" }),
    },
    {
      name: "append_syllabus",
      description: "Append a lesson to the syllabus. Append-only: existing content is never modified.",
      input: {
        type: "object" as const,
        properties: { topic: { type: "string" }, summary: { type: "string" } },
        required: ["topic", "summary"],
        additionalProperties: false,
      },
      run: (input: any) => {
        if (!input?.topic || !input?.summary) throw new Error("topic and summary are required");
        return appendSyllabus(deps.projectRoot(), input.topic, input.summary, auditFile(deps.projectRoot()));
      },
    },
    {
      name: "project_fingerprint",
      description: "Scan the project live and return its machine-readable fingerprint. No fingerprint file is created.",
      input: empty,
      run: () => scanProject(deps.projectRoot()),
    },
    {
      name: "context_status",
      description:
        "Show the compact context this agent is working from: SSOT, syllabus and session memory. Call it before substantive work and show the uiLine to the user so context management is visible in the UI.",
      input: {
        type: "object" as const,
        properties: {
          agent: { type: "string", description: "Agent id, when the caller knows it." },
          sessionID: { type: "string", description: "Session id, to include recent kept memory." },
        },
        additionalProperties: false,
      },
      run: async (input: any) => {
        const sessionID = String(input?.sessionID ?? "").trim();
        const recent = sessionID ? await readRecent(deps.storage, sessionID) : [];
        const pack = buildContextPack(deps.projectRoot(), String(input?.agent ?? "unknown"), recent);
        return {
          uiLine: pack.uiLine,
          packBytes: pack.bytes,
          allowedRoot: pack.allowedRoot,
          ssot: pack.ssot,
          syllabus: pack.syllabus,
          memory: pack.memory,
        };
      },
    },
    {
      name: "evidence_gate",
      description:
        "Validate a response or factual claim before calling it PASS. Reuses the installed Python evidence gate; FAIL/SKIP means the claim must be reported as UNVERIFIED, the agent must stop, and the user must get a clear next-step message instead of a silent dead-end.",
      input: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "JSON payload path, relative to the working directory or absolute." },
          kind: {
            type: "string",
            enum: ["auto", "models", "chat", "stream", "responses", "anthropic", "tls", "claim"],
          },
          claim: { type: "string", description: "Inline factual claim; used when file is omitted." },
          evidence: {
            type: "array",
            description: "Inline evidence records for a claim: [{source, observation, verified}].",
            items: { type: "object" },
          },
        },
        required: [],
        additionalProperties: false,
      },
      run: (input: any) => {
        const script = evidenceGateScript(deps.projectRoot());
        if (!script) {
          throw new Error(
            "evidence_gate.py is not installed; run the ZombieCoder installer to copy runtime assets",
          );
        }
        let file: string;
        let ephemeral = false;
        const requested = String(input?.file ?? "").trim();
        if (requested) {
          file = path.isAbsolute(requested)
            ? requested
            : path.resolve(deps.projectRoot(), requested);
        } else if (String(input?.claim ?? "").trim()) {
          const dir = path.join(deps.projectRoot(), ".zombiecoder", ".state");
          fs.mkdirSync(dir, { recursive: true });
          file = path.join(dir, `evidence-gate-${process.pid}-${Date.now()}.json`);
          fs.writeFileSync(
            file,
            JSON.stringify({
              claim: String(input.claim),
              evidence: Array.isArray(input.evidence) ? input.evidence : [],
            }),
            { mode: 0o600 },
          );
          ephemeral = true;
        } else {
          throw new Error("file or claim is required");
        }
        if (!fs.existsSync(file)) throw new Error(`evidence payload not found: ${file}`);
        try {
          const kind = String(input?.kind ?? (ephemeral ? "claim" : "auto"));
          const result = spawnSync(
            "python3",
            [script, "--kind", kind, "--file", file, "--root", deps.projectRoot()],
            {
              encoding: "utf8",
              timeout: 30000,
              maxBuffer: 4 * 1024 * 1024,
            },
          );
          if (result.error) throw new Error(`evidence_gate failed: ${result.error.message}`);
          const stdout = String(result.stdout ?? "").trim();
          if (!stdout) {
            throw new Error(`evidence_gate returned no output (exit ${result.status ?? "unknown"})`);
          }
          try {
            return JSON.parse(stdout);
          } catch {
            throw new Error(`evidence_gate returned non-JSON output: ${stdout.slice(0, 200)}`);
          }
        } finally {
          if (ephemeral) {
            try {
              fs.unlinkSync(file);
            } catch {
              // best-effort cleanup of the ephemeral payload
            }
          }
        }
      },
    },
    {
      name: "memory_archive",
      description:
        "Read archived messages for a session. Read memory/index.json first to see every archive; this tool returns the actual rows.",
      input: {
        type: "object" as const,
        properties: {
          sessionID: { type: "string" },
          limit: { type: "number" },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      run: (input: any) => ({
        sessionID: input?.sessionID,
        entries: readArchive(deps.projectRoot(), String(input?.sessionID ?? ""), input?.limit ?? 50),
      }),
    },
    {
      name: "syntax_check",
      description:
        "LSP-shaped syntax helper: return line/column diagnostics for a snippet before claiming it is valid. Uses JSON.parse, node --check, tsc, python3 compile, bash -n, php -l, then bracket balance.",
      input: {
        type: "object" as const,
        properties: {
          code: { type: "string", description: "Code snippet to check." },
          language: {
            type: "string",
            description: "Language or extension: javascript, typescript, python, bash, php, json, text.",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
      run: async (input: any) => {
        const code = String(input?.code ?? "");
        if (!code.trim()) throw new Error("code is required");
        return syntaxCheck(code, String(input?.language ?? "text"));
      },
    },
    {
      name: "skill_catalog",
      description:
        "List or install shared runtime skills. The catalog covers Laravel, Node, Next, Python, FastAPI, cPanel, resource optimization, server operations, first-principles and evidence-before-confidence. Skills live once at <install>/zombiecoder/skills, shared by every working directory. When the user names a skill or domain, call action=install with its id: the file is fetched from the gate/git catalog if missing, copied into the shared store, and the skill registry reloads. action=auto detects the current project's stack and installs those ids into the same shared store.",
      input: {
        type: "object" as const,
        properties: {
          action: { type: "string", enum: ["list", "install", "auto"] },
          id: { type: "string", description: "Skill id for action=install." },
          ids: { type: "array", items: { type: "string" }, description: "Optional skill ids for action=auto." },
        },
        additionalProperties: false,
      },
      run: async (input: any) => {
        const action = String(input?.action ?? "list");
        const installRoot = deps.installRoot();
        if (action === "list") return listSkillCatalog(installRoot);
        if (action === "auto") {
          const ids = Array.isArray(input?.ids)
            ? input.ids.map((value: any) => String(value)).filter(Boolean)
            : undefined;
          const result = await autoInstallSkills(installRoot, deps.projectRoot(), { ids, download: true });
          await deps.reloadSkills?.();
          return result;
        }
        const id = String(input?.id ?? "").trim();
        if (!id) throw new Error("id is required for action=install");
        const result = await installSharedSkill(installRoot, id, { download: true });
        await deps.reloadSkills?.();
        return result;
      },
    },
    {
      name: "agent_modes",
      description:
        "OpenCode V2 agent modes. Lists the real modes (primary | subagent | all), the builtin agents, the caller's current mode, and plans a validated switch. Read-only: it writes nothing — apply the returned patch through zombiecoder/config.json agentModes and reload.",
      input: {
        type: "object" as const,
        properties: {
          agent: { type: "string", description: "Agent id to inspect, e.g. manu." },
          next: { type: "string", enum: ["primary", "subagent", "all"], description: "Requested mode for a switch plan." },
        },
        additionalProperties: false,
      },
      run: (input: any) => {
        const agent = ROSTER.find((entry) => entry.id === String(input?.agent ?? ""));
        const next = String(input?.next ?? "").trim();
        return {
          modes: AGENT_MODES.map((id) => MODE_REGISTRY[id]),
          builtins: BUILTIN_AGENTS,
          agent: agent ? { id: agent.id, mode: agent.mode } : null,
          plan:
            agent && next
              ? planModeSwitch({ agent: { id: agent.id, mode: agent.mode }, next: next as AgentMode })
              : null,
          note: "Mode is config-level. Apply the patch, then reload/restart; without reload the switch is UNVERIFIED.",
        };
      },
    },
  ];
}

export type ToolRegistration = {
  /** Always empty at registration time; the transform applies after setup returns. */
  registered: string[];
  /** Resolves with what the deferred transform actually applied. */
  applied: Promise<{ registered: string[]; error?: string }>;
  release: () => Promise<void>;
};

export function registerTools(tool: ToolLike | undefined, deps: SurfaceDeps): ToolRegistration {
  if (!tool || typeof tool.transform !== "function") {
    return {
      registered: [],
      applied: Promise.resolve({ registered: [], error: "ctx.tool not available" }),
      release: async () => undefined,
    };
  }
  const specs = toolSpecs(deps);
  // Every ZombieCoder tool returns a JSON object. Declaring the output schema is
  // not optional: OpenCode rejects a result that carries `output` without one.
  const output = { type: "object" as const, additionalProperties: true };
  const kept = keepTransform<any, string[]>(tool as TransformDoor<any>, (editor: any) => {
    const added: string[] = [];
    editor?.namespace?.(TOOL_NAMESPACE);
    const existing = new Set<string>((editor.list?.() ?? []).map((entry: any) => entry?.name).filter(Boolean));
    for (const spec of specs) {
      // OpenCode re-runs transforms on reload. Do not add the same tool twice.
      if (existing.has(spec.name)) {
        added.push(spec.name);
        continue;
      }
      editor.add({
        name: spec.name,
        description: spec.description,
        input: spec.input,
        output,
        options: { namespace: TOOL_NAMESPACE.name },
        execute: async (input: any) => {
          // JSON has no `undefined`. A result such as
          // { id, file, copied, error: undefined } is a valid JS object but an
          // invalid JSON value; OpenCode's output-schema check rejects it.
          const result = await spec.run(input);
          return {
            output: JSON.parse(JSON.stringify(result ?? {})),
            metadata: { source: "zombiecoder", tool: spec.name },
          };
        },
      });
      added.push(spec.name);
    }
    return added;
  });

  const applied = kept.first.then(async (value) => {
    // Only the first apply triggers a reload; later invocations are re-applies.
    if (value !== null) {
      try {
        await tool.reload?.();
      } catch {
        /* reload is a convenience, not the registration itself */
      }
    }
    return {
      registered: value ?? [],
      error: value === null ? kept.error() ?? "tool transform callback did not fire" : kept.error(),
    };
  });

  return { registered: [], applied, release: kept.release };
}

// Audit append is the one thing every surface shares. It lives under .state so
// the project root stays focused on SSOT, syllabus and memory.
export function audit(projectRoot: string, agentID: string, record: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), agent: agentID, ...record };
  appendJsonl(auditFile(projectRoot), redactValue(entry));
}
