// External payload hygiene tests: invisible characters are noise, not signal.

import test from "node:test";
import assert from "node:assert/strict";
import {
  detectInvisible,
  detectTrailingMark,
  isExternallyMarked,
  stripInvisible,
} from "../src/zombie/sanitize.ts";

const ZWSP = "\u200B";
const ZWJ = "\u200D";
const BOM = "\uFEFF";

test("stripInvisible removes zero-width and bidi characters", () => {
  const dirty = `cre${ZWJ}ate ${ZWSP}user${BOM} \u202Etxt`;
  assert.equal(stripInvisible(dirty), "create user txt");
});

test("stripInvisible is idempotent", () => {
  const once = stripInvisible(`a${ZWSP}b${ZWJ}c`);
  assert.equal(stripInvisible(once), once);
});

test("detectInvisible counts characters and names the kinds", () => {
  const report = detectInvisible(`a${ZWSP}b${ZWJ}c${BOM}`);
  assert.equal(report.count, 3);
  assert.ok(report.suspicious);
  assert.ok(report.kinds.includes("zero-width joiner"));
});

test("two accidental zero-width characters are not called a watermark", () => {
  const report = detectInvisible(`a${ZWSP}b${ZWJ}c`);
  assert.equal(report.count, 2);
  assert.equal(report.suspicious, false);
});

test("trailing-space steganography needs a sustained pattern", () => {
  const marked = Array.from({ length: 20 }, (_, i) => `line ${i}  `).join("\n");
  assert.equal(detectTrailingMark(marked), true);
  assert.equal(detectTrailingMark("short\nlines"), false);
  assert.equal(isExternallyMarked(marked).trailing, true);
});
