// Spec §5 — persistent local memory.
//
// Disk is the source of truth:
//   disk (.zombiecoder/memory/<session>.jsonl) — the full user/assistant transcript,
//        append-only, plain JSONL, portable with the project.
//   RAM  (ctx.storage) — only the latest KEEP_RECENT messages, a fast cache.
//
// OpenCode's storage is never the only copy. A version change or a move to another
// machine must not erase the conversation: the project folder carries it.

import * as fs from "node:fs";
import * as path from "node:path";
import { appendJsonl, readJson, readJsonl, readText, sha256, writeJson } from "./io.ts";
import { memoryArchiveFile, memoryDir, memoryIndexFile, safe } from "./paths.ts";

export const KEEP_RECENT = 10;
export const INDEX_STORAGE_PREFIX = "memory/index/";

export type StorageLike = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: any) => Promise<void>;
  remove?: (key: string) => Promise<void>;
  scan?: (options: { prefix: string; limit?: number }) => Promise<{ entries: readonly { key: string; value: unknown }[] }>;
};

export type MemoryMessage = {
  id?: string;
  role?: string;
  text: string;
  at: string;
};

export type MemoryIndexEntry = {
  sessionID: string;
  updatedAt: string;
  kept: number;
  archivedTotal: number;
  archiveFile: string;
  lastMessageAt: string;
};

// Every archive file, so an agent that reads only index.json can find all older
// context. `archived` is the count written by this index; `bytes` is the live
// file size, which also makes a truncated/rotated archive visible.
export type MemoryArchiveEntry = {
  sessionID: string;
  file: string;
  archived: number;
  bytes: number;
  firstAt: string;
  lastAt: string;
  updatedAt: string;
};

export type MemoryIndex = {
  projectRoot: string;
  updatedAt: string;
  sessions: Record<string, MemoryIndexEntry>;
  archives: MemoryArchiveEntry[];
};

export function storageKey(sessionID: string): string {
  return "memory/recent/" + safe(sessionID);
}

// Loose extractor: works for strings, {text}, and {content:[...]} message shapes,
// because the hook payload evolves between versions.
export function textOf(item: any): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  const visible = (parts: any[]) =>
    parts
      .filter((part) => part?.type !== "reasoning" && part?.type !== "thinking")
      .map(textOf)
      .filter(Boolean)
      .join(" ");
  if (Array.isArray(item.parts)) return visible(item.parts);
  if (Array.isArray(item.content)) return visible(item.content);
  if (Array.isArray(item.messages)) return item.messages.map(textOf).filter(Boolean).join(" ");
  return "";
}

export function roleOf(item: any): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const r = item.role ?? item.type;
  return typeof r === "string" ? r : undefined;
}

export function toMemoryMessage(item: any, index?: number): MemoryMessage {
  const sourceID = item?.id ?? item?.messageID ?? item?.messageId;
  const id =
    typeof sourceID === "string" && sourceID.length > 0
      ? sourceID
      : Number.isInteger(index)
        ? `snapshot-index-${index}`
        : undefined;
  // Keep the source timestamp when the payload carries one. Stamping write time
  // made the archive look like everything happened at once (audit finding).
  const raw =
    item?.time?.created ?? item?.createdAt ?? item?.created_at ?? item?.time?.updated ?? item?.updatedAt;
  const at = typeof raw === "number" && Number.isFinite(raw)
    ? new Date(raw).toISOString()
    : typeof raw === "string" && raw.trim()
      ? raw
      : new Date().toISOString();
  return {
    id,
    role: roleOf(item),
    text: textOf(item),
    at,
  };
}

// Memory is the conversation, not the system prompt. Archiving system/tool rows
// filled the store with the tool catalog and made "what did we decide?" unreadable.
const ARCHIVED_ROLES = new Set(["user", "assistant", "message"]);

export function isArchivableRole(role?: string): boolean {
  return ARCHIVED_ROLES.has(String(role ?? "").toLowerCase());
}

// Disk is the truth. If an archive file exists but predates the index (or was
// copied in by hand), rebuild its counts from the file itself so a project moved
// to another machine still knows what it has, even without index.json.
function countArchive(file: string): { count: number; firstAt?: string; lastAt?: string } {
  const records = readJsonl<{ ts?: string; archived?: MemoryMessage[] }>(file);
  let count = 0;
  let firstAt: string | undefined;
  let lastAt: string | undefined;
  for (const record of records) {
    count += Array.isArray(record.archived) ? record.archived.length : 0;
    if (typeof record.ts === "string" && record.ts) {
      firstAt ??= record.ts;
      lastAt = record.ts;
    }
  }
  return { count, firstAt, lastAt };
}

