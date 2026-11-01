// Documentation consistency guard.
//
// Prose drifts faster than code: the circuit breaker stopped delegating to
// another agent, but old README/runtime text kept promising a switch. A stale
// sentence is a false instruction, so it must fail the same checks as code.
//
// The rules are deliberately narrow and evidence-based: known stale claims are
// rejected, and the ACP setup must stay documented. A scanner is not a proof of
// correctness; it is a tripwire against the exact regressions already seen.

import * as fs from "node:fs";
import * as path from "node:path";

export type DocsProblem = {
  file: string;
  line: number;
  reason: string;
  text: string;
};

type StaleRule = {
  file: string;
  pattern: RegExp;
  reason: string;
};

const STALE_RULES: StaleRule[] = [
  {
    file: "README.md",
    pattern: /পরের roster agent-এ switch হয়/,
    reason: "the circuit breaker never switches agents",
  },
  {
    file: "README.md",
    pattern: /এভাবে সর্বোচ্চ ৩টি agent চেষ্টা করে/,
    reason: "one agent retries; three different agents are not tried",
  },
  {
    file: "docs/100c-runtime-template.md",
    pattern: /switched to the next untried roster agent/,
    reason: "the circuit breaker never switches agents",
  },
  {
    file: "docs/100c-runtime-template.md",
    pattern: /After three failed agents/,
    reason: "one agent owns the failure; there are no three failed agents",
  },
  {
    file: "src/runtime.ts",
    pattern: /ctx\.session\.switchAgent/,
    reason: "runtime docs must not advertise a delegation door",
  },
  {
    file: "src/runtime.ts",
    pattern: /পরের roster agent-এ/,
    reason: "runtime docs must not promise a roster handoff",
  },
  {
    file: "src/zombie/syllabus.ts",
    pattern: /delegate with a named teammate/,
    reason: "the standing rules forbid delegation",
  },
  {
    file: "AGENTS.md",
    pattern: /delegate with a named teammate/,
    reason: "the standing rules forbid delegation",
  },
  {
    file: "docs/AGENT-HANDOFF.md",
    pattern: /Reject = থামো, handover করো/,
    reason: "Reject means stop and tell the user, not hand over to another agent",
  },
];

const REQUIRED: Array<{ file: string; pattern: RegExp; reason: string }> = [
  {
    file: "README.md",
    pattern: /acp-client|VS Code ACP/,
    reason: "the VS Code ACP path must stay reproducible",
  },
  {
    file: "docs/AGENT-HANDOFF.md",
    pattern: /acp-client|ACP Client/,
    reason: "the handoff document must mention the ACP setup",
  },
  {
    file: "README.md",
    pattern: /একই agent/,
    reason: "the breaker description must say the same agent retries",
  },
];

function readLines(root: string, file: string): string[] | null {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8").split(/\r?\n/);
}

/** Scan the repository docs and generated runtime source for stale claims. */
export function docsConsistencyProblems(root: string): DocsProblem[] {
  const problems: DocsProblem[] = [];
  for (const rule of STALE_RULES) {
    const lines = readLines(root, rule.file);
    if (!lines) continue;
    lines.forEach((text, index) => {
      if (rule.pattern.test(text)) {
        problems.push({ file: rule.file, line: index + 1, reason: rule.reason, text: text.trim() });
      }
    });
  }
  for (const rule of REQUIRED) {
    const lines = readLines(root, rule.file);
    if (!lines) {
      problems.push({ file: rule.file, line: 0, reason: `missing file: ${rule.reason}`, text: "" });
      continue;
    }
    if (!lines.some((text) => rule.pattern.test(text))) {
      problems.push({ file: rule.file, line: 0, reason: `missing: ${rule.reason}`, text: "" });
    }
  }
  return problems;
}
