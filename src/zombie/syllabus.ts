// Spec §4 — syllabus.
//
// Rules, personas, model policy and project references live here. The file is
// APPEND-ONLY: nothing in this module ever truncates it. If it is missing the
// agent seeds it from the SSOT fingerprint rather than asking the user.

import { appendJsonl, docWithSignature, readText, writeAtomic } from "./io.ts";
import { syllabusFile } from "./paths.ts";
import type { Fingerprint } from "./scan.ts";

export type SyllabusResult = {
  file: string;
  created: boolean;
  bytes: number;
};

export function readSyllabus(projectRoot: string): string | undefined {
  return readText(syllabusFile(projectRoot));
}

export function renderSyllabusSeed(fp: Fingerprint, agentIds: string[]): string {
  const langs = fp.languages.slice(0, 8).map((l) => l.name).join(", ") || "unknown";
  const body = [
    `# Syllabus — agent knowledge for this project`,
    ``,
    `> Seeded automatically from the project fingerprint. Append-only: new lessons are`,
    `> added at the bottom, nothing is ever removed.`,
    ``,
    `## 1. Scope`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Working directory | \`${fp.root}\` |`,
    `| Languages | ${langs} |`,
    `| Files scanned | ${fp.totalFiles} |`,
    `| Seeded at | ${fp.scannedAt} |`,
    ``,
    `## 2. Agents bound to this project`,
    ``,
    agentIds.map((a) => "- `" + a + "`").join("\n"),
    ``,
    `## 3. Standing rules`,
    ``,
    `1. SSOT first, then logic, then code.`,
    `2. Evidence before confidence. No evidence means no verified answer.`,
    `3. Never state a guess as a fact. Say "not verified" instead.`,
    `4. Every claim carries a label: SOURCE_VERIFIED, CONFIG_VALIDATED, LIVE_PROBE_PASSED, END_TO_END_TESTED, NOT_TESTED, UNVERIFIED.`,
    `5. Regression mindset: after a fix, re-run the checks that could have broken.`,
    `6. Two record-keeping duties only: back up before irreversible work, and log every action.`,
    ``,
    `## 4. Lessons (append-only)`,
    ``,
    `_Nothing recorded yet. Each new lesson lands below, newest last._`,
    ``,
  ].join("\n");
  return docWithSignature(body, "Syllabus", { files: fp.totalFiles });
}

export function ensureSyllabus(projectRoot: string, fp: Fingerprint, agentIds: string[]): SyllabusResult {
  const file = syllabusFile(projectRoot);
  const existing = readText(file);
  if (existing !== undefined && existing.trim().length > 0) {
    return { file, created: false, bytes: Buffer.byteLength(existing, "utf8") };
  }
  const seeded = renderSyllabusSeed(fp, agentIds);
  writeAtomic(file, seeded);
  return { file, created: true, bytes: Buffer.byteLength(seeded, "utf8") };
}

// Append-only lesson. Mirrored into footprint so the change is auditable.
export function appendSyllabus(
  projectRoot: string,
  topic: string,
  summary: string,
  footprint?: string,
): { file: string; bytes: number } {
  const file = syllabusFile(projectRoot);
  const existing = readText(file) ?? "";
  const block = [
    "",
    `### ${topic}`,
    ``,
    summary.trim(),
    ``,
    `_recorded ${new Date().toISOString()}_`,
    ``,
  ].join("\n");
  const next = existing.replace(/\s*$/, "") + "\n" + block;
  writeAtomic(file, next);
  if (footprint) {
    appendJsonl(footprint, {
      ts: new Date().toISOString(),
      kind: "syllabus.append",
      agent: "plugin",
      topic,
      bytes: Buffer.byteLength(block, "utf8"),
    });
  }
  return { file, bytes: Buffer.byteLength(next, "utf8") };
}
