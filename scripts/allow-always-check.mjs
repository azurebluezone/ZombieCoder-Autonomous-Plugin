// Gate check for the Allow always persistence contract.
// It reads the live OpenCode permission store read-only, then reports whether a
// durable row for goal_contract.open exists for this project. The LSP lines are
// observations from a separate probe; they never turn this permission check green.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const projectRoot = process.cwd();
const dbPath = process.env.ZOMBIECODER_OPENCODE_DB ?? path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
const evidencePath = process.env.ZOMBIECODER_LSP_EVIDENCE ?? "/tmp/opencode/lsp-after-edit.json";

let db;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
} catch (error) {
  console.log(`ALLOW_ALWAYS_DB_ERROR ${dbPath}: ${error.message}`);
  process.exit(1);
}

const rows = db
  .prepare("select action, resource, time_created, time_updated from permission where action = ? order by time_created desc")
  .all("goal_contract.open");
db.close();

const saved = rows.find((row) => row.resource === projectRoot || row.resource === `${projectRoot}/*` || row.resource === "*");
console.log(`PROJECT_ROOT=${projectRoot}`);
console.log(`PERMISSION_ROWS=${rows.length}`);
for (const row of rows) {
  console.log(`PERMISSION_ROW action=${row.action} resource=${row.resource} created=${row.time_created} updated=${row.time_updated}`);
}

const lspPath = evidencePath;
if (fs.existsSync(lspPath)) {
  try {
    const evidence = JSON.parse(fs.readFileSync(lspPath, "utf8"));
    const lsp = evidence.lsp ?? evidence;
    const findings = Array.isArray(evidence.findings) ? evidence.findings : [];
    const found = Boolean(lsp.pid || lsp.found > 0 || findings.length > 0);
    console.log(`LSP_AFTER_EDIT=${found ? "present" : "absent"}`);
    if (!found) {
      console.log("LSP_NOTE=no OpenCode-managed language-server child was observed after the edit");
    } else {
      console.log(`LSP_PID=${lsp.pid ?? "missing"} LSP_PPID=${lsp.ppid ?? "missing"}`);
      console.log(`LSP_CMD=${String(lsp.cmd ?? "missing").replace(/\s+/g, " ").slice(0, 240)}`);
      console.log(`LSP_CAPTURED_AT=${evidence.capturedAt ?? "missing"}`);
    }
    const diagnostics = Array.isArray(evidence.diagnostics) ? evidence.diagnostics : Array.isArray(lsp.diagnostics) ? lsp.diagnostics : [];
    console.log(`LSP_DIAGNOSTICS=${diagnostics.length}`);
    for (const diagnostic of diagnostics.slice(0, 3)) {
      console.log(`LSP_DIAGNOSTIC ${JSON.stringify(diagnostic).slice(0, 300)}`);
    }
    if (evidence.directProbe) {
      const probe = evidence.directProbe;
      console.log(`LSP_DIRECT_PROBE=${probe.ok ? "PASS" : "FAIL"} pid=${probe.pid ?? "missing"} code=${probe.code ?? "missing"}`);
    }
  } catch (error) {
    console.log(`LSP_AFTER_EDIT=present-unreadable ${error.message}`);
  }
} else {
  console.log("LSP_AFTER_EDIT=absent");
  console.log("LSP_NOTE=no evidence artifact; run the edit watch before claiming managed diagnostics");
}

if (!saved) {
  console.log("ALLOW_ALWAYS_MISSING");
  process.exit(1);
}

console.log("ALLOW_ALWAYS_OK");
