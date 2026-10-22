// Spec §6 — shared skills.
//
//   shared tier : <install>/zombiecoder/skills/*.md   (one copy for every project)
//
// Skills are owned by the install root, so opening a working directory never
// creates a second skill tree. OpenCode still discovers its own
// <project>/.opencode/skills natively; we do not register those again.
//
// Plain markdown with a tiny frontmatter block. We do not invent a new skill
// format — OpenCode's Skill.Info has {id, name, description, path, content} and
// we fill exactly those fields through its own ctx.skill door.

import * as fs from "node:fs";
import * as path from "node:path";
import { readText } from "./io.ts";
import { installSkillsDir, safe } from "./paths.ts";
import { keepTransform, type TransformDoor } from "./transform.ts";

export type SkillTier = "workstation";

export type DiscoveredSkill = {
  id: string;
  name: string;
  description?: string;
  tier: SkillTier;
  file: string;
  content: string;
};

export type SkillLike = TransformDoor<any> & { reload?: () => Promise<void> };

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

export function discoverSkills(installRoot: string): DiscoveredSkill[] {
  return discoverTier(installSkillsDir(installRoot), "workstation");
}

export type SkillRegistration = {
  /** Always empty at registration time; the transform applies after setup returns. */
  registered: string[];
  /** Resolves with what the deferred transform actually applied. */
  applied: Promise<{ registered: string[]; skipped: string[]; error?: string }>;
  release: () => Promise<void>;
};

export function registerSkills(skill: SkillLike | undefined, installRoot: string): SkillRegistration {
  // Project-tier skills in <project>/.opencode/skills are discovered by OpenCode
  // itself. Register only the shared install-root store, or every project skill
  // appears twice (once native, once namespaced) in ctx.skill.list().
  const discovered = discoverSkills(installRoot);
  if (!skill || typeof skill.transform !== "function") {
    return {
      registered: [],
      applied: Promise.resolve({
        registered: [],
        skipped: discovered.map((s) => s.id),
        error: "ctx.skill not available",
      }),
      release: async () => undefined,
    };
  }
  const kept = keepTransform<any, string[]>(skill, (editor: any) => {
    const added: string[] = [];
    const existing = new Set<string>((editor.list?.() ?? []).map((entry: any) => entry?.id).filter(Boolean));
    for (const s of discovered) {
      try {
        if (existing.has(s.id)) {
          added.push(s.id);
          continue;
        }
        if (typeof editor?.add === "function") {
          editor.add({
            id: s.id,
            name: s.name,
            description: s.description,
            path: s.file,
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

  const applied = kept.first.then(async (value) => {
    const registered = value ?? [];
    if (value !== null) {
      try {
        await skill.reload?.();
      } catch {
        /* reload is a convenience, not the registration itself */
      }
    }
    const registeredSet = new Set(registered);
    return {
      registered,
      skipped: discovered.map((s) => s.id).filter((id) => !registeredSet.has(id)),
      error: value === null ? kept.error() ?? "skill transform callback did not fire" : kept.error(),
    };
  });

  return { registered: [], applied, release: kept.release };
}
