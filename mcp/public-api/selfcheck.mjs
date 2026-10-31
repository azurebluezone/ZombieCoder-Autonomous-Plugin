#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../shared/client.mjs";

const MANUAL = [
  ["wiki_search", { query: "tea", limit: 2 }, (r) => {
    assert.ok(r.results.length > 0, "no search results");
    assert.ok(r.results[0].url.startsWith("https://"));
  }],
  ["wiki_page", { title: "Tea" }, (r) => {
    assert.ok((r.extract || "").length > 50, "empty extract");
    assert.match(r.url, /^https:\/\/en\.wikipedia\.org\/wiki\//);
  }],
  ["wiki_onthisday", { limit: 3 }, (r) => {
    assert.ok(r.events.length > 0, "no onthisday events");
    assert.ok(r.events[0].text.length > 10);
  }],
  ["wiki_featured", {}, (r) => {
    assert.ok(r.article?.title, "no featured article");
  }],
  ["weather", { latitude: 23.8103, longitude: 90.4125, days: 2 }, (r) => {
    assert.ok(r.current, "no current weather");
    assert.equal(r.daily.length, 2);
    assert.equal(typeof r.current.temperature_c, "number");
  }],
  ["currency", { from: "USD", to: "BDT" }, (r) => {
    assert.equal(typeof r.rate, "number");
    assert.ok(r.rate > 0);
  }],
  ["country", { name: "Bangladesh" }, (r) => {
    assert.ok(r.matches.length > 0, "no country match");
    assert.equal(r.matches[0].capital, "Dhaka");
    assert.match(r.matches[0].flag, /^https:\/\//);
  }],
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-api-selfcheck-"));
MANUAL.push(["qr", { data: "https://opencode.ai", size: 160, output_dir: dir }, (r) => {
  assert.ok(fs.existsSync(r.file), "qr file missing");
  assert.equal(r.size, 160);
  assert.ok(r.bytes > 100);
}]);

const client = await startServer(path.join(import.meta.dirname, "server.mjs"), { timeoutMs: 60000 });
let failures = 0;
try {
  const init = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "public-api-selfcheck", version: "1" },
  });
  assert.equal(init.serverInfo.name, "public-api");

  const list = await client.request("tools/list", {});
  assert.equal(list.tools.length, 8, `expected 8 tools, got ${list.tools.length}`);

  for (const [name, args, check] of MANUAL) {
    try {
      const result = await client.callTool(name, args);
      check(result);
      console.log(`ok   ${name}`);
    } catch (error) {
      failures += 1;
      console.log(`FAIL ${name}: ${error?.message ?? error}`);
    }
  }
} finally {
  await client.close();
}

if (failures > 0) {
  console.log(`tools=8 live=FAIL failures=${failures}`);
  process.exit(1);
}
console.log("tools=8 live=ok");
console.log(`qr_dir=${dir}`);
