// First-input onboarding evidence.
//
// The plugin cannot read the user's mind or the model's training cutoff. It can
// collect what the tree, the manifests and the logs actually prove, then hand
// that to the agent with a checklist. The agent still has to read the docs and
// the code and append the human judgement; this module only removes the excuse
// of "I did not see the project".

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { readJsonl, redact, sha256 } from "./io.ts";
import { auditFile, syllabusFile } from "./paths.ts";
import type { Fingerprint } from "./scan.ts";
import { detectProjectSkills, listSkillCatalog } from "./skillCatalog.ts";
import { appendSyllabus, readSyllabus } from "./syllabus.ts";

export type LogFinding = {
  file: string;
  bytes: number;
  errors: string[];
};

export type MarkerFinding = {
  file: string;
  line: number;
  kind: string;
  text: string;
};

export type ProjectIdentity = {
  name: string;
  version: string;
  description: string;
  scripts: string[];
};

export type OnboardingEvidence = {
  root: string;
  scannedAt: string;
  project: ProjectIdentity;
  totalFiles: number;
  totalBytes: number;
  languages: string[];
  topLevel: string[];
  docs: string[];
  tests: string[];
  logs: LogFinding[];
  markers: MarkerFinding[];
  git: { branch: string; head: string; changes: number } | null;
  auditFailures: Array<{ kind: string; tool?: string; error?: string }>;
  skills: {
    detected: string[];
    installed: string[];
    missing: string[];
    checked: boolean;
  };
  gaps: string[];
  unverified: string[];
};

const DOC_PATTERN = /^(README(?:\.[a-z0-9]+)?|(?:docs?)\/.*\.md)$/i;
const TEST_PATTERN = /^(?:test|tests|__tests__)\/|\.(?:test|spec)\.[a-z0-9]+$/i;
const CODE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|php|go|rs|java|kt|rb)$/i;
const LOG_PATTERN = /(?:^|\/)logs?\/.*\.log$|^[^/]+\.log$/i;
const ERROR_LINE = /\b(?:error|fatal|exception|traceback|failed|refused|timeout|unhandled)\b/i;
const MARKER_LINE = /\b(TODO|FIXME|HACK|NOTE)\b[:\s-]*(.*)/;

const MAX_DOCS = 24;
const MAX_TESTS = 24;
const MAX_LOGS = 6;
const MAX_LOG_BYTES = 32 * 1024;
const MAX_MARKER_FILES = 80;
const MAX_MARKERS = 40;
const MAX_AUDIT_ROWS = 500;

function tail(file: string, maxBytes: number): string {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return "";
    const size = Math.min(maxBytes, stat.size);
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(size);
      const read = fs.readSync(fd, buffer, 0, size, Math.max(0, stat.size - size));
      return buffer.subarray(0, read).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function projectIdentity(root: string): ProjectIdentity {
  const fallback: ProjectIdentity = { name: path.basename(root), version: "unknown", description: "", scripts: [] };
  for (const manifest of ["package.json", "composer.json"]) {
    const file = path.join(root, manifest);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return {
        name: String(parsed?.name ?? fallback.name),
        version: String(parsed?.version ?? "unknown"),
        description: String(parsed?.description ?? "").slice(0, 240),
        scripts: Object.keys(parsed?.scripts ?? {}).slice(0, 12),
      };
    } catch {
      return { ...fallback, description: `${manifest} is unreadable` };
    }
  }
  return fallback;
}

function gitState(root: string): OnboardingEvidence["git"] {
  if (!fs.existsSync(path.join(root, ".git"))) return null;
  const run = (args: string[]): string => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        timeout: 3_000,
        maxBuffer: 1024 * 1024,
      }).trim();
    } catch {
      return "";
    }
  };
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = run(["rev-parse", "--short", "HEAD"]);
  if (!branch && !head) return null;
  const status = run(["status", "--porcelain"]);
  return {
    branch: branch || "unknown",
    head: head || "unknown",
    changes: status ? status.split("\n").filter((line) => line.trim().length > 0).length : 0,
  };
}

function auditFailures(root: string): OnboardingEvidence["auditFailures"] {
  const rows = readJsonl<any>(auditFile(root), MAX_AUDIT_ROWS);
  const out: OnboardingEvidence["auditFailures"] = [];
  for (const row of rows) {
    const failed = row?.status === "error" || row?.ok === false;
    const escalation = row?.kind === "agent.escalation" || row?.kind === "gate";
    if (!failed && !escalation) continue;
    out.push({
      kind: String(row?.kind ?? "unknown"),
      tool: typeof row?.tool === "string" ? row.tool : undefined,
      error: typeof row?.error === "string" ? redact(row.error).slice(0, 240) : undefined,
    });
    if (out.length >= 8) break;
  }
  return out;
}

