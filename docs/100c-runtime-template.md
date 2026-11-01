# 100C Runtime Template

**Scope:** `/home/xubuntu/Plugin` runtime template, copied into this repository.
**Owner:** Sahon Srabon (Developer Zone), Dhaka, Bangladesh.
**Purpose:** a reusable, evidence-first client/runtime template that can be
installed beside any OpenAI-compatible gateway and tested with OpenSSL or Nginx.

No secret is stored in this document. API keys, cookies and browser session state
are never copied into generated reports.

---

## ১. What was added

| Path | Purpose |
|---|---|
| `model.mjs` | Interactive/non-interactive model mapper; probes `/v1/models`; deterministic agent mapping; OpenCode free-model fallback |
| `tools/hulia_100c.py` | Read-only file, editor/client, process and network scan |
| `tools/tls_verify.py` | OpenSSL TLS evidence + optional `nginx -t` |
| `tools/render_nginx.py` | Renders the generic Nginx template without a hardcoded host |
| `tls/nginx.conf.template` | Reusable TLS reverse-proxy template |
| `tools/origin_profile.py` | Builds an origin profile from a 100C report |
| `tools/evidence_gate.py` | Rejects unproven models, chat, stream, Responses, Anthropic, TLS and factual-claim payloads |
| `doc/identity.js` | Machine-readable identity surface |
| `doc/ethics.js` | Evidence-first ethics and labels |
| `doc/runtime-operations.js` | Runtime protocols, surfaces, fallback and blockers |
| `doc/index.js` | Re-exports the three JS documentation modules |

The local snapshot also backed up the old `doc/` Markdown files to
`.backups/doc-20261020232648` before replacing them with JS modules.

---

## ২. Hulia 100C scan

```bash
cd /home/xubuntu/Plugin
python3 tools/hulia_100c.py --root .
```

The script is read-only. It hashes files, extracts normalized endpoints without
query strings, inventories editor/client config paths, reads process/listener
state and prints explicit blockers.

Observed on 2026-10-20:

```text
files=47, clients=3, listeners=7, connections=28
```

Important blockers at that time:

- `nginx` binary was missing, so `nginx -t` could not run.
- no local `:443` listener, so local Nginx TLS was not running.
- no local `:8000` listener, so no local OpenAI-compatible gateway was running.
- live `/v1/models` without an API key returned `HTTP 401`.

`origin/origin-profile.json` is generated, not committed. The scan found one
public HTTPS API origin:

```text
https://gpu.zombiecoder.my.id
```

The profile keeps `requires_choice` explicit if more than one public API origin
is ever discovered.

---

## ৩. Model mapper

Interactive:

```bash
cd /home/xubuntu/Plugin
node model.mjs
```

The prompt asks for:

1. OpenAI-compatible URL
2. optional API key
3. optional MCP URL

Non-interactive:

```bash
node model.mjs --non-interactive \
  --url https://gpu.zombiecoder.my.id/v1 \
  --provider-id missionbarisal \
  --out /tmp/opencode/model-plan.json \
  --json
```

Rules:

- Probe the provider's own `/v1/models`; never assign an agent to a dead server.
- Reject empty, malformed or non-2xx responses.
- Timeout, no redirect, maximum response size, strict JSON/content-type checks.
- Derive the provider ID from `opencode.json` when the URL matches an existing
  provider; otherwise derive it from the host or accept `--provider-id`.
- Read agents from `opencode.json`; if missing, try `src/roster.ts`.
- Missing agents or models must not crash the mapper.

Fallback:

- Run `opencode models`.
- Keep IDs containing `free` plus the single allowed literal
  `opencode/big-pickle`.
- No other model name is hardcoded.
- If the OpenCode catalog is unavailable, use the allowed baseline only.

`--apply` is opt-in. It updates only existing agent objects in `opencode.json`,
copies a mode-`600` backup first, then writes atomically. The live config was not
changed by the dry-run.

Observed live provider:

```text
HTTP 200
1 model: Llama-3.2-3B-Instruct-Q4_K_M
mapped agents: 9
```

Observed fallback:

```text
opencode models: 11 refs
selected: 9 free refs + opencode/big-pickle
```

---

## ৪. Evidence gate

```bash
python3 tools/evidence_gate.py --kind auto --file response.json
python3 tools/evidence_gate.py --kind claim --file claim.json
python3 tools/evidence_gate.py --self-test
```

Supported kinds:

