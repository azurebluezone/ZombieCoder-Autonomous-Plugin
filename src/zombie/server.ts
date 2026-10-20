// Spec §6 + §7 — the in-plugin control surface.
//
// Two documented OpenCode doors are used, nothing invented:
//   ctx.rpc.register  -> reachable over HTTP at POST /api/rpc/{rpcID}/{method}
//   ctx.tool.transform -> tools the agents themselves can call
//
// Every handler is pure: it reads the working directory, returns data, and never
// mutates OpenCode's own state. The single exception is `syllabus_append`, which is
// append-only by construction.

import { auditFile, memoryDir, ssotFile, syllabusFile } from "./paths.ts";
import { appendJsonl, readJsonl, readText, redactValue, PLUGIN_VERSION } from "./io.ts";
import { readArchive, readIndex, readRecent, archiveSummary, type StorageLike } from "./memory.ts";
import { appendSyllabus, readSyllabus } from "./syllabus.ts";
import { scanProject } from "./scan.ts";
import { keepTransform, type TransformDoor } from "./transform.ts";
import { ROSTER } from "../roster.ts";

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
  storage: StorageLike;
  refreshSsot: () => { sha256: string; file: string; bytes: number };
  modelPlan: () => unknown;
};

const obj = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  additionalProperties: false,
});

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
        execute: async (input: any) => ({
          output: spec.run(input),
          metadata: { source: "zombiecoder", tool: spec.name },
        }),
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
