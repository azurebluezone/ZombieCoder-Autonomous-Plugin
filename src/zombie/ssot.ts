// Spec §3 — the Single Source of Truth.
//
// SSOT.md is a *generated* document. Nobody hand-edits it; the plugin rewrites it
// from the live filesystem fingerprint plus the live agent/model plan. It carries
// the branded, timestamped signature at the bottom so a stale file is obvious.

import { docWithSignature, readJson, sha256, writeJson, writeAtomic } from "./io.ts";
import { fingerprintFile, ssotFile } from "./paths.ts";
import type { Fingerprint } from "./scan.ts";

export type SsotContext = {
  agentCount: number;
  agentIds: string[];
  modelStrategy: string;
  modelAssignment: Record<string, string>;
  customProviderUrl: string;
  customProviderReachable: boolean;
  opencodeVersion?: string;
};

export function renderSsot(fp: Fingerprint, extra: SsotContext): string {
  const name =
    (fp.manifests.package as any)?.name ??
    (fp.manifests.composer as any)?.name ??
    fp.root.split("/").filter(Boolean).pop() ??
    "project";
  const version = (fp.manifests.package as any)?.version;

  const lines: string[] = [];
  lines.push(`# SSOT — Single Source of Truth`);
  lines.push("");
  lines.push(`> Generated from the live filesystem. Hand edits are pointless — the next run overwrites them.`);
  lines.push("");
  lines.push(`## 1. Project`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Name | \`${name}\`${version ? ` v${version}` : ""} |`);
  lines.push(`| Working directory | \`${fp.root}\` |`);
  lines.push(`| Scanned at | ${fp.scannedAt} |`);
  lines.push(`| Files / dirs / bytes | ${fp.totalFiles} / ${fp.totalDirs} / ${fp.totalBytes} |`);
  if (fp.truncated) lines.push(`| Truncated | yes — file cap reached, counts are a lower bound |`);
  lines.push("");

  lines.push(`## 2. Languages`);
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

  lines.push(`## 5. Manifests`);
  lines.push("");
  if (Object.keys(fp.manifests).length === 0) {
    lines.push(`_No package.json or composer.json at the root._`);
  } else {
    lines.push("```json");
    lines.push(JSON.stringify(fp.manifests, null, 2));
    lines.push("```");
  }
  lines.push("");

  lines.push(`## 6. Ignored paths`);
  lines.push("");
  lines.push(fp.ignored.map((i) => "`" + i + "`").join(", "));
  lines.push("");

  lines.push(`## 7. Agents attached`);
  lines.push("");
  lines.push(`${extra.agentCount} agents registered for this location:`);
  lines.push("");
  lines.push(extra.agentIds.map((a) => "`" + a + "`").join(", "));
  lines.push("");

  lines.push(`## 8. Model plan`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Strategy | \`${extra.modelStrategy}\` |`);
  lines.push(`| Custom provider URL | \`${extra.customProviderUrl}\` |`);
  lines.push(`| Custom provider reachable | ${extra.customProviderReachable ? "yes" : "no"} |`);
  if (extra.opencodeVersion) lines.push(`| OpenCode version | \`${extra.opencodeVersion}\` |`);
  lines.push("");
  lines.push(`| Agent | Model |`);
  lines.push(`| --- | --- |`);
  for (const [agent, model] of Object.entries(extra.modelAssignment)) {
    lines.push(`| ${agent} | \`${model}\` |`);
  }
  lines.push("");

  return docWithSignature(lines.join("\n"), "SSOT", { files: fp.totalFiles });
}

export type SsotWrite = {
  file: string;
  bytes: number;
  sha256: string;
  writtenAt: string;
};

export function writeSsot(projectRoot: string, fp: Fingerprint, extra: SsotContext): SsotWrite {
  const markdown = renderSsot(fp, extra);
  const file = ssotFile(projectRoot);
  writeAtomic(file, markdown);
  // fingerprint.json keeps the raw machine-readable half of the same scan.
  writeJson(fingerprintFile(projectRoot), fp);
  return {
    file,
    bytes: Buffer.byteLength(markdown, "utf8"),
    sha256: sha256(markdown),
    writtenAt: new Date().toISOString(),
  };
}

export function readFingerprint(projectRoot: string): Fingerprint | undefined {
  return readJson<Fingerprint>(fingerprintFile(projectRoot));
}
