import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../src/zombie/scan.ts";
import { redact } from "../src/zombie/io.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("installer/runtime sources do not duplicate provider defaults or credentials", () => {
  const files = [
    ...sourceFiles(path.join(ROOT, "src")),
    ...sourceFiles(path.join(ROOT, "bin")),
    ...sourceFiles(path.join(ROOT, "scripts")),
  ];
  const relative = (file: string) => path.relative(ROOT, file);
  const contents = files.map((file) => ({ file: relative(file), text: fs.readFileSync(file, "utf8") }));

  const onlyInDefaults = (pattern: RegExp, allowed: string) => {
    const hits = contents.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
    assert.deepEqual(hits, [allowed], `${pattern} must live only in ${allowed}`);
  };

  onlyInDefaults(/gpu\.zombiecoder\.my\.id/, "src/zombie/defaults.ts");
  onlyInDefaults(/127\.0\.0\.1:49374/, "src/zombie/defaults.ts");
  onlyInDefaults(/missionbarisal/, "src/zombie/defaults.ts");
  onlyInDefaults(/opencode\/big-pickle/, "src/roster.ts");

  for (const { file, text } of contents) {
    assert.doesNotMatch(text, /apiKey\s*:\s*["']public["']/, `${file} still hardcodes a fake credential`);
    assert.doesNotMatch(text, /\.archive-2026-10-19/, `${file} still carries a project-specific ignore path`);
    assert.doesNotMatch(text, /missionbarisal\/undefined/, `${file} can still emit provider/undefined`);
  }
});

test("redact removes bearer tokens and key assignments from reports", () => {
  assert.equal(
    redact("Authorization: Bearer zc-super-secret"),
    "Authorization: Bearer [REDACTED]",
  );
  assert.equal(redact("apiKey=abc123 token: xyz"), "apiKey=[REDACTED] token: [REDACTED]");
  assert.doesNotMatch(redact("contact user@example.test"), /\[REDACTED\]/);
});

test("scanProject does not silently ignore an archive-looking directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-scan-"));
  const hidden = path.join(root, ".archive-2026-10-19");
  fs.mkdirSync(hidden, { recursive: true });
  fs.writeFileSync(path.join(hidden, "note.txt"), "keep me\n");
  const fp = scanProject(root);
  assert.ok(fp.files.includes(".archive-2026-10-19/note.txt"));
  assert.ok(!fp.ignored.includes(".archive-2026-10-19"));
  fs.rmSync(root, { recursive: true, force: true });
});
