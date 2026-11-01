// Stitch-style design surface for the UI/UX agent.
//
// `design_sketch` writes the sketch stage to disk before any code exists:
// journey, wireframe, state matrix, tokens and the a11y checklist. `design_review`
// then reads the real markup/CSS and reports concrete file:line findings. The
// review is a regex heuristic, not a browser or an AST; the result says so.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { ensureDir, writeAtomic } from "./io.ts";
import { zombieRoot } from "./paths.ts";

export type DesignSite = "ecommerce" | "hospital" | "lms" | "generic";

export type SketchInput = {
  brief: string;
  brand?: string;
  site?: DesignSite;
  screens?: string[];
  output?: string;
};

export type DesignToken = { name: string; value: string; use: string };

export type DesignSketch = {
  dir: string;
  sketch: string;
  spec: string;
  brand: string;
  site: DesignSite;
  screens: string[];
  tokens: DesignToken[];
  created: string;
};

const SITE_TOKENS: Record<DesignSite, DesignToken[]> = {
  ecommerce: [
    { name: "color.accent", value: "#c2410c", use: "price, add-to-cart, sale badge" },
    { name: "color.surface", value: "#fffaf5", use: "page background" },
    { name: "color.ink", value: "#1c1917", use: "body text" },
    { name: "space.unit", value: "4px", use: "spacing scale 4/8/12/16/24/32" },
    { name: "radius.card", value: "12px", use: "product and summary cards" },
  ],
  hospital: [
    { name: "color.accent", value: "#0f766e", use: "primary action, department tag" },
    { name: "color.surface", value: "#f7fbfa", use: "page background" },
    { name: "color.ink", value: "#0f172a", use: "body text" },
    { name: "space.unit", value: "4px", use: "spacing scale 4/8/12/16/24/32" },
    { name: "radius.card", value: "10px", use: "department and appointment cards" },
  ],
  lms: [
    { name: "color.accent", value: "#4338ca", use: "progress, enroll, active lesson" },
    { name: "color.surface", value: "#f8f8ff", use: "page background" },
    { name: "color.ink", value: "#111827", use: "body text" },
    { name: "space.unit", value: "4px", use: "spacing scale 4/8/12/16/24/32" },
    { name: "radius.card", value: "12px", use: "course cards and lesson rows" },
  ],
  generic: [
    { name: "color.accent", value: "#2563eb", use: "primary action" },
    { name: "color.surface", value: "#f8fafc", use: "page background" },
    { name: "color.ink", value: "#0f172a", use: "body text" },
    { name: "space.unit", value: "4px", use: "spacing scale 4/8/12/16/24/32" },
    { name: "radius.card", value: "12px", use: "content cards" },
  ],
};

const SITE_LABEL: Record<DesignSite, string> = {
  ecommerce: "online shop",
  hospital: "hospital / clinic",
  lms: "learning platform",
  generic: "product site",
};

function slug(value: string): string {
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 6);
  return `${words || "design"}-${suffix}`;
}

function wireframe(brand: string, site: DesignSite, screens: string[]): string {
  const primary = screens[0] ?? "Home";
  return [
    "```text",
    `+--------------------------------------------------------------+`,
    `| ${brand.slice(0, 18).padEnd(24)}  nav: home  ${SITE_LABEL[site].slice(0, 16).padEnd(18)}|`,
    `|--------------------------------------------------------------|`,
    `| H1: ${primary.padEnd(56)}|`,
    `| subhead: one sentence, one promise                           |`,
    `| [ primary CTA ]   [ secondary action ]                       |`,
    `|                                                              |`,
    `| +--------------+  +--------------+  +--------------+          |`,
    `| | card 1       |  | card 2       |  | card 3       |          |`,
    `| | title        |  | title        |  | title        |          |`,
    `| | body 2 lines |  | body 2 lines |  | body 2 lines |          |`,
    `| +--------------+  +--------------+  +--------------+          |`,
    `|                                                              |`,
    `| data strip: one public fact + source                         |`,
    `| footer: contact, hours, licence                              |`,
    `+--------------------------------------------------------------+`,
    "```",
  ].join("\n");
}

