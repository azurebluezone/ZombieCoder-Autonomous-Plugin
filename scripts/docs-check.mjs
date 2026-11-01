// Documentation consistency check.
//
// Usage: node --experimental-strip-types scripts/docs-check.mjs [root]
// Exit 0 only when the known stale claims are gone and the ACP setup is present.

import * as path from "node:path";
import { docsConsistencyProblems } from "../src/zombie/docsConsistency.ts";

const root = path.resolve(process.argv[2] ?? process.cwd());
const problems = docsConsistencyProblems(root);

if (problems.length > 0) {
  for (const problem of problems) {
    const where = problem.line > 0 ? `${problem.file}:${problem.line}` : problem.file;
    console.error(`DOCS_FAIL ${where} — ${problem.reason}`);
    if (problem.text) console.error(`  ${problem.text}`);
  }
  process.exit(1);
}

console.log("DOCS_OK stale claims absent; ACP setup documented");
