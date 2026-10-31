# Provider Privacy Boundary

What the plugin sends to a model provider, and what it must never send.
This file is the contract; the tests below enforce it.

## Leaves the machine (required for the product to work)

- The agent system prompt (persona, shared rules, execution doctrine).
- The compact context pack: SSOT excerpt, syllabus lessons, focus files, recent memory.
- Tool names and JSON schemas.
- The session model reference and the provider credential OpenCode already holds.

## Never leaves the machine

| Data | Why | Enforced by |
| --- | --- | --- |
| Owner name, phone, address, email, website (`src/identity.ts`) | PII belongs to the owner, not the provider | `test/plugin.test.ts` — agent markdown/config must not contain those fields |
| OS home directory (`/home/<user>`, `C:\Users\<user>`) | Reveals account name and device layout on every request | `stripHomePath()` in `src/zombie/context.ts`; test in `test/context.test.ts` |
| `X-ZombieCoder-*` or any plugin identity header | A provider can fingerprint a client from headers | `test/plugin.test.ts` asserts the `model.request` hook adds nothing |
| `identity.json` / branding block | It is a local build artifact, not prompt content | `src/generate.ts` writes docs only; no runtime import into prompts |
| External gateway/MCP URLs | Infrastructure metadata; not needed by the model | installed `zombiecoder/config.json` keeps them empty when unset |

## Rules for new code

1. Anything pushed into `event.system`, messages, tool descriptions or request
   headers passes through this boundary. Add a test, not a comment.
2. Never add an outbound header that names the plugin or the owner.
3. Keep absolute paths available to tools; rewrite only the provider-facing copy.
4. `identity.json` stays a local artifact. Do not embed it in prompts.

## Evidence

- `test/context.test.ts` — home path rewritten to `~`, tools keep the real path.
- `test/plugin.test.ts` — PII absent from prompts/config; no plugin header added.
- `npm test` must stay green before a release (`npm run check`).
