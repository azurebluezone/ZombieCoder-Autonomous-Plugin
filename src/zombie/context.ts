// Compact context engineering for every model call.
//
// The provider should not receive the whole repository or the whole session.
// It receives a bounded pack: project goal, allowed root, SSOT excerpt,
// syllabus excerpt and the most recent session memory. The full files remain
// available through tools; the pack is the cheap default.

import * as fs from "node:fs";
import * as path from "node:path";
import { readText, sha256 } from "./io.ts";
import { readIndex, type MemoryMessage } from "./memory.ts";
import { readSyllabus } from "./syllabus.ts";
import { memoryIndexFile, ssotFile, syllabusFile } from "./paths.ts";

export const CONTEXT_LIMITS = {
  ssot: 2200,
  syllabus: 1800,
  memoryPerMessage: 320,
  memoryTotal: 1400,
  total: 6200,
} as const;

export type ContextFileStatus = {
  file: string;
  exists: boolean;
  bytes: number;
  lines: number;
  sha256: string;
  headings: string[];
};

export type MemoryStatus = {
  indexFile: string;
  sessions: number;
  archives: number;
  recent: number;
};

export type ContextPack = {
  text: string;
  bytes: number;
  uiLine: string;
  allowedRoot: string;
  ssot: ContextFileStatus;
  syllabus: ContextFileStatus;
  memory: MemoryStatus;
};

function clip(text: string, limit: number, from: "head" | "tail" = "head"): string {
  const value = String(text ?? "").trim();
  if (value.length <= limit) return value;
  const sliced = from === "head" ? value.slice(0, limit) : value.slice(value.length - limit);
  return `${from === "head" ? sliced.trimEnd() : sliced.trimStart()}\n[... truncated: ${value.length - limit} chars ...]`;
}

function headings(text: string): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim())
    .slice(0, 20);
}

function fileStatus(file: string, text: string | undefined): ContextFileStatus {
  const value = text ?? "";
  return {
    file,
    exists: text !== undefined,
    bytes: Buffer.byteLength(value, "utf8"),
    lines: value ? value.split(/\r?\n/).length : 0,
    sha256: value ? sha256(value) : "",
    headings: headings(value),
  };
}

function section(text: string, prefix: string, limit: number): string {
  const start = text.indexOf(prefix);
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start + prefix.length);
  const body = next >= 0 ? text.slice(start, next) : text.slice(start);
  return clip(body, limit);
}

function ssotExcerpt(text: string): string {
  const parts = [
    section(text, "## 1. Project", 700),
    section(text, "## 2. Detected technologies", 700),
    section(text, "## 3. Structure", 900),
    section(text, "## 7. Agent team", 900),
  ].filter(Boolean);
  return clip(parts.join("\n\n"), CONTEXT_LIMITS.ssot);
}

function syllabusExcerpt(text: string): string {
  const scope = section(text, "## 1. Scope", 450);
  const agents = section(text, "## 3. Agents bound", 500);
  const lessons = section(text, "## 5. Lessons", 1000);
  return clip([scope, agents, lessons].filter(Boolean).join("\n\n"), CONTEXT_LIMITS.syllabus, "tail");
}

function memorySummary(recent: MemoryMessage[]): string {
  if (recent.length === 0) return "No recent kept exchanges for this session.";
  const lines: string[] = [];
  let used = 0;
  for (const message of recent.slice(-5)) {
    const role = message.role ?? "message";
    const text = clip(message.text.replace(/\s+/g, " "), CONTEXT_LIMITS.memoryPerMessage);
    const line = `- ${role}: ${text}`;
    if (used + line.length > CONTEXT_LIMITS.memoryTotal) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

function exists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function buildContextPack(
  projectRoot: string,
  agentID: string,
  recent: MemoryMessage[] = [],
): ContextPack {
  const ssotPath = ssotFile(projectRoot);
  const syllabusPath = syllabusFile(projectRoot);
  const ssotText = readText(ssotPath);
  const syllabusText = readSyllabus(projectRoot);
  const index = readIndex(projectRoot);
  const ssot = fileStatus(ssotPath, ssotText);
  const syllabus = fileStatus(syllabusPath, syllabusText);
  const memory: MemoryStatus = {
    indexFile: memoryIndexFile(projectRoot),
    sessions: Object.keys(index.sessions).length,
    archives: Array.isArray(index.archives) ? index.archives.length : 0,
    recent: recent.length,
  };

  const lines = [
    "## ZombieCoder Compact Context Pack",
    "",
    `Agent: ${agentID}`,
    `Goal: work inside the allowed root, read only the files needed, and make every claim evidence-backed.`,
    `Allowed root: ${projectRoot}`,
    `Path policy: paths outside the allowed root are denied; a claim with no path/test evidence is UNVERIFIED.`,
    "",
    `### SSOT (${ssot.exists ? `${ssot.bytes}B, ${ssot.lines} lines` : "missing"})`,
    ssot.exists ? ssotExcerpt(ssotText ?? "") : `Missing: ${ssotPath}. Run the plugin setup before making claims.`,
    "",
    `### Syllabus (${syllabus.exists ? `${syllabus.bytes}B, ${syllabus.lines} lines` : "missing"})`,
    syllabus.exists
      ? syllabusExcerpt(syllabusText ?? "")
      : `Missing: ${syllabusPath}. Run the plugin setup before making claims.`,
    "",
    `### Session memory (${memory.recent} recent, ${memory.archives} archives)`,
    memorySummary(recent),
    "",
    "### Context rules",
    "- Read the specific file/section before claiming a fact; do not reload the whole project.",
    "- Do not send secrets or whole repository contents to the provider.",
    "- If the pack is insufficient, call `context_status`, then read only the named file/section.",
  ];
  const text = clip(lines.join("\n"), CONTEXT_LIMITS.total);
  const uiLine = `Context: SSOT ${ssot.exists ? "OK" : "MISSING"} | Syllabus ${
    syllabus.exists ? "OK" : "MISSING"
  } | Memory ${memory.recent} recent / ${memory.archives} archives / ${memory.sessions} sessions | Pack ${Buffer.byteLength(
    text,
    "utf8",
  )}B`;
  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    uiLine,
    allowedRoot: projectRoot,
    ssot,
    syllabus,
    memory,
  };
}

export function contextFilesPresent(projectRoot: string): boolean {
  return exists(ssotFile(projectRoot)) && exists(syllabusFile(projectRoot));
}

export function resolveAllowedPath(projectRoot: string, candidate: string): string | null {
  const raw = String(candidate ?? "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  const cleaned = raw.replace(/:\d+(?:-\d+)?$/, "").replace(/[),.;]+$/, "");
  const resolved = path.isAbsolute(cleaned)
    ? path.resolve(cleaned)
    : path.resolve(projectRoot, cleaned);
  const relative = path.relative(path.resolve(projectRoot), resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return resolved;
  return null;
}
