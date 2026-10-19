// Spec §3 — the Single Source of Truth.
//
// SSOT.md is generated from the live filesystem scan. It is project knowledge,
// not global config: model routing and MCP live in ~/.config/opencode. The file
// also carries the shared agent team/persona so every agent can see who can help.

import { docWithSignature, sha256, writeAtomic } from "./io.ts";
import { ssotFile } from "./paths.ts";
import { ROSTER, SHARED_EXPERTISE, SHARED_RULES } from "../roster.ts";
import type { Fingerprint } from "./scan.ts";

function packageInfo(fp: Fingerprint) {
  const pkg = fp.manifests.package as any;
  const composer = fp.manifests.composer as any;
  return {
    name: pkg?.name ?? composer?.name ?? fp.root.split("/").filter(Boolean).pop() ?? "project",
    version: pkg?.version,
    type: pkg?.type,
    scripts: pkg?.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, string>) : {},
    dependencies: Array.isArray(pkg?.dependencies) ? (pkg.dependencies as string[]) : [],
    devDependencies: Array.isArray(pkg?.devDependencies) ? (pkg.devDependencies as string[]) : [],
  };
}

// A compact, deterministic shortlist for the SSOT. The full file list lives in
// the live scan (project_fingerprint tool); this is the map an agent reads first.
function keyFiles(fp: Fingerprint): string[] {
  const all = Array.isArray(fp.files) ? fp.files : [];
  const out: string[] = [];
  const preferred = [
    /^package\.json$/,
    /^tsconfig\.json$/,
    /^README\.md$/i,
    /^(src|app|lib)\/(index|main|app|server)\.(ts|tsx|js|jsx|py|go|rs)$/,
    /^(src|app|lib)\//,
    /^test\//,
  ];
  for (const pattern of preferred) {
    for (const file of all) {
      if (out.includes(file)) continue;
      if (pattern.test(file)) out.push(file);
      if (out.length >= 80) return out;
    }
  }
  for (const file of all) {
    if (!out.includes(file)) out.push(file);
    if (out.length >= 80) break;
  }
  return out;
}

