// Spec §3 — working directory layout.
//
// Two roots, deliberately separate:
//   <project>/.zombiecoder  -> ours        (SSOT, syllabus, memory, footprint, agent store)
//   <project>/.opencode     -> OpenCode's  (agents/*.md, plugins/, skills/) — we only fill it
//
// We never move OpenCode's files into ours or the other way round. The two sides
// meet at the path join, nothing more.

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
export function bootstrapDirs(projectRoot: string): string[] {
  return [
    zombieRoot(projectRoot),
    memoryDir(projectRoot),
    skillsDir(projectRoot),
    path.join(zombieRoot(projectRoot), "agents"),
    opencodeAgentsDir(projectRoot),
    opencodeSkillsDir(projectRoot),
    opencodePluginsDir(projectRoot),
  ];
}
