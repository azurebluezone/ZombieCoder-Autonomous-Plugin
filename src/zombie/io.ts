// Small disk helpers. Every write is atomic (temp + rename) so a crash mid-write
// can never leave a half file behind. Nothing here deletes anything.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export const PRODUCT = "ZombieCoder";
export const PLUGIN_VERSION = "0.1.0";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeAtomic(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o644 });
  fs.renameSync(tmp, file);
}

export function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
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
  fs.appendFileSync(file, JSON.stringify(value) + "\n", { encoding: "utf8" });
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
