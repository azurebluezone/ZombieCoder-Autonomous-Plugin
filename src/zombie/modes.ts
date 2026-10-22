// OpenCode V2 agent modes — one registry, one switch planner, one persona block.
//
// Source of truth for the facts below is the V2 documentation (agents page):
//   https://opencode.ai/v2/docs/agents
//   mode            : "primary" | "subagent" | "all"
//   builtin visible : build(primary), plan(primary), general(subagent), explore(subagent)
//   builtin hidden  : compaction, title, summary
//   V2 has no `scout` agent.
//
// This file is deliberately import-free. `roster.ts` imports it to render the
// persona block, and the installer copies `src/zombie/**` as one graph, so a
// relative import here would still work — but a standalone module keeps the
// agent pack copyable without guessing import order.

export type AgentMode = "primary" | "subagent" | "all";

export const AGENT_MODES: readonly AgentMode[] = ["primary", "subagent", "all"];

export type ModeInfo = {
  id: AgentMode;
  label: string;
  /** Selectable as the main agent of a session. */
  asPrimary: boolean;
  /** Launchable by a parent through the `subagent` tool. */
  asSubagent: boolean;
  /** Visible in the interactive agent picker. */
  inPicker: boolean;
  /** One-line Bengali summary used in personas and tool output. */
  summary: string;
  /** Hard limits the agent must not claim to exceed. */
  limits: string[];
};

export const MODE_REGISTRY: Readonly<Record<AgentMode, ModeInfo>> = {
  primary: {
    id: "primary",
    label: "primary",
    asPrimary: true,
    asSubagent: false,
    inPicker: true,
    summary: "session-এর main agent; subagent tool দিয়ে ডাকা যায় না।",
    limits: [
      "`subagent` tool দিয়ে এই এজেন্টকে launch করা যাবে না।",
      "এক session-এ একসাথে একাধিক primary agent চলবে না।",
    ],
  },
  subagent: {
    id: "subagent",
    label: "subagent",
    asPrimary: false,
    asSubagent: true,
    inPicker: false,
    summary: "শুধু child session-এ চলে; picker-এ দেখা যায় না, default_agent হতে পারে না।",
    limits: [
      "ইউজার সরাসরি select করতে পারবে না (picker-এ থাকে না)।",
      "`default_agent` হিসেবে বসানো যাবে না।",
      "parent-এর `subagent` permission allow না থাকলে launch হবে না।",
    ],
  },
  all: {
    id: "all",
    label: "all",
    asPrimary: true,
    asSubagent: true,
    inPicker: true,
    summary: "primary হিসেবেও selectable, parent চাইলে subagent হিসেবেও launchable।",
    limits: [
      "দুটো ভূমিকাই থাকলেও একই session-এ একসাথে দুটো নয়।",
      "subagent হিসেবে ডাকা হলে child-এর নিজের permissions প্রযোজ্য।",
    ],
  },
};

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && (AGENT_MODES as readonly string[]).includes(value);
}

export function modeInfo(mode: AgentMode): ModeInfo {
  return MODE_REGISTRY[mode];
}

export function describeMode(mode: AgentMode): string {
  return isAgentMode(mode) ? MODE_REGISTRY[mode].summary : `unknown mode "${String(mode)}"`;
}

export type BuiltinAgent = {
  id: string;
  mode: AgentMode;
  purpose: string;
  /** Hidden builtins perform maintenance and cannot be selected. */
  hidden?: boolean;
  /** V2 forbids nested subagent launching for these builtins. */
  canLaunchSubagents: boolean;
};

// Only documented builtins. No invented "code"/"builder" mode: in V2 "build" and
// "plan" are agents (both primary), not modes. A six-name mode list would be a lie.
export const BUILTIN_AGENTS: readonly BuiltinAgent[] = [
  {
    id: "build",
    mode: "primary",
    purpose: "Default coding agent; workspace tools allowed, sensitive .env reads ask.",
    canLaunchSubagents: true,
  },
  {
    id: "plan",
    mode: "primary",
    purpose: "Explores and plans without editing normal project files.",
    canLaunchSubagents: true,
  },
  {
    id: "general",
    mode: "subagent",
    purpose: "Research and multi-step work with broad tools; cannot launch subagents.",
    canLaunchSubagents: false,
  },
  {
    id: "explore",
    mode: "subagent",
    purpose: "Searches and reads code or web sources without editing files.",
    canLaunchSubagents: false,
  },
  { id: "compaction", mode: "subagent", purpose: "Context maintenance.", hidden: true, canLaunchSubagents: false },
  { id: "title", mode: "subagent", purpose: "Session title generation.", hidden: true, canLaunchSubagents: false },
  { id: "summary", mode: "subagent", purpose: "Session summary generation.", hidden: true, canLaunchSubagents: false },
];

export type ModeSwitchInput = {
  agent: { id: string; mode: AgentMode };
  next: AgentMode;
  /** Currently configured default agent, when known. */
  defaultAgentId?: string | null;
  /** True when this agent already has a primary session running. */
  sessionRunning?: boolean;
};

export type ModeSwitchPlan = {
  ok: boolean;
  agentID: string;
  from: AgentMode;
  to: AgentMode;
  changed: boolean;
  /** What the caller must write: `agents[id].mode` and the markdown frontmatter. */
  patch: { mode: AgentMode; frontmatter: string };
  /** Human-visible consequences, in the order they matter. */
  warnings: string[];
  /** Reasons the switch must be refused outright. */
  blocked: string[];
  requiresReload: boolean;
  /** Capabilities after the switch; never claim more than this. */
  after: { asPrimary: boolean; asSubagent: boolean; inPicker: boolean };
};

