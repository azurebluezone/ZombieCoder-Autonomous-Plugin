// OpenCode runtime detection for the installer.
//
// The installer writes an OpenCode V2 config (`mcp.servers`, V2 agent entries).
// It must therefore know whether a V2 binary is actually present. Detection is
// filesystem-only here; the installer supplies the version probe so this module
// stays testable without spawning.

import * as fs from "node:fs";
import * as path from "node:path";

export type OpenCodeMode = "auto" | "install" | "none";

export type OpenCodeInfo = {
  found: boolean;
  path: string | null;
  version: string | null;
  major: number | null;
  searched: string[];
};

export type VersionInfo = { version: string; major: number };

export const OPENCODE_PACKAGE = "@opencode/cli";

export function parseOpenCodeVersion(output: string): VersionInfo | null {
  const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?(?:\s|$)/.exec(String(output ?? ""));
  if (!match) return null;
  return { version: `${match[1]}.${match[2]}.${match[3]}`, major: Number(match[1]) };
}

export function executableName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "opencode.exe" : "opencode";
}

export function candidateDirs(options: {
  home: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const dirs: string[] = [];
  const push = (dir: string | undefined | null) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!dirs.includes(resolved)) dirs.push(resolved);
  };

  push(options.execPath ? path.dirname(options.execPath) : path.dirname(process.execPath));
  for (const entry of String(env.PATH ?? "").split(path.delimiter)) push(entry);
  push(path.join(options.home, ".local", "bin"));
  push(path.join(options.home, "bin"));
  push(path.join(options.home, ".opencode", "bin"));
  if (platform === "win32") {
    push(path.join(env.LOCALAPPDATA ?? path.join(options.home, "AppData", "Local"), "Programs", "opencode"));
    push(path.join(env.APPDATA ?? path.join(options.home, "AppData", "Roaming"), "npm"));
  } else {
    push("/usr/local/bin");
    push("/usr/bin");
    push("/opt/homebrew/bin");
  }
  return dirs;
}

export function findOpenCodeBinary(options: {
  home: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  exists?: (file: string) => boolean;
  extraDirs?: string[];
}): string | null {
  const exists = options.exists ?? fs.existsSync;
  const name = executableName(options.platform);
  const dirs = [...(options.extraDirs ?? []), ...candidateDirs(options)];
  for (const dir of dirs) {
    const file = path.join(dir, name);
    try {
      if (exists(file)) return file;
    } catch {
      /* unreadable PATH entry */
    }
  }
  return null;
}

export function parseMode(raw: string | undefined, disabled: boolean): OpenCodeMode {
  if (disabled) return "none";
  const value = String(raw ?? "auto").trim().toLowerCase();
  if (value === "auto" || value === "install" || value === "none") return value;
  throw new Error(`--opencode must be auto, install or none; got ${JSON.stringify(raw)}`);
}

export function npmInstallArgs(prefix?: string | null): string[] {
  const args = ["install", "-g"];
  if (prefix) args.push("--prefix", prefix);
  args.push(`${OPENCODE_PACKAGE}@latest`);
  return args;
}

export function inspectVersion(binary: string, run: (binary: string) => string): OpenCodeInfo {
  let output = "";
  try {
    output = run(binary);
  } catch {
    return { found: false, path: binary, version: null, major: null, searched: [binary] };
  }
  const parsed = parseOpenCodeVersion(output);
  return {
    found: Boolean(parsed),
    path: binary,
    version: parsed?.version ?? null,
    major: parsed?.major ?? null,
    searched: [binary],
  };
}
