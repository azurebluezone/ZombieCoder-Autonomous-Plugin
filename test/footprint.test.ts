// Footprint lesson tests: a new directory leaves one trace, a restart leaves none.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scanProject } from "../src/zombie/scan.ts";
import { ensureSyllabus, readSyllabus, recordProjectFootprint } from "../src/zombie/syllabus.ts";
import { auditFile } from "../src/zombie/paths.ts";

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-footprint-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const x = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }), "utf8");
  return root;
}

test("first run appends one footprint lesson with the audit summary", () => {
  const root = project();
  const fp = scanProject(root);
  ensureSyllabus(root, fp, ["manu"]);
  fs.mkdirSync(path.dirname(auditFile(root)), { recursive: true });
  fs.appendFileSync(
    auditFile(root),
    JSON.stringify({ kind: "tool", tool: "shell", status: "error" }) + "\n",
    "utf8",
  );
  const first = recordProjectFootprint(root, fp);
  assert.equal(first.appended, true);
  const text = readSyllabus(root) ?? "";
  assert.match(text, /Project footprint \(auto\)/);
  assert.match(text, new RegExp(first.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, /Tool failures: shell×1/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a restart with the same tree does not append again", () => {
  const root = project();
  const fp = scanProject(root);
  ensureSyllabus(root, fp, ["manu"]);
  assert.equal(recordProjectFootprint(root, fp).appended, true);
  const second = recordProjectFootprint(root, fp);
  assert.equal(second.appended, false);
  const count = (readSyllabus(root) ?? "").split("Project footprint (auto)").length - 1;
  assert.equal(count, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a changed tree produces a new marker", () => {
  const root = project();
  const before = scanProject(root);
  ensureSyllabus(root, before, ["manu"]);
  recordProjectFootprint(root, before);
  fs.writeFileSync(path.join(root, "src", "extra.ts"), "export const y = 2;\n", "utf8");
  const after = scanProject(root);
  const record = recordProjectFootprint(root, after);
  assert.equal(record.appended, true);
  assert.notEqual(record.marker, `fp:${before.totalFiles}/${before.totalBytes}/${before.languages.slice(0, 3).map((l) => l.name).join("+")}`);
  fs.rmSync(root, { recursive: true, force: true });
});
