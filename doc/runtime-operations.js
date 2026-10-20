// ZombieCoder — runtime operations as data.
// The plugin has one process and uses OpenCode's existing doors. No second
// server, no second state store, no hidden permission wall.

export const RUNTIME_OPERATIONS = Object.freeze({
  architecture: {
    provider: "OpenAI-compatible URL",
    mcp: "JSON-RPC 2.0 over Streamable HTTP",
    no_second_server: true,
    source_of_truth: "TypeScript/JavaScript source",
    generated_artifacts: ["agent markdown", "SSOT", "syllabus", "opencode.json"],
  },
  protocols: {
    openai: {
      probe: "GET {base}/v1/models",
      chat: "POST {base}/v1/chat/completions",
      tool_call_contract: "choices[0].message.tool_calls",
      optional: ["/v1/completions", "/v1/embeddings", "/v1/responses"],
    },
    mcp: {
      initialize: true,
      initialized: true,
      tools_list: true,
      tools_call: "only after the user/agent explicitly selects a tool",
    },
  },
  surfaces: [
    "ctx.location",
    "ctx.storage",
    "ctx.session.hook",
    "ctx.skill",
    "ctx.rpc",
    "ctx.tool",
    "ctx.agent",
    "ctx.mcp",
  ],
  model_fallback: [
    "Configured provider: probe its own base URL, not a catalog guess.",
    "Empty /v1/models is unusable; do not map an agent to a dead provider.",
    "OpenCode catalog: keep models with cost.input == 0 and cost.output == 0.",
    "Baseline: opencode/big-pickle, used only when no free model exists.",
    "Mapping: deterministic stable hash of the agent id by default.",
    "Never emit provider/undefined.",
  ],
  blockers_to_report: [
    "missing provider URL",
    "DNS failure",
    "TLS verification failure",
    "HTTP 401/403",
    "empty /v1/models",
    "missing native tool_calls",
    "MCP initialize/tools/list failure",
    "missing local agent roster",
    "missing nginx binary or certificate",
  ],
  evidence: {
    pass_only_with: ["command", "exit code", "HTTP status", "payload shape"],
    labels: [
      "SOURCE_VERIFIED",
      "CONFIG_VALIDATED",
      "LIVE_PROBE_PASSED",
      "END_TO_END_TESTED",
      "NOT_TESTED",
      "UNVERIFIED",
    ],
  },
});

export default RUNTIME_OPERATIONS;
