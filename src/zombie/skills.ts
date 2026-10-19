// Spec §6 — two-tier skills.
//
//   workstation tier : <project>/.zombiecoder/skills/*.md   (ours, travels with the project)
//   project tier     : <project>/.opencode/skills/*.md      (OpenCode's own folder)
//
// Both are plain markdown with a tiny frontmatter block. We do not invent a new
// skill format — OpenCode's Skill.Info has {id, name, description, location, content}
// and we fill exactly those fields through its own ctx.skill door.

import * as fs from "node:fs";
import * as path from "node:path";
import { readText } from "./io.ts";
import { opencodeSkillsDir, safe, skillsDir } from "./paths.ts";
import { keepTransform, withTimeout, type TransformDoor } from "./transform.ts";

export type SkillTier = "workstation" | "project";

export type DiscoveredSkill = {
  id: string;
  name: string;
  description?: string;
  tier: SkillTier;
  file: string;
  content: string;
};

export type SkillLike = TransformDoor<any> & { reload?: () => Promise<void> };
const TRANSFORM_WAIT_MS = 6000;

export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

function discoverTier(dir: string, tier: SkillTier): DiscoveredSkill[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DiscoveredSkill[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const file = path.join(dir, entry.name);
    const raw = readText(file);
    if (!raw) continue;
    const { data, body } = parseFrontmatter(raw);
    const fallbackId = entry.name.replace(/\.md$/i, "");
    const id = `zombiecoder.${tier}.${safe(data.id ?? fallbackId)}`;
    out.push({
      id,
      name: data.name ?? fallbackId,
      description: data.description,
      tier,
      file,
      content: body.trim().length > 0 ? body : raw,
    });
  }
  return out;
}

export function discoverSkills(projectRoot: string): DiscoveredSkill[] {
  return [
    ...discoverTier(skillsDir(projectRoot), "workstation"),
    ...discoverTier(opencodeSkillsDir(projectRoot), "project"),
  ];
}

export async function registerSkills(
  skill: SkillLike | undefined,
  projectRoot: string,
): Promise<{ registered: string[]; skipped: string[]; error?: string; release?: () => Promise<void> }> {
  const discovered = discoverSkills(projectRoot);
  if (!skill || typeof skill.transform !== "function") {
    return { registered: [], skipped: discovered.map((s) => s.id), error: "ctx.skill not available" };
  }
  const kept = keepTransform<any, string[]>(skill, (editor: any) => {
    const added: string[] = [];
    for (const s of discovered) {
      try {
        if (typeof editor?.add === "function") {
          editor.add({
            id: s.id,
            name: s.name,
            description: s.description,
            location: s.file,
            content: s.content,
          });
          added.push(s.id);
        }
      } catch {
        /* one bad skill must not stop the rest */
      }
    }
    return added;
  });
  const registered = await withTimeout(kept.first, TRANSFORM_WAIT_MS, null);
  if (registered === null) {
    return {
      registered: [],
      skipped: discovered.map((s) => s.id),
      error: kept.error() ?? "skill transform callback did not fire",
      release: kept.release,
    };
  }
  const registeredSet = new Set(registered);
  await skill.reload?.();
  return {
    registered,
    skipped: discovered.map((s) => s.id).filter((id) => !registeredSet.has(id)),
    error: kept.error(),
    release: kept.release,
  };
}