- `models`
- `chat`
- `stream` / SSE
- `responses`
- `anthropic`
- `tls`
- `claim`

A `claim` payload must contain a non-empty `claim` string and a non-empty
`evidence[]` array. Every evidence item needs non-empty `source`, non-empty
`observation` and `verified: true`. Missing evidence is `FAIL`, so an unsupported
factual claim cannot be reported as `PASS` merely because the prose is fluent.

`PASS` requires every structural check. `HTTP 200` or fluent prose alone is not
evidence. A `401` error body, an empty assistant message, invalid tool-call JSON,
an unfinished stream or a failed certificate check is `FAIL`.

The plugin exposes the same verifier as the `evidence_gate` tool. The rule is
enforced in the shared agent contract: call it before a factual claim, and report
`UNVERIFIED` when it returns `FAIL` or `SKIP`. The gate checks structure and
evidence presence, not real-world truth.

### Hard response gate and compact context

Two plugin-side layers sit around the model call:

- **Compact context pack** (`src/zombie/context.ts`) — every primary model call
  receives a bounded pack built from `SSOT.md`, `syllabus.md` and recent session
  memory, never the whole repository or the whole history. The `context_status`
  tool returns the same pack's status plus a `uiLine` so the user can see in the
  UI that SSOT, syllabus and memory are being managed, and which agent owns each surface (SSOT=manu, syllabus=halim, memory=zombiecoder, skills=tuhin, gate=brishti).
- **Hard response gate** (`src/zombie/responseGate.ts`) — the `http.response`
  hook inspects primary answers. A completed or successful claim with no
  `path:line`, test output or exit code is replaced by an explicit `UNVERIFIED`
  message in the same provider protocol (OpenAI JSON and SSE are rebuilt). Only
  the final answer is gated: a turn that carries an OpenAI `tool_calls` /
  Anthropic `tool_use` / Responses `function_call` payload is intermediate and
  passes through untouched, because rewriting its `finish_reason` to `stop`
  terminated the tool chain mid-task. Evidence is structural: the cited file must
  exist and the cited line must be within it, test output must carry a count
  (`78/78 pass`, `tests 81`, `exit code 0`), and a bare `line 177`, a bare `5/10`
  or a path without a line is a reference, not proof. A blocked answer is also
  a circuit-breaker event: the failure (agent, reason, violations, blocked text
  preview) is stored under `agent/breaker/<sessionID>`, the user gets a synthetic
  status line, and the session is switched to the next untried roster agent with a
  queued prompt that demands evidence. After three failed agents the breaker
  opens with an unresolved message and concrete next steps instead of another
  silent stop. The replacement message states what failed, that the agent has
  been stopped, and what the user can do next (supply evidence, ask for an
  explicitly unverified explanation, or start a new instruction). The
  replacement is terminal (`finish_reason: stop` for OpenAI Chat, `stop_reason:
  end_turn` for Anthropic) so the client does not continue the stopped turn. It
  must not end in a silent dead-end. Evidence paths are not sandboxed: the agent
  may read any file, so a citation is accepted when the file and line exist,
  whether it sits in the working directory, an OpenCode config/data root, or an
  absolute/`~` path. An extension-less absolute file needs an explicit line
  (`/etc/hostname:1`). Unsupported protocols are passed through and audited as
  `NOT_TESTED`; the gate never claims to prove factual truth. Set
  `"responseGate": false` in the plugin config to disable it for diagnosis.

The 15–20 first-principles skill map per agent lives in `docs/skill-map.md`.

Observed:

- self-test: 10/10 fixtures pass
- plugin tests: 66/66 pass (`npm test`)
- typecheck: pass (`npm run typecheck`)
- compact context pack: bounded at 2800 bytes; role-scoped SSOT/syllabus/memory excerpts
- response gate: OpenAI JSON and SSE rewrite tests pass; outside-root paths fail
- live `/v1/models`: `PASS`
- live chat (`pong`): `PASS`
- `401` model payload: `FAIL`
- malformed model list: `FAIL`
- evidence-less claim: `FAIL` (`evidence_is_nonempty_array`)
- live OpenCode `http.response` gate: `NOT_TESTED` until the desktop process restarts

---

## ৫. TLS and Nginx

Render the generic template:

```bash
python3 tools/render_nginx.py \
  --server-name <host> \
  --cert /path/fullchain.pem \
  --key /path/privkey.pem \
  --upstream http://127.0.0.1:8000 \
  --out /tmp/opencode/nginx.conf
```

Validate:

