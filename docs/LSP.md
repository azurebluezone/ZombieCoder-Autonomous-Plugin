# LSP — OpenCode V2.2.3 (live runtime)

> **সংক্ষেপে:** OpenCode **V2.2.3-এ LSP runtime আছে**। `No LSP servers configured`
> মানে upstream-এ LSP নেই — তা নয়; এর মানে `lsp` config বা language-server
> binary নেই। **installer নিজেই** `<install>/lsp`-এ server toolchain নামায়
> এবং resolve হওয়া absolute path দিয়ে `opencode.json`-এর `lsp` block লেখে
> (`src/zombie/lspConfig.ts` → `syncLspConfig`); `--no-lsp` দিলে দুটোই skip হয়।
> এই setup-এ `typescript`, `python`, `bash`, `json`, `css`, `html`, `markdown` — ৭টি
> server configured; direct `initialize` probe **7/7 pass**
> (`npm run lsp:probe -- --compact`, exit `0`); direct diagnostics probe
> **real `TS2322`** দেয় (`npm run lsp:diagnostics`, exit `0`)।
>
> তবে **desktop editor UI নেই** — renderer source map-এ শুধু LSP settings
> (`settings/workspaces/project-lsp.ts`) পাওয়া যায়, কোনো code editor surface নয়।
> Session catalog-এ `lsp` tool-ও নেই (85 tools, zero `lsp`)। তাই "editor
> diagnostics" দাবি করা যাবে না। একটি real edit-এর পর ৪ সেকেন্ড watched run-এ
> কোনো language-server child বা `lsp.updated`/`publishDiagnostics` event আসেনি;
> OpenCode-managed edit diagnostics **`NOT_TESTED`/`UNVERIFIED`**। বিস্তারিত
> §৫.২–§৫.৪।

---

## ১. প্রমাণ

| চেক | ফল | লেবেল |
|---|---|---|
| OpenCode version | `2.2.3` (`~/.config/ai.opencode.desktop/cli/2.2.3-x64/opencode-cli --version`) | `LIVE_PROBE_PASSED` |
| Runtime schema | CLI binary-তে `Config.LSP.Server` (offset `122891880`/`170407040`), `publishDiagnostics` (`124119588`), `goToDefinition` (`124119680`), `typescript-language-server` (`124118650`) strings আছে | `SOURCE_VERIFIED` |
| Desktop renderer | `app.asar`-এ `project-lsp` source map (`211685514`); renderer asset-এ `publishDiagnostics` নেই | `SOURCE_VERIFIED` |
| Config | `~/.config/opencode/opencode.json`-এ `lsp` key; ৭টি server; effective config API-তেও ৭টি | `CONFIG_VALIDATED` |
| Binaries | `typescript-language-server 6.0.2`, `typescript 5.9.3`, `pyright 1.1.414`, `bash-language-server 5.8.1`, `vscode-langservers-extracted 4.10.0` | `SOURCE_VERIFIED` |
| Initialize probe | ৭টি server; `typescript` 172ms, `python` 246ms, `bash` 392ms, `json` 236ms, `css` 301ms, `html` 607ms, `markdown` 365ms; **7/7 ok, exit `0`** | `LIVE_PROBE_PASSED` |
| Direct diagnostics probe | `typescript-language-server` child PID `74818`, `TS2322` at line 432 (`__lsp_probe__`), `matched:true`, exit `0` | `LIVE_PROBE_PASSED` (probe-spawned) |
| OpenCode-managed edit | real edit + 4s watch: no language-server child, no `lsp.updated`/`publishDiagnostics` event | `NOT_TESTED` |
| Editor UI | desktop renderer-এ editor surface নেই; শুধু LSP settings | `NOT_APPLICABLE` |
| `lsp` tool | TUI tool-view map-এ `lsp` entry আছে, কিন্তু session catalog-এ নেই (85 tools, zero match) | `SOURCE_VERIFIED` mapping / `UNVERIFIED` availability |

Runtime প্রমাণের reproducible command:

```bash
CLI="$HOME/.config/ai.opencode.desktop/cli/2.2.3-x64/opencode-cli"
APP=/opt/OpenCode/resources/app.asar
grep -aob 'Config.LSP.Server' "$CLI"
grep -aob 'publishDiagnostics' "$CLI"
grep -aob 'goToDefinition' "$CLI"
grep -aob 'typescript-language-server' "$CLI"
grep -aob 'project-lsp' "$APP"
```