export function planModeSwitch(input: ModeSwitchInput): ModeSwitchPlan {
  const from = input.agent.mode;
  const to = input.next;
  const base: ModeSwitchPlan = {
    ok: false,
    agentID: input.agent.id,
    from,
    to,
    changed: false,
    patch: { mode: from, frontmatter: `mode: ${from}` },
    warnings: [],
    blocked: [],
    requiresReload: false,
    after: {
      asPrimary: isAgentMode(from) ? MODE_REGISTRY[from].asPrimary : true,
      asSubagent: isAgentMode(from) ? MODE_REGISTRY[from].asSubagent : false,
      inPicker: isAgentMode(from) ? MODE_REGISTRY[from].inPicker : true,
    },
  };

  if (!isAgentMode(to)) {
    base.blocked.push(`unknown mode "${String(to)}" — allowed: ${AGENT_MODES.join(", ")}`);
    return base;
  }
  if (!isAgentMode(from)) {
    base.blocked.push(`agent "${input.agent.id}" has invalid current mode "${String(from)}"`);
    return base;
  }

  const info = MODE_REGISTRY[to];
  base.patch = { mode: to, frontmatter: `mode: ${to}` };
  base.after = {
    asPrimary: info.asPrimary,
    asSubagent: info.asSubagent,
    inPicker: info.inPicker,
  };

  if (from === to) {
    base.ok = true;
    base.warnings.push(`already in mode "${to}" — nothing to write`);
    return base;
  }

  if (to === "subagent" && input.defaultAgentId === input.agent.id) {
    base.blocked.push(
      `"${input.agent.id}" is default_agent; a subagent-only agent cannot be the default — pick another default_agent first`,
    );
    return base;
  }

  base.changed = true;
  base.requiresReload = true;

  if (to === "primary") {
    base.warnings.push("আর `subagent` tool দিয়ে ডাকা যাবে না — parent-এর delegation ভাঙবে।");
  }
  if (to === "subagent") {
    base.warnings.push("agent picker থেকে সরে যাবে; শুধু parent-এর `subagent` tool ডাকতে পারবে।");
    if (input.sessionRunning) {
      base.warnings.push("চলমান primary session শেষ হবে না; reload/restart-এর পর নতুন নিয়ম কার্যকর।");
    }
  }
  if (to === "all") {
    base.warnings.push("দুটো ভূমিকা চালু হবে; subagent হিসেবে চলার সময় child-এর নিজের permissions মানতে হবে।");
  }

  base.ok = true;
  return base;
}

/**
 * Apply `agentModes` overrides from config onto the roster. Unknown ids and
 * invalid modes are rejected, never guessed — a typo must not silently produce
 * a half-switched team.
 */
export function applyModeOverrides<T extends { id: string; mode: AgentMode }>(
  agents: readonly T[],
  overrides?: Record<string, string> | null,
): { agents: T[]; applied: Record<string, AgentMode>; rejected: Array<{ agent: string; reason: string }> } {
  const applied: Record<string, AgentMode> = {};
  const rejected: Array<{ agent: string; reason: string }> = [];
  const known = new Set(agents.map((a) => a.id));
  const next = agents.map((agent) => ({ ...agent }));

  for (const [agentID, raw] of Object.entries(overrides ?? {})) {
    if (!known.has(agentID)) {
      rejected.push({ agent: agentID, reason: "unknown agent id" });
      continue;
    }
    if (!isAgentMode(raw)) {
      rejected.push({ agent: agentID, reason: `unknown mode "${String(raw)}" — allowed: ${AGENT_MODES.join(", ")}` });
      continue;
    }
    const target = next.find((agent) => agent.id === agentID)!;
    const plan = planModeSwitch({ agent: target, next: raw });
    if (!plan.ok) {
      rejected.push({ agent: agentID, reason: plan.blocked.join("; ") || "switch refused" });
      continue;
    }
    target.mode = raw;
    applied[agentID] = raw;
  }

  return { agents: next, applied, rejected };
}

/** Persona block. Every agent gets the real mode list and its own limits. */
export function modeProtocol(mode: AgentMode): string {
  const info = isAgentMode(mode) ? MODE_REGISTRY[mode] : MODE_REGISTRY.primary;
  return [
    "### Mode protocol (OpenCode V2)",
    `- Mode মাত্র তিনটি: \`primary\` | \`subagent\` | \`all\`. তোমার current mode: \`${info.id}\` — ${info.summary}`,
    "- Builtin agent: `build`/`plan` = primary, `general`/`explore` = subagent; `compaction`/`title`/`summary` hidden; V2-তে `scout` নেই।",
    "- তুমি নিজের mode নিজে বদলাতে পারো না — এটা config-level। `agentModes` config বা `planModeSwitch()` plan ছাড়া mode বদলানোর দাবি করবে না।",
    "- Subagent ডাকা যাবে শুধু `subagent` permission `allow` থাকলে; child fresh context পায় এবং তার নিজের permissions মানে।",
    "- পারবে না: নতুন mode বানানো; `subagent`-only এজেন্টকে `default_agent` বানানো; V1 field (`permission`, `tools`, `maxSteps`, `temperature`) ব্যবহার; `general`-কে subagent spawn করতে বলা।",
    `- এই mode-এর সীমা: ${info.limits.join(" ")}`,
    "- Mode বদলের পর reload/restart না হলে \"switched\" বলো না — `UNVERIFIED`।",
  ].join("\n");
}