```bash
python3 tools/tls_verify.py \
  --host <host> \
  --servername <host> \
  --nginx-conf /tmp/opencode/nginx.conf
```

The verifier keeps two evidence layers separate:

- OpenSSL handshake/certificate verification
- `nginx -t` configuration validation

OpenSSL live result for `gpu.zombiecoder.my.id`:

```text
status=PASS
protocol=TLSv1.3
verification=OK
peer certificate CN=zombiecoder.my.id
```

A wrong SNI produced `FAIL`; the evidence gate correctly refused it.

At the time of the initial scan, `nginx` was missing, so `nginx -t` was `SKIP`.
Nginx 1.18 was installed afterward.

### ৫.১ Local Nginx TLS test

A local self-signed certificate was created at
`/etc/ssl/zombiecoder/localhost.crt` with SANs `localhost`,
`zombiecoder.local` and `127.0.0.1`. The key is mode `600`.

Local site:

```text
/etc/nginx/sites-available/zombiecoder-local.conf
/etc/nginx/sites-enabled/zombiecoder-local.conf -> ../sites-available/zombiecoder-local.conf
```

It listens on `443` with TLS 1.2/1.3, serves a static `GET /health` response,
and proxies everything else to `http://127.0.0.1:8000`.

Validation and tests:

```text
sudo nginx -t
nginx: configuration file /etc/nginx/nginx.conf test is successful

openssl s_client ... -servername localhost -CAfile /etc/ssl/zombiecoder/localhost.crt
status=PASS
protocol=TLSv1.3
verification=OK
peer certificate CN=localhost

curl --cacert /etc/ssl/zombiecoder/localhost.crt https://localhost/health
ok
HTTP 200

curl --cacert /etc/ssl/zombiecoder/localhost.crt https://localhost/v1/models
HTTP 200
{"object":"list","data":[{"id":"mock-small"},{"id":"mock-large"}]}

python3 tools/evidence_gate.py --kind models --file local-nginx-models.json
PASS
```

The `/health` endpoint returned `200` through both `https://localhost` and
`https://zombiecoder.local` (using `--resolve zombiecoder.local:443:127.0.0.1`).
The model payload was returned through both names as well. The full template
rendered to `/tmp/opencode/nginx-full.conf` also passed `nginx -t` and OpenSSL
verification as root.

After the mock upstream was stopped, `/v1/models` returned `502`; that is the
expected state until a real local gateway listens on `127.0.0.1:8000`.

> The public DNS names resolve to Cloudflare, not to this machine. The local
> certificate is a test certificate, not a public Let's Encrypt certificate.
> `certbot --nginx` needs a domain whose DNS/origin reaches this Nginx.

---

## ৬. Commands

```bash
cd /home/xubuntu/Plugin

# scan
python3 tools/hulia_100c.py --root .

# origin profile
python3 tools/origin_profile.py \
  --report /tmp/opencode/hulia-100c-report.json

# TLS evidence
python3 tools/tls_verify.py \
  --host gpu.zombiecoder.my.id \
  --servername gpu.zombiecoder.my.id

# model plan
node model.mjs --non-interactive \
  --url https://gpu.zombiecoder.my.id/v1 \
  --json

# response gate
python3 tools/evidence_gate.py --kind auto --file response.json

# factual claim gate
python3 tools/evidence_gate.py --kind claim --file claim.json
```

---

## ৭. Evidence labels

| Label | Meaning |
|---|---|
| `SOURCE_VERIFIED` | File, config and source evidence read successfully |
| `CONFIG_VALIDATED` | Nginx/OpenCode config validates |
| `LIVE_PROBE_PASSED` | Provider or TLS endpoint answered correctly |
| `END_TO_END_TESTED` | Live request and response gate both passed |
| `NOT_TESTED` | Path not exercised |
| `UNVERIFIED` | No evidence |

Current status:

- `SOURCE_VERIFIED`: 100C scan, origin profile, fallback catalog
- `LIVE_PROBE_PASSED`: live models, live TLS, MCP mock probe
- `END_TO_END_TESTED`: live chat + evidence gate
- `CONFIG_VALIDATED`: local Nginx `nginx -t` and rendered template `nginx -t`
- `NOT_TESTED`: live `--apply`, real MCP server, public Let's Encrypt certificate

---

## ৮. Security note