function withoutHeading(text: string): string {
  return text.replace(/^##[^\n]*\n+/, "").trim();
}

export function renderSsot(fp: Fingerprint): string {
  const pkg = packageInfo(fp);
  const lines: string[] = [];
  lines.push(`# SSOT — Single Source of Truth`);
  lines.push("");
  lines.push(`> Generated from the live filesystem. Hand edits are pointless — the next run overwrites them.`);
  lines.push("");

  lines.push(`## 1. Project`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Name | \`${pkg.name}\`${pkg.version ? ` v${pkg.version}` : ""} |`);
  if (pkg.type) lines.push(`| Module type | \`${pkg.type}\` |`);
  lines.push(`| Working directory | \`${fp.root}\` |`);
  lines.push(`| Scanned at | ${fp.scannedAt} |`);
  lines.push(`| Files / dirs / bytes | ${fp.totalFiles} / ${fp.totalDirs} / ${fp.totalBytes} |`);
  if (fp.truncated) lines.push(`| Truncated | yes — file cap reached, counts are a lower bound |`);
  lines.push("");

  if (Object.keys(pkg.scripts).length > 0) {
    lines.push(`### Scripts`);
    lines.push("");
    lines.push(`| Name | Command |`);
    lines.push(`| --- | --- |`);
    for (const [name, command] of Object.entries(pkg.scripts).slice(0, 30)) {
      lines.push(`| \`${name}\` | \`${String(command)}\` |`);
    }
    lines.push("");
  }

  lines.push(`## 2. Detected technologies`);
  lines.push("");
  if (fp.languages.length === 0) {
    lines.push(`_No source files detected._`);
  } else {
    lines.push(`| Language | Files | Bytes |`);
    lines.push(`| --- | ---: | ---: |`);
    for (const l of fp.languages.slice(0, 25)) {
      lines.push(`| ${l.name} | ${l.files} | ${l.bytes} |`);
    }
  }
  lines.push("");
  if (pkg.dependencies.length > 0 || pkg.devDependencies.length > 0) {
    lines.push(`| Dependency kind | Packages (first 30) |`);
    lines.push(`| --- | --- |`);
    if (pkg.dependencies.length > 0) {
      lines.push(`| Runtime | ${pkg.dependencies.slice(0, 30).map((d) => "`" + d + "`").join(", ")} |`);
    }
    if (pkg.devDependencies.length > 0) {
      lines.push(`| Dev | ${pkg.devDependencies.slice(0, 30).map((d) => "`" + d + "`").join(", ")} |`);
    }
    lines.push("");
  }

  lines.push(`## 3. Structure (depth ≤ 6)`);
  lines.push("");
  if (fp.tree.length === 0) {
    lines.push(`_Empty or unreadable._`);
  } else {
    lines.push("```text");
    for (const t of fp.tree) lines.push(t);
    lines.push("```");
  }
  lines.push("");

  lines.push(`## 4. Markers detected`);
  lines.push("");
  lines.push(fp.markers.length ? fp.markers.map((m) => "`" + m + "`").join(", ") : "_none_");
  lines.push("");

  lines.push(`## 5. Key files`);
  lines.push("");
  const keys = keyFiles(fp);
  if (keys.length === 0) {
    lines.push(`_No files detected._`);
  } else {
    lines.push(keys.map((f) => "- `" + f + "`").join("\n"));
    if ((fp.files?.length ?? 0) >= 500) {
      lines.push("");
      lines.push(`_File list capped at 500; use the \`project_fingerprint\` tool for a live scan._`);
    }
  }
  lines.push("");

  lines.push(`## 6. Manifests`);
  lines.push("");
  if (Object.keys(fp.manifests).length === 0) {
    lines.push(`_No package.json or composer.json at the root._`);
  } else {
    lines.push("```json");
    lines.push(JSON.stringify(fp.manifests, null, 2));
    lines.push("```");
  }
  lines.push("");

  lines.push(`## 7. Agent team (shared persona)`);
  lines.push("");
  lines.push(
    `All ${ROSTER.length} agents are main agents (\`mode: all\`): select any from the dropdown, and any agent may delegate to another.`,
  );
  lines.push("");
  for (const a of ROSTER) {
    lines.push(`### ${a.name} — ${a.callSign} (\`${a.id}\`)`);
    lines.push("");
    lines.push(`- **Role:** ${a.role}`);
    lines.push(`- **Mode:** ${a.mode} (primary + subagent)`);
    lines.push(`- **Mission:** ${a.mission}`);
    lines.push(`- **Core Persona:** "${a.persona}"`);
    lines.push(`- **Decision Rule:** ${a.rule}`);
    lines.push("");
  }

  lines.push(`## 8. Shared operating rules`);
  lines.push("");
  lines.push(withoutHeading(SHARED_RULES));
  lines.push("");

  lines.push(`## 9. Cross-domain baseline`);
  lines.push("");
  lines.push(withoutHeading(SHARED_EXPERTISE));
  lines.push("");

  lines.push(`## 10. Ignored paths`);
  lines.push("");
  lines.push(fp.ignored.map((i) => "`" + i + "`").join(", "));
  lines.push("");

  return docWithSignature(lines.join("\n"), "SSOT", { files: fp.totalFiles });
}

export type SsotWrite = {
  file: string;
  bytes: number;
  sha256: string;
  writtenAt: string;
};

export function writeSsot(projectRoot: string, fp: Fingerprint): SsotWrite {
  const markdown = renderSsot(fp);
  const file = ssotFile(projectRoot);
  writeAtomic(file, markdown);
  return {
    file,
    bytes: Buffer.byteLength(markdown, "utf8"),
    sha256: sha256(markdown),
    writtenAt: new Date().toISOString(),
  };
}
