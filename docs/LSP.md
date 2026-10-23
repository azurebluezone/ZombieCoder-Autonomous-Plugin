# LSP — OpenCode V2.1.1

> **সংক্ষেপে:** OpenCode **V2.1.1-এ LSP runtime আছে**। `No LSP servers configured`
> মানে upstream-এ LSP নেই — তা নয়; এর মানে `lsp` config বা language-server
> binary নেই। এখন **installer নিজেই** `<install>/lsp`-এ server toolchain নামায়
> এবং resolve হওয়া absolute path দিয়ে `opencode.json`-এর `lsp` block লেখে
> (`src/zombie/lspConfig.ts` → `syncLspConfig`); `--no-lsp` দিলে দুটোই skip হয়।
> এই setup-এ `typescript`, `python`, `bash`, `json` — ৪টি server configured,
> আর direct `initialize` probe **4/4 pass** (`npm run lsp:probe`, exit `0`)।
> Editor UI-তে diagnostics এখনো `NOT_TESTED`; desktop app restart করে একটা
> source file খুললে সেটা যাচাই করতে হবে।

---

## ১. প্রমাণ

| চেক | ফল | লেবেল |
|---|---|---|
| OpenCode version | `2.1.1` (`~/.config/ai.opencode.desktop/cli/2.1.1-x64/opencode-cli --version`) | `LIVE_PROBE_PASSED` |
| Runtime schema | `/opt/OpenCode/resources/app.asar`-এ `Config.LSP.Server` আছে | `SOURCE_VERIFIED` |
| LSP protocol | app bundle-এ `initialize`, `textDocument/publishDiagnostics`, `textDocument/hover`, `textDocument/definition`, `workspaceFolders` আছে | `SOURCE_VERIFIED` |
| Config | `~/.opencode/opencode.json`-এ `lsp` key; ৪টি server; mode `600` | `CONFIG_VALIDATED` |
| Config reload | log-এ `config.updated` at `2026-10-21T02:43:31Z` | `LIVE_PROBE_PASSED` |
| Binaries | `typescript-language-server 6.0.2`, `typescript 5.9.3`, `pyright 1.1.414`, `bash-language-server 5.8.1`, `vscode-langservers-extracted 4.10.0` | `SOURCE_VERIFIED` |
| Initialize probe | `typescript` 23 capabilities, `python` 16, `bash` 11, `json` 11; **4/4 ok** | `LIVE_PROBE_PASSED` |
| Editor UI | log-এ এখনো LSP child process নেই; restart/open file বাকি | `NOT_TESTED` |

Runtime প্রমাণের reproducible command:

```bash
ASAR=/opt/OpenCode/resources/app.asar
grep -aob 'Config.LSP.Server' "$ASAR"
grep -aob 'publishDiagnostics' "$ASAR"
grep -aob 'textDocument/hover' "$ASAR"
```

`grep` offset পাওয়া মানে bundle-এ string আছে; সাথে `Config.LSP.Server` schema-তে
`command`, `extensions`, `disabled`, `env`, `initialization` field আছে। এটাই
দেখায় V2.1.1-এ LSP client/runtime বর্তমান।

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
cd ZombieCoder-Autonomous-Plugin
npm run lsp:probe -- --root "/home/xubuntu/Documents/Default Project"
```

Expected: exit `0`, `ok: true`, ৪টি server। এই run-এ observed:

| Server | Initialize | Capabilities | Time |
|---|---:|---:|---:|
| `typescript` | ok | 23 | 162 ms |
| `python` | ok | 16 | 252 ms |
| `bash` | ok | 11 | 439 ms |
| `json` | ok | 11 | 243 ms |

Script শুধু `lsp` section পড়ে; provider key/config বাকি অংশ print করে না।

### ৫.২ Editor UI

Direct probe মানে server + command ঠিক। OpenCode-এর নিজের editor client যে
diagnostics দিচ্ছে, সেটা এর চেয়ে আলাদা স্তর। এই log-এ config reload হয়েছে, কিন্তু
LSP child process এখনো দেখা যায়নি:

```bash
grep -E 'config.updated|lsp.updated' \
  "$HOME/.local/share/opencode/log/opencode.log" | tail -20
ps -eo pid,args | grep -E \
  '[t]ypescript-language-server|[p]yright-langserver|[b]ash-language-server|[v]scode-json-language-server'
```

Editor UI যাচাইয়ের ধাপ:

1. OpenCode desktop পুরো বন্ধ করুন।
2. আবার খুলুন, `Default Project` workspace খুলুন।
3. একটি `.ts` file খুলুন, hover/definition/diagnostics দেখুন।
4. উপরের `ps` command-এ LSP process দেখা উচিত।
5. তারপর `END_TO_END_TESTED` label দিন। তার আগে `NOT_TESTED`।

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

Token **কাজ করছে**। কিন্তু LSP model token ব্যবহার করে না — LSP editor feature।
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

1. OpenCode V2.1.1-এ LSP runtime **আছে**; “V2-তে LSP নেই” দাবি ভুল ছিল।
2. আগের সমস্যা: `lsp` config নেই + binary নেই + TS 7.0.2-এ `tsserver.js` নেই।
3. এখন ৪টি server configured; direct initialize probe **4/4 pass**।
4. Desktop editor UI `NOT_TESTED` — restart + file open করে যাচাই করতে হবে।
5. `syntax_check` fallback; LSP-এর বিকল্প নয়, supplement।
6. Token valid, কিন্তু exposed — rotate। Cloudflare probe limited, no mixing seen.

<!-- INTEGRITY:START -->
<div align="center">

### 🔐 ZombieCoder Integrity Seal

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  4753aab58d3a40160bd494e432eef8c79ed7a09f74e1b0ed461bb3738fb0454c  ║
║  files 59 · bytes 611438 · base 8132cf1 · clean                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

[Full manifest](INTEGRITY.md) · Verify: `npm run integrity:check`

> SHA-256 over source, scripts, tests, skills, package metadata and license.
> Detects accidental or unauthorized changes. Not a legal identity signature.
> Base commit is the code tree before this seal commit. Generated: 2026-10-23T22:55:34.999Z

</div>
<!-- INTEGRITY:END -->
