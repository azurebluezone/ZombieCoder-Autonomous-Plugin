import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { balanceDiagnostics, extractFencedBlocks, syntaxCheck } from "../src/zombie/lsp.ts";

test("JSON syntax check reports a real error", async () => {
  const ok = await syntaxCheck('{"a":1}', "json");
  assert.equal(ok.ok, true);
  assert.equal(ok.checkedBy, "JSON.parse");
  const bad = await syntaxCheck('{"a":}', "json");
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostics.length, 1);
  assert.ok(bad.diagnostics[0].line >= 1);
});

test("JavaScript syntax check catches an incomplete statement", async () => {
  const ok = await syntaxCheck("const x = 1;\nconsole.log(x);", "javascript");
  assert.equal(ok.ok, true);
  const bad = await syntaxCheck("const x = ;", "javascript");
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.length > 0);
  assert.match(bad.diagnostics[0].message, /SyntaxError|Unexpected|Unexpected token/i);
});

test("TypeScript check accepts valid typed code", async () => {
  const result = await syntaxCheck("const x: number = 1;\nconsole.log(x);", "typescript");
  assert.equal(result.ok, true);
  assert.match(result.checkedBy, /typescript|stripTypeScriptTypes/i);
});

test("bracket balance catches an unclosed block", () => {
  const diagnostics = balanceDiagnostics("function x() {\n  return 1;\n");
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /unclosed/);
});

test("Python syntax check runs when python3 exists", async (t) => {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    t.skip("python3 is not installed");
    return;
  }
  const ok = await syntaxCheck("def f():\n    return 1\n", "python");
  assert.equal(ok.ok, true);
  assert.equal(ok.checkedBy, "python3 compile");
  const bad = await syntaxCheck("def f(:\n    pass\n", "python");
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.length > 0);
});

test("fenced code blocks are extracted with their language", () => {
  const blocks = extractFencedBlocks("text\n```ts\nconst x: number = 1;\n```\n");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].language, "typescript");
  assert.match(blocks[0].code, /const x/);
});
