// Single source for every value that used to be copied into the plugin, the
// installer and the helper scripts.
//
// Nothing here is a secret and nothing here is required: every value can be
// overridden with the matching environment variable or with the global
// ~/.config/opencode/zombiecoder/config.json. The literals below are only the
// documented fallbacks, kept in ONE place so the runtime and the installer can
// never disagree again.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_MODEL } from "../roster.ts";

function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Walk up from this module until a package.json is found. That works in the
// source tree (src/zombie -> repo) and in the installed copy
// (<config>/plugins/zombiecoder/zombie -> <config>), so the version is read,
// never duplicated.
function readPackageVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (typeof parsed?.version === "string" && parsed.version.trim()) return parsed.version.trim();
    } catch {
      /* keep walking */
    }
    // Installed runtimes ship <config>/package.json without a version field, but
    // the installer always writes <config>/zombiecoder/config.json with one.
    // Without this the whole SSOT/syllabus is stamped v0.0.0-dev.
    const fromConfig = readConfigVersion(dir);
    if (fromConfig) return fromConfig;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0-dev";
}

function readConfigVersion(dir: string): string | undefined {
  const candidates = [path.join(dir, "zombiecoder", "config.json")];
  if (path.basename(dir) === "zombiecoder") candidates.push(path.join(dir, "config.json"));
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof parsed?.version === "string" && parsed.version.trim()) return parsed.version.trim();
    } catch {
      /* no config here */
    }
  }
  return undefined;
}

export const PRODUCT = "ZombieCoder";
export const PLUGIN_VERSION = env("ZOMBIECODER_VERSION") ?? readPackageVersion();
export { BASELINE_MODEL };

export const DEFAULT_CUSTOM_PROVIDER_ID =
  env("ZOMBIECODER_PROVIDER_ID") ?? "missionbarisal";
export const DEFAULT_CUSTOM_PROVIDER_URL =
  env("ZOMBIECODER_PROVIDER_URL") ?? "https://gpu.zombiecoder.my.id/v1";
export const DEFAULT_CUSTOM_PROVIDER_KEY =
  env("ZOMBIECODER_PROVIDER_KEY") ?? env("ZOMBIECODER_API_KEY") ?? "";
export const DEFAULT_PROVIDER_NAME =
  env("ZOMBIECODER_PROVIDER_NAME") ?? "ZombieCoder Gateway";
export const DEFAULT_OPENCODE_API_URL =
  env("OPENCODE_API_URL") ?? env("OPENCODE_BASE") ?? "http://127.0.0.1:49374";
// URL-only origin handshake. Empty means "do not handshake"; the provider URL
// from config is used as-is. Set ZOMBIECODER_ORIGIN_URL or config.originUrl to a
// trusted origin that publishes /gateway_url.json.
export const DEFAULT_ORIGIN_URL = env("ZOMBIECODER_ORIGIN_URL") ?? "";
export const DEFAULT_MCP_URL = env("ZOMBIECODER_MCP_URL") ?? "";
export const DEFAULT_SSOT_REFRESH_MS = 5 * 60 * 1000;