`grep` offset পাওয়া মানে binary/bundle-এ string আছে। `Config.LSP.Server` schema-তে
`command`, `extensions`, `disabled`, `env`, `initialization`, `diagnostics` field
আছে। এটাই দেখায় V2.2.3-এ LSP client/runtime বর্তমান। Renderer-এ শুধু
`settings/workspaces/project-lsp.ts` source map পাওয়া যায়; `app.asar`-এ
`publishDiagnostics` নেই — অর্থাৎ LSP runtime server-side, renderer editor নয়।

> **সতর্কতা:** `https://opencode.ai/v2/docs/lsp` probe-এর সময় `404` ছিল। ৪০৪
> URL-কে প্রমাণ হিসেবে ব্যবহার করা যাবে না। এখানে প্রমাণ হলো installed app
> bundle + live initialize probe + config event।

---

## ২. আগে কেন কাজ করছিল না

তিনটি আলাদা কারণ ছিল:

1. `~/.opencode/opencode.json`-এ `lsp` key ছিল না।
2. `typescript-language-server`, `pyright-langserver`, `bash-language-server`,
   `vscode-json-language-server` — কোনো binary install ছিল না।
3. প্রথম দফায় `typescript@7.0.2` install হয়েছিল; এতে `lib/tsserver.js` নেই।
   `typescript-language-server 6.0.2` সেই path খোঁজে, তাই TS initialize fail করে:
   `Could not find a valid TypeScript installation...`
   `typescript@5.9.3` pin করার পর TS server pass করে।

অর্থাৎ এটা config + dependency সমস্যা ছিল, OpenCode-এর অভাবে নয়।

---

## ৩. Install (installer এখন স্বয়ংক্রিয়ভাবে করে)

Manual reproduction (installer `--no-lsp` ছাড়া এটাই চালায়):

```bash
LSP="$HOME/.opencode/lsp"
mkdir -p "$LSP"
cd "$LSP"
npm init -y
npm install --no-audit --no-fund \
  typescript@5.9.3 \
  typescript-language-server \
  pyright \
  bash-language-server \
  vscode-langservers-extracted
```

`typescript@5.9.3` ইচ্ছা করে pin করা: TS 7.0.2-এ `lib/tsserver.js` নেই। ভবিষ্যতে
`typescript-language-server` TS 7 support করলে pin না-ও লাগতে পারে; ততদিন 5.9.3
নিরাপদ।

Binary paths:

```text
~/.opencode/lsp/node_modules/.bin/typescript-language-server
~/.opencode/lsp/node_modules/.bin/pyright-langserver
~/.opencode/lsp/node_modules/.bin/bash-language-server
~/.opencode/lsp/node_modules/.bin/vscode-json-language-server
~/.opencode/lsp/node_modules/.bin/vscode-css-language-server
~/.opencode/lsp/node_modules/.bin/vscode-html-language-server
~/.opencode/lsp/node_modules/.bin/vscode-markdown-language-server
```

---

## ৪. Config

Installer `syncLspConfig` দিয়ে `opencode.json`-এর `lsp` object নিজে লেখে; user-এর
আগের entry বা অন্য key মুছে না। এই machine-এর actual paths:

```jsonc
{
  "lsp": {
    "typescript": {
      "command": [
        "/home/xubuntu/.opencode/lsp/node_modules/.bin/typescript-language-server",
        "--stdio"
      ],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
    },
    "python": {
      "command": [
        "/home/xubuntu/.opencode/lsp/node_modules/.bin/pyright-langserver",
        "--stdio"
      ],
      "extensions": [".py", ".pyi"]
    },
    "bash": {
      "command": [
        "/home/xubuntu/.opencode/lsp/node_modules/.bin/bash-language-server",
        "start"
      ],
      "extensions": [".sh", ".bash", ".zsh", ".ksh"]
    },
    "json": {
      "command": [
        "/home/xubuntu/.opencode/lsp/node_modules/.bin/vscode-json-language-server",
        "--stdio"
      ],
      "extensions": [".json", ".jsonc"]
    },
    "css": {
      "command": [
        "/home/xubuntu/.opencode/lsp/node_modules/.bin/vscode-css-language-server",
        "--stdio"
      ],
      "extensions": [".css", ".scss", ".less"]
    },
    "html": {
      "command": [
        "/home/xubuntu/.opencode/lsp/node_modules/.bin/vscode-html-language-server",
        "--stdio"
      ],
      "extensions": [".html", ".htm"]
    },
    "markdown": {
      "command": [
        "/home/xubuntu/.opencode/lsp/node_modules/.bin/vscode-markdown-language-server",
        "--stdio"
      ],
      "extensions": [".md", ".mdx"]
    }
  }
}
```

