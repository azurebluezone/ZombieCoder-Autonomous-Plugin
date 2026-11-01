// OpenCode V2 MCP config shape.
//
// V2 expects every server under `mcp.servers` and uses `disabled`, not
// `enabled`. Older configs (and V1 examples) put server names directly under
// `mcp` and write `enabled: true`. V2 silently ignores both, so the agent sees
// no tools. This module migrates the shape without dropping an owner's server.

export type McpMigration = {
  mcp: Record<string, any>;
  moved: string[];
  enabledRemoved: string[];
  disabledAdded: string[];
  invalid: { name: string; reason: string }[];
};

function isServerEntry(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, any>;
  return "type" in entry || "command" in entry || "url" in entry;
}

function serverProblem(name: string, entry: Record<string, any>): string | null {
  const type = String(entry.type ?? "").trim();
  if (type === "local") {
    if (!Array.isArray(entry.command) || entry.command.length === 0) return "local server needs a non-empty command array";
    if (entry.command.some((part: unknown) => typeof part !== "string")) return "command entries must be strings";
    return null;
  }
  if (type === "remote") {
    if (typeof entry.url !== "string" || !/^https?:\/\//.test(entry.url)) return "remote server needs an http(s) url";
    return null;
  }
  return name ? `unknown type ${JSON.stringify(entry.type)}; use local or remote` : "unknown type";
}

export function migrateMcpConfig(raw: unknown): McpMigration {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const servers: Record<string, Record<string, any>> = {
    ...(source.servers && typeof source.servers === "object" && !Array.isArray(source.servers)
      ? source.servers
      : {}),
  };
  const moved: string[] = [];
  const enabledRemoved: string[] = [];
  const disabledAdded: string[] = [];

  for (const [name, value] of Object.entries(source)) {
    if (name === "servers") continue;
    if (!isServerEntry(value)) continue;
    if (!(name in servers)) servers[name] = { ...(value as Record<string, any>) };
    moved.push(name);
  }

  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if ("enabled" in entry) {
      const enabled = entry.enabled;
      delete entry.enabled;
      enabledRemoved.push(name);
      if (enabled === false && entry.disabled === undefined) {
        entry.disabled = true;
        disabledAdded.push(name);
      }
    }
  }

  const invalid: { name: string; reason: string }[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    const problem = serverProblem(name, entry);
    if (problem) invalid.push({ name, reason: problem });
  }

  return { mcp: { servers }, moved, enabledRemoved, disabledAdded, invalid };
}

export function mcpServerNames(mcp: unknown): string[] {
  if (!mcp || typeof mcp !== "object") return [];
  const servers = (mcp as Record<string, any>).servers;
  if (!servers || typeof servers !== "object") return [];
  return Object.keys(servers);
}
