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
| `tools/evidence_gate.py` | Rejects unproven models, chat, stream, Responses, Anthropic and TLS payloads |
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
python3 tools/evidence_gate.py --self-test
```

Supported kinds:

- `models`
- `chat`
- `stream` / SSE
- `responses`
- `anthropic`
- `tls`

`PASS` requires every structural check. `HTTP 200` or fluent prose alone is not
evidence. A `401` error body, an empty assistant message, invalid tool-call JSON,
an unfinished stream or a failed certificate check is `FAIL`.

Observed:

- self-test: 8/8 fixtures pass
- live `/v1/models`: `PASS`
- live chat (`pong`): `PASS`
- `401` model payload: `FAIL`
- malformed model list: `FAIL`

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

It listens on `443` with TLS 1.2/1.3 and proxies to
`http://127.0.0.1:8000`.

Validation and tests:

```text
sudo nginx -t
nginx: configuration file /etc/nginx/nginx.conf test is successful

openssl s_client ... -servername localhost -CAfile /etc/ssl/zombiecoder/localhost.crt
status=PASS
protocol=TLSv1.3
verification=OK
peer certificate CN=localhost

curl --cacert /etc/ssl/zombiecoder/localhost.crt https://localhost/v1/models
HTTP 200
{"object":"list","data":[{"id":"mock-small"},{"id":"mock-large"}]}

python3 tools/evidence_gate.py --kind models --file local-nginx-models.json
PASS
```

The same payload was returned through `https://zombiecoder.local` using
`--resolve zombiecoder.local:443:127.0.0.1`. The full template rendered to
`/tmp/opencode/nginx-full.conf` also passed `nginx -t` and OpenSSL verification
as root.

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
