// Tests for the compact context pack and the hard response gate.
//
// These are test-only harnesses: they build a temporary project, never touch the
// real working directory, and do not contact any provider.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContextPack, resolveAllowedPath } from "../src/zombie/context.ts";
import {
  applyResponseGate,
  evaluateResponse,
  parseResponseBody,
} from "../src/zombie/responseGate.ts";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-context-"));
}

function seedProject(): string {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder", "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "SSOT.md"),
    [
      "# SSOT — Single Source of Truth",
      "",
      "## 1. Project",
      "| Field | Value |",
      "| Name | test-project |",
      "",
      "## 2. Detected technologies",
      "| TypeScript | 27 |",
      "",
      "## 3. Structure (depth ≤ 6)",
      "```text",
      "src/",
      "test/",
      "```",
      "",
      "## 7. Agent team (shared persona)",
      "9 primary agents.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "syllabus.md"),
    [
      "# ZombieCoder Syllabus",
      "",
      "## 1. Scope",
      "Standing rules for this project.",
      "",
      "## 3. Agents bound",
      "manu, jarin, brishti, rashed, halim, majnu, nila, tuhin, zombiecoder",
      "",
      "## 5. Lessons (append-only)",
      "### 2026-10-21 — evidence gate",
      "A claim without an evidence array is UNVERIFIED.",
      "",
    ].join("\n"),
  );
  return root;
}

test("context pack merges SSOT, syllabus and memory into a bounded pack", () => {
  const root = seedProject();
  const pack = buildContextPack(root, "manu", [
    { role: "user", text: "check the API contract", at: new Date().toISOString() },
    { role: "assistant", text: "SSOT says the root is the working directory.", at: new Date().toISOString() },
  ]);
  assert.match(pack.text, /ZombieCoder Compact Context Pack/);
  assert.match(pack.text, /### SSOT/);
  assert.match(pack.text, /### Syllabus/);
  assert.match(pack.text, /### Session memory \(2 recent, 0 archives\)/);
  assert.match(pack.text, /Allowed root: /);
  assert.ok(pack.bytes > 0 && pack.bytes <= 6200, `pack must stay bounded, got ${pack.bytes}`);
  assert.match(pack.uiLine, /Context: SSOT OK \| Syllabus OK \| Memory 2 recent/);
  assert.equal(pack.ssot.exists, true);
  assert.equal(pack.syllabus.exists, true);
  assert.equal(pack.allowedRoot, root);
});

test("context pack marks missing SSOT instead of inventing content", () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  const pack = buildContextPack(root, "jarin", []);
  assert.match(pack.text, /Missing: /);
  assert.match(pack.uiLine, /SSOT MISSING/);
  assert.equal(pack.ssot.exists, false);
});

test("resolveAllowedPath denies paths outside the allowed root", () => {
  const root = seedProject();
  assert.ok(resolveAllowedPath(root, "src/plugin.ts:759"));
  assert.ok(resolveAllowedPath(root, path.join(root, "src/plugin.ts")));
  assert.equal(resolveAllowedPath(root, "../outside/file.ts"), null);
  assert.equal(resolveAllowedPath(root, "/etc/hosts"), null);
  assert.equal(resolveAllowedPath(root, "https://example.com/file.ts"), null);
});

test("response gate blocks an unproven claim and passes real evidence", () => {
  const root = seedProject();
  const claim = "I fixed the bug in the login flow, the issue was the poll timer and the stale HTML.";
  const blocked = evaluateResponse(claim, { allowedRoot: root });
  assert.equal(blocked.passed, false);
  assert.match(blocked.reason, /claim without evidence/);

  const proven = evaluateResponse(
    "The root cause is in src/plugin.ts:759 and the fix passed 45/45 tests.",
    { allowedRoot: root },
  );
  assert.equal(proven.passed, true);
  assert.ok(proven.matched.length > 0);

  const outside = evaluateResponse(
    "I changed the config in ../outside/file.ts:10 and the bug is fixed now.",
    { allowedRoot: root },
  );
  assert.equal(outside.passed, false);
  assert.ok(outside.violations.length > 0);

  const urlOnly = evaluateResponse(
    "I fixed the bug in the login flow; see https://example.com/src/plugin.ts:759 for the patch.",
    { allowedRoot: root },
  );
  assert.equal(urlOnly.passed, false, "a remote URL is not local file evidence");

  const honest = evaluateResponse("প্রমাণ নেই, তাই আমি নিশ্চিত না — status UNVERIFIED.", {
    allowedRoot: root,
  });
  assert.equal(honest.passed, true);
  assert.match(honest.reason, /lack of proof/);

  const explanatory = evaluateResponse(
    "Here is how the provider fallback works: the plugin tries the baseline model first.",
    { allowedRoot: root },
  );
  assert.equal(explanatory.passed, true);
  assert.match(explanatory.reason, /explanatory/);
});

test("parseResponseBody extracts OpenAI JSON and SSE assistant text", () => {
  const json = parseResponseBody(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hello from JSON" } }],
    }),
    "application/json",
  );
  assert.equal(json.protocol, "openai-chat");
  assert.equal(json.supported, true);
  assert.equal(json.text, "hello from JSON");

  const sse = parseResponseBody(
    [
      'data: {"choices":[{"delta":{"role":"assistant","content":"hello "}}]}',
      'data: {"choices":[{"delta":{"content":"world"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"),
    "text/event-stream",
  );
  assert.equal(sse.protocol, "openai-sse");
  assert.equal(sse.supported, true);
  assert.equal(sse.text, "hello world");

  const plain = parseResponseBody("not a provider payload", "text/plain");
  assert.equal(plain.supported, false);
});

test("applyResponseGate rewrites an unproven JSON answer and passes a proven one", async () => {
  const root = seedProject();
  const claim = "I fixed the bug in the login flow, the issue was the poll timer and the stale HTML.";
  const jsonResponse = new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: claim } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const blocked = await applyResponseGate(jsonResponse, { allowedRoot: root });
  assert.equal(blocked.verdict.passed, false);
  const blockedBody = await blocked.response.text();
  assert.match(blockedBody, /UNVERIFIED/);
  assert.equal(JSON.parse(blockedBody).choices[0].message.content.includes("UNVERIFIED"), true);

  const provenResponse = new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: "The root cause is in src/plugin.ts:759 and the fix passed 45/45 tests.",
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const passed = await applyResponseGate(provenResponse, { allowedRoot: root });
  assert.equal(passed.verdict.passed, true);
  assert.equal((await passed.response.text()).includes("root cause"), true);
});

test("applyResponseGate rewrites an unproven SSE stream into a truthful stream", async () => {
  const root = seedProject();
  const claim = "I fixed the bug in the login flow, the issue was the poll timer and the stale HTML.";
  const sse = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: claim } }] })}`,
    "data: [DONE]",
    "",
  ].join("\n");
  const response = new Response(sse, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  const result = await applyResponseGate(response, { allowedRoot: root });
  assert.equal(result.verdict.passed, false);
  const body = await result.response.text();
  assert.match(body, /UNVERIFIED/);
  assert.match(body, /^data: /m);
});
