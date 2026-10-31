// Runtime skill catalog.
//
// The catalog is deliberately small and explicit. Each entry points at a
// markdown skill that ships with this repo under docs/skills/. The installer
// seeds a cache at <install>/zombiecoder/skills-catalog; if a skill is missing
// later, the runtime can fetch it from the configured git repo.
//
// Skill files are shared, not per-project:
//   <install>/zombiecoder/skills/*.md   active skills, registered by skills.ts
//   <install>/zombiecoder/skills-catalog/*.md   offline catalog
// Opening a working directory never creates <project>/.zombiecoder/skills.
// When the user names a skill, the agent calls skill_catalog action=install;
// that downloads the file (if needed) into the shared store and reloads
// OpenCode's skill registry for every project under this install.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installSkillsDir, safe } from "./paths.ts";

export type SkillSpec = {
  id: string;
  name: string;
  description: string;
  /** File name under docs/skills in the source repo. */
  file: string;
  tags: string[];
};

export type SkillCatalogOptions = {
  /** Install root that contains zombiecoder/. Defaults to the live install. */
  installRoot?: string;
  /** Git repo that hosts docs/skills. */
  repoUrl?: string;
  /** Defaults to every catalog entry. */
  ids?: string[];
  /** Set false to use only local/bundled files. */
  download?: boolean;
  /** Replace an existing project skill instead of keeping the user's copy. */
  force?: boolean;
};

export type SkillCatalogResult = {
  cacheDir: string;
  installed: string[];
  downloaded: string[];
  failed: { id: string; error: string }[];
};

export const DEFAULT_SKILL_REPO =
  process.env.ZOMBIECODER_SKILL_REPO?.trim() ||
  "https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git";

export const SKILL_CATALOG: SkillSpec[] = [
  {
    id: "typescript",
    name: "TypeScript",
    description:
      "Type-safe JavaScript with strict types, interfaces, generics, type guards and tooling; use for API contracts and safe refactors.",
    file: "typescript.md",
    tags: ["typescript", "javascript", "types"],
  },
  {
    id: "bootstrap",
    name: "Bootstrap",
    description:
      "Bootstrap grid, components, utilities and responsive layouts; use for rapid prototyping and admin UIs.",
    file: "bootstrap.md",
    tags: ["css", "bootstrap", "ui", "responsive"],
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    description:
      "Utility-first CSS with design tokens, responsive, states and component patterns; use for design-system-driven UIs.",
    file: "tailwind.md",
    tags: ["css", "tailwind", "ui", "design-tokens"],
  },
  {
    id: "ollama",
    name: "Ollama",
    description:
      "Local LLM inference with Ollama, model management, API usage and integration; use for local/edge AI workflows.",
    file: "ollama.md",
    tags: ["ai", "llm", "ollama", "local"],
  },
  {
    id: "llama-cpu",
    name: "Llama CPU",
    description:
      "Efficient LLaMA inference on CPU via GGUF/llama.cpp, quantization, threading and memory tuning; use for CPU-only environments.",
    file: "llama-cpu.md",
    tags: ["ai", "llm", "llama", "cpu", "gguf"],
  },
  {
    id: "laravel",
    name: "Laravel",
    description:
      "Laravel routes, controllers, Eloquent, migrations, queues and Blade; use for 500 errors, N+1 queries, auth and deployment.",
    file: "laravel.md",
    tags: ["php", "laravel", "web"],
  },
  {
    id: "node",
    name: "Node.js",
    description:
      "Node.js services and CLIs with the standard library first; use for package.json, ESM, streams, child processes and async failures.",
    file: "node.md",
    tags: ["javascript", "typescript", "node"],
  },
  {
    id: "next",
    name: "Next.js",
    description:
      "Next.js App Router or Pages Router: server/client boundaries, data fetching, caching and build errors; use for hydration, 404/500 and deployment.",
    file: "next.md",
    tags: ["javascript", "typescript", "react", "next"],
  },
  {
    id: "python",
    name: "Python",
    description:
      "Python virtual environments, type hints, scripts, imports, packaging and tests; use for data work and CLI tools.",
    file: "python.md",
    tags: ["python"],
  },
  {
    id: "fastapi",
    name: "FastAPI",
    description:
      "FastAPI request models, dependencies, async I/O, validation errors and OpenAPI; use for 422/500 and deployment issues.",
    file: "fastapi.md",
    tags: ["python", "fastapi", "api"],
  },
  {
    id: "cpanel",
    name: "cPanel",
    description:
      "cPanel PHP/Node/Python sites: document root, .htaccess, SSL, cron, email DNS and permissions; use for 403/500 and subdomain issues.",
    file: "cpanel.md",
    tags: ["hosting", "cpanel", "php"],
  },
  {
    id: "resource-optimization",
    name: "Resource Optimization",
    description:
      "Reduce CPU, memory, tokens, network and human time with measurements instead of guesses; use when something is slow or expensive.",
    file: "resource-optimization.md",
    tags: ["performance", "cost", "tokens"],
  },
  {
    id: "server",
    name: "Server Operations",
    description:
      "Linux server process, port, logs, permissions, systemd, Nginx and TLS; use for deployment, 502/504 and boot failures.",
    file: "server.md",
    tags: ["linux", "nginx", "systemd", "tls"],
  },
  {
    id: "first-principles",
    name: "First-Principles Thinking",
    description:
      "Break a problem into primitives before choosing a framework or dependency; use when the cause is unclear or the answer feels borrowed.",
    file: "first-principles.md",
    tags: ["thinking", "architecture", "debug"],
  },
  {
    id: "evidence-before-confidence",
    name: "Evidence Before Confidence",
    description:
      "Prove a claim with a path, command, exit code, HTTP status or test output before presenting it as fact; use for every success report.",
    file: "evidence-before-confidence.md",
    tags: ["evidence", "verification", "quality"],
  },
  {
    id: "uiux-delivery",
    name: "UI/UX Delivery",
    description:
      "Ship a client-ready interface with a deliberate direction, every interaction state, WCAG 2.2 AA and Core Web Vitals budgets; use for landing pages, dashboards and design review.",
    file: "uiux-delivery.md",
    tags: ["ui", "ux", "accessibility", "performance", "design"],
  },
  {
    id: "python-regex",
    name: "Python Regex",
    description:
      "Build and performance-check Python regex with fixtures first, named groups, ReDoS limits and linear-time fallbacks; use for parsing, validation and bulk extraction.",
    file: "python-regex.md",
    tags: ["python", "regex", "redos", "performance", "codegen"],
  },
  {
    id: "web-delivery",
    name: "Website Delivery Pipeline",
    description:
      "Deliver a branded website end to end inside a time box: collect assets in parallel, model content, build pages, upload and verify; use for client site builds and redesigns.",
    file: "web-delivery.md",
    tags: ["web", "delivery", "workflow", "branding", "planning"],
  },
  {
    id: "scrape-verify",
    name: "Scrape and Verify",
    description:
      "Collect images and data with provenance, licensing, deduplication and schema validation while treating scraped bytes as untrusted data; use for asset gathering and catalog extraction.",
    file: "scrape-verify.md",
    tags: ["scraping", "playwright", "provenance", "validation", "security"],
  },
];