function reconcileArchives(projectRoot: string, index: MemoryIndex): MemoryIndex {
  if (!Array.isArray(index.archives)) index.archives = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(memoryDir(projectRoot)).filter((f) => f.toLowerCase().endsWith(".jsonl"));
  } catch {
    return index;
  }
  const known = new Set(index.archives.map((a) => a.file));
  for (const name of files) {
    const file = path.join(memoryDir(projectRoot), name);
    if (known.has(file)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const sessionID = name.replace(/\.jsonl$/i, "");
    const counted = countArchive(file);
    index.archives.push({
      sessionID,
      file,
      archived: counted.count,
      bytes: stat.size,
      firstAt: counted.firstAt ?? stat.birthtime.toISOString(),
      lastAt: counted.lastAt ?? stat.mtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    });
    if (!index.sessions[sessionID]) {
      index.sessions[sessionID] = {
        sessionID,
        updatedAt: stat.mtime.toISOString(),
        kept: 0,
        archivedTotal: counted.count,
        archiveFile: file,
        lastMessageAt: counted.lastAt ?? stat.mtime.toISOString(),
      };
    }
  }
  return index;
}

export function readIndex(projectRoot: string): MemoryIndex {
  const index =
    readJson<MemoryIndex>(memoryIndexFile(projectRoot)) ?? {
      projectRoot,
      updatedAt: new Date().toISOString(),
      sessions: {},
      archives: [],
    };
  const reconciled = reconcileArchives(projectRoot, index);
  // `kept` is the in-RAM count. If an older build wrote a larger number, report
  // the current policy instead of stale metadata; touchIndex persists the fix.
  for (const entry of Object.values(reconciled.sessions)) {
    if (typeof entry.kept === "number" && entry.kept > KEEP_RECENT) entry.kept = KEEP_RECENT;
  }
  return reconciled;
}

export function writeIndex(projectRoot: string, index: MemoryIndex): MemoryIndex {
  index.updatedAt = new Date().toISOString();
  if (!Array.isArray(index.archives)) index.archives = [];
  writeJson(memoryIndexFile(projectRoot), index);
  fs.chmodSync(memoryIndexFile(projectRoot), 0o600);
  return index;
}

export function touchIndex(
  projectRoot: string,
  sessionID: string,
  patch: Partial<MemoryIndexEntry>,
): MemoryIndexEntry {
  const index = readIndex(projectRoot);
  const prev = index.sessions[sessionID];
  const now = new Date().toISOString();
  const entry: MemoryIndexEntry = {
    ...(prev ?? {}),
    sessionID,
    updatedAt: now,
    kept: prev?.kept ?? 0,
    archivedTotal: prev?.archivedTotal ?? 0,
    archiveFile: prev?.archiveFile ?? memoryArchiveFile(projectRoot, sessionID),
    lastMessageAt: prev?.lastMessageAt ?? now,
    ...patch,
  };
  index.sessions[sessionID] = entry;
  writeIndex(projectRoot, index);
  return entry;
}

export async function readRecent(storage: StorageLike, sessionID: string): Promise<MemoryMessage[]> {
  const raw = await storage.get(storageKey(sessionID));
  const arr = (raw as any)?.recent;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r: any) => (typeof r === "string" ? { text: r, at: "" } : r))
    .filter((r: MemoryMessage) => typeof r?.text === "string" && r.text.length > 0)
    .slice(-KEEP_RECENT);
}

function archiveIdentity(message: MemoryMessage): string {
  return message.id
    ? `id:${message.id}`
    : `content:${sha256(`${message.role ?? "message"}\n${message.text}`)}`;
}

