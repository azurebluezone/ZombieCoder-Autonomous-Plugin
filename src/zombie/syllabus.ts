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
  upgraded?: boolean;
  bytes: number;
};

export function readSyllabus(projectRoot: string): string | undefined {
  return readText(syllabusFile(projectRoot));
}

function renderProjectMap(fp: Fingerprint): string[] {
  const files = Array.isArray(fp.files) ? fp.files : [];
  if (files.length === 0) return ["_No files detected._"];
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const at = file.lastIndexOf("/");
    const dir = at >= 0 ? file.slice(0, at + 1) : "./";
    const name = at >= 0 ? file.slice(at + 1) : file;
    const list = byDir.get(dir) ?? [];
    list.push(name);
    byDir.set(dir, list);
  }
  const rows = [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b));
  const out: string[] = [];
  for (const [dir, names] of rows.slice(0, 30)) {
    const shown = names.slice(0, 10).map((n) => "`" + n + "`").join(", ");
    const more = names.length > 10 ? ` … +${names.length - 10}` : "";
    out.push(`| \`${dir}\` | ${shown}${more} |`);
  }
  if (rows.length > 30) out.push(`| _…_ | ${rows.length - 30} more directories; use \`project_fingerprint\` |`);
  return out;
}

export function renderSyllabusSeed(fp: Fingerprint, agentIds: string[]): string {
  const langs = fp.languages.slice(0, 8).map((l) => l.name).join(", ") || "unknown";
  const top =
    fp.topLevel
      .slice(0, 12)
      .map((t) => "`" + t.name + (t.kind === "dir" ? "/" : "") + "`")
      .join(", ") || "_none_";
  const manifests = Object.keys(fp.manifests).map((m) => "`" + m + "`").join(", ") || "_none_";
  const markers = fp.markers.map((m) => "`" + m + "`").join(", ") || "_none_";
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
    `## 2. Footprint (auto-discovered)`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Top-level entries | ${top} |`,
    `| Manifests | ${manifests} |`,
    `| Markers | ${markers} |`,
    `| Files / dirs / bytes | ${fp.totalFiles} / ${fp.totalDirs} / ${fp.totalBytes} |`,
    ``,
    `### Project map (directory → key files)`,
    ``,
    `| Directory | Files |`,
    `| --- | --- |`,
    ...renderProjectMap(fp),
    ``,
    `_This map is the footprint. Do not create a separate footprint file. If it is`,
    `missing or stale, explore the project and update this section in place; add`,
    `durable lessons to §5._`,
    ``,
    `## 3. Agents bound to this project`,
    ``,
    agentIds.map((a) => "- `" + a + "`").join("\n"),
    ``,
    `## 4. Standing rules`,
    ``,
    `1. SSOT first, then logic, then code.`,
    `2. Evidence before confidence. No evidence means no verified answer.`,
    `3. Never state a guess as a fact. Say "not verified" instead.`,
    `4. Every claim carries a label: SOURCE_VERIFIED, CONFIG_VALIDATED, LIVE_PROBE_PASSED, END_TO_END_TESTED, NOT_TESTED, UNVERIFIED.`,
    `5. Regression mindset: after a fix, re-run the checks that could have broken.`,
    `6. Two record-keeping duties only: back up before irreversible work, and log every action.`,
    `7. Every response starts with "ভাইয়া"; chat in Bengali, code/shortcuts in English.`,
    `8. Never lie. Admit a mistake; an honest "I don't know" beats a confident guess.`,
    `9. Read the directory and this syllabus before writing; do not rely on memory.`,
    `10. Shortest evidence-backed answer wins. Send only the necessary context to the provider.`,
    `11. Every agent is a main agent; delegate with a named teammate and minimal context.`,
    ``,
    `## 5. Lessons (append-only)`,
    ``,
    `_Nothing recorded yet. Each new lesson lands below, newest last._`,
    ``,
  ].join("\n");
  return docWithSignature(body, "Syllabus", { files: fp.totalFiles });
}

const LESSONS_PLACEHOLDER = "_Nothing recorded yet. Each new lesson lands below, newest last._";

// Upgrade an older seed without losing a single lesson. The header is allowed to
// change (new footprint section, renamed agent); the lesson body is append-only.
function upgradeSyllabus(existing: string, fp: Fingerprint, agentIds: string[]): string {
  const seed = renderSyllabusSeed(fp, agentIds);
  const seedMarker = "## 5. Lessons (append-only)";
  const seedAt = seed.indexOf(seedMarker);
  if (seedAt < 0) return seed;

  const oldAt = existing.search(/^## \d+\. Lessons[^\n]*$/m);
  let lessons = "";
  if (oldAt >= 0) {
    lessons = existing
      .slice(oldAt)
      .replace(/^## \d+\. Lessons[^\n]*\n+/, "")
      .replace(/\n---\n\n_— ZombieCoder Syllabus[^\n]*\n?$/, "")
      .trim();
  }
  if (!lessons || lessons === LESSONS_PLACEHOLDER) lessons = LESSONS_PLACEHOLDER;

  const header = seed.slice(0, seedAt);
  const sigAt = seed.indexOf("---", seedAt);
  const signature = sigAt >= 0 ? seed.slice(sigAt) : "";
  return `${header}${seedMarker}\n\n${lessons}\n\n${signature}`;
}

export function ensureSyllabus(projectRoot: string, fp: Fingerprint, agentIds: string[]): SyllabusResult {
  const file = syllabusFile(projectRoot);
  const existing = readText(file);
  if (existing !== undefined && existing.trim().length > 0) {
    const needsUpgrade =
      !existing.includes("## 2. Footprint") ||
      !existing.includes("### Project map") ||
      existing.includes("- `kobir`");
    if (!needsUpgrade) {
      return { file, created: false, bytes: Buffer.byteLength(existing, "utf8") };
    }
    const upgraded = upgradeSyllabus(existing, fp, agentIds);
    writeAtomic(file, upgraded);
    return {
      file,
      created: false,
      upgraded: true,
      bytes: Buffer.byteLength(upgraded, "utf8"),
    };
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
