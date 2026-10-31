import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS, handleRpc } from "../server.mjs";
import {
  clampInt,
  cleanHtml,
  coordinate,
  isoDate,
  langCode,
  titleSlug,
  weatherText,
} from "../sources.mjs";

test("server exposes the eight public-data tools", () => {
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    ["wiki_search", "wiki_page", "wiki_onthisday", "wiki_featured", "weather", "currency", "country", "qr"],
  );
  for (const tool of TOOLS) assert.equal(tool.inputSchema.type, "object");
});

test("language codes reject path and scheme tricks", () => {
  assert.equal(langCode("bn"), "bn");
  assert.equal(langCode("zh-yue"), "zh-yue");
  for (const bad of ["EN!", "../x", "en/us", "e", ""]) assert.throws(() => langCode(bad), /invalid language code/);
});

test("numeric arguments are clamped and validated", () => {
  assert.equal(clampInt("7", 3, 1, 10), 7);
  assert.equal(clampInt(99, 3, 1, 10), 10);
  assert.equal(clampInt(undefined, 3, 1, 10), 3);
  assert.throws(() => clampInt("abc", 3, 1, 10), /integer/);
  assert.equal(coordinate(23.81, "latitude", -90, 90), 23.81);
  assert.throws(() => coordinate(123, "latitude", -90, 90), /between/);
});

test("dates must be real calendar dates", () => {
  assert.equal(isoDate("2026-10-31").toISOString().slice(0, 10), "2026-10-31");
  assert.throws(() => isoDate("2026-02-30"), /invalid calendar date/);
  assert.throws(() => isoDate("31-10-2026"), /YYYY-MM-DD/);
});

test("helpers clean html, map weather codes and slug titles", () => {
  assert.equal(cleanHtml("<b>Tea</b> &amp; coffee"), "Tea & coffee");
  assert.equal(weatherText(0), "Clear sky");
  assert.equal(weatherText(61), "Slight rain");
  assert.match(weatherText(1234), /WMO 1234/);
  assert.equal(titleSlug("Black tea"), "Black_tea");
  assert.throws(() => titleSlug("  "), /title is required/);
});

test("unknown tool and bad arguments return isError, not a crash", async () => {
  const unknown = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope", arguments: {} } });
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0].text, /unknown tool/);

  const bad = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wiki_search", arguments: {} } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /query is required/);

  const badLang = await handleRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "wiki_page", arguments: { title: "Tea", lang: "../etc" } },
  });
  assert.equal(badLang.result.isError, true);
  assert.match(badLang.result.content[0].text, /invalid language code/);

  const badCoord = await handleRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "weather", arguments: { latitude: 900, longitude: 0 } },
  });
  assert.equal(badCoord.result.isError, true);
  assert.match(badCoord.result.content[0].text, /latitude must be a number/);
});

test("initialize and tools/list answer over the JSON-RPC surface", async () => {
  const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(init.result.serverInfo.name, "public-api");
  assert.equal(init.result.capabilities.tools !== undefined, true);

  const list = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(list.result.tools.length, 8);

  const missing = await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" });
  assert.equal(missing.error.code, -32601);
});
