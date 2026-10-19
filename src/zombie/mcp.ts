// MCP probe — spec §6/§7.
//
// We do not guess whether an MCP URL is alive: we speak the same JSON-RPC the
// runtime speaks. Modern Streamable HTTP first, then the 2024-11-05 header name
// for older servers. The probe is read-only: initialize -> initialized -> tools/list.
// It never calls an arbitrary tool, because a tool can have side effects.

import { PLUGIN_VERSION } from "./io.ts";

export type McpTool = { name: string; description?: string };

export type McpProbeResult = {
  url: string;
  ok: boolean;
  protocolVersion: string | null;
  server: { name?: string; version?: string } | null;
  tools: McpTool[];
  ms: number;
  checkedAt: string;
  error?: string;
};

export type McpProbeOptions = {
  timeoutMs?: number;
  clientName?: string;
};

const DEFAULT_TIMEOUT_MS = 5000;

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
};

function ssePayload(text: string, id: number): JsonRpcResponse {
  // Streamable HTTP may answer with one or more `data:` events. A response can
  // arrive on the same event stream as notifications, so match the id.
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data) as JsonRpcResponse;
      if (message.id === id) return message;
    } catch {
      /* keep looking for a parseable event */
    }
  }
  throw new Error("no JSON-RPC response in SSE stream");
}

export async function probeMcp(url: string, options: McpProbeOptions = {}): Promise<McpProbeResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result: McpProbeResult = {
    url,
    ok: false,
    protocolVersion: null,
    server: null,
    tools: [],
    ms: 0,
    checkedAt: new Date().toISOString(),
  };

  if (!url || !/^https?:\/\//i.test(url)) {
    result.error = "no MCP URL configured";
    return result;
  }

  let sessionID: string | null = null;
  let nextID = 1;

  const rpc = async (method: string, params?: unknown, notification = false): Promise<JsonRpcResponse | null> => {
    const id = notification ? undefined : nextID++;
    const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (id !== undefined) payload.id = id;
    if (params !== undefined) payload.params = params;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(sessionID ? { "mcp-session-id": sessionID } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const sid = response.headers.get("mcp-session-id");
      if (sid) sessionID = sid;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      if (notification) {
        // 202/204 is normal; some servers still send a tiny JSON body.
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const message = contentType.includes("text/event-stream")
        ? ssePayload(await response.text(), id as number)
        : ((await response.json()) as JsonRpcResponse);
      if (message.error) {
        throw new Error(message.error.message ?? JSON.stringify(message.error));
      }
      return message;
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error(`timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // Try the current protocol first, then the widely deployed 2024-11-05.
    let initialized: JsonRpcResponse | null = null;
    let lastError: unknown = null;
    for (const protocolVersion of ["2025-03-26", "2024-11-05"]) {
      try {
        initialized = await rpc("initialize", {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: options.clientName ?? "zombiecoder", version: PLUGIN_VERSION },
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!initialized) throw lastError ?? new Error("initialize failed");

    result.protocolVersion =
      typeof initialized.result?.protocolVersion === "string" ? initialized.result.protocolVersion : null;
    result.server =
      initialized.result?.serverInfo && typeof initialized.result.serverInfo === "object"
        ? initialized.result.serverInfo
        : null;

    // The initialized notification has no id and no response body by spec.
    await rpc("notifications/initialized", undefined, true).catch(() => undefined);

    const listed = await rpc("tools/list", {});
    const tools = Array.isArray(listed?.result?.tools) ? listed.result.tools : [];
    result.tools = tools
      .map((tool: any) => ({
        name: typeof tool?.name === "string" ? tool.name : "",
        description: typeof tool?.description === "string" ? tool.description : undefined,
      }))
      .filter((tool: McpTool) => tool.name.length > 0);
    result.ok = true;
    return result;
  } catch (error: any) {
    result.error = String(error?.message ?? error);
    return result;
  } finally {
    result.ms = Date.now() - started;
  }
}
