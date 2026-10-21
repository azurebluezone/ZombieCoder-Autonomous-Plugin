#!/usr/bin/env node
/**
 * ZombieCoder integrity seal.
 *
 * Computes a SHA-256 manifest over code, tests, skills, package metadata and
 * license, then updates a small footer block in the documentation.
 *
 * Usage:
 *   node scripts/integrity.mjs            # write docs/INTEGRITY.md + JSON + footers
 *   node scripts/integrity.mjs --check    # verify the working tree, write nothing
 *
 * This is a checksum manifest for tamper detection. It is not a legal identity
 * signature: anyone who can edit the repo can also regenerate the manifest.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_JSON = join(ROOT, "docs", "integrity.json");
const OUT_MD = join(ROOT, "docs", "INTEGRITY.md");

const SCOPE = [
  "src",
  "bin",
  "scripts",
  "test",
  "docs/skills",
  "package.json",
  "LICENSE",
];

const FOOTER_DOCS = [
  { path: "README.md", link: "docs/INTEGRITY.md" },
  { path: "docs/100c-runtime-template.md", link: "INTEGRITY.md" },
  { path: "docs/AGENT-HANDOFF.md", link: "INTEGRITY.md" },
  { path: "docs/LSP.md", link: "INTEGRITY.md" },
  { path: "AGENTS.md", link: "docs/INTEGRITY.md" },
];

const SKIP = new Set(["docs/INTEGRITY.md", "docs/integrity.json"]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

function isIncluded(file) {
  const p = file.split(sep).join("/");
  if (SKIP.has(p)) return false;
  if (p.startsWith("node_modules/") || p.startsWith(".git/")) return false;
  if (p === "package.json" || p === "LICENSE") return true;
  return (
    p.startsWith("src/") ||
    p.startsWith("bin/") ||
    p.startsWith("scripts/") ||
    p.startsWith("test/") ||
    p.startsWith("docs/skills/")
  );
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function listFiles() {
  let files = [];
  const tracked = git([
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...SCOPE,
  ]);
  if (tracked) {
    files = tracked.split("\0").filter(Boolean);
  } else {
    files = SCOPE.flatMap((entry) => {
      const full = join(ROOT, entry);
      if (!existsSync(full)) return [];
      const stat = statSync(full);
      if (stat.isFile()) return [full];
      return walk(full);
    }).map((full) => relative(ROOT, full));
  }
  return [...new Set(files)]
    .map((file) => file.split(sep).join("/"))
    .filter(isIncluded)
    .sort((a, b) => a.localeCompare(b));
}

function build() {
  const files = listFiles().map((file) => {
    const full = join(ROOT, file);
    const buffer = readFileSync(full);
    return { path: file, bytes: buffer.length, sha256: sha256(buffer) };
  });
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const rootInput = files.map((file) => `${file.sha256}  ${file.path}\n`).join("");
  const root = sha256(rootInput);
  const commit = git(["rev-parse", "--short", "HEAD"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  // Only code-scope changes count here. Docs and the manifest itself are not
  // part of the hash, so they must not make the seal say "dirty" forever.
  const status = git(["status", "--porcelain", "--", ...SCOPE]) ?? "";
  const dirty = status.length > 0;
  return {
    schema: "zombiecoder-integrity/v1",
    generated_at: new Date().toISOString(),
    scope: SCOPE,
    root_sha256: root,
    file_count: files.length,
    total_bytes: totalBytes,
    git: { commit, branch, dirty },
    files,
  };
}

function sealBox(lines, width = 74) {
  const top = "╔" + "═".repeat(width) + "╗";
  const bottom = "╚" + "═".repeat(width) + "╝";
  const body = lines.map((line) => {
    const text = line.length > width - 4 ? line.slice(0, width - 4) : line;
    return "║  " + text.padEnd(width - 2) + "║";
  });
  return [top, ...body, bottom].join("\n");
}

function renderFooter(data, link) {
  const commit = data.git.commit ?? "no-git";
  const state = data.git.dirty ? "dirty" : "clean";
  const summary = `files ${data.file_count} · bytes ${data.total_bytes} · base ${commit} · ${state}`;
  const box = sealBox([`root  ${data.root_sha256}`, summary]);
  return `<!-- INTEGRITY:START -->
<div align="center">

### 🔐 ZombieCoder Integrity Seal

\`\`\`text
${box}
\`\`\`

[Full manifest](${link}) · Verify: \`npm run integrity:check\`

> SHA-256 over source, scripts, tests, skills, package metadata and license.
> Detects accidental or unauthorized changes. Not a legal identity signature.
> Base commit is the code tree before this seal commit. Generated: ${data.generated_at}

</div>
<!-- INTEGRITY:END -->`;
}

function updateFooters(data) {
  const changed = [];
  for (const doc of FOOTER_DOCS) {
    const full = join(ROOT, doc.path);
    if (!existsSync(full)) continue;
    const before = readFileSync(full, "utf8");
    const block = renderFooter(data, doc.link);
    const start = "<!-- INTEGRITY:START -->";
    const end = "<!-- INTEGRITY:END -->";
    let after;
    const startAt = before.indexOf(start);
    const endAt = before.indexOf(end, startAt + start.length);
    if (startAt >= 0 && endAt >= 0) {
      after =
        before.slice(0, startAt) +
        block +
        before.slice(endAt + end.length);
    } else {
      after = before.replace(/\s*$/, "") + "\n\n" + block + "\n";
    }
    if (after !== before) {
      writeFileSync(full, after);
      changed.push(doc.path);
    }
  }
  return changed;
}

function renderMarkdown(data) {
  const commit = data.git.commit ?? "no-git";
  const state = data.git.dirty ? "dirty" : "clean";
  const box = sealBox([
    `root  ${data.root_sha256}`,
    `files ${data.file_count} · bytes ${data.total_bytes} · base ${commit} · ${state}`,
  ]);
  const rows = data.files
    .map((file) => `| \`${file.path}\` | ${file.bytes} | \`${file.sha256}\` |`)
    .join("\n");
  return `# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, \`package.json\` ও \`LICENSE\`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

\`\`\`text
${box}
\`\`\`

| Field | Value |
|---|---|
| Schema | \`${data.schema}\` |
| Generated (UTC) | \`${data.generated_at}\` |
| Base commit | \`${commit}\` |
| Branch | \`${data.git.branch ?? "no-git"}\` |
| Code tree | \`${state}\` |
| Files | ${data.file_count} |
| Bytes | ${data.total_bytes} |
| Root SHA-256 | \`${data.root_sha256}\` |

## Scope

${data.scope.map((entry) => `- \`${entry}\``).join("\n")}

## Verify

\`\`\`bash
npm run integrity:check
\`\`\`

\`--check\` কোনো file লেখে না; mismatch হলে exit code \`1\` দেয়।

## Files

| Path | Bytes | SHA-256 |
|---|---:|---|
${rows}

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
\`npm run integrity\` চালিয়ে regenerate করুন।
`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    console.log("Usage: node scripts/integrity.mjs [--check] [--help]");
    return;
  }
  const data = build();
  if (args.has("--check")) {
    if (!existsSync(OUT_JSON)) {
      console.log(JSON.stringify({ ok: false, error: "missing docs/integrity.json" }, null, 2));
      process.exitCode = 1;
      return;
    }
    let expected;
    try {
      expected = JSON.parse(readFileSync(OUT_JSON, "utf8"));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: `cannot parse manifest: ${error}` }, null, 2));
      process.exitCode = 1;
      return;
    }
    const expectedMap = new Map((expected.files ?? []).map((file) => [file.path, file.sha256]));
    const actualMap = new Map(data.files.map((file) => [file.path, file.sha256]));
    const changed = data.files
      .filter((file) => expectedMap.has(file.path) && expectedMap.get(file.path) !== file.sha256)
      .map((file) => file.path);
    const missing = [...expectedMap.keys()].filter((path) => !actualMap.has(path));
    const extra = [...actualMap.keys()].filter((path) => !expectedMap.has(path));
    const ok =
      expected.root_sha256 === data.root_sha256 &&
      changed.length === 0 &&
      missing.length === 0 &&
      extra.length === 0;
    console.log(
      JSON.stringify(
        {
          ok,
          expected_root: expected.root_sha256 ?? null,
          actual_root: data.root_sha256,
          file_count: data.file_count,
          changed,
          missing,
          extra,
        },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
    return;
  }

  mkdirSync(join(ROOT, "docs"), { recursive: true });
  const changedDocs = updateFooters(data);
  writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + "\n");
  writeFileSync(OUT_MD, renderMarkdown(data));
  console.log(
    JSON.stringify(
      {
        ok: true,
        root_sha256: data.root_sha256,
        file_count: data.file_count,
        total_bytes: data.total_bytes,
        git: data.git,
        outputs: ["docs/INTEGRITY.md", "docs/integrity.json"],
        footers_updated: changedDocs,
      },
      null,
      2,
    ),
  );
}

main();
