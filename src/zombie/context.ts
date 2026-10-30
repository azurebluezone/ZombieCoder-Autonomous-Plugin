// Compact context engineering for every model call.
//
// The provider should not receive the whole repository or the whole session.
// It receives a bounded pack: project goal, allowed root, SSOT excerpt,
// syllabus excerpt and the most recent session memory. The full files remain
// available through tools; the pack is the cheap default.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readText, sha256 } from "./io.ts";
import { readIndex, type MemoryMessage } from "./memory.ts";
import { readSyllabus } from "./syllabus.ts";
import { memoryIndexFile, ssotFile, syllabusFile } from "./paths.ts";
import { FOCUS_LIMITS, listProjectFiles, resolveFocus, type FocusPlan } from "./focus.ts";
import { openContracts } from "./goalContract.ts";

export const CONTEXT_LIMITS = {
  // Only the slices an agent needs for the current task. The full SSOT and
  // syllabus stay on disk and are read on demand through tools.
  ssot: 1200,
  syllabus: 650,
  focus: 700,
  memoryPerMessage: 220,
  memoryTotal: 700,
  total: 3600,
} as const;

// Which SSOT sections each role actually needs. A documentation agent does not
// need the technology census; an architecture agent does not need the whole
// structure tree. Unknown agents get the three cheap essentials.
const SSOT_FOCUS: Record<string, string[]> = {
  manu: ["## 1. Project", "## 3. Structure"],
  jarin: ["## 2. Detected technologies", "## 3. Structure"],
  brishti: ["## 1. Project", "## 2. Detected technologies"],
  rashed: ["## 2. Detected technologies", "## 3. Structure"],
  halim: ["## 1. Project", "## 3. Structure"],
  majnu: ["## 1. Project", "## 2. Detected technologies"],
  nila: ["## 3. Structure"],
  tuhin: ["## 2. Detected technologies"],
  zombiecoder: ["## 1. Project", "## 2. Detected technologies"],
};
const DEFAULT_SSOT_FOCUS = ["## 1. Project", "## 2. Detected technologies", "## 3. Structure"];
const SSOT_SECTION_BUDGET: Record<string, number> = {
  "## 1. Project": 350,
  "## 2. Detected technologies": 260,
  "## 3. Structure": 420,
};

// Who owns each context surface. The UI line names them so a user can see that
// SSOT, syllabus and memory are being managed, not silently assumed.
export const CONTEXT_OWNERS = {
  ssot: { agent: "manu", role: "Chief Systems Architect" },
  syllabus: { agent: "halim", role: "Documentation & Knowledge Engineer" },
  memory: { agent: "zombiecoder", role: "Chief Arbiter" },
  skills: { agent: "tuhin", role: "AIML & Model Auditor" },
  gate: { agent: "brishti", role: "Chief Security & Trust Analyst" },
} as const;

export type ContextOwners = typeof CONTEXT_OWNERS;

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
  /** Bytes of the SSOT excerpt actually prepared for the prompt, not the file. */
  ssotExcerptBytes: number;
  /** Bytes of the syllabus excerpt actually prepared for the prompt, not the file. */
  syllabusExcerptBytes: number;
  /** Target files resolved from the user's message, when one was available. */
  focus: FocusPlan | null;
  /** Goal contracts opened in this session whose result is not recorded yet. */
  openContractIDs: string[];
  memory: MemoryStatus;
  owners: ContextOwners;
};

// Provider-facing text must not carry the OS home directory. `/home/<user>` (or
// `C:\Users\<user>`) reveals the account name and device layout on every
// request, and a model provider is a third party. Tools still receive the real
// absolute paths — evidence quality is unchanged; only the copy that leaves the
// machine is rewritten to `~`.
const HOME_DIR = (() => {
  try {
    return os.homedir();
  } catch {
    return "";
  }
})();

