// Onboarding evidence is a fact pack, not a claim. These tests build a small
// temporary project and prove that the scanner reads the real files, that the
// lesson is appended once per tree, and that a changed tree gets a new record.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  collectOnboardingEvidence,
  ensureOnboarding,
  onboardingMarker,
  renderOnboardingLesson,
} from "../src/zombie/onboarding.ts";
import { scanProject } from "../src/zombie/scan.ts";
import { auditFile, syllabusFile } from "../src/zombie/paths.ts";
import { appendJsonl } from "../src/zombie/io.ts";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-onboarding-"));
}

function write(root: string, file: string, content: string): void {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function seedProject(): string {
  const root = tempProject();
  write(
    root,
    "package.json",
    JSON.stringify({
      name: "demo-app",
      version: "1.2.3",
      description: "checkout demo",
      scripts: { test: "node --test", build: "tsc" },
    }),
  );
  write(root, "README.md", "# Demo app\n\nCheckout flow.\n");
  write(root, "src/app.ts", "export const ok = true;\n// TODO: fix the login retry\n");
  write(root, "test/app.test.ts", "// real test file\n");
  write(root, "logs/server.log", "listening on 3000\nError: connect ECONNREFUSED 127.0.0.1:5432\n");
  appendJsonl(auditFile(root), {
    ts: new Date().toISOString(),
    agent: "manu",
    kind: "tool",
    tool: "edit",
    ok: false,
    error: "EACCES: permission denied",
  });
  return root;
}

function tempInstall(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-install-"));
  fs.mkdirSync(path.join(root, "zombiecoder", "skills"), { recursive: true });
  fs.writeFileSync(path.join(root, "zombiecoder", "skills", "first-principles.md"), "# skill\n");
  return root;
}

test("onboarding evidence reads the real tree, logs, markers and audit trail", () => {
  const root = seedProject();
  const installRoot = tempInstall();
  const evidence = collectOnboardingEvidence(root, scanProject(root), { installRoot });

  assert.equal(evidence.project.name, "demo-app");
  assert.equal(evidence.project.version, "1.2.3");
  assert.equal(evidence.project.description, "checkout demo");
  assert.deepEqual(evidence.project.scripts, ["test", "build"]);
  assert.ok(evidence.totalFiles >= 5);
  assert.ok(evidence.docs.includes("README.md"), "README must be listed");
  assert.ok(evidence.tests.includes("test/app.test.ts"), "test file must be listed");
  assert.ok(evidence.languages.some((entry) => entry.startsWith("TypeScript")));

  const log = evidence.logs.find((entry) => entry.file === "logs/server.log");
  assert.ok(log, "log file must be read");
  assert.equal(log.errors.length, 1);
  assert.match(log.errors[0], /ECONNREFUSED/);

  assert.ok(evidence.markers.some((entry) => entry.kind === "TODO" && entry.file === "src/app.ts"));
  assert.ok(evidence.auditFailures.some((entry) => entry.error?.includes("EACCES")));

  assert.equal(evidence.skills.checked, true);
  assert.ok(evidence.skills.detected.includes("node"));
  assert.ok(evidence.skills.installed.includes("first-principles"));
  assert.ok(evidence.skills.missing.includes("node"));

  assert.ok(evidence.gaps.some((gap) => /Log files contain/.test(gap)));
  assert.ok(evidence.gaps.some((gap) => /TODO\/FIXME/.test(gap)));
  assert.ok(evidence.gaps.some((gap) => /audit trail/.test(gap)));

  const lesson = renderOnboardingLesson(evidence);
  assert.match(lesson, /Project: `demo-app` 1\.2\.3/);
  assert.match(lesson, /Log problems \(tail\)/);
  assert.match(lesson, /ECONNREFUSED/);
  assert.match(lesson, /Audit failures carried over/);
  assert.match(lesson, /Agent checklist before the first goal contract/);
  assert.match(lesson, /A passing check is not user consent/);
});

test("onboarding lesson is appended once per file tree and refreshed when the tree changes", () => {
  const root = seedProject();
  const installRoot = tempInstall();
  const fp = scanProject(root);

  const first = ensureOnboarding(root, fp, { installRoot });
  assert.equal(first.created, true);
  assert.match(first.marker, /^onboarding:[a-f0-9]{12}$/);
  assert.equal(first.marker, onboardingMarker(fp));

  const text = fs.readFileSync(syllabusFile(root), "utf8");
  assert.match(text, new RegExp(first.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, /### Project onboarding/);

  const second = ensureOnboarding(root, scanProject(root), { installRoot });
  assert.equal(second.created, false, "the same tree must not append a second lesson");
  assert.equal(
    fs.readFileSync(syllabusFile(root), "utf8").match(/### Project onboarding/g)?.length,
    1,
  );

  write(root, "src/new-file.ts", "export const added = 1;\n");
  const third = ensureOnboarding(root, scanProject(root), { installRoot });
  assert.equal(third.created, true, "an added file changes the marker");
  assert.notEqual(third.marker, first.marker);
  assert.equal(
    fs.readFileSync(syllabusFile(root), "utf8").match(/### Project onboarding/g)?.length,
    2,
  );
});

test("a project with no docs or tests says so instead of inventing purpose", () => {
  const root = tempProject();
  write(root, "main.py", "print('hello')\n");
  const evidence = collectOnboardingEvidence(root, scanProject(root));
  assert.equal(evidence.docs.length, 0);
  assert.equal(evidence.tests.length, 0);
  assert.equal(evidence.skills.checked, false);
  assert.ok(evidence.gaps.some((gap) => /No README\/docs/.test(gap)));
  assert.ok(evidence.gaps.some((gap) => /No test files/.test(gap)));
  const lesson = renderOnboardingLesson(evidence);
  assert.match(lesson, /Docs: none found/);
  assert.match(lesson, /Tests: none found/);
  assert.match(lesson, /Still unverified/);
  assert.match(lesson, /the user's expectation/i);
});
