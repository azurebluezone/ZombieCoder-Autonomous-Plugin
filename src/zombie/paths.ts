// Spec §3 — working directory layout.
//
//   <project>/.zombiecoder/
//     SSOT.md                 generated project scan + shared team persona
//     syllabus.md             footprint + standing rules + append-only lessons
//     memory/                 conversation index + append-only archives
//     .state/                 internal diagnostics (setup report, audit, MCP probe)
//
// Global configuration lives in ~/.config/opencode. Per-project config is an
// optional manual override, never auto-created. No fingerprint.json, footprint.jsonl,
// models.json or mcp.json is created in the project.
//
// Skills are owned by the install root, never by a working directory:
//   <install>/zombiecoder/skills/*.md        shared, registered for every project
//   <install>/zombiecoder/skills-catalog/    offline catalog seeded by the installer
// A project keeps only SSOT, syllabus, memory and .state.

import path from "node:path";

export const DOT_DIR = ".zombiecoder";
export const OPENCODE_DIR = ".opencode";

export function safe(id: string): string {
  return String(id).replace(/[^A-Za-z0-9._-]/g, "_") || "unknown";
}

export function zombieRoot(projectRoot: string): string {
  return path.join(projectRoot, DOT_DIR);
}

export function ssotFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "SSOT.md");
}

export function stateDir(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), ".state");
}

export function syllabusFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "syllabus.md");
}

/**
 * Shared skill store at the install root. `installRoot` is OpenCode's config
 * directory (`~/.config/opencode` for a global install, `<project>/.opencode`
 * for a project-local install), not a working directory.
 */
export function installSkillsDir(installRoot: string): string {
  return path.join(installRoot, "zombiecoder", "skills");
}

/**
 * OpenCode's native global skill directory. One folder per skill holding a
 * SKILL.md; the directory name must equal the frontmatter `name`. This is the
 * door OpenCode itself discovers, so installed skills work without a plugin
 * transform and in every working directory.
 */
export function nativeSkillsDir(installRoot: string): string {
  return path.join(installRoot, "skills");
}

export function memoryDir(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "memory");
}

export function memoryIndexFile(projectRoot: string): string {
  return path.join(memoryDir(projectRoot), "index.json");
}

export function memoryArchiveFile(projectRoot: string, sessionID: string): string {
  return path.join(memoryDir(projectRoot), safe(sessionID) + ".jsonl");
}

export function auditFile(projectRoot: string): string {
  return path.join(stateDir(projectRoot), "audit.jsonl");
}

export function setupReportFile(projectRoot: string): string {
  return path.join(stateDir(projectRoot), "setup-report.json");
}

// Optional manual override. The plugin reads it if it exists but never creates it;
// the global ~/.config/opencode/zombiecoder/config.json is the real config.
export function configFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "config.json");
}

// OpenCode's own folder — the door we are allowed to fill.
export function opencodeAgentsDir(projectRoot: string): string {
  return path.join(projectRoot, OPENCODE_DIR, "agents");
}

export function opencodeSkillsDir(projectRoot: string): string {
  return path.join(projectRoot, OPENCODE_DIR, "skills");
}

export function opencodePluginsDir(projectRoot: string): string {
  return path.join(projectRoot, OPENCODE_DIR, "plugins");
}

// Spec §3.1 — created on first run, then left alone.
// No skills dir: it appears only when a skill is actually added. No .opencode
// dir: that belongs to the install root, never to an arbitrary working directory.
export function bootstrapDirs(projectRoot: string): string[] {
  return [zombieRoot(projectRoot), memoryDir(projectRoot), stateDir(projectRoot)];
}
