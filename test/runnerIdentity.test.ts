// Live runner identity: the runner belongs to OpenCode, the voice to ZombieCoder.
// These tests pin the evidence rule — free/local only when catalog facts say so.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRunnerIdentity,
  classifyRunner,
  isLocalBaseUrl,
  parseRunnerRef,
  renderRunnerIdentity,
} from "../src/zombie/runnerIdentity.ts";

const JARIN = { id: "jarin", name: "Jarin", role: "Principal Debug & Root Cause Engineer" };

test("isLocalBaseUrl accepts loopback, LAN and dotless hosts only", () => {
  for (const url of [
    "http://localhost:11434/v1",
    "http://127.0.0.1:8080/v1",
    "http://192.168.1.20:11434/v1",
    "http://10.0.0.5/v1",
    "http://172.20.4.4:8000/v1",
    "http://[::1]:11434/v1",
    "http://ollama:11434/v1",
    "http://box.local/v1",
  ]) {
    assert.equal(isLocalBaseUrl(url), true, url);
  }
  for (const url of [
    "https://api.openai.com/v1",
    "https://opencode.ai/v1",
    "https://ollama-cloud.com/v1",
    "http://172.32.0.1/v1",
    "not a url",
    "",
    null,
  ]) {
    assert.equal(isLocalBaseUrl(url), false, String(url));
  }
});

test("parseRunnerRef splits on the first slash and rejects non-references", () => {
  assert.deepEqual(parseRunnerRef("opencode/big-pickle"), {
    ref: "opencode/big-pickle",
    providerID: "opencode",
    modelID: "big-pickle",
  });
  assert.equal(parseRunnerRef("openrouter/meta-llama/llama-3")?.modelID, "meta-llama/llama-3");
  for (const value of ["", "inherit", "provider/", "/model", "a b/c", null, undefined]) {
    assert.equal(parseRunnerRef(value), null, String(value));
  }
});

test("classifyRunner prefers local evidence, then cost 0/0, then custom, then remote", () => {
  const local = classifyRunner("ollama/llama3", {
    localProviders: [{ providerID: "ollama", baseURL: "http://127.0.0.1:11434/v1" }],
    freeRefs: ["ollama/llama3"],
  });
  assert.equal(local.kind, "local");
  assert.match(local.evidence, /127\.0\.0\.1/);

  assert.equal(classifyRunner("lmstudio/qwen", {}).kind, "local", "known local provider id is a fallback");
  assert.equal(classifyRunner("opencode/big-pickle", { freeRefs: ["opencode/big-pickle"] }).kind, "free");
  assert.equal(
    classifyRunner("missionbarisal/m1", { customProviderID: "missionbarisal", freeRefs: [] }).kind,
    "custom",
  );
  assert.equal(classifyRunner("anthropic/claude", { freeRefs: [] }).kind, "remote");
  assert.equal(classifyRunner(undefined, { freeRefs: ["opencode/big-pickle"] }).kind, "unknown");
});

test("a free runner is introduced as ZombieCoder with role and catalog proof", () => {
  const line = renderRunnerIdentity(JARIN, "opencode/big-pickle", {
    freeRefs: ["opencode/big-pickle"],
  });
  assert.equal(
    line,
    [
      "আমি ZombieCoder, এজেন্ট জারিন — Principal Debug & Root Cause Engineer।",
      "এই session-এ OpenCode-এর ফ্রি মডেল opencode/big-pickle ব্যবহার করছি। প্রমাণ: live catalog cost 0/0।",
      "Plugin identity: ZombieCoder (X-ZombieCoder-Powered-By); OpenCode-এর providerID/modelID ও metadata অপরিবর্তিত।",
    ].join(" "),
  );
  assert.ok(!line.includes("\n"), "the identity line must stay single-line for the prompt and the gate");
});

test("an unknown runner never claims free or local", () => {
  const line = renderRunnerIdentity({ id: "build" }, null, {});
  assert.match(line, /এজেন্ট build/);
  assert.match(line, /OpenCode builtin runner/);
  assert.doesNotMatch(line, /ফ্রি মডেল/);
  assert.doesNotMatch(line, /লোকাল মডেল/);
});

test("buildRunnerIdentity carries the evidence next to the prompt line", () => {
  const identity = buildRunnerIdentity(JARIN, "ollama/llama3", {
    localProviders: [{ providerID: "ollama", baseURL: "http://192.168.0.9:11434/v1" }],
  });
  assert.equal(identity.kind, "local");
  assert.equal(identity.ref, "ollama/llama3");
  assert.match(identity.evidence, /192\.168\.0\.9/);
  assert.match(identity.line, /লোকাল মডেল ollama\/llama3/);
});
