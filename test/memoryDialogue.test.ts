// Memory fidelity tests.
//
// The audit found the archive storing the system/tool payload and stamping every
// message with write time, which made older context useless for "what did we
// decide?". These tests pin the fix.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isArchivableRole, keepRecent, toMemoryMessage } from "../src/zombie/memory.ts";

function memory(): { root: string; storage: { get: (k: string) => Promise<unknown>; set: (k: string, v: any) => Promise<void> } } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-memory-"));
  fs.mkdirSync(path.join(root, ".zombiecoder", "memory"), { recursive: true });
  const store = new Map<string, unknown>();
  return {
    root,
    storage: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: any) => {
        store.set(key, value);
      },
    },
  };
}

test("system and tool rows are not conversation memory", () => {
  assert.equal(isArchivableRole("system"), false);
  assert.equal(isArchivableRole("tool"), false);
  assert.equal(isArchivableRole("user"), true);
  assert.equal(isArchivableRole("assistant"), true);
});

test("archive keeps the full dialogue only, newest ten stay in RAM", async () => {
  const { root, storage } = memory();
  const messages = [
    { role: "system", text: "tool catalog noise" },
    ...Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `turn ${i + 1}` })),
    { role: "tool", text: "shell output" },
  ];
  const result = await keepRecent(storage, root, "ses_dialogue", messages);
  assert.equal(result.kept, 10);
  assert.equal(result.archived, 12);
  const raw = fs.readFileSync(result.archiveFile, "utf8").trim().split("\n");
  const archived = raw.flatMap((line) => JSON.parse(line).archived);
  assert.equal(archived.length, 12);
  assert.ok(archived.every((m: any) => m.role === "user" || m.role === "assistant"));
  assert.ok(!archived.some((m: any) => m.text.includes("catalog") || m.text.includes("shell output")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("source timestamps are preserved when the payload carries one", () => {
  const created = Date.parse("2026-10-20T10:00:00.000Z");
  assert.equal(toMemoryMessage({ role: "user", text: "hi", time: { created } }).at, "2026-10-20T10:00:00.000Z");
  const stamped = toMemoryMessage({ role: "user", text: "hi" });
  assert.match(stamped.at, /^\d{4}-\d{2}-\d{2}T/);
});
