// Small disk helpers. Every write is atomic (temp + rename) so a crash mid-write
// can never leave a half file behind. Nothing here deletes anything.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { PRODUCT, PLUGIN_VERSION } from "./defaults.ts";

export { PRODUCT, PLUGIN_VERSION };

// Audit records leave the process, so credentials must be removed at the
// boundary. The patterns cover the shapes this plugin can actually see:
// bearer headers, OpenAI-style keys, and key/token/password assignments.
export function redact(text: string): string {
  return String(text)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[REDACTED]")
    .replace(
      /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret)\s*["']?\s*[:=]\s*["']?)[^\s,;"'}\]]+/gi,
      "$1[REDACTED]",
    );
}

/** Recursive form of redact(), for audit records and report details. */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(item);
    }
    return out as T;
  }
  return value;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeAtomic(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const tmp = file + "." + process.pid + ".tmp";
  // Preserve an existing mode so a secret-bearing config never becomes
  // world-readable just because the plugin rewrote it.
  let mode = 0o644;
  try {
    if (fs.existsSync(file)) mode = fs.statSync(file).mode & 0o777;
  } catch {
    /* keep the default */
  }
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode });
  fs.renameSync(tmp, file);
}

export function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

export function parseEnvironmentFile(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export function readEnvironmentFile(file: string): Record<string, string> {
  const raw = readText(file);
  return raw === undefined ? {} : parseEnvironmentFile(raw);
}

export function readJson<T = any>(file: string): T | undefined {
  const raw = readText(file);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function writeJson(file: string, value: unknown): void {
  writeAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function readJsonl<T = any>(file: string, limit?: number): T[] {
  const raw = readText(file);
  if (!raw) return [];
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const slice = limit && limit > 0 ? lines.slice(-limit) : lines;
  const out: T[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* skip a torn line rather than lose the rest */
    }
  }
  return out;
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// "সময়সহ ব্র্যান্ডিং সিগনেচার" — spec §3.3. Every generated document ends with
// this line, so a human can always see which run produced the file.
export function signature(kind: string, extra?: Record<string, string | number>): string {
  const stamp = new Date().toISOString();
  const tail = extra
    ? " · " +
      Object.entries(extra)
        .map(([k, v]) => `${k}=${v}`)
        .join(" · ")
    : "";
  return `_— ${PRODUCT} ${kind} · v${PLUGIN_VERSION} · generated ${stamp}${tail}_`;
}

export function docWithSignature(body: string, kind: string, extra?: Record<string, string | number>): string {
  return body.replace(/\s*$/, "") + "\n\n---\n\n" + signature(kind, extra) + "\n";
}
