import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  detectProjectSkills,
  ensureSkillCatalog,
  installSharedSkill,
  listSkillCatalog,
  SKILL_CATALOG,
} from "../src/zombie/skillCatalog.ts";
import { registerSkills } from "../src/zombie/skills.ts";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

test("detectProjectSkills picks core plus the project's stack", () => {
  const root = tempDir("zombiecoder-detect-");
  try {
    write(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }));
    write(path.join(root, "requirements.txt"), "fastapi==0.115.0\n");
    fs.mkdirSync(path.join(root, "public_html"), { recursive: true });
    const ids = detectProjectSkills(root);
    for (const id of [
      "node",
      "next",
      "python",
      "fastapi",
      "cpanel",
      "first-principles",
      "evidence-before-confidence",
      "resource-optimization",
      "server",
    ]) {
      assert.ok(ids.includes(id), `missing detected skill: ${id}`);
    }
    assert.ok(!ids.includes("laravel"), "laravel must not be detected without a marker");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every catalog entry ships a real skill file with matching frontmatter", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  for (const spec of SKILL_CATALOG) {
    const file = path.join(root, "docs", "skills", spec.file);
    assert.ok(fs.existsSync(file), `catalog entry ${spec.id} has no file: ${spec.file}`);
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /^---\n/, `${spec.id} must start with YAML frontmatter`);
    assert.match(text, new RegExp(`^id:\\s*${spec.id}$`, "m"), `${spec.id} frontmatter id mismatch`);
    assert.match(text, new RegExp(`^name:\\s*.+$`, "m"), `${spec.id} frontmatter has no name`);
    assert.match(text, new RegExp(`^description:\\s*.+$`, "m"), `${spec.id} frontmatter has no description`);
  }
});

test("detectProjectSkills adds laravel-market only for a commerce-shaped Laravel app", () => {
  const plain = tempDir("zombiecoder-detect-laravel-");
  const shop = tempDir("zombiecoder-detect-shop-");
  try {
    for (const root of [plain, shop]) {
      write(
        path.join(root, "composer.json"),
        JSON.stringify({ require: { "laravel/framework": "^11.0" } }),
      );
    }
    write(path.join(shop, "app", "Models", "Product.php"), "<?php\n");

    const plainIds = detectProjectSkills(plain);
    assert.ok(plainIds.includes("laravel"), "plain Laravel app must get the laravel skill");
    assert.ok(!plainIds.includes("laravel-market"), "no commerce marker must not add laravel-market");

    const shopIds = detectProjectSkills(shop);
    assert.ok(shopIds.includes("laravel"));
    assert.ok(shopIds.includes("laravel-market"), "commerce model must add laravel-market");
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
    fs.rmSync(shop, { recursive: true, force: true });
  }
});

test("detectProjectSkills adds UI/UX, delivery and regex skills for their stacks", () => {
  const root = tempDir("zombiecoder-detect-new-");
  try {
    write(path.join(root, "package.json"), JSON.stringify({ dependencies: {} }));
    write(path.join(root, "requirements.txt"), "playwright==1.48.0\n");
    const ids = detectProjectSkills(root);
    for (const id of ["uiux-delivery", "web-delivery", "python-regex", "scrape-verify"]) {
      assert.ok(ids.includes(id), `missing new skill for this stack: ${id}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("registerSkills re-discovers shared skills when the skill door reloads", async () => {
  const root = tempDir("zombiecoder-skill-reload-");
  try {
    const dir = path.join(root, "zombiecoder", "skills");
    write(path.join(dir, "one.md"), "---\nid: one\nname: One\n---\n\nOne.\n");

    const registered: any[] = [];
    let apply: ((editor: any) => void) | null = null;
    const door = {
      transform: async (callback: (editor: any) => void) => {
        apply = callback;
        callback({ list: () => registered, add: (skill: any) => registered.push(skill) });
        return { dispose: async () => undefined };
      },
      reload: async () => {
        apply?.({ list: () => registered, add: (skill: any) => registered.push(skill) });
      },
    };

    const registration = registerSkills(door, root);
    await registration.applied;
    assert.deepEqual(registered.map((skill) => skill.id), ["zombiecoder.workstation.one"]);

    write(path.join(dir, "two.md"), "---\nid: two\nname: Two\n---\n\nTwo.\n");
    await door.reload();
    assert.deepEqual(
      registered.map((skill) => skill.id).sort(),
      ["zombiecoder.workstation.one", "zombiecoder.workstation.two"],
    );
    await registration.release();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime downloads a missing skill from a git repo and installs it once at the install root", async (t) => {
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (git.status !== 0) {
    t.skip("git is not installed");
    return;
  }
  const root = tempDir("zombiecoder-skill-git-");
  try {
    const repo = path.join(root, "repo");
    write(
      path.join(repo, "docs", "skills", "node.md"),
      "---\nid: node\nname: Node.js\ndescription: test skill\n---\n\n# Node.js\n\nUse the standard library.\n",
    );
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "skill"], {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });

    const project = path.join(root, "project");
    fs.mkdirSync(project, { recursive: true });
    const installRoot = path.join(root, "install");
    const catalog = await ensureSkillCatalog({
      installRoot,
      repoUrl: repo,
      ids: ["node"],
    });
    assert.deepEqual(catalog.installed, ["node"]);
    assert.ok(fs.existsSync(path.join(installRoot, "zombiecoder", "skills-catalog", "node.md")));

    const installed = await installSharedSkill(installRoot, "node", { repoUrl: repo });
    assert.equal(installed.copied, true);
    assert.equal(Object.prototype.hasOwnProperty.call(installed, "error"), false);
    assert.ok(fs.existsSync(path.join(installRoot, "zombiecoder", "skills", "node.md")));
    assert.ok(
      !fs.existsSync(path.join(project, ".zombiecoder", "skills")),
      "opening a project must not create a per-project skill tree",
    );

    const listing = listSkillCatalog(installRoot);
    const node = listing.skills.find((skill) => skill.id === "node");
    assert.equal(node?.installed, true);
    assert.equal(node?.cached, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