const CORE_IDS = ["first-principles", "evidence-before-confidence", "resource-optimization", "server"];

export function catalogIds(): string[] {
  return SKILL_CATALOG.map((skill) => skill.id);
}

export function findSkill(id: string): SkillSpec | undefined {
  return SKILL_CATALOG.find((skill) => skill.id === id);
}

function hereDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/** The install root that owns zombiecoder/, with a safe source-tree fallback. */
export function defaultInstallRoot(): string {
  const candidate = path.resolve(hereDir(), "../../..");
  if (fs.existsSync(path.join(candidate, "zombiecoder"))) return candidate;
  return path.join(process.env.HOME || os.homedir(), ".opencode");
}

export function catalogDir(installRoot = defaultInstallRoot()): string {
  return path.join(installRoot, "zombiecoder", "skills-catalog");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function hasDependency(file: string, names: string[]): boolean {
  const parsed = readJson(file);
  if (!parsed) return false;
  const buckets = [
    parsed.dependencies,
    parsed.devDependencies,
    parsed.peerDependencies,
    parsed.optionalDependencies,
  ];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const name of names) if (name in bucket) return true;
  }
  return false;
}

function fileContains(file: string, needles: string[]): boolean {
  try {
    const text = fs.readFileSync(file, "utf8").toLowerCase();
    return needles.some((needle) => text.includes(needle.toLowerCase()));
  } catch {
    return false;
  }
}

