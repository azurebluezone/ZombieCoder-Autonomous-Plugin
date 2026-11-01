// Spec §6 — shared skills.
//
//   native tier : <install>/skills/<name>/SKILL.md   (OpenCode discovers this globally)
//   legacy tier : <install>/zombiecoder/skills/*.md  (plugin transform, older installs)
//
// OpenCode V2 loads `skills/*/SKILL.md` from its config directory by itself.
// The plugin still registers legacy flat files through ctx.skill, but a legacy
// file whose native folder exists is skipped: the same skill must not appear
// twice with two ids.

import * as fs from "node:fs";
import * as path from "node:path";
import { readText } from "./io.ts";
import { installSkillsDir, nativeSkillsDir, safe } from "./paths.ts";
import { parseFrontmatter } from "./frontmatter.ts";
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

const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Directory/frontmatter name OpenCode accepts. */
export function nativeSkillName(id: string): string {
  const cleaned = String(id ?? "")
    .toLowerCase()
    .replace(/^zombiecoder[._-][a-z-]+[._-]/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (SKILL_NAME.test(cleaned)) return cleaned;
  return "skill";
}

export function nativeSkillFile(installRoot: string, name: string): string {
  return path.join(nativeSkillsDir(installRoot), name, "SKILL.md");
}

function nativeNames(installRoot: string): Set<string> {
  const names = new Set<string>();
  try {
    for (const entry of fs.readdirSync(nativeSkillsDir(installRoot), { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(nativeSkillsDir(installRoot), entry.name, "SKILL.md"))) {
        names.add(entry.name);
      }
    }
  } catch {
    /* no native skills yet */
  }
  return names;
}

export { parseFrontmatter } from "./frontmatter.ts";

function discoverTier(dir: string, tier: SkillTier, native: Set<string>): DiscoveredSkill[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DiscoveredSkill[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const fallbackId = entry.name.replace(/\.md$/i, "");
    if (native.has(nativeSkillName(fallbackId))) continue;
    const file = path.join(dir, entry.name);
    const raw = readText(file);
    if (!raw) continue;
    const { data, body } = parseFrontmatter(raw);
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
  return discoverTier(installSkillsDir(installRoot), "workstation", nativeNames(installRoot));
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
  if (!skill || typeof skill.transform !== "function") {
    return {
      registered: [],
      applied: Promise.resolve({
        registered: [],
        skipped: discoverSkills(installRoot).map((s) => s.id),
        error: "ctx.skill not available",
      }),
      release: async () => undefined,
    };
  }
  // Re-discover on every transform invocation. OpenCode re-runs the transform
  // when ctx.skill.reload() is called; a skill copied into the shared store
  // after setup must be registered by that reload, not only after a full
  // plugin/location restart.
  const kept = keepTransform<any, string[]>(skill, (editor: any) => {
    const discovered = discoverSkills(installRoot);
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
    const discovered = discoverSkills(installRoot);
    return {
      registered,
      skipped: discovered.map((s) => s.id).filter((id) => !registeredSet.has(id)),
      error: value === null ? kept.error() ?? "skill transform callback did not fire" : kept.error(),
    };
  });

  return { registered: [], applied, release: kept.release };
}