function markerScan(root: string, files: string[]): MarkerFinding[] {
  const out: MarkerFinding[] = [];
  for (const file of files.filter((entry) => CODE_PATTERN.test(entry)).slice(0, MAX_MARKER_FILES)) {
    const raw = tail(path.join(root, file), 48 * 1024);
    if (!raw) continue;
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = MARKER_LINE.exec(lines[index]);
      if (!match) continue;
      out.push({
        file,
        line: index + 1,
        kind: match[1],
        text: match[2].trim().slice(0, 140),
      });
      if (out.length >= MAX_MARKERS) return out;
    }
  }
  return out;
}

function logScan(root: string, files: string[]): LogFinding[] {
  const out: LogFinding[] = [];
  for (const file of files.filter((entry) => LOG_PATTERN.test(entry)).slice(0, MAX_LOGS)) {
    const raw = tail(path.join(root, file), MAX_LOG_BYTES);
    if (!raw) continue;
    const errors = raw
      .split(/\r?\n/)
      .filter((line) => ERROR_LINE.test(line))
      .slice(-6)
      .map((line) => redact(line.trim()).slice(0, 240));
    out.push({ file, bytes: Buffer.byteLength(raw, "utf8"), errors });
  }
  return out;
}

export function onboardingMarker(fp: Fingerprint): string {
  const digest = sha256((fp.files ?? []).join("\n")).slice(0, 12);
  return `onboarding:${digest}`;
}

export function collectOnboardingEvidence(
  projectRoot: string,
  fp: Fingerprint,
  options: { installRoot?: string } = {},
): OnboardingEvidence {
  const root = path.resolve(projectRoot);
  const files = Array.isArray(fp.files) ? fp.files : [];
  const docs = files.filter((file) => DOC_PATTERN.test(file)).sort().slice(0, MAX_DOCS);
  const tests = files.filter((file) => TEST_PATTERN.test(file)).sort().slice(0, MAX_TESTS);
  const logs = logScan(root, files);
  const markers = markerScan(root, files);
  const git = gitState(root);
  const audit = auditFailures(root);

  const detected = detectProjectSkills(root);
  let installed: string[] = [];
  let checked = false;
  if (options.installRoot) {
    try {
      installed = listSkillCatalog(options.installRoot)
        .skills.filter((skill) => skill.installed)
        .map((skill) => skill.id);
      checked = true;
    } catch {
      checked = false;
    }
  }
  const missing = checked ? detected.filter((id) => !installed.includes(id)) : [];

  const gaps: string[] = [];
  if (docs.length === 0) gaps.push("No README/docs found; the project's stated purpose is not written down.");
  if (tests.length === 0) gaps.push("No test files detected; behaviour cannot be re-proved from the repo alone.");
  if (logs.some((entry) => entry.errors.length > 0)) {
    gaps.push("Log files contain error/failure lines; reproduce them before changing code.");
  }
  if (audit.length > 0) gaps.push("The audit trail contains recent tool/gate failures.");
  if (markers.length > 0) gaps.push(`${markers.length} open TODO/FIXME/NOTE marker(s) remain in source.`);
  if (git && git.changes > 0) {
    gaps.push(`Git working tree has ${git.changes} uncommitted change(s); the running code may differ from HEAD.`);
  }
  if (missing.length > 0) gaps.push(`Skills for this stack are not installed: ${missing.join(", ")}.`);

  const unverified = [
    "Whether the docs match the running behaviour; the agent must read both.",
    "The model's training cutoff; the agent must check versions against official docs.",
    "The user's expectation; the agent must record it in the syllabus, not infer it from the tree.",
  ];

  return {
    root,
    scannedAt: new Date().toISOString(),
    project: projectIdentity(root),
    totalFiles: fp.totalFiles,
    totalBytes: fp.totalBytes,
    languages: fp.languages.slice(0, 8).map((entry) => `${entry.name}(${entry.files})`),
    topLevel: fp.topLevel.slice(0, 12).map((entry) => entry.name + (entry.kind === "dir" ? "/" : "")),
    docs,
    tests,
    logs,
    markers,
    git,
    auditFailures: audit,
    skills: { detected, installed, missing, checked },
    gaps,
    unverified,
  };
}

function renderList(values: string[], empty: string, limit = 12): string {
  if (values.length === 0) return empty;
  const shown = values.slice(0, limit);
  const more = values.length > limit ? ` … +${values.length - limit}` : "";
  return shown.map((value) => "`" + value + "`").join(", ") + more;
}