- Do not print API keys, bearer tokens or cookies.
- Reports contain endpoints, hashes and block reasons, not secret values.
- Use `ZC_API_KEY`/`OPENAI_API_KEY` instead of `--api-key` where possible.
- Rotate any key that has appeared in terminal output.
- Nginx and Certbot configuration is system-level; review before reload.

---

## ৯. Current blockers

- Public DNS for `zombiecoder.my.id` and `gpu.zombiecoder.my.id` resolves to
  Cloudflare addresses. `certbot --nginx` cannot issue a public certificate for
  this machine unless DNS/origin routing points here.
- No real local `:8000` upstream is running. The local Nginx config is ready, but
  it returns `502` until a gateway starts there.
- Live `--apply` has not been run against the global `opencode.json`.
- The local TLS certificate is self-signed and valid for 30 days; it is not a
  public certificate.

Local Nginx TLS is configured and tested. The next production step is a real
domain/origin certificate, either through a Cloudflare-aware DNS challenge or by
pointing an origin hostname at this machine.

### ৯.১ Install/model verification evidence (2026-10-21)

| Check | Observed | Label |
|---|---|---|
| Provider model list | `/v1/models` returns only `Llama-3.2-3B-Instruct-Q4_K_M`; stale `Qwen2.5-Coder-7B-Instruct-Q4_K_M` removed from config | `LIVE_PROBE_PASSED` |
| Chat | `POST /v1/chat/completions` → HTTP 200, content `pong` | `LIVE_PROBE_PASSED` |
| Tool call | `get_time` tool call returned | `LIVE_PROBE_PASSED` |
| Prompt throughput | 11.7 tok/s on the install probe; below the 20 tok/s gate | `LIVE_PROBE_PASSED` |
| Fallback | Provider saved, not selected; all 9 agents → `opencode/big-pickle` | `CONFIG_VALIDATED` |
| Baseline catalog | `opencode/big-pickle` active, cost 0/0 | `LIVE_PROBE_PASSED` |
| Skills cache | 20 files in `~/.opencode/zombiecoder/skills-catalog` | `SOURCE_VERIFIED` |
| Shared skills | 4 core files in `~/.opencode/zombiecoder/skills` (one copy for every project) | `END_TO_END_TESTED` (function), `NOT_TESTED` (post-restart UI) |
| LSP config | Installer generates `opencode.json.lsp` from `<install>/lsp` binaries (`syncLspConfig`) | `SOURCE_VERIFIED`; live probe separately |
| Tests | `npm test` 61/61 pass; `npm run typecheck` pass | `SOURCE_VERIFIED` |

Why the fallback: the local 3B model answers short prompts, but OpenCode sends
multi-thousand-token agent prompts. At ~11 tok/s prompt processing a single turn
can take minutes. `--allow-slow` keeps the provider if the owner explicitly wants
that trade-off; the default is a working free baseline.

`NOT_TESTED`: the new `syntax_check` code path through the already-running
OpenCode process; a restart is required to load the updated plugin module.

### ৯.২ LSP, token ও Cloudflare probe (2026-10-21; historical 2.1.1 values)

| Check | Observed | Label |
|---|---|---|
| OpenCode version | `opencode v2.1.1` | `LIVE_PROBE_PASSED` |
| LSP runtime | `Config.LSP.Server` and LSP protocol methods (`initialize`, `publishDiagnostics`) present in installed V2.1.1 app bundle | `SOURCE_VERIFIED` |
| LSP config | 4 servers (`typescript`, `python`, `bash`, `json`); `config.updated` at `02:43:31` | `CONFIG_VALIDATED` |
| LSP binaries | `typescript-language-server 6.0.2`, `typescript 5.9.3`, `pyright 1.1.414`, `bash-language-server 5.8.1`, `vscode-langservers-extracted 4.10.0` | `SOURCE_VERIFIED` |
| LSP initialize | direct probe 4/4 ok, exit `0` | `LIVE_PROBE_PASSED` |
| Editor LSP | config reloaded; no LSP child process yet; restart/open file required | `NOT_TESTED` |
| Provider token | `/v1/models` without token `401`; with token `200`; chat `200`, content `TOKEN_OK` | `LIVE_PROBE_PASSED` |
| Cloudflare | `server: cloudflare`, `cf-cache-status: DYNAMIC`, `cf-ray` unique per request | `LIVE_PROBE_PASSED` |
| Request mixing | 4 concurrent non-stream + 2 concurrent SSE, all markers matched their own response | `LIVE_PROBE_PASSED` (limited) |

