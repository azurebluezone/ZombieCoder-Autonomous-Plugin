#!/usr/bin/env node
/**
 * Inspect an OpenCode install that ZombieCoder produced and report whether the
 * pieces that matter actually exist: agents, LSP binaries, MCP servers, the
 * plugin entrypoint and the skill store.
 *
 * This reads the real filesystem; it does not trust the installer log.
 *
 *   node scripts/audit-install.mjs [--config <dir>] [--install <dir>]
 *
 *   --config   directory that holds opencode.json (default ~/.config/opencode)
 *   --install  install root with agents/, plugins/, zombiecoder/
 *              (default: the --config directory)
 *   -h, --help show usage and exit 0
 *
 * Exit codes: 0 complete, 1 incomplete, 2 bad arguments or unreadable config.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE = `Usage: node scripts/audit-install.mjs [options]

Options:
  --config <dir>   OpenCode config directory (default: ~/.config/opencode)
  --install <dir>  Install root with agents/, plugins/, zombiecoder/
                   (default: the --config directory)
  -h, --help       Show this help and exit

Exit codes: 0 complete, 1 incomplete, 2 bad arguments or unreadable config.`;

function usage(stream = process.stdout) {
  stream.write(USAGE + "\n");
}

function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }
  const options = {
    config: path.join(os.homedir(), ".config", "opencode"),
    install: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const match = /^--(config|install)(?:=(.*))?$/.exec(token);
    if (!match) {
      console.error(`FAIL unknown argument ${JSON.stringify(token)}`);
      usage(process.stderr);
      process.exit(2);
    }
    const value = match[2] ?? argv[index + 1];
    if (!value || value.startsWith("-")) {
      console.error(`FAIL --${match[1]} needs a directory`);
      usage(process.stderr);
      process.exit(2);
    }
    if (match[2] === undefined) index += 1;
    options[match[1]] = value;
  }
  options.config = path.resolve(options.config);
  options.install = path.resolve(options.install ?? options.config);
  return options;
}

const { config: configDir, install: installDir } = parseArgs(process.argv.slice(2));
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
