// Tests for the compact context pack and the hard response gate.
//
// These are test-only harnesses: they build a temporary project, never touch the
// real working directory, and do not contact any provider.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildContextPack,
  CONTEXT_LIMITS,
  resolveAllowedPath,
  stripHomePath,
} from "../src/zombie/context.ts";
import {
  applyResponseGate,
  evaluateResponse,
  isStandInPath,
  parseResponseBody,
  resolveEvidencePath,
} from "../src/zombie/responseGate.ts";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-context-"));
}

function seedProject(): string {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder", "memory"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "plugin.ts"),
    Array.from({ length: 800 }, (_, index) => `// line ${index + 1}`).join("\n") + "\n",
  );
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
      "9 all agents.",
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
  assert.ok(pack.bytes > 0 && pack.bytes <= CONTEXT_LIMITS.total, `pack must stay bounded, got ${pack.bytes}`);
  assert.match(pack.uiLine, /Context: SSOT OK \(manu\) \| Syllabus OK \(halim\) \| Memory 2 recent/);
  assert.equal(pack.ssot.exists, true);
  assert.equal(pack.syllabus.exists, true);
  assert.ok(
    pack.ssotExcerptBytes > 0 && pack.ssotExcerptBytes < pack.ssot.bytes,
    `SSOT prompt excerpt must be smaller than the file, got ${pack.ssotExcerptBytes}/${pack.ssot.bytes}`,
  );
  assert.ok(
    pack.syllabusExcerptBytes > 0 && pack.syllabusExcerptBytes < pack.syllabus.bytes,
    `syllabus prompt excerpt must be smaller than the file, got ${pack.syllabusExcerptBytes}/${pack.syllabus.bytes}`,
  );
  assert.match(pack.text, /### SSOT excerpt \(\d+B from a \d+B file/);
  assert.doesNotMatch(pack.text, /## 7\. Agent team/, "manu's focused excerpt must not include unrelated SSOT sections");
  assert.doesNotMatch(pack.text, /Standing rules for this project/, "only the lessons tail belongs in the prompt");
  assert.equal(pack.allowedRoot, root);
  assert.equal(pack.owners.ssot.agent, "manu");
  assert.equal(pack.owners.syllabus.agent, "halim");
  assert.equal(pack.owners.memory.agent, "zombiecoder");
  assert.match(pack.uiLine, /SSOT OK \(manu\)/);
  assert.match(pack.uiLine, /Syllabus OK \(halim\)/);
  assert.match(pack.text, /### Context ownership/);
});

test("context pack marks missing SSOT instead of inventing content", () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  const pack = buildContextPack(root, "jarin", []);
  assert.match(pack.text, /Missing: /);
  assert.match(pack.uiLine, /SSOT MISSING/);
  assert.equal(pack.ssot.exists, false);
  assert.equal(pack.ssotExcerptBytes, 0);
  assert.equal(pack.syllabusExcerptBytes, 0);
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
  assert.match(outside.reason, /does not exist/);

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

test("response gate keeps authentic test output and rejects a stand-in-only done claim", () => {
  const root = seedProject();
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  fs.mkdirSync(path.join(root, "mocks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "test", "checkout.test.ts"),
    Array.from({ length: 40 }, (_, index) => `// test line ${index + 1}`).join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(root, "mocks", "payment.mock.ts"),
    Array.from({ length: 30 }, (_, index) => `// mock line ${index + 1}`).join("\n") + "\n",
  );

  // A real test file is evidence of a real run. Directory "test/" is not a sin.
  const realTest = evaluateResponse(
    "The checkout test passes: test/checkout.test.ts:12.",
    { allowedRoot: root },
  );
  assert.equal(realTest.passed, true);
  assert.ok(realTest.matched.length > 0);

  // The disease: the mock is the only thing exercised, yet the answer says done.
  const standIn = evaluateResponse(
    "I fixed the checkout bug; mocks/payment.mock.ts:9 returns 200.",
    { allowedRoot: root },
  );
  assert.equal(standIn.passed, false);
  assert.match(standIn.reason, /stand-in only/);

  // Honest status report: no outcome claim, real input explicitly not tested.
  const honest = evaluateResponse(
    "FIXTURE_ONLY — mocks/payment.mock.ts:9 passes; the real payment endpoint is NOT_TESTED.",
    { allowedRoot: root },
  );
  assert.equal(honest.passed, true);

  assert.equal(isStandInPath(path.join(root, "mocks", "payment.mock.ts"), root), true);
  assert.equal(isStandInPath(path.join(root, "test", "checkout.test.ts"), root), false);
  assert.equal(isStandInPath(path.join(root, "src", "plugin.ts"), root), false);
});

test("response gate blocks a short Bengali success claim", () => {
  const root = seedProject();
  const blocked = evaluateResponse("ফিক্স করেছি, টেস্ট পাস করেছে।", {
    allowedRoot: root,
  });
  assert.equal(blocked.passed, false);
  assert.match(blocked.reason, /claim without evidence/);
});

test("response gate lets a Bengali explanation through", () => {
  const root = seedProject();
  const ok = evaluateResponse("এই ফাংশনটা ঠিক করার উপায় হলো পাথ যাচাই করা।", {
    allowedRoot: root,
  });
  assert.equal(ok.passed, true);
});

test("response gate treats a diagnosis as an explanation, not a success claim", () => {
  const root = seedProject();
  // Regression: these ordinary diagnostic sentences were classified as
  // unproven success claims and replaced by the UNVERIFIED message.
  const cases = [
    "ভাইয়া, সমস্যা হলো মেমোরি ফাইল প্রতিবার পুরোটা আবার লেখা হচ্ছে।",
    "The problem is the context hook runs on every request.",
    "The root cause is that the gate buffers the whole response body.",
  ];
  for (const text of cases) {
    const verdict = evaluateResponse(text, { allowedRoot: root });
    assert.equal(verdict.passed, true, `diagnosis must pass: ${text}`);
  }
});

test("response gate still blocks real action claims after narrowing the markers", () => {
  const root = seedProject();
  const claims = [
    "আমি ঠিক করেছি, এখন কনফিগারেশন ঠিকভাবে লোড হবে।",
    "I fixed it and deployed the build.",
    "The bug is fixed now.",
  ];
  for (const text of claims) {
    const verdict = evaluateResponse(text, { allowedRoot: root });
    assert.equal(verdict.passed, false, `claim must block: ${text}`);
  }
});

test("provider-facing pack replaces the OS home directory with ~", () => {
  const root = seedProject();
  const home = os.homedir();
  fs.appendFileSync(
    path.join(root, ".zombiecoder", "syllabus.md"),
    `\n### local path\nWorking copy at ${home}/secret-project\n`,
  );
  const pack = buildContextPack(root, "manu");
  assert.ok(!pack.text.includes(home), "home directory leaked into the provider pack");
  assert.match(pack.text, /~\/secret-project/);
  assert.equal(pack.allowedRoot, root, "tools keep the real absolute path");
  assert.equal(stripHomePath(`${home}/x`, home), "~/x");
  assert.equal(stripHomePath("nothing to strip", home), "nothing to strip");
});

test("context pack reuses the cached SSOT snapshot until the file changes", () => {
  const root = seedProject();
  const first = buildContextPack(root, "manu");
  const second = buildContextPack(root, "manu");
  assert.equal(second.ssot.sha256, first.ssot.sha256);
  assert.equal(second.ssot, first.ssot, "unchanged file must reuse the cached status");

  fs.appendFileSync(path.join(root, ".zombiecoder", "SSOT.md"), "\n## 3. Structure\nchanged\n");
  const third = buildContextPack(root, "manu");
  assert.notEqual(third.ssot.sha256, first.ssot.sha256);
  assert.notEqual(third.ssot, first.ssot);
});

test("response gate rejects a file path that does not exist", () => {
  const root = seedProject();
  const fake = evaluateResponse(
    "I fixed the bug in src/ghost.ts:42 and the suite passed 45/45 tests.",
    { allowedRoot: root },
  );
  assert.equal(fake.passed, false);
  assert.match(fake.reason, /does not exist/);
});

test("response gate blocks a short success claim instead of treating it as trivial", () => {
  const root = seedProject();
  const short = evaluateResponse("সব ঠিক আছে", { allowedRoot: root });
  assert.equal(short.passed, false);
  assert.match(short.reason, /short claim without evidence/);

  const shortEnglish = evaluateResponse("Everything works now", { allowedRoot: root });
  assert.equal(shortEnglish.passed, false);

  const shortInstalled = evaluateResponse("ভাইয়া installed", { allowedRoot: root });
  assert.equal(shortInstalled.passed, false);
  assert.match(shortInstalled.reason, /short claim without evidence/);

  const greeting = evaluateResponse("OK", { allowedRoot: root });
  assert.equal(greeting.passed, true);
  assert.match(greeting.reason, /trivial/);
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

  const anthropic = parseResponseBody(
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
    "text/event-stream",
  );
  assert.equal(anthropic.protocol, "anthropic-sse");
  assert.equal(anthropic.supported, false);
  assert.equal(anthropic.text, "hello");

  const responses = parseResponseBody(
    'data: {"type":"response.output_text.delta","delta":"hi"}',
    "text/event-stream",
  );
  assert.equal(responses.protocol, "responses-sse");
  assert.equal(responses.supported, false);
  assert.equal(responses.text, "hi");
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
  assert.match(blockedBody, /এজেন্টকে থামানো হয়েছে/);
  assert.match(blockedBody, /কাজ তো এই সমস্যা হয়েছে/);
  assert.match(blockedBody, /এখন কী করব/);
  assert.match(blockedBody, /path:line/);
  const blockedJson = JSON.parse(blockedBody);
  assert.equal(blockedJson.choices[0].message.content.includes("UNVERIFIED"), true);
  assert.equal(blockedJson.choices[0].finish_reason, "stop");

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

test("applyResponseGate streams an unproven answer through and annotates it", async () => {
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
  assert.equal(result.streamed, true, "SSE body must not be buffered");
  assert.equal(result.verdict.passed, true, "provisional verdict is pending, not a block");

  const body = await result.response.text();
  // The real answer is preserved; the correction is appended, not substituted.
  assert.match(body, /I fixed the bug in the login flow/);
  assert.match(body, /UNVERIFIED/);
  assert.match(body, /এজেন্টকে থামানো হয়েছে/);
  assert.match(body, /কাজ তো এই সমস্যা হয়েছে/);
  assert.match(body, /এখন কী করব/);
  assert.match(body, /^data: /m);
  // The advisory lands before the terminal marker.
  assert.ok(body.indexOf("UNVERIFIED") < body.indexOf("[DONE]"));

  const final = await result.settled;
  assert.equal(final.verdict.passed, false);
  assert.match(final.verdict.reason, /claim without evidence/);
});

test("applyResponseGate does not buffer a live stream", async () => {
  const root = seedProject();
  let push!: (text: string) => void;
  let close!: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (text) => controller.enqueue(new TextEncoder().encode(text));
      close = () => controller.close();
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

  const result = await applyResponseGate(response, { allowedRoot: root });
  const reader = result.response.body!.getReader();
  const decoder = new TextDecoder();

  push(`data: ${JSON.stringify({ choices: [{ delta: { content: "প্রথম টোকেন" } }] })}\n\n`);

  // If the gate buffered the body this read would hang until close(). A timeout
  // turns that regression into a failed assertion instead of a stuck test.
  const first = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stream was buffered")), 1000)),
  ]);
  assert.match(decoder.decode(first.value), /প্রথম টোকেন/);

  push(`data: ${JSON.stringify({ choices: [{ delta: { content: " I fixed the parser" } }] })}\n\n`);
  push("data: [DONE]\n\n");
  close();

  let rest = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    rest += decoder.decode(next.value);
  }
  assert.match(rest, /I fixed the parser/);
  assert.match(rest, /UNVERIFIED/);
  const final = await result.settled;
  assert.equal(final.verdict.passed, false);
});

test("response gate skips an intermediate tool-call turn instead of killing the chain", async () => {
  const root = seedProject();
  // Real regression: this exact prose was gated on a tool turn and the gate
  // rewrote finish_reason to "stop", ending the task mid-flight.
  const progress = "এখন edit.blade.php আর shipment.blade.php-এ একই পরিবর্তন করি";
  const sse = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: progress }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "edit", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}`,
    "data: [DONE]",
    "",
  ].join("\n");
  const sseResponse = new Response(sse, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  const parsed = parseResponseBody(sse, "text/event-stream");
  assert.equal(parsed.toolCalls, true);

  const sseResult = await applyResponseGate(sseResponse, { allowedRoot: root });
  assert.equal(sseResult.verdict.passed, true);
  assert.match(sseResult.verdict.reason, /streaming|tool-call turn/);
  assert.equal(sseResult.streamed, true);
  const toolBody = await sseResult.response.text();
  assert.match(toolBody, /finish_reason":"tool_calls/);
  assert.equal(toolBody.includes("UNVERIFIED"), false, "a tool turn must not be annotated");
  assert.equal((await sseResult.settled).verdict.passed, true);

  const jsonResponse = new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: "I fixed the login bug.",
            tool_calls: [{ id: "call_2", type: "function", function: { name: "read", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const jsonResult = await applyResponseGate(jsonResponse, { allowedRoot: root });
  assert.equal(jsonResult.verdict.passed, true);
  assert.equal(jsonResult.response, jsonResponse);

  // The final answer (no tool call) must still be gated.
  const finalSse = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: progress } }] })}`,
    "data: [DONE]",
    "",
  ].join("\n");
  const finalResult = await applyResponseGate(
    new Response(finalSse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    { allowedRoot: root },
  );
  // The body must be consumed: a streamed verdict settles when the stream ends.
  await finalResult.response.text();
  assert.equal((await finalResult.settled).verdict.passed, false);

  // Prose that merely mentions a tool-call field is not a tool call.
  const prose = parseResponseBody(
    JSON.stringify({ choices: [{ message: { content: "the function_call field is empty here" } }] }),
    "application/json",
  );
  assert.equal(prose.toolCalls, false);
});

