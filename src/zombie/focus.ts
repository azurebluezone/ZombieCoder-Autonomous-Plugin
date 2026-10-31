// Focus resolver — the anti-wandering layer.
//
// The audit found the pack had four context sources (SSOT, syllabus, memory,
// gates) but no step that turned the user's sentence into a small set of files.
// Agents compensated by planning and re-scanning the whole tree, which is both
// slow and noisy. This module answers one question before any tool call:
// "which files is this sentence actually about, and what travels with them?"
//
// It is deterministic: same message + same tree = same focus list. No model call,
// no network, no guessing about content it has not read.

import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_IGNORE } from "./scan.ts";
import { stripInvisible } from "./sanitize.ts";

export const FOCUS_LIMITS = {
  primary: 5,
  related: 8,
  text: 700,
  files: 4000,
  depth: 8,
} as const;

// ── file index ───────────────────────────────────────────────────────────────

type FileCache = { at: number; root: string; files: string[] };
let cache: FileCache | null = null;
const CACHE_MS = 60_000;

function ignored(rel: string, ignore: string[]): boolean {
  const parts = rel.split("/");
  return parts.some((part) => ignore.includes(part));
}

function walk(root: string, dir: string, out: string[], ignore: string[], depth: number): void {
  if (out.length >= FOCUS_LIMITS.files || depth > FOCUS_LIMITS.depth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= FOCUS_LIMITS.files) return;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (ignore.includes(entry.name) || ignored(rel, ignore)) continue;
      walk(root, full, out, ignore, depth + 1);
    } else if (entry.isFile()) {
      if (ignored(rel, ignore)) continue;
      out.push(rel);
    }
  }
}

/** Relative file list for a project, cached briefly so the context hook stays cheap. */
export function listProjectFiles(root: string, ignore: string[] = DEFAULT_IGNORE): string[] {
  const now = Date.now();
  if (cache && cache.root === root && now - cache.at < CACHE_MS) return cache.files;
  const files: string[] = [];
  walk(root, root, files, ignore, 0);
  files.sort();
  cache = { at: now, root, files };
  return files;
}

export function clearFocusCache(): void {
  cache = null;
}

// ── terms ────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  // English
  "the", "and", "for", "with", "this", "that", "from", "have", "has", "not", "but", "you", "your",
  "please", "check", "look", "need", "want", "make", "does", "did", "was", "were", "there", "here",
  "file", "files", "code", "project", "error", "problem", "issue", "fix", "update", "change", "add",
  // Bengali chat glue
  "একটা", "এখন", "আমার", "আমরা", "তোমার", "করে", "করা", "হয়", "হয়েছে", "নেই", "কি", "কী", "এই", "ওই",
  "এখানে", "সেখানে", "দেখ", "দেখো", "বলো", "বল", "কিন্তু", "আর", "তার", "তারপর", "জন্য", "সাথে", "একই",
  "সমস্যা", "চেক", "ফাইল", "কোড", "কাজ", "কেন", "কিভাবে", "কোথায়", "হবে", "থেকে", "মধ্যে", "একটি",
]);

const EXT_HINTS: Array<{ re: RegExp; exts: string[] }> = [
  { re: /(?:^|[^a-z])(?:view|views|blade|template|ui|page|screen)(?:[^a-z]|$)|ভিউ|পেইজ/i, exts: [".blade.php", ".tsx", ".jsx", ".vue", ".svelte", ".ejs", ".twig", ".njk", ".html"] },
  { re: /controller|কন্ট্রোলার/i, exts: [".php"] },
  { re: /model|মডেল/i, exts: [".php", ".ts", ".py", ".js"] },
  { re: /route|routing|রাউট/i, exts: [".php", ".ts", ".js"] },
  { re: /migration|মাইগ্রেশন/i, exts: [".php", ".sql"] },
  { re: /test|spec|টেস্ট/i, exts: [".test.ts", ".spec.ts", ".test.js", ".spec.js", ".php"] },
];

export type FocusPlan = {
  query: string;
  terms: string[];
  exts: string[];
  primary: Array<{ path: string; score: number; reason: string }>;
  related: Array<{ path: string; score: number; reason: string }>;
  text: string;
  bytes: number;
};

