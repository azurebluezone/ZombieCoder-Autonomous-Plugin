// LSP configuration generator.
//
// OpenCode V2.1.1 reads an `lsp` object from opencode.json:
//   { "<server>": { "command": ["<binary>", "--stdio"], "extensions": [...] } }
// The config is the piece that used to be missing after an install. This module
// detects the language-server binaries that actually exist and merges the
// matching entries into opencode.json without touching the owner's other keys.
//
// It is deliberately pure filesystem logic: no spawn, no network. The installer
// owns the optional `npm install` toolchain; this module only describes what an
// install would need and what is already resolvable.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type LspServerSpec = {
  id: string;
  /** Executable name without a platform extension. */
  bin: string;
  args: string[];
  extensions: string[];
  /** npm packages that provide the binary (installer hint). */
  packages: string[];
};

export type LspServerConfig = {
  command: string[];
  extensions: string[];
};

export type ResolvedLsp = {
  servers: Record<string, LspServerConfig>;
  missing: string[];
  searchDirs: string[];
};

export type SyncLspResult = {
  file: string;
  updated: boolean;
  servers: string[];
  missing: string[];
  /** Managed entries whose configured binary disappeared and was re-resolved. */
  refreshed?: string[];
  skipped?: string;
};

// Servers documented in docs/LSP.md. The pins matter: TS 7 dropped
// lib/tsserver.js, which typescript-language-server 6.x still expects.
// css/html/markdown come from the same vscode-langservers-extracted package,
// so one install covers templates, styles and docs without another dependency.
export const LSP_SERVERS: LspServerSpec[] = [
  {
    id: "typescript",
    bin: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    packages: ["typescript@5.9.3", "typescript-language-server"],
  },
  {
    id: "python",
    bin: "pyright-langserver",
    args: ["--stdio"],
    extensions: [".py", ".pyi"],
    packages: ["pyright"],
  },
  {
    id: "bash",
    bin: "bash-language-server",
    args: ["start"],
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
    packages: ["bash-language-server"],
  },
  {
    id: "json",
    bin: "vscode-json-language-server",
    args: ["--stdio"],
    extensions: [".json", ".jsonc"],
    packages: ["vscode-langservers-extracted"],
  },
  {
    id: "css",
    bin: "vscode-css-language-server",
    args: ["--stdio"],
    extensions: [".css", ".scss", ".less"],
    packages: ["vscode-langservers-extracted"],
  },
  {
    id: "html",
    bin: "vscode-html-language-server",
    args: ["--stdio"],
    extensions: [".html", ".htm"],
    packages: ["vscode-langservers-extracted"],
  },
  {
    id: "markdown",
    bin: "vscode-markdown-language-server",
    args: ["--stdio"],
    extensions: [".md", ".mdx"],
    packages: ["vscode-langservers-extracted"],
  },
];

export function lspPackageList(): string[] {
  return [...new Set(LSP_SERVERS.flatMap((server) => server.packages))];
}

/** Directories searched for a server binary, in priority order. */
export function lspSearchDirs(
  installRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string[] {
  const dirs = [
    path.join(installRoot, "lsp", "node_modules", ".bin"),
    path.join(home, ".opencode", "lsp", "node_modules", ".bin"),
    path.join(home, ".config", "opencode", "lsp", "node_modules", ".bin"),
  ];
  for (const entry of String(env.PATH ?? "").split(path.delimiter)) {
    if (entry.trim()) dirs.push(entry);
  }
  return [...new Set(dirs)];
}

function findBinary(dir: string, name: string): string | null {
  const names =
    process.platform === "win32" ? [name + ".cmd", name + ".exe", name] : [name, name + ".cmd"];
  for (const candidate of names) {
    const full = path.join(dir, candidate);
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Detect which configured language servers are usable on this machine. */
export function resolveLspServers(
  installRoot: string,
  options: { env?: NodeJS.ProcessEnv; home?: string; dirs?: string[] } = {},
): ResolvedLsp {
  const searchDirs =
    options.dirs ?? lspSearchDirs(installRoot, options.env ?? process.env, options.home ?? os.homedir());
  const servers: Record<string, LspServerConfig> = {};
  const missing: string[] = [];
  for (const spec of LSP_SERVERS) {
    let found: string | null = null;
    for (const dir of searchDirs) {
      found = findBinary(dir, spec.bin);
      if (found) break;
    }
    if (found) {
      servers[spec.id] = { command: [found, ...spec.args], extensions: [...spec.extensions] };
    } else {
      missing.push(spec.id);
    }
  }
  return { servers, missing, searchDirs };
}

/**
 * Merge detected servers into the `lsp` object of an OpenCode config file.
 * Existing entries win; a boolean `lsp: true` (built-in servers) is never
 * rewritten. Returns `updated: false` when nothing changed.
 */
export function syncLspConfig(
  configFile: string,
  installRoot: string,
  options: { env?: NodeJS.ProcessEnv; home?: string; dirs?: string[] } = {},
): SyncLspResult {
  let raw: string;
  try {
    raw = fs.readFileSync(configFile, "utf8");
  } catch {
    return { file: configFile, updated: false, servers: [], missing: [], skipped: "opencode.json missing" };
  }
  let config: any;
  try {
    config = JSON.parse(raw);
  } catch {
    return {
      file: configFile,
      updated: false,
      servers: [],
      missing: [],
      skipped: "opencode.json is not strict JSON; lsp not written",
    };
  }
  if (config?.lsp === true) {
    return {
      file: configFile,
      updated: false,
      servers: [],
      missing: [],
      skipped: "lsp=true (built-in servers); explicit entries not added",
    };
  }

  const resolved = resolveLspServers(installRoot, options);
  const existing =
    config.lsp && typeof config.lsp === "object" && !Array.isArray(config.lsp) ? config.lsp : {};
  const nextLsp: Record<string, any> = { ...existing };
  const added: string[] = [];
  const refreshed: string[] = [];
  for (const spec of LSP_SERVERS) {
    const entry = resolved.servers[spec.id];
    if (!entry) continue;
    const current = nextLsp[spec.id];
    if (!current) {
      nextLsp[spec.id] = entry;
      added.push(spec.id);
      continue;
    }
    const command = Array.isArray(current?.command) ? current.command : null;
    const first = command && typeof command[0] === "string" ? command[0] : "";
    const bin = first ? path.basename(first) : "";
    const managed = bin === spec.bin || bin === spec.bin + ".cmd" || bin === spec.bin + ".exe";
    if (managed && !fs.existsSync(first)) {
      nextLsp[spec.id] = {
        ...entry,
        ...(Array.isArray(current?.extensions) ? { extensions: current.extensions } : {}),
      };
      refreshed.push(spec.id);
    }
  }
  if (added.length === 0 && refreshed.length === 0) {
    return {
      file: configFile,
      updated: false,
      servers: Object.keys(resolved.servers),
      missing: resolved.missing,
    };
  }
  const next = { ...config, lsp: nextLsp };
  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (serialized === raw) {
    return {
      file: configFile,
      updated: false,
      servers: Object.keys(resolved.servers),
      missing: resolved.missing,
    };
  }
  fs.writeFileSync(configFile, serialized, { encoding: "utf8", mode: 0o600 });
  return {
    file: configFile,
    updated: true,
    servers: Object.keys(resolved.servers),
    missing: resolved.missing,
    ...(refreshed.length ? { refreshed } : {}),
  };
}