/** Pick the skills a project actually needs. Core thinking/evidence skills are always included. */
export function detectProjectSkills(projectRoot: string): string[] {
  const picked = new Set<string>(CORE_IDS);
  const packageJson = path.join(projectRoot, "package.json");
  const composerJson = path.join(projectRoot, "composer.json");
  const requirements = path.join(projectRoot, "requirements.txt");
  const pyproject = path.join(projectRoot, "pyproject.toml");
  const setupPy = path.join(projectRoot, "setup.py");

  if (fs.existsSync(packageJson)) {
    picked.add("node");
    picked.add("uiux-delivery");
    picked.add("web-delivery");
    if (hasDependency(packageJson, ["next"])) picked.add("next");
  }
  if (fs.existsSync(composerJson) || fs.existsSync(path.join(projectRoot, "artisan"))) {
    picked.add("laravel");
    picked.add("uiux-delivery");
    picked.add("web-delivery");
  }
  if (fs.existsSync(path.join(projectRoot, "public_html"))) {
    picked.add("cpanel");
    picked.add("web-delivery");
  }

  const pythonMarker =
    fs.existsSync(requirements) || fs.existsSync(pyproject) || fs.existsSync(setupPy);
  let pythonFiles = false;
  try {
    pythonFiles = fs
      .readdirSync(projectRoot, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith(".py"));
  } catch {
    /* unreadable project is not a reason to crash setup */
  }
  if (pythonMarker || pythonFiles) {
    picked.add("python");
    picked.add("python-regex");
    if (
      (fs.existsSync(requirements) && fileContains(requirements, ["fastapi"])) ||
      (fs.existsSync(pyproject) && fileContains(pyproject, ["fastapi"]))
    ) {
      picked.add("fastapi");
    }
    if (
      (fs.existsSync(requirements) && fileContains(requirements, ["playwright", "beautifulsoup", "scrapy", "requests"])) ||
      (fs.existsSync(pyproject) && fileContains(pyproject, ["playwright", "beautifulsoup", "scrapy", "requests"]))
    ) {
      picked.add("scrape-verify");
    }
  }

  return catalogIds().filter((id) => picked.has(id));
}

function copySkill(source: string, target: string): boolean {
  try {
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
    return true;
  } catch {
    return false;
  }
}

function sourceDirs(installRoot?: string): string[] {
  const dirs = [catalogDir(installRoot)];
  // Source-tree and test-tree fallback: <repo>/src/zombie -> ../../docs/skills.
  dirs.push(path.resolve(hereDir(), "../../docs/skills"));
  return dirs;
}

