// Tests for the goal-contract verifier: parse, match, run.
//
// The point of these tests is the boundary the old implementation missed:
// the agent's own observed/exitCode claim must never decide PASS. Only a real
// command run plus a match against the pre-registered expectation can.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  contractStatus,
  extractJson,
  matches,
  normalizeMatch,
  parseContract,
  runCheck,
  validateExpected,
} from "../src/zombie/goalContract.ts";

const syllabus = [
  "### Goal Contract gc-abc",
  "",
  "- status: open",
  "- goal: checkout",
  "- input: check.mjs",
  '- expected: {"id":7,"total":42}',
  "- check: `node check.mjs`",
  "- pass: exit 0",
  "- match: json",
  "",
  "_recorded x_",
  "### Goal Contract gc-abc — result",
  "- status: PASS",
  "",
].join("\n");

test("parseContract reads the open block, not the result block", () => {
  const parsed = parseContract(syllabus, "gc-abc");
  assert.equal(parsed?.check, "node check.mjs");
  assert.equal(parsed?.match, "json");
  assert.equal(parsed?.expected, '{"id":7,"total":42}');
  assert.equal(parseContract(syllabus, "gc-missing"), null);
  assert.equal(parseContract("", "gc-abc"), null);
});

test("matchers compare real output, including JSON key order", () => {
  assert.equal(matches('order {"id":7,"total":42}', '{"total":42,"id":7}', "json"), true);
  assert.equal(matches('order {"id":9,"total":42}', '{"id":7,"total":42}', "json"), false);
  assert.equal(matches("hello world", "world", "contains"), true);
  assert.equal(matches("hello world", "hello world", "equals"), true);
  assert.equal(matches("id=7", "^id=\\d+$", "regex"), true);
  assert.equal(matches("no json here", "{}", "json"), false);
  assert.equal(extractJson('prefix {"a":{"b":"]"}} suffix'), '{"a":{"b":"]"}}');
  assert.equal(extractJson("no json"), null);
});

test("validateExpected rejects a broken regex or JSON at open", () => {
  assert.match(String(validateExpected("[", "regex")), /valid regex/);
  assert.match(String(validateExpected("{nope", "json")), /valid JSON/);
  assert.equal(validateExpected('{"a":1}', "json"), null);
  assert.equal(normalizeMatch("JSON"), "json");
  assert.equal(normalizeMatch("weird"), "contains");
});

test("runCheck reports exit code, output and timeout from a real process", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-check-"));
  const ok = await runCheck(root, 'node -e "console.log(42)"');
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.stdout.trim(), "42");

  const bad = await runCheck(root, 'node -e "process.exit(2)"');
  assert.equal(bad.exitCode, 2);

  const slow = await runCheck(root, 'node -e "setTimeout(()=>{}, 5000)"', { timeoutMs: 300 });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.exitCode, null);
});

test("runCheck returns plain text even when the caller exports FORCE_COLOR", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-color-"));
  const previous = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "1";
  try {
    const forced = await runCheck(root, 'node -e "console.log(42)"');
    assert.equal(forced.stdout.trim(), "42");
  } finally {
    if (previous === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = previous;
  }

  const painted = await runCheck(root, 'node -e "process.stdout.write(\'\\u001B[33m42\\u001B[39m\')"');
  assert.equal(painted.stdout, "42");
});

test("contractStatus reads the recorded verdict and ignores the open block", () => {
  const syllabus = [
    "### Goal Contract gc-abc — result",
    "- status: PASS",
    "- exitCode: 0",
    "",
    "### Goal Contract gc-def",
    "- status: open",
    "",
    "### Goal Contract gc-ghi — result",
    "- status: FAIL",
    "- reason: mismatch",
    "",
    "### Next section",
  ].join("\n");
  assert.equal(contractStatus(syllabus, "gc-abc"), "PASS");
  assert.equal(contractStatus(syllabus, "gc-ghi"), "FAIL");
  assert.equal(contractStatus(syllabus, "gc-def"), null, "an open contract has no verdict");
  assert.equal(contractStatus(syllabus, "gc-missing"), null);
});
