// Spec §4 — syllabus.
//
// Rules, personas, model policy and project references live here. The file is
// APPEND-ONLY: nothing in this module ever truncates it. If it is missing the
// agent seeds it from the SSOT fingerprint rather than asking the user.

import { appendJsonl, docWithSignature, readJsonl, readText, writeAtomic } from "./io.ts";
import { auditFile, syllabusFile } from "./paths.ts";
import type { Fingerprint } from "./scan.ts";
import { LEGACY_AGENT_IDS } from "../roster.ts";

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
    `12. Before work, read the input intake (§5) and the SSOT: locate the files bound to the request, then start. Planning stays at the goal-contract level; no long planning loops between syllabus and conversation.`,
    ``,
    `## 5. Input intake`,
    ``,
    `How work starts, for both a new project and an existing one:`,
    ``,
    `- **New project** — record the user's current intent and its expected output here once, at intake, before any code. Do not invent scope beyond that intent.`,
    `- **Existing project** — keep the previous proof/footprint (§2), standing rules (§4) and lessons (§6). An intake update adds the new intent; it never erases prior evidence.`,
    `- **Every later input** — read the SSOT and this syllabus first, map the request to the exact files from the project map/SSOT, and start there. Filename inventory is not proof of logic; open the files tied to the request.`,
    `- **Planning cap** — planning is the goal contract plus the few steps needed to hit the point. No hour-long planning between syllabus and conversation, no exploratory loops for a simple task, and no flattery/brokerage: keep only what the task needs.`,
    ``,
    `## 6. Lessons (append-only)`,
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
  const seedMarker = "## 6. Lessons (append-only)";
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
    const hasLegacyAgent = LEGACY_AGENT_IDS.some((id) => existing.includes("- `" + id + "`"));
    const needsUpgrade =
      !existing.includes("## 2. Footprint") ||
      !existing.includes("### Project map") ||
      !/^## 5\. Input intake$/m.test(existing) ||
      hasLegacyAgent;
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
export function appendSyllabus(  projectRoot: string,
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

// A new working directory must leave a trace, but a restart must not append the
// same lesson again. The marker line is the dedupe key: it is derived from the
// live fingerprint, so a changed tree produces a new lesson and an unchanged tree
// stays silent.
export type FootprintRecord = { appended: boolean; file: string; marker: string };

function auditSummary(projectRoot: string): string[] {
  const rows = readJsonl<any>(auditFile(projectRoot), 500);
  if (rows.length === 0) return ["- No previous audit trail in `.zombiecoder/.state/audit.jsonl`."];
  const failures = new Map<string, number>();
  let escalations = 0;
  let gateBlocks = 0;
  for (const row of rows) {
    if (row?.kind === "tool" && row?.status === "error") {
      const tool = String(row?.tool ?? "unknown");
      failures.set(tool, (failures.get(tool) ?? 0) + 1);
    }
    if (row?.kind === "agent.escalation") escalations += 1;
    if (row?.kind === "gate") gateBlocks += 1;
  }
  const top = [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return [
    `- Audit rows read: ${rows.length}`,
    top.length > 0 ? `- Tool failures: ${top.map(([tool, n]) => `${tool}×${n}`).join(", ")}` : "- Tool failures: none recorded",
    `- Agent escalations: ${escalations}`,
    `- Gate blocks: ${gateBlocks}`,
  ];
}

export function recordProjectFootprint(projectRoot: string, fp: Fingerprint): FootprintRecord {
  const file = syllabusFile(projectRoot);
  const marker = `fp:${fp.totalFiles}/${fp.totalBytes}/${fp.languages.slice(0, 3).map((l) => l.name).join("+") || "unknown"}`;
  const existing = readText(file) ?? "";
  if (existing.includes(marker)) return { appended: false, file, marker };
  const langs = fp.languages.slice(0, 6).map((l) => `${l.name}(${l.files})`).join(", ") || "unknown";
  const dirs = fp.topLevel.slice(0, 8).map((t) => "`" + t.name + (t.kind === "dir" ? "/" : "") + "`").join(", ") || "none";
  const summary = [
    `\`${marker}\``,
    "",
    `- Files / dirs / bytes: ${fp.totalFiles} / ${fp.totalDirs} / ${fp.totalBytes}`,
    `- Languages: ${langs}`,
    `- Top level: ${dirs}`,
    `- Markers: ${fp.markers.join(", ") || "none"}`,
    "",
    "Carried from the previous audit trail:",
    "",
    ...auditSummary(projectRoot),
    "",
    "Next action: read SSOT section 3 before opening files; do not re-scan the tree unless the fingerprint is stale.",
  ].join("\n");
  appendSyllabus(projectRoot, "Project footprint (auto)", summary, auditFile(projectRoot));
  return { appended: true, file, marker };
}
