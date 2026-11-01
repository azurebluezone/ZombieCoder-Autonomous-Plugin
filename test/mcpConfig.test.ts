import test from "node:test";
import assert from "node:assert/strict";
import { mcpServerNames, migrateMcpConfig } from "../src/zombie/mcpConfig.ts";

test("migrateMcpConfig moves direct entries under mcp.servers", () => {
  const result = migrateMcpConfig({
    legacy: { type: "local", command: ["node", "legacy.mjs"] },
    remote: { type: "remote", url: "https://example.test/mcp" },
  });
  assert.deepEqual(result.moved.sort(), ["legacy", "remote"]);
  assert.deepEqual(Object.keys(result.mcp.servers).sort(), ["legacy", "remote"]);
  assert.deepEqual(result.mcp.servers.legacy.command, ["node", "legacy.mjs"]);
  assert.equal(result.mcp.servers.remote.url, "https://example.test/mcp");
});

test("migrateMcpConfig keeps an existing mcp.servers entry when a direct one collides", () => {
  const result = migrateMcpConfig({
    servers: { dup: { type: "local", command: ["node", "kept.mjs"] } },
    dup: { type: "local", command: ["node", "ignored.mjs"] },
  });
  assert.deepEqual(result.mcp.servers.dup.command, ["node", "kept.mjs"]);
  assert.deepEqual(result.moved, ["dup"]);
});

test("migrateMcpConfig replaces enabled:false with disabled:true and removes enabled", () => {
  const result = migrateMcpConfig({
    servers: {
      off: { type: "local", command: ["node", "off.mjs"], enabled: false },
      on: { type: "local", command: ["node", "on.mjs"], enabled: true },
    },
  });
  assert.equal(result.mcp.servers.off.disabled, true);
  assert.equal("enabled" in result.mcp.servers.off, false);
  assert.equal("enabled" in result.mcp.servers.on, false);
  assert.deepEqual(result.enabledRemoved.sort(), ["off", "on"]);
  assert.deepEqual(result.disabledAdded, ["off"]);
});

test("migrateMcpConfig reports invalid server entries without inventing fields", () => {
  const result = migrateMcpConfig({
    servers: {
      local: { type: "local" },
      remote: { type: "remote", url: "ftp://example.test/mcp" },
      unknown: { type: "socket" },
      stringy: "not a server",
    },
  });
  assert.deepEqual(result.invalid.map((entry) => entry.name).sort(), [
    "local",
    "remote",
    "stringy",
    "unknown",
  ]);
  assert.deepEqual(Object.keys(result.mcp.servers).sort(), ["local", "remote", "stringy", "unknown"]);
});

test("migrateMcpConfig leaves a non-object input as an empty server map", () => {
  const result = migrateMcpConfig(null);
  assert.deepEqual(result.mcp, { servers: {} });
  assert.deepEqual(result.moved, []);
  assert.deepEqual(result.invalid, []);
});

test("mcpServerNames reads only the V2 shape", () => {
  assert.deepEqual(mcpServerNames({ servers: { a: {}, b: {} } }), ["a", "b"]);
  assert.deepEqual(mcpServerNames({ a: { type: "local" } }), []);
  assert.deepEqual(mcpServerNames(null), []);
});