অন্য machine-এ `/home/xubuntu` নিজের home path দিয়ে বদলাতে হবে। JSON-এ `$HOME`
expand হয় না; তাই absolute path ব্যবহার করা হয়েছে।

Config লেখার আগে backup:

```bash
cp -p "$HOME/.opencode/opencode.json" \
  "$HOME/.opencode/opencode.json.bak-$(date +%Y%m%d-%H%M%S)"
chmod 600 "$HOME/.opencode/opencode.json"
```

Config-এ provider key থাকে; তাই `opencode.json` কখনো Git-এ commit বা chat-এ
print করবেন না।

---

## ৫. Verify

### ৫.১ Direct LSP initialize probe

Repo-তে probe script আছে:

```bash
cd ZombieCoder-Plugin
npm run lsp:probe -- --root "$PWD"
```

Expected: exit `0`, `ok: true`, ৭টি server। Agent-দের জন্য কম্প্যাক্ট output:

```bash
npm run lsp:probe -- --compact --root "$PWD"
```

এই run-এ observed (compact mode, `2026-11-01T09:51Z`):

| Server | Initialize | Time |
|---|---:|---:|
| `typescript` | ok | 172 ms |
| `python` | ok | 246 ms |
| `bash` | ok | 392 ms |
| `json` | ok | 236 ms |
| `css` | ok | 301 ms |
| `html` | ok | 607 ms |
| `markdown` | ok | 365 ms |

Full mode capability list দেখায়; `--compact` শুধু ok/time/serverInfo দেয়। Script শুধু
`lsp` section পড়ে; provider key/config বাকি অংশ print করে না।

### ৫.২ Direct diagnostics probe

`npm run lsp:diagnostics -- --file <path>` configured server-কে সত্যিকারের
`textDocument/didOpen` পাঠায় এবং `textDocument/publishDiagnostics`-এর জন্য
অপেক্ষা করে। File on disk বদলায় না; শুধু in-memory text-এ `--inject` line
যোগ করতে পারে।

আজকের run:

```bash
npm run lsp:diagnostics -- --file src/zombie/lsp.ts \
  --inject 'const __lsp_probe__: number = "x";' \
  --expect "not assignable" --compact
```

Observed: `ok:true`, PID `74818`, `TS2322` at line 432, `matched:true`, exit `0`।
এটা `typescript-language-server 6.0.2` + TS 5.9.3 + configured path-এর real run;
কিন্তু server-টা probe নিজে spawn করেছে — OpenCode-এর managed client নয়।

### ৫.৩ OpenCode-managed edit — যা এখনো প্রমাণ হয়নি

Desktop renderer-এ code editor নেই (শুধু Settings → LSP), আর session catalog-এ
`lsp` tool নেই (85 tools, zero match)। তবু একটি real edit test চালানো হয়েছে:

1. `src/zombie/lsp.ts`-এ সাময়িক type error (`const __lsp_live_probe: number = "not-a-number";`) edit।
2. ৪ সেকেন্ড `ps` + SSE watch।
3. ফল: কোনো `typescript-language-server` child নেই, `lsp.updated` নেই,
   `publishDiagnostics` event নেই। Edit result-এও diagnostic আসেনি।
4. ফাইল সাথে সাথে revert; hash আগের `4ad4e476...`-এ ফিরেছে।

Label: `NOT_TESTED` (managed path), `NOT_APPLICABLE` (desktop editor UI)।
ভবিষ্যতে যদি desktop-এ editor আসে বা `lsp` tool session-এ register হয়, তখন
`npm run lsp:diagnostics` + real edit + child PID — তিনটে মিলিয়ে
`END_TO_END_TESTED` দেওয়া যাবে। তার আগে নয়।

### ৫.৪ Agent playbook — capability vs availability

| File | Configured server | Server-side capability (initialize) |
|---|---|---|
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | `typescript` | hover, definition, references, rename, diagnostics |
| `.py`, `.pyi` | `python` | hover, definition, references, diagnostics |
| `.sh`, `.bash`, `.zsh`, `.ksh` | `bash` | symbol, hover, references |
| `.json`, `.jsonc` | `json` | schema validation, hover, formatting |
| `.css`, `.scss`, `.less` | `css` | completion, hover, diagnostics |
| `.html`, `.htm` | `html` | completion, hover, linked editing |
| `.md`, `.mdx` | `markdown` | document symbol, links, rename |