test("response gate detects Anthropic tool_use blocks", () => {
  const anthropic = parseResponseBody(
    JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "checking the file" },
        { type: "tool_use", id: "toolu_1", name: "read", input: {} },
      ],
    }),
    "application/json",
  );
  assert.equal(anthropic.protocol, "anthropic");
  assert.equal(anthropic.toolCalls, true);

  const textOnly = parseResponseBody(
    JSON.stringify({ type: "message", content: [{ type: "text", text: "done" }] }),
    "application/json",
  );
  assert.equal(textOnly.toolCalls, false);
});

test("response gate resolves a bare basename that lives in a nested directory", () => {
  const root = seedProject();
  fs.mkdirSync(path.join(root, "resources", "views"), { recursive: true });
  fs.writeFileSync(path.join(root, "resources", "views", "edit.blade.php"), "<div></div>\n");
  fs.writeFileSync(path.join(root, "resources", "views", "shipment.blade.php"), "<div></div>\n");

  const resolution = resolveEvidencePath(root, "edit.blade.php");
  assert.equal(resolution.status, "ok");
  assert.equal(resolution.status === "ok" && resolution.exact, false);

  // The old failure mode: "file path does not exist inside allowed root".
  const progress = evaluateResponse(
    "এখন edit.blade.php আর shipment.blade.php-এ একই পরিবর্তন করি",
    { allowedRoot: root },
  );
  assert.equal(progress.violations.length, 0);
  assert.doesNotMatch(progress.reason, /does not exist/);
  assert.equal(progress.passed, true);

  // A claim that names only a basename has no path:line, so it is still blocked
  // as a claim without evidence — but not as an escape.
  const claim = evaluateResponse("আমি edit.blade.php ঠিক করেছি", { allowedRoot: root });
  assert.equal(claim.passed, false);
  assert.match(claim.reason, /claim without evidence/);
  assert.equal(claim.violations.length, 0);

  const ghost = evaluateResponse(
    "আমি ghost.blade.php ফাইলটা ঠিক করেছি, এখন পুরো ফ্লো ঠিকঠাক চলছে।",
    { allowedRoot: root },
  );
  assert.equal(ghost.passed, false);
  assert.match(ghost.reason, /does not exist/);
});

