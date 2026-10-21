import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  detectProjectSkills,
  ensureSkillCatalog,
  installProjectSkill,
  listSkillCatalog,
} from "../src/zombie/skillCatalog.ts";

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

test("runtime downloads a missing skill from a git repo and installs it per project", async (t) => {
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
    const cacheRoot = path.join(root, "install");
    const catalog = await ensureSkillCatalog({
      cacheRoot,
      repoUrl: repo,
      ids: ["node"],
    });
    assert.deepEqual(catalog.installed, ["node"]);
    assert.ok(fs.existsSync(path.join(cacheRoot, "zombiecoder", "skills-catalog", "node.md")));

    const installed = await installProjectSkill(project, "node", { cacheRoot, repoUrl: repo });
    assert.equal(installed.copied, true);
    assert.ok(fs.existsSync(path.join(project, ".zombiecoder", "skills", "node.md")));

    const listing = listSkillCatalog(project, { cacheRoot });
    const node = listing.skills.find((skill) => skill.id === "node");
    assert.equal(node?.installed, true);
    assert.equal(node?.cached, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