এই table server capability, agent tool availability নয়। Session-এ `lsp` tool না
থাকলে agent hover/definition/diagnostics সরাসরি call করতে পারবে না;
`npm run lsp:diagnostics` শুধু manual evidence। Code claim-এর আগে
`npm run typecheck`, `npm test`, `node --check` ইত্যাদি চালাও; `syntax_check`
fallback, LSP client নয়।

---

## ৬. `syntax_check` কী

Plugin-এর `syntax_check` tool একটা **LSP-shaped syntax fallback**, LSP server নয়।
এটা `node --check`, `tsc`, `python -m py_compile`, `bash -n`, `php -l` ডাকে।
Editor-এর hover, go-to-definition, completion, rename, live diagnostics এর কাজ
নয়। LSP configured থাকলেও CI/agent claim-এর জন্য typecheck/lint/test চালাতেই
হবে:

```bash
npm run typecheck
npm test
node --check file.mjs
python3 -m py_compile file.py
bash -n script.sh
php -l file.php
```

---

## ৭. Token — LSP-এর সাথে সম্পর্ক নেই

`Plain Text.txt`-এ থাকা bearer token দিয়ে live probe:

| Probe | HTTP | ফল |
|---|---:|---|
| `GET /v1/models` (token ছাড়া) | `401` | `Invalid API key` |
| `GET /v1/models` (token সহ) | `200` | model list |
| `POST /v1/chat/completions` | `200` | content `TOKEN_OK` |

Token **কাজ করছে**। কিন্তু LSP model token ব্যবহার করে না — LSP server feature।
Token chat-এ শেয়ার হয়েছে; rotate করুন। কোথাও print/commit/screenshot করবেন না।
এই doc-এ token নেই।

---

## ৮. Cloudflare — request mixing probe

Endpoint Cloudflare-এর পিছনে:

| Header | Value |
|---|---|
| `server` | `cloudflare` |
| `cf-cache-status` | `DYNAMIC` |
| `cf-ray` | প্রতি request-এ আলাদা |
| `colo` | `DAC` |
| TLS | `TLSv1.3`, HTTP/2 |

| Test | Requests | ফল | লেবেল |
|---|---:|---|---|
| Non-streaming | ৪টি concurrent, আলাদা marker | ৪/৪ নিজের marker; কোনো swap নেই | `LIVE_PROBE_PASSED` |
| SSE streaming | ২টি concurrent, আলাদা marker | ২/২ নিজের marker; parse error `0` | `LIVE_PROBE_PASSED` |

এই probe-এ mixing **ধরা পড়েনি**। তবে সীমিত টেস্ট; gateway/Cloudflare config
বদলালে আবার probe করতে হবে। Production-এ unique request ID রাখা ভালো।

---

## ৯. সিদ্ধান্ত

1. OpenCode V2.2.3-এ LSP runtime **আছে**; “V2-তে LSP নেই” দাবি ভুল ছিল।
2. আগের সমস্যা: `lsp` config নেই + binary নেই + TS 7.0.2-এ `tsserver.js` নেই।
3. এখন ৭টি server configured (`typescript`, `python`, `bash`, `json`, `css`,
   `html`, `markdown`); direct initialize probe **7/7 pass** (`--compact`, exit `0`)।
4. Direct diagnostics probe real `TS2322` দেয় (`npm run lsp:diagnostics`, exit `0`)।
5. Managed entry-র binary path হারিয়ে গেলে `syncLspConfig` সেটা re-resolve করে;
   owner-এর নিজের (non-managed) entry ছোঁয় না।
6. Desktop editor UI **নেই** (`NOT_APPLICABLE`); OpenCode-managed edit test-এ
   কোনো child/event আসেনি (`NOT_TESTED`)। `lsp` tool session catalog-এ নেই।
   Editor diagnostics-এর দাবি করার আগে নতুন evidence লাগবে।
7. `syntax_check` fallback; LSP-এর বিকল্প নয়, supplement।
8. Token valid, কিন্তু exposed — rotate। Cloudflare probe limited, no mixing seen.

<!-- INTEGRITY:START -->
<div align="center">

### 🔐 ZombieCoder Integrity Seal

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  98204656dfbdacb87afb97174887cf4254c184159093c40c18dd9fe3df6dd692  ║
║  files 105 · bytes 988702 · base ae09518 · dirty                         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

[Full manifest](INTEGRITY.md) · Verify: `npm run integrity:check`

> SHA-256 over source, scripts, tests, skills, package metadata and license.
> Detects accidental or unauthorized changes. Not a legal identity signature.
> Base commit is the code tree before this seal commit. Generated: 2026-11-01T09:55:14.500Z

</div>
<!-- INTEGRITY:END -->