test("evidence outside the working directory counts when the file exists", () => {
  const root = seedProject();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-outside-"));
  const outsideFile = path.join(outsideDir, "config.json");
  fs.writeFileSync(outsideFile, "{\n  \"ok\": true\n}\n");

  // Absolute path outside the root: readable by the agent, so it is evidence.
  const absolute = resolveEvidencePath(root, `${outsideFile}:2`);
  assert.equal(absolute.status, "ok");
  assert.equal(absolute.status === "ok" && absolute.file, outsideFile);
  const claim = evaluateResponse(`I fixed it in ${outsideFile}:2 and 78/78 tests pass.`, {
    allowedRoot: root,
  });
  assert.equal(claim.passed, true);

  // ".." is resolved, not rejected: a real file is evidence, a missing one is not.
  const viaParent = resolveEvidencePath(root, `../${path.basename(outsideDir)}/config.json`);
  assert.equal(viaParent.status, "ok");
  assert.equal(resolveEvidencePath(root, "../outside/ghost.ts").status, "missing");

  // A global config citation resolves through the extra OpenCode roots.
  const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-global-"));
  fs.mkdirSync(path.join(globalRoot, "zombiecoder"), { recursive: true });
  fs.writeFileSync(path.join(globalRoot, "zombiecoder", "syllabus.md"), "# syllabus\n");
  const globalCitation = resolveEvidencePath(root, "zombiecoder/syllabus.md", [globalRoot]);
  assert.equal(globalCitation.status, "ok");
  assert.equal(
    globalCitation.status === "ok" && globalCitation.file,
    path.join(globalRoot, "zombiecoder", "syllabus.md"),
  );

  const missing = evaluateResponse(
    "I fixed it in zombiecoder/syllabus.md:3 and everything works.",
    { allowedRoot: root },
  );
  assert.equal(missing.passed, false);
  assert.match(missing.reason, /does not exist/);
});

