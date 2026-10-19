// Spec §5 — persistent local memory.
//
// Two layers, on purpose:
//   RAM  (ctx.storage)  — the latest KEEP_RECENT messages per session, cheap to read
//   disk (.zombiecoder/memory/<session>.jsonl) — everything that fell out, append-only
//
// The index (.zombiecoder/memory/index.json) is the list of archives so an agent can
// find older context without loading it. This lives per working directory, so two
// projects never share a memory.

import * as fs from "node:fs";
import * as path from "node:path";
import { appendJsonl, readJson, readJsonl, readText, writeJson } from "./io.ts";
import { memoryArchiveFile, memoryDir, memoryIndexFile, safe } from "./paths.ts";

export const KEEP_RECENT = 5;
export const INDEX_STORAGE_PREFIX = "memory/index/";

export type StorageLike = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: any) => Promise<void>;
  remove?: (key: string) => Promise<void>;
  scan?: (options: { prefix: string; limit?: number }) => Promise<{ entries: readonly { key: string; value: unknown }[] }>;
};

export type MemoryMessage = {
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
  if (Array.isArray(item.parts)) return item.parts.map(textOf).filter(Boolean).join(" ");
  if (Array.isArray(item.content)) return item.content.map(textOf).filter(Boolean).join(" ");
  if (Array.isArray(item.messages)) return item.messages.map(textOf).filter(Boolean).join(" ");
  return "";
}

export function roleOf(item: any): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const r = item.role ?? item.type;
  return typeof r === "string" ? r : undefined;
}

export function toMemoryMessage(item: any): MemoryMessage {
  return { role: roleOf(item), text: textOf(item), at: new Date().toISOString() };
}

// Disk is the truth. If an archive file exists but predates the index (or was
// copied in by hand), add it on read so the agent never has to guess.
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
    index.archives.push({
      sessionID,
      file,
      archived: index.sessions[sessionID]?.archivedTotal ?? 0,
      bytes: stat.size,
      firstAt: stat.birthtime.toISOString(),
      lastAt: stat.mtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    });
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
  return reconcileArchives(projectRoot, index);
}

export function writeIndex(projectRoot: string, index: MemoryIndex): MemoryIndex {
  index.updatedAt = new Date().toISOString();
  if (!Array.isArray(index.archives)) index.archives = [];
  writeJson(memoryIndexFile(projectRoot), index);
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

export async function keepRecent(
  storage: StorageLike,
  projectRoot: string,
  sessionID: string,
  messages: any[],
): Promise<{ kept: number; archived: number; archiveFile: string }> {
  const all = messages.map(toMemoryMessage).filter((m) => m.text.length > 0);
  const recent = all.slice(-KEEP_RECENT);
  const older = all.slice(0, Math.max(0, all.length - KEEP_RECENT));

  await storage.set(storageKey(sessionID), {
    updatedAt: new Date().toISOString(),
    sessionID,
    recent,
  });

  if (older.length > 0) {
    appendJsonl(memoryArchiveFile(projectRoot, sessionID), {
      ts: new Date().toISOString(),
      sessionID,
      archived: older,
    });
  }

  const now = new Date().toISOString();
  const archiveFile = memoryArchiveFile(projectRoot, sessionID);
  const index = readIndex(projectRoot);
  const prev = index.sessions[sessionID];
  index.sessions[sessionID] = {
    ...(prev ?? {}),
    sessionID,
    updatedAt: now,
    kept: recent.length,
    archivedTotal: (prev?.archivedTotal ?? 0) + older.length,
    archiveFile,
    lastMessageAt: recent.length ? recent[recent.length - 1].at : now,
  };

  if (older.length > 0) {
    let size = 0;
    try {
      size = fs.statSync(archiveFile).size;
    } catch {
      size = 0;
    }
    const previousArchive = index.archives.find((a) => a.sessionID === sessionID);
    index.archives = index.archives.filter((a) => a.sessionID !== sessionID);
    index.archives.push({
      sessionID,
      file: archiveFile,
      archived: (previousArchive?.archived ?? 0) + older.length,
      bytes: size,
      firstAt: previousArchive?.firstAt ?? now,
      lastAt: now,
      updatedAt: now,
    });
  }
  writeIndex(projectRoot, index);

  return {
    kept: recent.length,
    archived: older.length,
    archiveFile,
  };
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
    `kept in RAM: ${entry.kept}`,
    `archived to disk: ${entry.archivedTotal}`,
    `archive file: ${entry.archiveFile}${exists ? "" : " (not written yet)"}`,
    `index knows ${index.archives.length} archive file(s); this session: ${known ? `${known.archived} message(s), ${known.bytes} bytes` : "not indexed yet"}`,
    `last message: ${entry.lastMessageAt}`,
    `index file: ${memoryIndexFile(projectRoot)}`,
  ].join("\n");
}