function findLocalSkill(id: string, installRoot?: string): string | null {
  const spec = findSkill(id);
  if (!spec) return null;
  for (const dir of sourceDirs(installRoot)) {
    const file = path.join(dir, spec.file);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function fetchRaw(repoUrl: string, id: string, timeoutMs: number): Promise<string | null> {
  const spec = findSkill(id);
  if (!spec) return null;
  const base = repoUrl.replace(/\.git$/i, "").replace(/\/+$/, "");
  const url = `${base}/raw/main/docs/skills/${spec.file}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const text = await response.text();
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

function cloneRepo(repoUrl: string, target: string, timeoutMs: number): string | null {
  const attempts: string[][] = [
    ["clone", "--depth", "1", repoUrl, target],
    ["clone", repoUrl, target],
  ];
  for (const args of attempts) {
    const result = spawnSync("git", args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status === 0 && fs.existsSync(target)) return target;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  return null;
}

async function downloadMissing(
  ids: string[],
  installRoot: string,
  repoUrl: string,
  timeoutMs: number,
): Promise<{ downloaded: string[]; failed: { id: string; error: string }[] }> {
  const downloaded: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const missing = ids.filter((id) => !findLocalSkill(id, installRoot));
  if (missing.length === 0) return { downloaded, failed };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-skills-"));
  const cloneTarget = path.join(tmp, "repo");
  const cloned = cloneRepo(repoUrl, cloneTarget, timeoutMs);
  try {
    for (const id of missing) {
      const spec = findSkill(id);
      if (!spec) {
        failed.push({ id, error: "not in catalog" });
        continue;
      }
      let text: string | null = null;
      if (cloned) {
        const source = path.join(cloned, "docs", "skills", spec.file);
        if (fs.existsSync(source)) text = fs.readFileSync(source, "utf8");
      }
      if (!text) text = await fetchRaw(repoUrl, id, timeoutMs);
      if (!text || text.trim().length === 0) {
        failed.push({ id, error: "skill file not found in git repo" });
        continue;
      }
      const target = path.join(catalogDir(installRoot), spec.file);
      try {
        ensureDir(path.dirname(target));
        fs.writeFileSync(target, text.endsWith("\n") ? text : text + "\n", "utf8");
        downloaded.push(id);
      } catch (error: any) {
        failed.push({ id, error: String(error?.message ?? error) });
      }
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  return { downloaded, failed };
}

/**
 * Ensure the cache contains the requested skills. Never throws on network
 * failure: a missing skill is reported and the project keeps working.
 */
export async function ensureSkillCatalog(options: SkillCatalogOptions = {}): Promise<SkillCatalogResult> {
  const installRoot = options.installRoot ?? defaultInstallRoot();
  const cache = catalogDir(installRoot);
  ensureDir(cache);

  const ids = (options.ids?.length ? options.ids : catalogIds()).filter((id) => Boolean(findSkill(id)));
  const installed: string[] = [];
  for (const id of ids) {
    const local = findLocalSkill(id, installRoot);
    if (!local) continue;
    const target = path.join(cache, findSkill(id)!.file);
    if (local !== target) copySkill(local, target);
    if (fs.existsSync(target)) installed.push(id);
  }

  let downloaded: string[] = [];
  let failed: { id: string; error: string }[] = [];
  const missing = ids.filter((id) => !fs.existsSync(path.join(cache, findSkill(id)!.file)));
  if (missing.length > 0 && options.download !== false) {
    const result = await downloadMissing(
      missing,
      installRoot,
      options.repoUrl?.trim() || DEFAULT_SKILL_REPO,
      Number(process.env.ZOMBIECODER_SKILL_TIMEOUT_MS ?? 60000),
    );
    downloaded = result.downloaded;
    failed = result.failed;
  } else if (missing.length > 0) {
    failed = missing.map((id) => ({ id, error: "missing locally and download disabled" }));
  }

  const finalInstalled = ids.filter((id) => fs.existsSync(path.join(cache, findSkill(id)!.file)));
  return {
    cacheDir: cache,
    installed: finalInstalled.length > 0 ? finalInstalled : installed,
    downloaded,
    failed,
  };
}

export type SkillInstallResult = { id: string; file: string; copied: boolean; error?: string };

/**
 * Copy one cached skill into the shared install-root store. The file is shared
 * by every working directory under this install; nothing is written into the
 * project.
 */
export async function installSharedSkill(
  installRoot: string,
  id: string,
  options: SkillCatalogOptions = {},
): Promise<SkillInstallResult> {
  const spec = findSkill(id);
  if (!spec) return { id, file: "", copied: false, error: "not in catalog" };
  const ensured = await ensureSkillCatalog({ ...options, installRoot, ids: [id] });
  if (!ensured.installed.includes(id)) {
    return {
      id,
      file: "",
      copied: false,
      error: ensured.failed.find((item) => item.id === id)?.error ?? "skill not available",
    };
  }
  const source = path.join(catalogDir(installRoot), spec.file);
  const target = path.join(installSkillsDir(installRoot), safe(id) + ".md");
  if (fs.existsSync(target) && !options.force) {
    return { id, file: target, copied: false };
  }
  const copied = copySkill(source, target);
  const result = { id, file: target, copied };
  return copied ? result : { ...result, error: "copy failed" };
}

export type SharedSkillInstallSummary = {
  installRoot: string;
  skillsDir: string;
  ids: string[];
  results: SkillInstallResult[];
};

async function installMany(
  installRoot: string,
  ids: string[],
  options: SkillCatalogOptions,
): Promise<SharedSkillInstallSummary> {
  const unique = [...new Set(ids.filter((id) => Boolean(findSkill(id))))];
  await ensureSkillCatalog({ ...options, installRoot, ids: unique });
  const results: SkillInstallResult[] = [];
  for (const id of unique) {
    results.push(await installSharedSkill(installRoot, id, { ...options, installRoot }));
  }
  return {
    installRoot,
    skillsDir: installSkillsDir(installRoot),
    ids: unique,
    results,
  };
}

/** Ensure the core skill set exists in the shared install-root store. */
export async function ensureSharedSkills(
  installRoot: string,
  ids: string[] = CORE_IDS,
  options: SkillCatalogOptions = {},
): Promise<SharedSkillInstallSummary> {
  return installMany(installRoot, ids, options);
}

/**
 * Detect the project's stack and install those skills into the shared store.
 * Detection reads the project, but no file is created inside it.
 */
export async function autoInstallSkills(
  installRoot: string,
  projectRoot: string,
  options: SkillCatalogOptions = {},
): Promise<SharedSkillInstallSummary> {
  const ids = options.ids?.length ? options.ids : detectProjectSkills(projectRoot);
  return installMany(installRoot, ids, options);
}

export type CatalogListing = {
  cacheDir: string;
  skillsDir: string;
  skills: (SkillSpec & { cached: boolean; installed: boolean; file: string })[];
};

export function listSkillCatalog(
  installRoot: string,
  options: SkillCatalogOptions = {},
): CatalogListing {
  const root = options.installRoot ?? installRoot;
  const cache = catalogDir(root);
  const shared = installSkillsDir(root);
  return {
    cacheDir: cache,
    skillsDir: shared,
    skills: SKILL_CATALOG.map((skill) => ({
      ...skill,
      cached: fs.existsSync(path.join(cache, skill.file)),
      installed: fs.existsSync(path.join(shared, skill.id + ".md")),
      file: path.join(cache, skill.file),
    })),
  };
}
