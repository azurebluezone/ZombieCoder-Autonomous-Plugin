// Spec §3 — working directory layout.
//
//   <project>/.zombiecoder  -> ours  (SSOT, syllabus, memory, footprint, agent store)
//
// OpenCode's own home is NOT created inside every working directory. A global
// install lives in ~/.config/opencode (or a project install in <project>/.opencode
// when --dir is used); the runtime only owns .zombiecoder per working directory.
//
// Skills are lazy: .zombiecoder/skills is not created until someone actually puts
// a skill there.

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

export function fingerprintFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "fingerprint.json");
}

export function syllabusFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "syllabus.md");
}

export function skillsDir(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "skills");
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

export function footprintFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "footprint.jsonl");
}

export function modelPlanFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "models.json");
}

// Early builds wrote the model plan to memory.json, which made the "memory"
// file a lie. Kept only so setup() can migrate it once, then remove it.
export function legacyModelPlanFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "memory.json");
}

export function mcpFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "mcp.json");
}

export function setupReportFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "setup-report.json");
}

export function configFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "config.json");
}

export function agentStoreDir(projectRoot: string, agentID: string): string {
  return path.join(zombieRoot(projectRoot), "agents", safe(agentID));
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
  return [
    zombieRoot(projectRoot),
    memoryDir(projectRoot),
    path.join(zombieRoot(projectRoot), "agents"),
  ];
}
