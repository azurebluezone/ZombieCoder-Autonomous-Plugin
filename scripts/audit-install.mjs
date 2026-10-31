#!/usr/bin/env node
/**
 * Inspect an OpenCode install that ZombieCoder produced and report whether the
 * pieces that matter actually exist: agents, LSP binaries, MCP servers, the
 * plugin entrypoint and the skill store.
 *
 * This reads the real filesystem; it does not trust the installer log.
 *
 *   node scripts/audit-install.mjs [--config <dir>]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const configDir = path.resolve(arg("--config", path.join(os.homedir(), ".config", "opencode")));
const installDir = path.resolve(arg("--install", configDir));
const jsonFile = path.join(configDir, "opencode.json");
const jsoncFile = path.join(configDir, "opencode.jsonc");
const configFile = fs.existsSync(jsonFile) ? jsonFile : jsoncFile;
if (!fs.existsSync(configFile)) {
  console.error(`FAIL no opencode.json/jsonc under ${configDir}`);
  process.exit(2);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configFile, "utf8"));
} catch (error) {
  console.error(`FAIL ${configFile} is not strict JSON: ${error.message}`);
  process.exit(2);
}

const has = (target) => fs.existsSync(target);
const agents = Object.keys(config.agents ?? {});
const agentsDir = path.join(installDir, "agents");
const agentFiles = has(agentsDir) ? fs.readdirSync(agentsDir).filter((name) => name.endsWith(".md")) : [];

const lsp = Object.entries(config.lsp ?? {}).map(([name, entry]) => {
  const command = Array.isArray(entry?.command) ? entry.command[0] : null;
  return { name, command, ok: Boolean(command) && has(command) };
});
const lspOk = lsp.filter((entry) => entry.ok).length;

const mcp = Object.entries(config.mcp?.servers ?? {}).map(([name, entry]) => {
  const command = Array.isArray(entry?.command) ? entry.command : null;
  const target = entry?.url ?? (command ? command[command.length - 1] : null);
  const local = entry?.type === "local";
  return {
    name,
    type: entry?.type ?? "remote",
    target,
    ok: !local || (command ? has(command[command.length - 1]) : false),
  };
});

const entrypoint = has(path.join(installDir, "plugins", "zombiecoder.ts"));
const skillsDir = path.join(installDir, "zombiecoder", "skills");
const catalogDir = path.join(installDir, "zombiecoder", "skills-catalog");
const countMd = (dir) => (has(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".md")).length : 0);
const skills = countMd(skillsDir);
const catalog = countMd(catalogDir);
const model = config.model ?? "(unset)";

const summary = [
  `agents=${agents.length}`,
  `lsp=${lspOk}/${lsp.length}`,
  `mcp=${mcp.length}`,
  `entrypoint=${entrypoint ? "ok" : "missing"}`,
  `skills=${skills}`,
  `model=${model}`,
];
console.log(`config=${configDir} install=${installDir}`);
console.log(summary.join(" "));

console.log(`agents_detail=${agentFiles.length} files: ${agentFiles.join(", ") || "-"}`);
for (const entry of lsp) {
  console.log(`lsp.${entry.name}=${entry.ok ? "ok" : "MISSING"} ${entry.command ?? "(no command)"}`);
}
for (const server of mcp) {
  console.log(`mcp.${server.name}=${server.ok ? "ok" : "MISSING"} ${server.type} ${server.target ?? ""}`.trim());
}
console.log(`skills_detail=${skills} installed, ${catalog} in catalog`);

const problems = [];
if (agents.length === 0) problems.push("no agents");
if (lsp.length === 0) problems.push("no lsp servers");
for (const entry of lsp) if (!entry.ok) problems.push(`lsp.${entry.name} binary missing`);
for (const server of mcp) if (!server.ok) problems.push(`mcp.${server.name} command missing`);
if (!entrypoint) problems.push("plugin entrypoint missing");

if (problems.length > 0) {
  console.log(`FAIL ${problems.join("; ")}`);
  process.exit(1);
}
console.log("PASS install configuration complete");
