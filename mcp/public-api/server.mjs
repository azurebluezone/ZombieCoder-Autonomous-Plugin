#!/usr/bin/env node
/**
 * public-api MCP server (stdio, zero npm dependencies).
 *
 * One tool per source in sources.mjs. Every adapter hits a fixed host, so the
 * caller cannot point this server at an arbitrary URL.
 */

import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { SOURCES, sourceByName, VERSION } from "./sources.mjs";

export const TOOLS = SOURCES.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));

export async function handleRpc(request) {
  const { id, method, params } = request ?? {};

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "public-api", version: VERSION },
      },
    };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const source = sourceByName(name);
    if (!source) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `Error: unknown tool ${JSON.stringify(name)}` }], isError: true },
      };
    }
    try {
      const result = await source.run(params?.arguments ?? {});
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${String(error?.message ?? error)}` }],
          isError: true,
        },
      };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  process.stderr.write(`public-api MCP ${VERSION} (stdio)\n`);
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    chain = chain.then(async () => {
      let request;
      try {
        request = JSON.parse(text);
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
        return;
      }
      if (request.id === undefined || request.id === null) return;
      try {
        process.stdout.write(JSON.stringify(await handleRpc(request)) + "\n");
      } catch (error) {
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: String(error?.message ?? error) } }) + "\n",
        );
      }
    });
  });
  await new Promise((resolve) => rl.on("close", resolve));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
