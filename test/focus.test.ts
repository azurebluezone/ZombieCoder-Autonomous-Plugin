// Focus resolver tests.
//
// The contract: a sentence about one screen must resolve to that screen's slice
// (view + controller + model + route + test), stay deterministic, and never
// invent a file that is not in the tree.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  clearFocusCache,
  detectExtensionHints,
  extractTerms,
  listProjectFiles,
  relatedTo,
  resolveFocus,
} from "../src/zombie/focus.ts";

const LARAVEL = [
  "app/Http/Controllers/Admin/UserController.php",
  "app/Models/User.php",
  "app/Models/Role.php",
  "routes/web.php",
  "database/migrations/2024_01_01_create_users_table.php",
  "resources/views/admin/users/index.blade.php",
  "resources/views/admin/users/create.blade.php",
  "resources/views/admin/roles/index.blade.php",
  "tests/Feature/UserCrudTest.php",
];

function tempProject(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-focus-"));
  for (const file of files) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "// fixture\n", "utf8");
  }
  clearFocusCache();
  return root;
}

test("extractTerms keeps paths and identifiers, drops chat glue", () => {
  const terms = extractTerms(
    "ভাইয়া admin users view-তে error দেখাচ্ছে, UserController আর index.blade.php চেক করো",
  );
  assert.ok(terms.includes("UserController"));
  assert.ok(terms.includes("index.blade.php"));
  assert.ok(!terms.includes("চেক"));
});

test("zero-width characters do not break term matching", () => {
  const terms = extractTerms("us\u200Ber\u200Dcontroller");
  assert.ok(terms.some((term) => term.toLowerCase().includes("usercontroller")));
});

test("view wording pulls in the whole slice, not the whole repo", () => {
  const files = LARAVEL;
  const plan = resolveFocus(files, "admin users index.blade.php view-এ ডেটা দেখাচ্ছে না");
  const paths = plan.primary.map((hit) => hit.path);
  const related = plan.related.map((hit) => hit.path);
  assert.ok(paths.includes("resources/views/admin/users/index.blade.php"), JSON.stringify(paths));
  assert.ok(related.includes("app/Http/Controllers/Admin/UserController.php"), JSON.stringify(related));
  assert.ok(related.includes("app/Models/User.php"), JSON.stringify(related));
  assert.ok(!plan.related.some((hit) => hit.path.endsWith("roles/index.blade.php")));
  assert.ok(plan.bytes <= 700 + 64);
});

test("unknown topic says so instead of scanning blindly", () => {
  const plan = resolveFocus(LARAVEL, "hello there");
  assert.equal(plan.primary.length, 0);
  assert.match(plan.text, /Do not scan the repository blindly/);
});

test("resolver is deterministic", () => {
  const message = "routes/web.php আর UserController";
  const a = resolveFocus(LARAVEL, message);
  const b = resolveFocus(LARAVEL, message);
  assert.deepEqual(a.primary.map((h) => h.path), b.primary.map((h) => h.path));
  assert.deepEqual(a.related.map((h) => h.path), b.related.map((h) => h.path));
});

test("extension hints follow the wording", () => {
  assert.ok(detectExtensionHints("view ঠিক করো").includes(".blade.php"));
  assert.ok(detectExtensionHints("migration দেখো").includes(".sql"));
});

test("relatedTo links a model to its migration", () => {
  const related = relatedTo("app/Models/User.php", LARAVEL).map((hit) => hit.path);
  assert.ok(related.includes("database/migrations/2024_01_01_create_users_table.php"), JSON.stringify(related));
});

test("listProjectFiles walks real files and ignores node_modules", () => {
  const root = tempProject(["src/a.ts", "node_modules/x/index.js", "src/b.ts"]);
  const files = listProjectFiles(root);
  assert.ok(files.includes("src/a.ts"));
  assert.ok(!files.some((file) => file.startsWith("node_modules/")));
  fs.rmSync(root, { recursive: true, force: true });
});
