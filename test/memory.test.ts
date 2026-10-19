import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KEEP_RECENT, keepRecent, readArchive, readIndex, readRecent, touchIndex } from "../src/zombie/memory.ts";

function fakeStorage() {
  const map = new Map<string, unknown>();
  return {
    get: async (key: string) => map.get(key),
    set: async (key: string, value: unknown) => {
      map.set(key, value);
    },
  };
}

test("keepRecent keeps the latest 10 in RAM and archives the rest", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-memory-"));
  const storage = fakeStorage();
  const messages = Array.from({ length: 14 }, (_, i) => ({ role: "user", text: `message ${i + 1}` }));

  const result = await keepRecent(storage, root, "ses_test", messages);
  assert.equal(result.kept, KEEP_RECENT);
  assert.equal(result.archived, 4);

  const recent = await readRecent(storage, "ses_test");
  assert.equal(recent.length, KEEP_RECENT);
  assert.equal(recent[0].text, "message 5");
  assert.equal(recent.at(-1)?.text, "message 14");

  const archived = readArchive(root, "ses_test");
  assert.equal(archived.length, 1);
  assert.equal(archived[0].archived.length, 4);

  const index = readIndex(root);
  assert.equal(index.sessions.ses_test.kept, KEEP_RECENT);
  assert.equal(index.sessions.ses_test.archivedTotal, 4);
});

test("touchIndex merges patches without dropping previous fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-index-"));
  touchIndex(root, "ses_a", { kept: 3 });
  const entry = touchIndex(root, "ses_a", { archivedTotal: 7 });
  assert.equal(entry.kept, 3);
  assert.equal(entry.archivedTotal, 7);
  assert.match(entry.archiveFile, /ses_a\.jsonl$/);
});