The earlier "V2 has no LSP runtime" claim was wrong. V2.1.1 supports LSP through
the `lsp` config; the missing pieces were the config and the server binaries.

**2026-11-01 update (live V2.2.3):**

| Check | Observed | Label |
|---|---|---|
| OpenCode version | `opencode v2.2.3` | `LIVE_PROBE_PASSED` |
| LSP config | ৭টি server (`typescript`, `python`, `bash`, `json`, `css`, `html`, `markdown`) | `CONFIG_VALIDATED` |
| Initialize probe | 7/7 ok, exit `0` | `LIVE_PROBE_PASSED` |
| Direct diagnostics probe | `typescript-language-server` child PID `74818`, real `TS2322` | `LIVE_PROBE_PASSED` (probe-spawned) |
| Managed edit | real `.ts` edit + 4s watch: no child, no `lsp.updated`/`publishDiagnostics` | `NOT_TESTED` |
| Desktop editor | renderer has LSP settings only; no editor surface | `NOT_APPLICABLE` |

So editor diagnostics are **not** "restart and open a file" — the desktop build
has no editor to open. `npm run lsp:probe` and `npm run lsp:diagnostics` prove the
server side; a future editor or an `lsp` tool in the session is still required
for `END_TO_END_TESTED`. `syntax_check` is a fallback, not LSP. `docs/LSP.md` is
the source of truth.

Token note: the bearer token in the attached probe file is valid, but it was
shared in chat; rotate it. It is not used by LSP, and it must never be committed
or printed.

---

## ১০. গল্প, দায় ও ব্যবহারের সীমা

### ছোট্ট গল্প — চায়ের দোকানের শিক্ষানবিশ

একটি চায়ের দোকানে নতুন শিক্ষানবিশ এসেছে। দোকানদার তাকে সব কাজ একসাথে দেয় না;
দেয় একটি খাতা (SSOT), একটি ডায়েরি (syllabus), আর আজকের কাজের একটি ট্রে
(compact context pack)। শিক্ষানবিশ কিছু বলার আগে খাতা দেখে, ট্রে থেকে দরকারি
কাগজ পড়ে, একটি কাজ করে, শেষে ডায়েরিতে শেখাটা লেখে। দোকানদার প্রমাণ ছাড়া
"হয়ে গেছে" বলতে দেয় না — সেই কঠিন লোকটাই `response_gate`।

দোকানে বড় আর ছোট দুই কর্মী। ছোটজন সব জানে না, তাই তার পাশে রেসিপি কার্ড
(`docs/skills`: Laravel, Node, Next, Python, FastAPI, cPanel, server,
resource optimization, first-principles, evidence-before-confidence)। ছোটজন
কার্ড দেখে ধাপে ধাপে কাজ করে; বড়জন দ্রুত কাজ করে। কেউ অবহেলিত নয়, কারণ শেষ
প্রশ্ন সবার জন্য এক: "প্রমাণ কোথায়?"

### License ও নীতিশাস্ত্র

- **localhost/ব্যক্তিগত ব্যবহার:** হ্যাঁ।
- **ব্যবসায়িক ব্যবহার:** না। এই repo থেকে ডাউনলোড করা কোড দিয়ে ব্যবসা, paid
  service, SaaS, client work বা commercial product বানানো যাবে না।
- **শেখা/গবেষণা/non-profit:** হ্যাঁ, attribution রাখলে।
- কোনো doubt থাকলে commercial ধরে নিন এবং owner-এর লিখিত অনুমতি নিন।

আমরা কষ্ট করি মানুষের উপকারের জন্য; মানুষকে নিয়ে ব্যবসা করা এই প্রকল্পের
নীতির বিরুদ্ধে। বিস্তারিত শর্ত `LICENSE` ফাইলে; এটি legal advice নয়।

---

<!-- INTEGRITY:START -->
<div align="center">

### 🔐 ZombieCoder Integrity Seal

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  79d6a7d44f651316bd86ede5ee77b483b7cbcab258f495e3f759f00b6d763e3c  ║
║  files 105 · bytes 1001885 · base de442e8 · dirty                        ║
╚══════════════════════════════════════════════════════════════════════════╝
```

[Full manifest](INTEGRITY.md) · Verify: `npm run integrity:check`

> SHA-256 over source, scripts, tests, skills, package metadata and license.
> Detects accidental or unauthorized changes. Not a legal identity signature.
> Base commit is the code tree before this seal commit. Generated: 2026-11-01T10:01:39.719Z

</div>
<!-- INTEGRITY:END -->
