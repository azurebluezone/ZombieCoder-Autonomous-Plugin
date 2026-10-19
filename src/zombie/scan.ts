// Spec §3.2 — "টপ-টু-বটম এনালাইসিস".
//
// One bounded walk of the project tree, then a fingerprint: how many files, which
// languages, what markers are present, what the manifests say. Bounded on purpose —
// a plugin must never hang on a huge repo.

import * as fs from "node:fs";
import * as path from "node:path";

export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".zombiecoder",
  ".opencode",
  ".archive-2026-10-19",
  ".backups",
  "dist",
  "build",
  "out",
  "out-test",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".gradle",
  ".idea",
  ".vscode-test",
  "coverage",
  ".cache",
  ".DS_Store",
];

export const DEFAULT_MAX_FILES = 20000;
export const DEFAULT_MAX_DEPTH = 12;

export type LanguageStat = { name: string; files: number; bytes: number };

export type TopLevelEntry = {
  name: string;
  kind: "dir" | "file";
  entries?: number;
  bytes?: number;
};

export type Fingerprint = {
  root: string;
  scannedAt: string;
  totalFiles: number;
  totalDirs: number;
  totalBytes: number;
  truncated: boolean;
  languages: LanguageStat[];
  topLevel: TopLevelEntry[];
  markers: string[];
  manifests: Record<string, unknown>;
  tree: string[];
  /** Relative file paths, capped so a huge repo cannot bloat the SSOT. */
  files: string[];
  ignored: string[];
};

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript (JSX)",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript (JSX)",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".php": "PHP",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".cs": "C#",
  ".c": "C",
  ".h": "C/C++ header",
  ".cpp": "C++",
  ".cc": "C++",
  ".hpp": "C++ header",
  ".swift": "Swift",
  ".dart": "Dart",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".ps1": "PowerShell",
  ".sql": "SQL",
  ".md": "Markdown",
  ".json": "JSON",
  ".jsonc": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".less": "LESS",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".lua": "Lua",
  ".r": "R",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".clj": "Clojure",
  ".hs": "Haskell",
  ".scala": "Scala",
  ".tf": "Terraform",
  ".proto": "Protobuf",
  ".graphql": "GraphQL",
  ".env": "Env",
};

const MARKER_NAMES = [
  "package.json",
  "tsconfig.json",
  "composer.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "Dockerfile",
  "docker-compose.yml",
  "Makefile",
  ".git",
  ".gitignore",
  "README.md",
  ".opencode",
  ".zombiecoder",
  "opencode.json",
  "LICENSE",
];

export type ScanOptions = {
  ignore?: string[];
  maxFiles?: number;
  maxDepth?: number;
};

export function languageOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (LANG_BY_EXT[ext]) return LANG_BY_EXT[ext];
  const base = path.basename(file);
  if (base.startsWith(".") && base.length > 1) return "Dotfile";
  return ext ? ext.replace(".", "").toUpperCase() : "other";
}

export function scanProject(root: string, options: ScanOptions = {}): Fingerprint {
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  const lang = new Map<string, { files: number; bytes: number }>();
  const dirs: string[] = [];
  const tree: string[] = [];
  const filePaths: string[] = [];
  const markers: string[] = [];
  let files = 0;
  let bytes = 0;
  let truncated = false;

  const walk = (dir: string, rel: string, depth: number): void => {
    if (truncated) return;
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip, never throw
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (ignore.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const relPath = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) {
        dirs.push(relPath);
        if (depth < 6) tree.push(relPath + "/");
        walk(full, relPath, depth + 1);
      } else if (e.isFile()) {
        if (files >= maxFiles) {
          truncated = true;
          return;
        }
        files += 1;
        if (filePaths.length < 500) filePaths.push(relPath);
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          size = 0;
        }
        bytes += size;
        const name = languageOf(e.name);
        const cur = lang.get(name) ?? { files: 0, bytes: 0 };
        cur.files += 1;
        cur.bytes += size;
        lang.set(name, cur);
      }
    }
  };

  walk(root, "", 0);

  // markers + manifests, read only at the root
  let topEntries: fs.Dirent[] = [];
  try {
    topEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    topEntries = [];
  }
  const present = new Set(topEntries.map((e) => e.name));
  for (const m of MARKER_NAMES) if (present.has(m)) markers.push(m);

  const manifests: Record<string, unknown> = {};
  const pkg = path.join(root, "package.json");
  if (present.has("package.json")) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkg, "utf8"));
      manifests.package = {
        name: parsed.name,
        version: parsed.version,
        type: parsed.type,
        scripts: parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {},
        dependencies: parsed.dependencies ? Object.keys(parsed.dependencies) : [],
        devDependencies: parsed.devDependencies ? Object.keys(parsed.devDependencies) : [],
      };
    } catch {
      manifests.package = "unreadable package.json";
    }
  }
  const composer = path.join(root, "composer.json");
  if (present.has("composer.json")) {
    try {
      const parsed = JSON.parse(fs.readFileSync(composer, "utf8"));
      manifests.composer = {
        name: parsed.name,
        require: parsed.require ? Object.keys(parsed.require) : [],
      };
    } catch {
      manifests.composer = "unreadable composer.json";
    }
  }

  const topLevel: TopLevelEntry[] = topEntries
    .filter((e) => !ignore.has(e.name))
    .map((e) => {
      if (e.isDirectory()) {
        let n = 0;
        try {
          n = fs.readdirSync(path.join(root, e.name)).length;
        } catch {
          n = 0;
        }
        return { name: e.name, kind: "dir" as const, entries: n };
      }
      let size = 0;
      try {
        size = fs.statSync(path.join(root, e.name)).size;
      } catch {
        size = 0;
      }
      return { name: e.name, kind: "file" as const, bytes: size };
    });

  const languages: LanguageStat[] = [...lang.entries()]
    .map(([name, v]) => ({ name, files: v.files, bytes: v.bytes }))
    .sort((a, b) => b.files - a.files);

  return {
    root,
    scannedAt: new Date().toISOString(),
    totalFiles: files,
    totalDirs: dirs.length,
    totalBytes: bytes,
    truncated,
    languages,
    topLevel,
    markers,
    manifests,
    tree: tree.slice(0, 200),
    files: filePaths,
    ignored: [...ignore],
  };
}