function normalize(value: string): string {
  return value.toLowerCase();
}

/** Pull path-ish tokens, filenames and identifiers out of one user message. */
export function extractTerms(message: string): string[] {
  // Pasted pages carry invisible characters; "cre\u200Date" must still match "create".
  const text = stripInvisible(String(message ?? ""));
  const found = new Set<string>();
  const add = (value: string) => {
    const v = value.trim().replace(/^[`'"(\[]+|[`'")\].,:;!?]+$/g, "");
    if (v.length < 3 || v.length > 80) return;
    if (STOPWORDS.has(normalize(v))) return;
    found.add(v);
  };
  // Quoted names win: "resources/views/admin/users/index.blade.php"
  for (const m of text.matchAll(/[`"']([^`"'\n]{3,80})[`"']/g)) add(m[1]);
  // Paths and dotted filenames (multi-dot, e.g. index.blade.php)
  for (const m of text.matchAll(/(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+|(?:[A-Za-z0-9_-]+\.)+[A-Za-z0-9]{1,8}\b/g)) add(m[0]);
  // Identifiers: snake_case, camelCase, PascalCase, dotted calls
  for (const m of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}(?:\.[A-Za-z_][A-Za-z0-9_]*)?\b/g)) {
    const v = m[0];
    if (/^[a-z]{1,3}$/.test(v)) continue;
    add(v);
  }
  return [...found].slice(0, 24);
}

export function detectExtensionHints(message: string): string[] {
  const out: string[] = [];
  for (const hint of EXT_HINTS) {
    if (!hint.re.test(message)) continue;
    for (const ext of hint.exts) if (!out.includes(ext)) out.push(ext);
  }
  return out;
}

// ── linkage ──────────────────────────────────────────────────────────────────

const stemOf = (file: string) => {
  const base = path.basename(file);
  return base.replace(/\.(blade\.php|test\.ts|test\.js|spec\.ts|spec\.js|d\.ts)$/i, "").replace(/\.[^.]+$/, "");
};
const dirOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
const isView = (file: string) => /\.(blade\.php|tsx|jsx|vue|svelte|ejs|twig|njk|html)$/i.test(file);
const isController = (file: string) => /controller/i.test(file) || /app\/Http\/Controllers\//.test(file);
const isModel = (file: string) => /(^|\/)models?\//i.test(file) || /app\/Models\//.test(file);
const isRoute = (file: string) => /(^|\/)routes?\//i.test(file) || /route\.(php|ts|js)$/i.test(file);
const isMigration = (file: string) => /migrations?\//i.test(file);
const isTest = (file: string) => /\.(test|spec)\.[a-z]+$|(^|\/)tests?\//i.test(file);

/** Related files for one primary hit: the slice, not the whole repo. */
export function relatedTo(file: string, files: string[]): Array<{ path: string; score: number; reason: string }> {
  const out: Array<{ path: string; score: number; reason: string }> = [];
  const stem = normalize(stemOf(file));
  const dirLeaf = normalize(dirOf(file).split("/").filter(Boolean).pop() ?? "");
  // "users" and "User" in UserController are the same slice in Laravel; compare
  // after dropping a trailing plural and non-letters.
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  const slugs = [stem, dirLeaf, ...normalize(file).split("/")]
    .map(slug)
    .filter((value) => value.length >= 4);
  const wantsView = isView(file);
  const wantsController = isController(file);
  const wantsModel = isModel(file);

  for (const candidate of files) {
    if (candidate === file) continue;
    const low = normalize(candidate);
    const cSlug = slug(stemOf(candidate));
    const cLowSlug = slug(low);
    const shared = slugs.find((value) => cSlug === value || cLowSlug.includes(value));
    const sameDir = dirOf(file) === dirOf(candidate) && dirOf(file).length > 0;

    let score = 0;
    const reasons: string[] = [];
    if (shared) { score = 25; reasons.push(`shares "${shared}"`); }
    if (sameDir) { score += 10; reasons.push("same directory"); }
    // Routes usually share no filename with the view, but they are part of the
    // slice: an edit that never reaches the route is a half fix.
    if (score === 0 && wantsView && isRoute(candidate)) { score = 20; reasons.push("route for this view"); }
    if (score === 0) continue;

    if (wantsView && isController(candidate)) { score += 45; reasons.push("controller"); }
    if (wantsView && isModel(candidate)) { score += 35; reasons.push("model"); }
    if (wantsView && isRoute(candidate)) { score += 15; reasons.push("route"); }
    if (wantsController && isModel(candidate)) { score += 30; reasons.push("model"); }
    if (wantsModel && isMigration(candidate)) { score += 30; reasons.push("migration"); }
    if (isTest(candidate)) { score += 25; reasons.push("test"); }

    out.push({ path: candidate, score, reason: reasons.join(" + ") });
  }
  out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return out;
}

// ── resolver ─────────────────────────────────────────────────────────────────

export function resolveFocus(files: string[], message: string): FocusPlan {
  const query = String(message ?? "").trim();
  const terms = extractTerms(query);
  const exts = detectExtensionHints(query);
  const ranked: Array<{ path: string; score: number; reason: string }> = [];
  const lowTerms = terms.map(normalize);

  for (const file of files) {
    const low = normalize(file);
    const base = normalize(path.basename(file));
    const stem = normalize(stemOf(file));
    const segments = low.split("/");
    let score = 0;
    const reasons: string[] = [];

    for (const term of lowTerms) {
      if (term === base) { score += 100; reasons.push(`exact file "${term}"`); }
      else if (term === stem) { score += 90; reasons.push(`file stem "${term}"`); }
      else if (term.includes(".") && base.startsWith(term)) { score += 80; reasons.push(`file prefix "${term}"`); }
      else if (term.includes("/") && (low === term || low.endsWith("/" + term))) { score += 95; reasons.push(`path "${term}"`); }
      else if (term.includes("/") ? low.includes(term) : segments.includes(term)) { score += 45; reasons.push(`segment "${term}"`); }
      else if (term.length >= 5 && low.includes(term)) { score += 20; reasons.push(`contains "${term}"`); }
    }
    if (score > 0 && exts.some((ext) => low.endsWith(ext))) {
      score += 20;
      reasons.push("requested kind");
    }
    if (score > 0) ranked.push({ path: file, score, reason: reasons.slice(0, 4).join(", ") });
  }

  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  // Primary means "the user pointed at this". Weak matches (one generic segment)
  // are slice members, not the target; keeping them out of primary is what stops
  // the agent from opening the controller first and wandering.
  const strong = ranked.filter((hit) => hit.score >= 60);
  const primary = (strong.length > 0 ? strong : ranked.slice(0, 2)).slice(0, FOCUS_LIMITS.primary);
  const relatedMap = new Map<string, { path: string; score: number; reason: string }>();
  for (const hit of primary) {
    for (const rel of relatedTo(hit.path, files)) {
      if (primary.some((p) => p.path === rel.path)) continue;
      const seen = relatedMap.get(rel.path);
      if (!seen || seen.score < rel.score) relatedMap.set(rel.path, { ...rel, reason: `${rel.reason} (via ${hit.path})` });
    }
  }
  const related = [...relatedMap.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, FOCUS_LIMITS.related);

  const lines: string[] = [];
  if (primary.length === 0) {
    lines.push(`No file in the tree matches this message. Do not scan the repository blindly.`);
    if (terms.length > 0) lines.push(`Terms tried: ${terms.slice(0, 8).map((t) => "`" + t + "`").join(", ")}`);
    lines.push(`Ask the user for the exact file, or use \`project_fingerprint\` only if the path is unknown.`);
  } else {
    lines.push(`Primary — open these first:`);
    for (const hit of primary) lines.push(`- \`${hit.path}\` — ${hit.reason}`);
    if (related.length > 0) {
      lines.push(`Related — check because the slice usually breaks together:`);
      for (const hit of related) lines.push(`- \`${hit.path}\` — ${hit.reason}`);
    }
    lines.push(`Rule: do not open a file outside this list without stating the reason in one line.`);
  }
  const text = lines.join("\n");
  const clipped = text.length > FOCUS_LIMITS.text ? text.slice(0, FOCUS_LIMITS.text) + "\n[... focus truncated ...]" : text;
  return {
    query,
    terms,
    exts,
    primary,
    related,
    text: clipped,
    bytes: Buffer.byteLength(clipped, "utf8"),
  };
}