export function stripHomePath(text: string, home = HOME_DIR): string {
  const value = String(text ?? "");
  const target = String(home ?? "").trim();
  if (!target || target === "/" || target === "\\") return value;
  const variants = new Set([
    target,
    target.replace(/\\/g, "/"),
    target.replace(/\//g, "\\"),
  ]);
  let out = value;
  for (const variant of variants) {
    if (variant) out = out.split(variant).join("~");
  }
  return out;
}

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

// The `context` hook fires on every model request, so re-reading and re-hashing
// a 26 KB SSOT file each time is pure latency. Cache by (path, mtime, size):
// the file is re-read only when it actually changes on disk.
type Snapshot = { mtimeMs: number; size: number; text: string | undefined; status: ContextFileStatus };
const snapshotCache = new Map<string, Snapshot>();

function statKey(file: string): { mtimeMs: number; size: number } | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

function snapshot(file: string, read: () => string | undefined): Snapshot {
  const key = statKey(file);
  const cached = snapshotCache.get(file);
  if (key && cached && cached.mtimeMs === key.mtimeMs && cached.size === key.size) return cached;
  const text = read();
  const value: Snapshot = {
    mtimeMs: key?.mtimeMs ?? 0,
    size: key?.size ?? -1,
    text,
    status: fileStatus(file, text),
  };
  snapshotCache.set(file, value);
  return value;
}

function section(text: string, prefix: string, limit: number): string {
  const start = text.indexOf(prefix);
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start + prefix.length);
  const body = next >= 0 ? text.slice(start, next) : text.slice(start);
  return clip(body, limit);
}

function ssotExcerpt(text: string, agentID: string): string {
  const focus = SSOT_FOCUS[agentID] ?? DEFAULT_SSOT_FOCUS;
  const parts = focus
    .map((prefix) => section(text, prefix, SSOT_SECTION_BUDGET[prefix] ?? 300))
    .filter(Boolean);
  return clip(parts.join("\n\n"), CONTEXT_LIMITS.ssot);
}