export function buildDesignSketch(projectRoot: string, input: SketchInput): DesignSketch {
  const brief = String(input?.brief ?? "").trim();
  if (!brief) throw new Error("brief is required");
  const site: DesignSite = input.site && input.site in SITE_TOKENS ? input.site : "generic";
  const brand = String(input.brand ?? "").trim() || "Untitled";
  const screens = (Array.isArray(input.screens) ? input.screens : [])
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .slice(0, 12);
  if (screens.length === 0) screens.push("Home");
  const tokens = SITE_TOKENS[site];
  const id = slug(brief);
  const dir = input.output
    ? path.resolve(projectRoot, input.output)
    : path.join(zombieRoot(projectRoot), "design", id);
  const root = path.resolve(projectRoot);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error("output must stay inside the project root");
  }

  const created = new Date().toISOString();
  const spec = {
    id,
    brief,
    brand,
    site,
    screens,
    tokens,
    states: ["loading", "empty", "error", "success"],
    a11y: [
      "WCAG 2.2 AA contrast for text and controls",
      "Visible :focus-visible ring on every interactive element",
      "Keyboard order follows the reading order",
      "Form controls have labels; errors are announced, not colour-only",
      "Images carry alt text; decorative images use alt=\"\"",
      "prefers-reduced-motion respected",
    ],
    created,
  };
  const sketch = [
    `# Design sketch — ${brand}`,
    "",
    `- Site: ${site} (${SITE_LABEL[site]})`,
    `- Brief: ${brief}`,
    `- Screens: ${screens.join(", ")}`,
    `- Created: ${created}`,
    "",
    "## User journey",
    "",
    "1. Land on the page and understand the promise in one screen.",
    "2. Scan the three cards; each card answers one real question.",
    "3. Take the primary action, or open a secondary detail.",
    "4. See loading, then success or an error with a recovery path.",
    "",
    "## Wireframe",
    "",
    wireframe(brand, site, screens),
    "",
    "## State matrix",
    "",
    "| State | Trigger | What the user sees | Recovery |",
    "|---|---|---|---|",
    "| loading | first paint / submit | skeleton with the final layout | none needed |",
    "| empty | zero records | one sentence + primary action | create or change filter |",
    "| error | request failed | what failed, why, retry button | retry / contact |",
    "| success | action completed | confirmation + next step | continue |",
    "",
    "## Design tokens",
    "",
    "| Token | Value | Use |",
    "|---|---|---|",
    ...tokens.map((token) => `| \`${token.name}\` | \`${token.value}\` | ${token.use} |`),
    "",
    "## Accessibility checklist",
    "",
    ...spec.a11y.map((item) => `- [ ] ${item}`),
    "",
    "## Handoff",
    "",
    "1. Build the markup/CSS with the tokens above.",
    "2. Call `design_review` on the output directory.",
    "3. Fix every high finding before claiming the design is done.",
    "4. Verify the real page with keyboard, zoom 200%, and one slow request.",
    "",
  ].join("\n");

  ensureDir(dir);
  const sketchFile = path.join(dir, "sketch.md");
  const specFile = path.join(dir, "design.json");
  writeAtomic(sketchFile, sketch);
  writeAtomic(specFile, JSON.stringify(spec, null, 2) + "\n");
  return { dir, sketch: sketchFile, spec: specFile, brand, site, screens, tokens, created };
}

export type ReviewSeverity = "high" | "medium" | "low";
export type ReviewFinding = {
  rule: string;
  severity: ReviewSeverity;
  file: string;
  line: number;
  message: string;
};

export type DesignReview = {
  ok: boolean;
  method: "regex-heuristic";
  target: string;
  files: string[];
  findings: ReviewFinding[];
  summary: Record<ReviewSeverity, number>;
  note: string;
};

const REVIEW_EXTENSIONS = new Set([".html", ".htm", ".css", ".tsx", ".jsx", ".vue", ".svelte", ".astro"]);

function collectFiles(root: string, max = 200): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) break;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && REVIEW_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(file);
    }
  };
  walk(root);
  return out;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

