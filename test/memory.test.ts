import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  archiveSessionSnapshot,
  KEEP_RECENT,
  keepRecent,
  readArchive,
  readIndex,
  readRecent,
  textOf,
  touchIndex,
} from "../src/zombie/memory.ts";

function fakeStorage() {
  const map = new Map<string, unknown>();
  return {
    get: async (key: string) => map.get(key),
    set: async (key: string, value: unknown) => {
      map.set(key, value);
    },
  };
}

test("keepRecent keeps the latest KEEP_RECENT in RAM and archives the full dialogue", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-memory-"));
  const storage = fakeStorage();
  const messages = Array.from({ length: 14 }, (_, i) => ({ role: "user", text: `message ${i + 1}` }));

  const result = await keepRecent(storage, root, "ses_test", messages);
  assert.equal(result.kept, KEEP_RECENT);
  assert.equal(result.archived, 14);
  const repeated = await keepRecent(storage, root, "ses_test", messages);
  assert.equal(repeated.archived, 0, "reprocessing messages must not duplicate archive rows");

  const recent = await readRecent(storage, "ses_test");
  assert.equal(recent.length, KEEP_RECENT);
  assert.equal(recent[0].text, `message ${14 - KEEP_RECENT + 1}`);
  assert.equal(recent.at(-1)?.text, "message 14");

  const archived = readArchive(root, "ses_test");
  assert.equal(archived.length, 1);
  assert.equal(archived[0].archived.length, 14);

  const index = readIndex(root);
  assert.equal(index.sessions.ses_test.kept, KEEP_RECENT);
  assert.equal(index.sessions.ses_test.archivedTotal, 14);
  assert.equal(index.archives.length, 1);
  assert.equal(index.archives[0].sessionID, "ses_test");
  assert.equal(index.archives[0].archived, 14);
  assert.ok(index.archives[0].bytes > 0);
  assert.match(index.archives[0].file, /ses_test\.jsonl$/);
});

test("the archive names the agent that produced the turn", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-agent-memory-"));
  const storage = fakeStorage();
  await keepRecent(
    storage,
    root,
    "ses_agent",
    [
      { id: "m1", role: "user", text: "প্রশ্ন" },
      { id: "m2", role: "assistant", text: "উত্তর", agent: "halim" },
    ],
    "halim",
  );
  const archived = readArchive(root, "ses_agent");
  assert.equal(archived[0].agent, "halim");
  assert.equal(archived[0].archived.length, 2);
});

test("completed session snapshots archive all messages once and keep recent context", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-session-archive-"));
  const storage = fakeStorage();
  const messages = Array.from({ length: 8 }, (_, i) => ({
    id: `message-${i + 1}`,
    type: i % 2 === 0 ? "user" : "assistant",
    text: `exchange ${i + 1}`,
  }));

  const first = await archiveSessionSnapshot(storage, root, "ses_complete", messages);
  assert.equal(first.kept, Math.min(KEEP_RECENT, messages.length));
  assert.equal(first.archived, messages.length);
  const second = await archiveSessionSnapshot(storage, root, "ses_complete", messages);
  assert.equal(second.archived, 0, "idle snapshots must be idempotent");

  const archive = readArchive(root, "ses_complete");
  assert.equal(archive.length, 1);
  assert.equal(archive[0].archived.length, messages.length);
  assert.equal((await readRecent(storage, "ses_complete")).length, Math.min(KEEP_RECENT, messages.length));
  assert.equal(readIndex(root).sessions.ses_complete.archivedTotal, messages.length);
});

test("id-less repeated messages at different positions are preserved without duplicate snapshots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-idless-memory-"));
  const storage = fakeStorage();
  const messages = [
    { type: "user", text: "Repeat this." },
    { type: "assistant", text: "Repeat this." },
    { type: "user", text: "Repeat this." },
  ];

  const first = await archiveSessionSnapshot(storage, root, "ses_idless", messages);
  assert.equal(first.archived, 3);
  const repeated = await archiveSessionSnapshot(storage, root, "ses_idless", messages);
  assert.equal(repeated.archived, 0);
  assert.equal(readArchive(root, "ses_idless")[0].archived.length, 3);
});

test("memory snapshots omit reasoning blocks and keep generated archives private", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-private-memory-"));
  const storage = fakeStorage();
  const visibleText = textOf({
    type: "assistant",
    content: [
      { type: "text", text: "Visible answer." },
      { type: "reasoning", text: "Private reasoning." },
    ],
  });
  assert.equal(visibleText, "Visible answer.");

  await archiveSessionSnapshot(storage, root, "ses_private", [
    { id: "message-1", type: "assistant", content: [{ type: "text", text: "Visible answer." }] },
  ]);
  const dir = path.join(root, ".zombiecoder", "memory");
  for (const file of ["index.json", "ses_private.jsonl"]) {
    const mode = fs.statSync(path.join(dir, file)).mode & 0o777;
    assert.equal(mode & 0o077, 0, `${file} must not be readable by group/other users`);
  }
});

test("readIndex discovers an archive file that was written before the index existed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-archive-"));
  const dir = path.join(root, ".zombiecoder", "memory");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ses_legacy.jsonl"),
    JSON.stringify({ ts: "2026-10-01T00:00:00.000Z", archived: [{ role: "user", text: "old" }] }) + "\n",
  );

  const index = readIndex(root);
  const found = index.archives.find((a) => a.sessionID === "ses_legacy");
  assert.ok(found, "legacy archive missing from index");
  assert.equal(found.archived, 1, "archive count must come from the file, not the missing index");
  assert.ok(found.bytes > 0);
  assert.equal(index.sessions.ses_legacy.archivedTotal, 1);
  assert.equal(index.sessions.ses_legacy.archiveFile, path.join(dir, "ses_legacy.jsonl"));
});

test("touchIndex merges patches without dropping previous fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-index-"));
  touchIndex(root, "ses_a", { kept: 1 });
  const entry = touchIndex(root, "ses_a", { archivedTotal: 7 });
  assert.equal(entry.kept, 1);
  assert.equal(entry.archivedTotal, 7);
  assert.match(entry.archiveFile, /ses_a\.jsonl$/);
});

test("an empty touchIndex patch refreshes the index without resetting kept", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-touch-"));
  touchIndex(root, "ses_prompt", { kept: 2, archivedTotal: 11 });
  const entry = touchIndex(root, "ses_prompt", {});
  assert.equal(entry.kept, 2);
  assert.equal(entry.archivedTotal, 11);
});