test("response gate rejects weak evidence shapes and keeps real results", () => {
  const root = seedProject();
  const weak = [
    "I fixed the bug; see line 177 for the change.",
    "I fixed the bug and the checks are green at 5/10.",
    "I fixed the bug in src/plugin.ts.",
    "I fixed the bug; ran npm test.",
  ];
  for (const text of weak) {
    const verdict = evaluateResponse(text, { allowedRoot: root });
    assert.equal(verdict.passed, false, `${text} -> ${verdict.reason}`);
    assert.match(verdict.reason, /claim without evidence/, text);
  }

  const strong = [
    "I fixed the bug in src/plugin.ts:759.",
    "I fixed the bug; the suite is 78/78 pass.",
    "I fixed the bug; exit code 0.",
    "I fixed the bug; npm test reported 80 pass.",
  ];
  for (const text of strong) {
    const verdict = evaluateResponse(text, { allowedRoot: root });
    assert.equal(verdict.passed, true, `${text} -> ${verdict.reason}`);
  }

  const outOfRange = evaluateResponse(
    "I fixed the bug in src/plugin.ts:9999 and the login flow now behaves correctly.",
    { allowedRoot: root },
  );
  assert.equal(outOfRange.passed, false);
  assert.match(outOfRange.reason, /line out of range/);
});

test("absolute, extension-less and OpenCode config-root evidence is accepted when real", () => {
  const root = seedProject();

  // An extension-less absolute file (/etc/hostname style) with an explicit line.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-bare-"));
  const bareFile = path.join(bare, "hostname");
  fs.writeFileSync(bareFile, "host-a\n");
  const bareClaim = evaluateResponse(`I read ${bareFile}:1 and fixed the gate.`, {
    allowedRoot: root,
  });
  assert.equal(bareClaim.passed, true);
  assert.match(bareClaim.reason, /evidence:/);

  // A file under the OpenCode config root ($XDG_CONFIG_HOME/opencode) is evidence.
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-xdg-"));
  const note = path.join(configHome, "opencode", "plugins", "zombiecoder", "note.md");
  fs.mkdirSync(path.dirname(note), { recursive: true });
  fs.writeFileSync(note, "# note\n");
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  try {
    const globalClaim = evaluateResponse(
      "I read plugins/zombiecoder/note.md:1 and fixed the gate.",
      { allowedRoot: root },
    );
    assert.equal(globalClaim.passed, true);
    assert.match(globalClaim.reason, /evidence:/);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
});
