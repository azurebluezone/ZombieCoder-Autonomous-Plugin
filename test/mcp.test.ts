import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { probeMcp } from "../src/zombie/mcp.ts";

function startMcp(run: (base: string) => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const message = JSON.parse(body || "{}");
        if (message.method === "notifications/initialized") {
          res.writeHead(202).end();
          return;
        }
        const base = { jsonrpc: "2.0", id: message.id ?? null };
        if (message.method === "initialize") {
          res.setHeader("mcp-session-id", "test-session");
          res.end(
            JSON.stringify({
              ...base,
              result: {
                protocolVersion: "2025-03-26",
                capabilities: {},
                serverInfo: { name: "test-mcp", version: "1.0.0" },
              },
            }),
          );
          return;
        }
        if (message.method === "tools/list") {
          res.end(JSON.stringify({ ...base, result: { tools: [{ name: "echo", description: "Echo." }] } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...base, error: { code: -32601, message: "unknown" } }));
      });
    });
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/mcp`;
      try {
        await run(base);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test("probeMcp lists tools over Streamable HTTP", async () => {
  await startMcp(async (url) => {
    const result = await probeMcp(url, { timeoutMs: 3000 });
    assert.equal(result.ok, true);
    assert.equal(result.protocolVersion, "2025-03-26");
    assert.deepEqual(result.tools.map((tool) => tool.name), ["echo"]);
  });
});

test("probeMcp refuses an empty URL without touching the network", async () => {
  const result = await probeMcp("");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no MCP URL/);
});