function appendUniqueArchive(
  projectRoot: string,
  sessionID: string,
  messages: MemoryMessage[],
  agentID?: string,
): { archived: number; total: number; file: string; bytes: number } {
  const file = memoryArchiveFile(projectRoot, sessionID);
  const existing = readJsonl<{ archived?: MemoryMessage[] }>(file);
  const seen = new Set<string>();
  for (const record of existing) {
    for (const message of Array.isArray(record.archived) ? record.archived : []) {
      if (typeof message?.text === "string") seen.add(archiveIdentity(message));
    }
  }
  const fresh = messages.filter((message) => {
    const identity = archiveIdentity(message);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  if (fresh.length > 0) {
    // One record per sync, with the agent that produced the assistant turn. The
    // format stays plain JSONL so a newer OpenCode can read it without this plugin.
    appendJsonl(file, { ts: new Date().toISOString(), sessionID, agent: agentID, archived: fresh });
  }
  let bytes = 0;
  try {
    bytes = fs.statSync(file).size;
  } catch {
    /* no archive exists until the first non-empty append */
  }
  return { archived: fresh.length, total: seen.size, file, bytes };
}

function recordArchive(
  projectRoot: string,
  sessionID: string,
  kept: number,
  archivedTotal: number,
  archiveFile: string,
  bytes: number,
): void {
  const now = new Date().toISOString();
  const index = readIndex(projectRoot);
  const previous = index.sessions[sessionID];
  // Totals come from the file that was just read, never from adding to a cached
  // number: re-reading the index after a rebuild must not double-count.
  index.sessions[sessionID] = {
    ...(previous ?? {}),
    sessionID,
    updatedAt: now,
    kept,
    archivedTotal,
    archiveFile,
    lastMessageAt: now,
  };
  if (archivedTotal > 0) {
    const previousArchive = index.archives.find((entry) => entry.sessionID === sessionID);
    index.archives = index.archives.filter((entry) => entry.sessionID !== sessionID);
    index.archives.push({
      sessionID,
      file: archiveFile,
      archived: archivedTotal,
      bytes,
      firstAt: previousArchive?.firstAt ?? now,
      lastAt: now,
      updatedAt: now,
    });
  }
  writeIndex(projectRoot, index);
}

export async function keepRecent(
  storage: StorageLike,
  projectRoot: string,
  sessionID: string,
  messages: any[],
  agentID?: string,
): Promise<{ kept: number; archived: number; archiveFile: string }> {
  const all = messages.map(toMemoryMessage).filter((m) => m.text.length > 0 && isArchivableRole(m.role));
  const recent = all.slice(-KEEP_RECENT);

  await storage.set(storageKey(sessionID), {
    updatedAt: new Date().toISOString(),
    sessionID,
    recent,
  });

  // Archive the whole visible dialogue, not only the overflow: the disk copy is
  // the portable transcript, storage is a cache of the last KEEP_RECENT turns.
  const appended = appendUniqueArchive(projectRoot, sessionID, all, agentID);
  recordArchive(projectRoot, sessionID, recent.length, appended.total, appended.file, appended.bytes);

  return {
    kept: recent.length,
    archived: appended.archived,
    archiveFile: appended.file,
  };
}

export async function archiveSessionSnapshot(
  storage: StorageLike,
  projectRoot: string,
  sessionID: string,
  messages: any[],
  agentID?: string,
): Promise<{ kept: number; archived: number; archiveFile: string }> {
  const all = messages.map(toMemoryMessage).filter((message) => message.text.length > 0 && isArchivableRole(message.role));
  const recent = all.slice(-KEEP_RECENT);
  await storage.set(storageKey(sessionID), {
    updatedAt: new Date().toISOString(),
    sessionID,
    recent,
  });
  const appended = appendUniqueArchive(projectRoot, sessionID, all, agentID);
  recordArchive(projectRoot, sessionID, recent.length, appended.total, appended.file, appended.bytes);
  return { kept: recent.length, archived: appended.archived, archiveFile: appended.file };
}

export function readArchive(projectRoot: string, sessionID: string, limit = 50): any[] {
  return readJsonl(memoryArchiveFile(projectRoot, sessionID), limit);
}

export function archiveSummary(projectRoot: string, sessionID: string): string {
  const index = readIndex(projectRoot);
  const entry = index.sessions[sessionID];
  if (!entry) return "No archived memory yet for this session.";
  const exists = readText(entry.archiveFile) !== undefined;
  const known = index.archives.find((a) => a.sessionID === sessionID);
  return [
    `Session ${sessionID}`,
    `kept in RAM (cache): ${entry.kept}`,
    `full dialogue archived to disk: ${entry.archivedTotal}`,
    `archive file: ${entry.archiveFile}${exists ? "" : " (not written yet)"}`,
    `index knows ${index.archives.length} archive file(s); this session: ${known ? `${known.archived} message(s), ${known.bytes} bytes` : "not indexed yet"}`,
    `last message: ${entry.lastMessageAt}`,
    `index file: ${memoryIndexFile(projectRoot)}`,
    "Disk is the source of truth; OpenCode storage is only the recent-message cache.",
  ].join("\n");
}