export function reviewDesign(projectRoot: string, target = "."): DesignReview {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("target must stay inside the project root");
  }
  const files = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? collectFiles(resolved) : [resolved];
  const findings: ReviewFinding[] = [];
  const add = (rule: string, severity: ReviewSeverity, file: string, line: number, message: string) => {
    findings.push({ rule, severity, file: path.relative(root, file), line, message });
  };
  let combined = "";

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    if (fs.statSync(file).size > 512 * 1024) continue;
    const text = fs.readFileSync(file, "utf8");
    combined += "\n" + text;
    const ext = path.extname(file).toLowerCase();
    const isMarkup = [".html", ".htm", ".tsx", ".jsx", ".vue", ".svelte", ".astro"].includes(ext);

    for (const match of text.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\balt\s*=/.test(match[0])) {
        add("img-alt", "high", file, lineAt(text, match.index ?? 0), "img is missing alt text");
      }
    }
    for (const match of text.matchAll(/<a\b[^>]*>/gi)) {
      if (!/\bhref\s*=/.test(match[0])) {
        add("link-href", "medium", file, lineAt(text, match.index ?? 0), "anchor has no href; use a button for actions");
      }
    }
    for (const match of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const attrs = match[1] ?? "";
      const label = (match[2] ?? "").replace(/<[^>]*>/g, "").trim();
      if (!label && !/\baria-label\s*=/.test(attrs)) {
        add("button-name", "high", file, lineAt(text, match.index ?? 0), "icon-only button has no aria-label");
      }
      if (!/\btype\s*=/.test(attrs)) {
        add("button-type", "low", file, lineAt(text, match.index ?? 0), "button has no type; inside a form it submits");
      }
    }
    if (isMarkup) {
      const html = text.match(/<html\b([^>]*)>/i);
      if (html && !/\blang\s*=/.test(html[1] ?? "")) {
        add("html-lang", "medium", file, lineAt(text, html.index ?? 0), "html element has no lang attribute");
      }
      if (ext === ".html" && !/<meta[^>]+name=["']viewport["']/i.test(text)) {
        add("viewport", "medium", file, 1, "missing viewport meta; mobile zoom will be wrong");
      }
    }
    if ((ext === ".css" || isMarkup) && /outline\s*:\s*(none|0)\b/i.test(text) && !/:focus-visible/.test(text)) {
      const index = text.search(/outline\s*:\s*(none|0)\b/i);
      add("focus-visible", "high", file, lineAt(text, index), "outline removed without a :focus-visible replacement");
    }
    const hexColors = (text.match(/#[0-9a-f]{3,8}\b/gi) ?? []).length;
    if (ext === ".css" && hexColors > 8 && !/--[a-z0-9-]+\s*:/i.test(text)) {
      add("design-tokens", "low", file, 1, `${hexColors} hard-coded colours and no custom properties`);
    }
  }

  const stateText = combined.toLowerCase();
  if (files.length > 0) {
    for (const [state, pattern] of [
      ["loading", /loading|skeleton|spinner/],
      ["empty", /empty|no results|nothing here/],
      ["error", /error|failed|try again/],
      ["success", /success|saved|done/],
    ] as const) {
      if (!pattern.test(stateText)) {
        add("state-completeness", "medium", files[0], 1, `${state} state is not represented in the reviewed files`);
      }
    }
  }

  const seen = new Set<string>();
  const unique = findings.filter((finding) => {
    // Message is part of the key: four missing states share rule/file/line
    // (line 1), and the old key collapsed them into one finding.
    const key = `${finding.rule}:${finding.file}:${finding.line}:${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const summary = { high: 0, medium: 0, low: 0 };
  for (const finding of unique) summary[finding.severity] += 1;
  return {
    ok: summary.high === 0,
    method: "regex-heuristic",
    target: path.relative(root, resolved) || ".",
    files: files.map((file) => path.relative(root, file)),
    findings: unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    summary,
    note: "Heuristic only: it catches missing alt text, unnamed buttons, focus removal and absent states, not layout or real contrast.",
  };
}
