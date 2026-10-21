---
id: node
name: Node.js
description: Build and debug Node.js services and CLIs with the standard library first. Use for package.json, ESM, streams, child processes and async failures.
---

# Node.js

## Baseline

```bash
node --version
npm --version
npm ci
npm run typecheck
npm test
```

- Prefer the current LTS; check `node --version` before using a feature.
- Use ESM (`"type": "module"`) or CommonJS consistently.
- Do not commit `node_modules`.

## Async rules

- `await` every promise that matters; do not leave floating rejections.
- Add `AbortController` timeouts to network calls.
- Use `Promise.allSettled` when one failure must not cancel the rest.
- Close streams and child processes in `finally`.

## File and process work

```js
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
```

- Use `node:path` instead of string concatenation.
- Use `spawnSync` with `encoding: "utf8"` and a timeout for short tools.
- Do not build shell strings from untrusted input.

## Debugging

```bash
node --trace-warnings app.js
node --inspect-brk app.js
NODE_DEBUG=net,http app.js
```

- Read the first stack frame that belongs to your code.
- Reproduce with the smallest script.
- Check exit codes and `stderr`, not only `stdout`.

## Verification

- `npm test` exit code 0.
- One real request or CLI invocation.
- No unhandled rejection warning.