function syllabusExcerpt(text: string): string {
  // Lessons are the only syllabus content that changes per turn. The seed puts
  // its placeholder and signature above the first lesson, so slicing the raw
  // section used to send "_Nothing recorded yet_" to the model even when the
  // file had 12 lessons. Split on lesson headings instead and keep the newest.
  const at = text.indexOf("## 5. Lessons");
  if (at < 0) return "No lessons yet; read the full syllabus with read_syllabus before work.";
  const body = text.slice(at).replace(/^## 5\. Lessons[^\n]*\n/, "");
  const lessons = body
    .split(/^### /m)
    .slice(1)
    .map((entry) => entry.trimEnd())
    .filter((entry) => entry.length > 0 && !/^Goal Contract /i.test(entry));
  if (lessons.length === 0) {
    return "No lessons yet; read the full syllabus with read_syllabus before work.";
  }
  const newest = lessons[lessons.length - 1].trim();
  const header = `Newest of ${lessons.length} lessons (newest last). Full history: read_syllabus.`;
  return clip(`${header}\n### ${newest}`, CONTEXT_LIMITS.syllabus);
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
  userMessage = "",
  sessionID = "",
): ContextPack {
  const ssotPath = ssotFile(projectRoot);
  const syllabusPath = syllabusFile(projectRoot);
  const ssotSnap = snapshot(ssotPath, () => readText(ssotPath));
  const syllabusSnap = snapshot(syllabusPath, () => readSyllabus(projectRoot));
  const ssotText = ssotSnap.text;
  const syllabusText = syllabusSnap.text;
  const index = readIndex(projectRoot);
  const ssot = ssotSnap.status;
  const syllabus = syllabusSnap.status;
  const memory: MemoryStatus = {
    indexFile: memoryIndexFile(projectRoot),
    sessions: Object.keys(index.sessions).length,
    archives: Array.isArray(index.archives) ? index.archives.length : 0,
    recent: recent.length,
  };

  const ssotBody = ssot.exists
    ? ssotExcerpt(ssotText ?? "", agentID)
    : `Missing: ${ssotPath}. Run the plugin setup before making claims.`;
  const syllabusBody = syllabus.exists
    ? syllabusExcerpt(syllabusText ?? "")
    : `Missing: ${syllabusPath}. Run the plugin setup before making claims.`;
  const ssotExcerptBytes = ssot.exists ? Buffer.byteLength(ssotBody, "utf8") : 0;
  const syllabusExcerptBytes = syllabus.exists ? Buffer.byteLength(syllabusBody, "utf8") : 0;

  // The gate is derived from the syllabus ledger, not from the model's memory.
  // An open contract without a result block means work was pre-registered; no
  // open contract means the agent is about to start unregistered.
  const openContractsForSession = openContracts(syllabusText ?? "", sessionID);
  const gate = openContractsForSession.length
    ? [
        `- open: ${openContractsForSession
          .map((contract) => `${contract.id} — ${contract.goal || "(no goal recorded)"}`)
          .join("; ")}`,
        "- close it with the recorded check before claiming success; without that result the claim is UNVERIFIED.",
      ]
    : [
        "- none for this session.",
        "- Before the first write/edit/shell that changes the project, call `goal_contract` open: real input, observable expected output, check command, pass criteria.",
      ];

  // Focus: turn the user's sentence into the smallest truthful file set. This is
  // what stops the "plan first, scan everything" loop the audit found.
  let focusPlan: FocusPlan | null = null;
  if (String(userMessage ?? "").trim().length > 0) {
    try {
      const files = listProjectFiles(projectRoot);
      if (files.length > 0) focusPlan = resolveFocus(files, userMessage);
    } catch {
      focusPlan = null;
    }
  }
  const focusBody = focusPlan ? clip(focusPlan.text, CONTEXT_LIMITS.focus) : "";

  const lines = [
    "## ZombieCoder Compact Context Pack",
    "",
    `Agent: ${agentID}`,
    `Allowed root: ${projectRoot}`,
    `Path policy: paths outside the allowed root are denied; a claim with no path/test evidence is UNVERIFIED.`,
    "",
    ssot.exists
      ? `### SSOT excerpt (${ssotExcerptBytes}B from a ${ssot.bytes}B file, ${ssot.lines} lines)`
      : "### SSOT (missing)",
    ssotBody,
    "",
    syllabus.exists
      ? `### Syllabus excerpt (${syllabusExcerptBytes}B from a ${syllabus.bytes}B file)`
      : "### Syllabus (missing)",
    syllabusBody,
    "",
    "### Pre-work gate — goal contract",
    ...gate,
    "",
    ...(focusBody ? [`### Focus files — from the user's message (${Buffer.byteLength(focusBody, "utf8")}B)`, focusBody, ""] : []),
    `### Session memory (${memory.recent} recent, ${memory.archives} archives) — owner: ${CONTEXT_OWNERS.memory.agent}`,
    memorySummary(recent),
    "",
    "### Context ownership (visible in the UI)",
    `- SSOT → ${CONTEXT_OWNERS.ssot.agent} (${CONTEXT_OWNERS.ssot.role})`,
    `- Syllabus → ${CONTEXT_OWNERS.syllabus.agent} (${CONTEXT_OWNERS.syllabus.role})`,
    `- Memory → ${CONTEXT_OWNERS.memory.agent} (${CONTEXT_OWNERS.memory.role})`,
    `- Skills → ${CONTEXT_OWNERS.skills.agent} (${CONTEXT_OWNERS.skills.role})`,
    `- Evidence gate → ${CONTEXT_OWNERS.gate.agent} (${CONTEXT_OWNERS.gate.role})`,
  ];
  const text = stripHomePath(clip(lines.join("\n"), CONTEXT_LIMITS.total));
  const uiLine = `Context: SSOT ${ssot.exists ? "OK" : "MISSING"} (${CONTEXT_OWNERS.ssot.agent}) | Syllabus ${
    syllabus.exists ? "OK" : "MISSING"
  } (${CONTEXT_OWNERS.syllabus.agent}) | Memory ${memory.recent} recent / ${memory.archives} archives (${
    CONTEXT_OWNERS.memory.agent
  }) | Focus ${focusPlan ? `${focusPlan.primary.length}+${focusPlan.related.length} files` : "off"} | Contract ${
    openContractsForSession.length ? openContractsForSession[0].id : "none"
  } | Pack ${Buffer.byteLength(text, "utf8")}B`;
  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    uiLine,
    allowedRoot: projectRoot,
    ssot,
    syllabus,
    ssotExcerptBytes,
    syllabusExcerptBytes,
    focus: focusPlan,
    openContractIDs: openContractsForSession.map((contract) => contract.id),
    memory,
    owners: CONTEXT_OWNERS,
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