export function renderOnboardingLesson(evidence: OnboardingEvidence): string {
  const lines = [
    `- Project: \`${evidence.project.name}\` ${evidence.project.version}${
      evidence.project.description ? ` — ${evidence.project.description}` : ""
    }`,
    `- Project root: \`${evidence.root}\``,
    `- Files / bytes: ${evidence.totalFiles} / ${evidence.totalBytes}`,
    `- Languages: ${evidence.languages.join(", ") || "unknown"}`,
    `- Top level: ${renderList(evidence.topLevel, "empty")}`,
    `- Scripts: ${renderList(evidence.project.scripts, "none declared")}`,
    `- Docs: ${renderList(evidence.docs, "none found")}`,
    `- Tests: ${renderList(evidence.tests, "none found")}`,
    `- Logs: ${
      evidence.logs.length === 0
        ? "no .log files found"
        : evidence.logs
            .map((entry) => `\`${entry.file}\` (${entry.bytes}B, ${entry.errors.length} error line(s))`)
            .join(", ")
    }`,
    ...(evidence.logs.some((entry) => entry.errors.length > 0)
      ? [
          "",
          "**Log problems (tail)**",
          "",
          ...evidence.logs
            .filter((entry) => entry.errors.length > 0)
            .flatMap((entry) => entry.errors.map((line) => `- \`${entry.file}\`: ${line}`)),
        ]
      : []),
    `- Markers: ${
      evidence.markers.length === 0
        ? "none"
        : evidence.markers
            .slice(0, 8)
            .map((entry) => `\`${entry.file}:${entry.line}\` ${entry.kind} ${entry.text}`)
            .join("; ")
    }`,
    `- Git: ${
      evidence.git
        ? `${evidence.git.branch} @ ${evidence.git.head}, ${evidence.git.changes} uncommitted change(s)`
        : "not a git working tree"
    }`,
    `- Skills: detected ${renderList(evidence.skills.detected, "none")}; installed ${
      evidence.skills.checked ? renderList(evidence.skills.installed, "none") : "not checked"
    }${evidence.skills.missing.length ? `; missing ${evidence.skills.missing.join(", ")}` : ""}`,
    "",
    "**Audit failures carried over**",
    "",
    ...(evidence.auditFailures.length > 0
      ? evidence.auditFailures.map(
          (entry) => `- ${entry.kind}${entry.tool ? ` (${entry.tool})` : ""}${entry.error ? `: ${entry.error}` : ""}`,
        )
      : ["- none recorded"]),
    "",
    "**Evidence-backed gaps**",
    "",
    ...(evidence.gaps.length > 0
      ? evidence.gaps.map((gap) => `- ${gap}`)
      : ["- None found. This does not prove the user's expectation is met."]),
    "",
    "**Still unverified**",
    "",
    ...evidence.unverified.map((item) => `- ${item}`),
    "",
    "**Agent checklist before the first goal contract**",
    "",
    "1. Read the docs above and compare every claim with the current code.",
    "2. Reproduce any log/audit failure against the real input before fixing it.",
    "3. Write the user's expectation, the contradictions and the remaining gaps into this syllabus with `append_syllabus`.",
    "4. If the stack/version is newer than the model's training, `websearch` the official docs, then install the needed skill with `skill_catalog`.",
    "5. Only then open `goal_contract`; the user must approve it. A passing check is not user consent.",
  ];
  return lines.join("\n");
}

export type OnboardingResult = {
  created: boolean;
  file: string;
  marker: string;
  evidence: OnboardingEvidence;
};

/**
 * Append the onboarding lesson once per file tree. A renamed/added file changes
 * the marker, so the next first-input pass gets a fresh record; content-only
 * edits do not, because the agent's manual review is the part that must judge
 * behaviour, not the scanner.
 */
export function ensureOnboarding(
  projectRoot: string,
  fp: Fingerprint,
  options: { installRoot?: string; evidence?: OnboardingEvidence } = {},
): OnboardingResult {
  const root = path.resolve(projectRoot);
  const marker = onboardingMarker(fp);
  const existing = readSyllabus(root) ?? "";
  if (existing.includes(marker)) {
    return {
      created: false,
      file: syllabusFile(root),
      marker,
      evidence: options.evidence ?? collectOnboardingEvidence(root, fp, options),
    };
  }
  const evidence = options.evidence ?? collectOnboardingEvidence(root, fp, options);
  const body = [`\`${marker}\``, "", renderOnboardingLesson(evidence)].join("\n");
  appendSyllabus(root, "Project onboarding", body, auditFile(root));
  return { created: true, file: syllabusFile(root), marker, evidence };
}
