# ZombieCoder Autonomous Plugin

**OpenCode-এর জন্য local-first এজেন্ট প্যাক**

**Owner:** Sahon Srabon (Developer Zone), Dhaka, Bangladesh<br>
**License:** Local Freedom, Non-Commercial (see §18)

[![OpenCode](https://img.shields.io/badge/OpenCode-2.0.32%2B-111111)](https://opencode.ai)
[![Node](https://img.shields.io/badge/Node-22.6%2B-339933)](https://nodejs.org)

---

## ১. পরিচিতি

ZombieCoder একটি স্বয়ংসম্পূর্ণ OpenCode এজেন্ট প্যাক। এটি একবার ইনস্টল করে
একাধিক প্রজেক্টে ব্যবহার করা যায়। প্রতিটি প্রজেক্টে এটি শুধু প্রয়োজনীয়
runtime state তৈরি করে; প্রজেক্টের ভিতরে আলাদা `.opencode` install তৈরি করে না।

প্রধান বৈশিষ্ট্য:

- ৯টি এজেন্ট, প্রত্যেকটি `mode: all`; কোনো এজেন্ট subagent নয়।
- OpenCode-এর agent dropdown থেকে প্রত্যেক এজেন্ট সরাসরি নির্বাচন করা যায়।
- OpenAI-compatible provider-এর `/v1/models` থেকে মডেল তালিকা নেওয়া হয়।
- Provider unavailable হলে OpenCode-এর free model এবং সর্বশেষে baseline model-এ
  fallback হয়।
- প্রতিটি প্রজেক্টের জন্য `.zombiecoder/SSOT.md`, `syllabus.md`, memory ও
  audit state তৈরি হয়।
- MCP server শুধু probe সফল হলে register হয়।
- Origin handshake (URL-only): trusted origin থেকে শুধু base URL sync করা যায়;
  API key, cookie বা browser session transfer হয় না।
- API key, provider URL, provider ID, model strategy ও baseline model
  configuration/environment/flags দিয়ে পরিবর্তন করা যায়।

> এই ডকুমেন্ট GitHub Markdown-এর জন্য লেখা। বাংলা অংশে standard Unicode
> Bengali ব্যবহৃত হয়েছে; code, command, path, API নাম ও identifier ইংরেজিতে
> রাখা হয়েছে।

### ১.১ একটি ছোট্ট গল্প — বরিশালের চায়ের দোকান

বরিশালের এক চায়ের দোকানে একজন নতুন শিক্ষানবিশ এসেছে। দোকানদার তাকে প্রথম দিনই
সব কাজ একসাথে দেয়নি। দিয়েছে তিনটি জিনিস: একটি **খাতা** যেখানে দোকানের সব
সত্যি লেখা (কোন চায়ে কী, দাম কত, কোনটা শেষ), একটি **ডায়েরি** যেখানে প্রতিদিনের
শেখা জমা হয়, আর একটি **ট্রে** যেখানে শুধু আজকের কাজের কাগজপত্র থাকে।

শিক্ষানবিশ যখনই কিছু বলতে চায়, দোকানদার জিজ্ঞেস করে: "কাগজে দেখেছ? না দেখে
বললে ওটা অনুমান।" তাই সে আগে খাতা খোলে, তারপর ট্রে-র দরকারি কাগজ পড়ে, তারপর
একটা কাজ করে, শেষে ডায়েরিতে শেখাটা লিখে রাখে। ভুল হলে দোকানদার রাগ করে না;
বলে, "ভুলটা দেখাও, তারপর ঠিক করো।"

দোকানে দুজন কর্মী: একজন বড়, একজন ছোট। ছোটজন সবকিছু জানে না, তাই তার হাতের
পাশে **রেসিপি কার্ড** রাখা হয় — Laravel, Node, Next, Python, FastAPI, cPanel,
server, resource optimization, first-principles আর evidence-before-confidence।
ছোটজন কার্ড দেখে ধাপে ধাপে কাজ করে; বড়জন দ্রুত কাজ করে। কেউ অবহেলিত নয়, কারণ
প্রত্যেকের কাজের শেষে একই প্রশ্ন: "প্রমাণ কোথায়?"

ZombieCoder ঠিক এই দোকানের মতো। `SSOT.md` হলো খাতা, `syllabus.md` হলো ডায়েরি,
compact context pack হলো ট্রে, `response_gate` হলো সেই দোকানদার যে প্রমাণ ছাড়া
"হয়ে গেছে" বলতে দেয় না, আর `docs/skills` হলো রেসিপি কার্ড। ছোট মডেল ধীরে
চলতে পারে, কিন্তু স্কিল আর টুল তাকে ছোট ছোট ধাপে কাজ করতে সাহায্য করে। বড়
মডেল দ্রুত চলতে পারে, কিন্তু প্রমাণ ছাড়া সে-ও "পাস" বলতে পারে না।

---

## ২. আর্কিটেকচার

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Install root                                                         │
│                                                                      │
│  opencode.json       provider, models, agents, permissions, MCP      │
│  agents/*.md          ৯টি agent persona                              │
│  plugins/             ZombieCoder runtime                            │
│  zombiecoder/         config.json, models.json, mcp.json             │
│  node_modules/        runtime dependencies                           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                │ OpenCode global loader
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ OpenCode                                                             │
│  ├── ৯টি primary agent                                               │
│  ├── zombiecoder.* tools                                             │
│  └── প্রতি প্রজেক্টে plugin setup                                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  project-a/.zombiecoder  project-b/.zombiecoder  project-c/.zombiecoder
  ├── SSOT.md              ├── SSOT.md              ├── SSOT.md
  ├── syllabus.md          ├── syllabus.md          ├── syllabus.md
  ├── memory/              ├── memory/              ├── memory/
  ├── .state/              ├── .state/              ├── .state/
  └── skills/ (core+detected) └── skills/ (core+detected) └── skills/ (core+detected)
```

### ২.১ দুই স্তরের state

| স্তর | অবস্থান | উদ্দেশ্য |
|---|---|---|
| Install state | `~/.opencode` অথবা `~/.config/opencode` | Provider, agent, plugin, model plan |
| Project state | `<project>/.zombiecoder` | SSOT, syllabus, memory, audit |

Install state একবার তৈরি হয়। Project state প্রথমবার প্রজেক্ট খোলার সময়
plugin নিজে তৈরি করে।

### ২.২ Model routing

1. Provider-এর নিজের base URL-এ `GET /v1/models` probe করা হয়।
2. Probe সফল হলে `/v1/models`-এর **live** model IDs দিয়েই provider config
   তৈরি হয়; আগের install-এর stale model (যেমন retired `Qwen` entry) বাদ পড়ে।
3. শুধু model list থাকলেই provider ব্যবহারযোগ্য ধরা হয় না। installer
   `/v1/chat/completions`-এ একটি ছোট chat probe এবং (ডিফল্ট) একটি tool-call
   probe চালায়।
4. Chat fail, tool fail, অথবা prompt processing খুব ধীর (<20 tok/s) হলে
   provider config-এ থাকলেও agent-রা baseline free model
   (`opencode/big-pickle`) পায়। `--allow-slow` দিয়ে slow model জোর করে রাখা যায়।
5. Provider একেবারে unreachable হলে OpenCode-এর free model fallback হয়;
   `modelStrategy: "baseline"` এই fallback-কে স্থায়ী করে।
6. Global install-এ provider live হলে বা configured provider outage হলে runtime
   plan global agent assignment update করতে পারে।
7. প্রজেক্ট নিজে provider disable করলে (`customProviderUrl: ""`) global
   assignment downgrade হয় না।

### ২.৩ 100C runtime template

Runtime template-এর scanner, model mapper, TLS verifier ও evidence gate এখন
রিপোজিটরিতে আছে:

- `model.mjs` — runtime model probe, deterministic agent mapping ও free fallback
- `tools/hulia_100c.py` — read-only file/client/network scan
- `tools/tls_verify.py` — OpenSSL TLS verification ও optional `nginx -t`
- `tools/evidence_gate.py` — প্রমাণ ছাড়া response `PASS` করে না; `--kind claim`
  দিয়ে `claim` + verified `evidence[]` ছাড়া factual claim-ও `FAIL` করে
- `tools/render_nginx.py` + `tls/nginx.conf.template` — reusable Nginx TLS template
- `doc/*.js` — runtime-readable identity, ethics ও runtime operations

Plugin-এ `evidence_gate` tool wired আছে। এটি installed Python gate-কে call করে;
`FAIL`/`SKIP` হলে agent-কে দাবি `UNVERIFIED` বলে থামতে হবে। Gate structure ও
evidence presence যাচাই করে, বাস্তব সত্য নিজে প্রমাণ করে না।

### Context pack, UI status ও hard response gate

- **Compact context pack** — প্রতিটি model call-এ provider পুরো repo বা পুরো
  history পায় না। Plugin `SSOT.md` + `syllabus.md` + recent memory মিলিয়ে একটি
  bounded pack inject করে (`src/zombie/context.ts`)।
- **`context_status` tool** — agent substantive কাজ শুরুর আগে এই tool call করে
  UI-তে এক লাইন দেখায়: `Context: SSOT OK | Syllabus OK | Memory N recent / M archives | Pack NB`।
  তাই SSOT, syllabus ও memory manage হচ্ছে কিনা user সরাসরি দেখতে পায়।
- **Hard response gate** — `http.response` hook primary answer যাচাই করে।
  `path:line`, test output বা exit code ছাড়া completed/successful claim পেলে
  উত্তর `UNVERIFIED` message দিয়ে replace করা হয় (`src/zombie/responseGate.ts`)।
  message-এ কী সমস্যা, এজেন্ট থামানো হয়েছে, আর user এখন কী করতে পারেন
  (প্রমাণ দিন / ব্যাখ্যা চান / নতুন নির্দেশ) স্পষ্ট থাকে। replacement terminal
  (`finish_reason: stop`)। শুধু **final answer** গেট হয়: যে turn-এ model
  tool/function call দেয় সেটি intermediate ধরে হুবহু pass through করা হয়, নইলে
  gate `finish_reason` কে `stop` করে tool chain মাঝপথে ভেঙে দিত। প্রমাণও
  structural: `path:line`-এর file ও line দুটোই থাকতে হয় (line count ছাড়িয়ে গেলে
  গ্রহণ নয়), টেস্ট output-এ count থাকতে হয় (`78/78 pass`, `tests 81`,
  `exit code 0`); একা `line 177`, `5/10` বা path-মাত্র (`src/plugin.ts`) প্রমাণ নয়।
  এজেন্ট নিজে থেকে প্রমাণ ছাড়া এগোয় না। Gate structural; সে factual truth
  প্রমাণ করে না, আর unsupported provider protocol `NOT_TESTED` হিসেবে audit-এ
  থাকে। Disable করতে config-এ `"responseGate": false` দিন।
- **Circuit breaker** — গেট আটকালে উত্তরটি শুধু replace হয়ে থেমে যায় না:
  failure-এর কারণ ও context (`agent/breaker/<sessionID>`) storage-এ লেখা হয়, user
  UI-তে synthetic status message যায়, session পরের roster agent-এ switch হয় এবং
  একটি queued prompt দিয়ে একই কাজ প্রমাণসহ আবার শুরু হয় (`src/zombie/circuitBreaker.ts`)।
  এভাবে সর্বোচ্চ ৩টি agent চেষ্টা করে; ৩টি ব্যর্থ হলে breaker খুলে user-কে স্পষ্ট
  unresolved message দেয় — কী কী চেষ্টা হয়েছে, শেষ কারণ কী, আর এখন কী করা যায়
  (প্রমাণ দিন / কাজ ছোট করুন / নতুন নির্দেশ / gate বন্ধ করে diagnosis)।
- **Evidence path policy** — agent যেকোনো ফাইল পড়তে পারে, তাই gate path-কে
  sandbox করে না; শুধু যাচাই করে cited ফাইলটি সত্যিই আছে কি না। resolution order:
  working directory → OpenCode config/data root (`$XDG_CONFIG_HOME/opencode`,
  `~/.opencode`, `$XDG_DATA_HOME/opencode`) → absolute/`~` path। `../`, absolute
  বা global config path — সবই বৈধ প্রমাণ, যদি ফাইল ও লাইনটি সত্যিই থাকে।
  Extension ছাড়া absolute file-ও চলে, তবে তখন `:line` লাগবে (`/etc/hostname:1`)।
- **Skill map** — প্রতিটি agent-এর 15–20 first-principles skill:
  [`docs/skill-map.md`](docs/skill-map.md)।

বিস্তারিত: [`docs/100c-runtime-template.md`](docs/100c-runtime-template.md)

---

## ৩. প্রয়োজনীয়তা

| উপাদান | ন্যূনতম |
|---|---|
| Node.js | 22.6 বা তার বেশি |
| npm | Node-এর সাথে bundled |
| Git | যেকোনো সাম্প্রতিক version |
| OpenCode | 2.0.32 বা তার বেশি |
| Python 3 | `evidence_gate` ও `syntax_check` helper-এর জন্য (core chat এর জন্য নয়) |
| Internet | Provider/MCP probe-এর সময়; না থাকলে free fallback |

Node version যাচাই:

```bash
node --version
npm --version
```

---

## ৪. সরাসরি ক্লোন ও ইনস্টল

### ৪.০ এক-ক্লিক রিমোট ইনস্টল / আপডেট (কোনো clone নেই)

নতুন computer-এ শুধু একটি command — source tarball নিজেই নামবে, integrity
manifest যাচাই হবে, তারপর install হবে:

```bash
curl -fsSL https://raw.githubusercontent.com/azurebluezone/ZombieCoder-Autonomous-Plugin/murubbi/install.sh | bash
```

আবার একই command চালালে **update** হয়: `opencode.json`-এর অজানা key, provider
config ও user data merge হয়, মুছে যায় না; already-satisfied dependency আবার
ডাউনলোড হয় না (`--force-install` দিলে হবে)।

| Environment variable | ডিফল্ট | কাজ |
|---|---|---|
| `ZOMBIECODER_DIR` | `~/.opencode` | install root |
| `ZOMBIECODER_REPO` | `azurebluezone/ZombieCoder-Autonomous-Plugin` | GitHub repo |
| `ZOMBIECODER_REF` | `murubbi` | branch/tag |
| `ZOMBIECODER_TARBALL` | — | offline/local tarball (download skip) |

উদাহরণ: LSP ছাড়া (≈180 MB কম জায়গা):

```bash
curl -fsSL .../install.sh | bash -s -- --no-lsp
```

Installer প্রথমে জায়গা যাচাই করে: base ≈32 MB + deps ≈180 MB + LSP ≈180 MB
(+10% headroom)। জায়গা কম হলে শুধু পুনরায় ডাউনলোডযোগ্য `~/.npm` cache
পরিষ্কার করে; তারপরও কম হলে **কিছুই লেখার আগে** exit code `3` দিয়ে থামে এবং
`--no-lsp`, `--no-install`, `--config-dir` বিকল্প দেখায়। `--no-space-check`
দিয়ে check বন্ধ করা যায়, আর `--keep-cache` দিয়ে cache পরিষ্কার বন্ধ।

উপরের bootstrap-টি `install.sh`; একই installer সরাসরি চালাতে চাইলে:

```bash
node --experimental-strip-types bin/install.mjs --config-dir "$HOME/.opencode" --yes
```

### ৪.০.১ নতুনদের জন্য এক-কমান্ড ইনস্টল (clone করা repo থেকে)

কোডিং না জানলেও চলবে। শুধু terminal-এ তিনটি লাইন:

```bash
git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git
cd ZombieCoder-Autonomous-Plugin
node bin/quick-install.mjs
```

তারপর স্ক্রিনে যে menu আসবে, সেখানে একটি সংখ্যা চাপুন:

```text
1) এই computer-এ একবার install/update (recommended)
2) Fast start — free baseline model (local GPU লাগবে না)
3) শুধু এই folder-এর project-এ install
4) শুধু verify (কিছু বদলাবে না)
5) বন্ধ
```

- **1** — `~/.opencode`-এ একবার install; সব project-এ কাজ করবে।
- **2** — local provider probe না করে `opencode/big-pickle` baseline দিয়ে
  দ্রুত শুরু; ছোট/ধীর CPU model-এ আটকে থাকবে না।
- **3** — `cd` করা folder-এর `.opencode`-এ project-local install।
- **4** — শুধু SSOT/syllabus/agent/config state যাচাই করে; কিছু লেখে না।
  `--dir <project>` দিয়ে নির্দিষ্ট project বেছে নেওয়া যায়।

Automation-এর জন্য: `node bin/quick-install.mjs --yes` (option 1) অথবা
`node bin/quick-install.mjs --choice=2`।

Install শেষে কোনো project folder-এ verify করতে:

```bash
node bin/quick-install.mjs --choice=4 --dir "/path/to/your-project"
```

### ৪.১ Linux / macOS

```bash
# ১. রিপোজিটরি ক্লোন
git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git
cd ZombieCoder-Autonomous-Plugin

# ২. dependency ইনস্টল
npm ci

# ৩. validation
npm run typecheck
npm test

# ৪. self-contained install
npm run install-pack -- --config-dir "$HOME/.opencode" --yes
```

### ৪.২ Windows PowerShell

```powershell
# ১. রিপোজিটরি ক্লোন
git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git
cd ZombieCoder-Autonomous-Plugin

# ২. dependency ইনস্টল
npm.cmd ci

# ৩. validation
npm.cmd run typecheck
npm.cmd test

# ৪. self-contained install
npm.cmd run install-pack -- --config-dir "$env:USERPROFILE\.opencode" --yes
```

> PowerShell-এ `npm.ps1` blocked হলে `npm.cmd` ব্যবহার করুন।
>
> Windows-এও `node bin\quick-install.mjs` চালালে একই numbered menu আসবে;
> `1` চাপলে self-contained `%USERPROFILE%\.opencode` install হবে।

### ৪.৩ Standard global install (বিকল্প)

Linux/macOS-এ `~/.config/opencode` এবং Windows-এ `%USERPROFILE%\.config\opencode`-এ
ইনস্টল করতে চাইলে:

```bash
npm run install-pack -- --yes
```

Windows PowerShell:

```powershell
npm.cmd run install-pack -- --yes
```

Self-contained `.opencode` install ব্যবহার করলে OpenCode-এর global loader-এর
জন্য pointer প্রয়োজন। `--config-dir "$HOME/.opencode"` installer এখন এই ছয়টি
entry নিজেই link করে: Linux/macOS-এ symlink, Windows-এ junction (admin/Developer
Mode ছাড়াই), আর সেটাও না পারলে copy করে দেয় যাতে install আটকে না যায়। Copy হলে
পরের update-এর পর installer আবার চালাতে হবে। নিচের manual command শুধু repair-এর জন্য।

Linux:

```bash
mkdir -p "$HOME/.config/opencode"
for item in opencode.json agents plugins zombiecoder node_modules package.json; do
  ln -sfn "$HOME/.opencode/$item" "$HOME/.config/opencode/$item"
done
```

Windows PowerShell (repair; junction-এর জন্য admin লাগে না):

```powershell
$source = "$env:USERPROFILE\.opencode"
$target = "$env:USERPROFILE\.config\opencode"
New-Item -ItemType Directory -Force $target | Out-Null
foreach ($item in @("opencode.json","agents","plugins","zombiecoder","node_modules","package.json")) {
  New-Item -ItemType Junction -Force `
    -Path (Join-Path $target $item) `
    -Target (Join-Path $source $item) | Out-Null
}
```

> Symlink না দিলে `.opencode` config শুধু home directory-এর অধীনস্থ প্রজেক্টে
> পাওয়া যাবে। Standard global install ব্যবহার করলে symlink প্রয়োজন নেই।

### ৪.৩.১ ইনস্টল-সমস্যার সহজ সমাধান

| সমস্যা | কারণ | সমাধান |
|---|---|---|
| `EACCES` / `permission denied` | আগে `sudo` দিয়ে ইনস্টল হয়েছে, ফাইল root-owned | `sudo chown -R "$USER" "$HOME/.opencode" "$HOME/.config/opencode"` — তারপর installer normal user হিসেবে চালান। `sudo` দিয়ে installer চালাবেন না (container ছাড়া)। |
| `Node.js ... too old` | Node < 22.6 | [nodejs.org](https://nodejs.org) থেকে LTS ইনস্টল করুন, `node --version` দিয়ে যাচাই করুন। |
| Windows-এ symlink error | symlink privilege নেই | নতুন installer junction/copy fallback ব্যবহার করে; Developer Mode বাধ্যতামূলক নয়। Copy হলে update-এর পর installer আবার চালান। |
| `python3: not found` | Python 3 নেই | Python 3 ইনস্টল করুন (`evidence_gate`, `syntax_check` helper ব্যবহার করবে)। |
| `npm: not found` | Node-এর bundled npm PATH-এ নেই | Node LTS ইনস্টল/repair করুন, নতুন terminal খুলুন। |
| `space` / exit code `3` | live USB-এ জায়গা কম | `--no-lsp` (≈180 MB বাঁচে), `--config-dir` দিয়ে বেশি জায়গার path, অথবা npm cache পরিষ্কার হতে দিন (`--keep-cache` দিলে হবে না)। installer কিছু লেখার আগেই থামে। |

Installer প্রতিটি step-এর শেষে `OK`/`FAIL` লাইন দেখায় এবং `installed: N/M steps ok`
প্রিন্ট করে; কোনো FAIL থাকলে exit code `1`।

### ৪.৪ ইনস্টলের পর কী হবে

Installer নিচের কাজগুলো ধাপে ধাপে সম্পন্ন করে:

1. Install root তৈরি করে।
2. Plugin runtime graph copy করে (files `0644`, dirs `0755`; checked-out mode যাই হোক)।
3. `zombiecoder/{docs,tools,tls,model.mjs,skills-catalog}` runtime asset copy করে।
5. জায়গা যাচাই করে (base+deps+LSP अनुमान, ১০% headroom); কম হলে শুধু
   পুনরায় ডাউনলোডযোগ্য npm cache পরিষ্কার করে, তারপরও কম হলে কিছু না লিখে
   exit `3`। (`--no-space-check`, `--keep-cache`, `--force-low-space` আছে।)
6. `npm install` চালায়; dependency আগে থেকেই satisfy থাকলে skip করে
   (`--force-install` দিলে আবার চালায়)। `--no-install` দিলে পুরো step skip।
6. `<install>/lsp`-এ LSP server toolchain install করে (`typescript-language-server`,
   `pyright`, `bash-language-server`, `vscode-langservers-extracted`); `--no-lsp`
   দিলে skip করে।
7. `zombiecoder/config.json` seed বা update করে।
8. MCP URL থাকলে probe করে।
9. Provider-এর `/v1/models` probe করে, তারপর `/v1/chat/completions`-এ chat ও
   tool-call probe চালায়। Chat/tool fail বা prompt throughput `<20 tok/s` হলে
   provider config-এ থাকলেও baseline free model নির্বাচন করে।
10. `opencode.json`-এ provider, models, agents, permissions ও MCP merge করে।
11. Resolve হওয়া LSP binary থেকে `opencode.json`-এর `lsp` block স্বয়ংক্রিয়ভাবে
    লেখে (`syncLspConfig`); আগের entry অক্ষত থাকে।
12. ৯টি agent markdown লেখে এবং পুরনো legacy agent prune করে।
13. Project-local legacy install-এ `.zombiecoder` seed করে।
14. `--config-dir ~/.opencode` হলে `~/.config/opencode`-এর ছয়টি entry-কে
    একটি self-contained root-এ link করে (symlink; Windows-এ junction, না পারলে
    copy); পুরনো regular file/directory `~/.config/opencode/.backups/`-এ সরিয়ে রাখে।
15. শেষে `scripts/audit-install.mjs` দিয়ে নিজের কাজ যাচাই করে (agents, LSP,
    MCP, entrypoint, permissions); audit fail হলে install FAIL ও exit code `1`।

Install শেষ হলে কোথায় কী থাকবে:

| Path | বিষয়বস্তু |
|---|---|
| `~/.opencode/opencode.json` | Provider, model, agent, permission ও LSP config (mode `600`) |
| `~/.opencode/agents/*.md` | ৯টি agent persona |
| `~/.opencode/plugins/zombiecoder.ts` | Plugin entrypoint |
| `~/.opencode/lsp/` | ৭টি language-server binary |
| `~/.opencode/zombiecoder/config.json` | Runtime configuration |
| `~/.opencode/zombiecoder/models.json` | Model plan, chat/tool probe ও slow evidence |
| `~/.opencode/zombiecoder/tools/` | `evidence_gate.py`, TLS/origin/scanner tools |
| `~/.opencode/zombiecoder/docs/` | Runtime template ও identity/ethics JS |
| `~/.opencode/zombiecoder/skills-catalog/` | ২০টি runtime skill-এর offline cache |
| `~/.opencode/zombiecoder/skills/` | Shared skill store — সব working directory একই copy ব্যবহার করে |
| `~/.opencode/zombiecoder/tls/` | Nginx TLS template |
| `~/.opencode/zombiecoder/model.mjs` | Model probe ও deterministic mapping |
| `~/.opencode/node_modules/` | Runtime dependencies |
| `<project>/.zombiecoder/SSOT.md` | Project scan ও agent team |
| `<project>/.zombiecoder/syllabus.md` | Project footprint ও lessons |
| `<project>/.zombiecoder/memory/` | Conversation context ও archive index |
| `<project>/.zombiecoder/.state/` | Setup report ও audit log |

> Project-এ `skills/`, `config.json`, `models.json`, `fingerprint.json`,
> `footprint.jsonl` বা `mcp.json` তৈরি হয় না।

---

## ৫. প্রথমবার চালু ও যাচাই

### ৫.১ OpenCode চালু করা

OpenCode খুলে যেকোনো প্রজেক্ট select করুন। প্রথমবার plugin setup চালাবে এবং
প্রজেক্টে `.zombiecoder` তৈরি করবে।

Agent dropdown থেকে `zombiecoder` অথবা অন্য যেকোনো agent নির্বাচন করা যাবে।
সব agent primary; কোনো agent subagent হিসেবে configure করা নেই।

### ৫.২ Configuration যাচাই

OpenCode CLI available থাকলে:

```bash
opencode debug config
opencode debug agents
opencode plugin list
opencode models
```

প্রত্যাশিত ফলাফল:

- `debug config` install root-এর `opencode.json` দেখাবে।
- `debug agents`-এ ৯টি roster agent থাকবে, প্রত্যেকের `mode: all`।
- `plugin list`-এ `zombiecoder` local plugin দেখাবে।
- `models`-এ provider model এবং প্রয়োজন হলে `opencode/big-pickle` থাকবে।

> Windows-এ OpenCode CLI PATH-এ না থাকলে OpenCode Desktop ব্যবহার করুন।
> CLI command চালাতে হলে OpenCode-এর full executable path ব্যবহার করুন।

### ৫.৩ প্রথম inference test

```bash
opencode run --agent zombiecoder \
  --model "<provider-id>/<model-id>" \
  "Reply with exactly: OK"
```

Windows PowerShell:

```powershell
opencode run --agent zombiecoder `
  --model "<provider-id>/<model-id>" `
  "Reply with exactly: OK"
```

Provider ও model ID `opencode models` output থেকে নিন।

### ৫.৪ Setup report

কোনো step ব্যর্থ হলে দেখুন:

```bash
cat <project>/.zombiecoder/.state/setup-report.json
cat <project>/.zombiecoder/.state/audit.jsonl
```

Windows PowerShell:

```powershell
Get-Content <project>\.zombiecoder\.state\setup-report.json
Get-Content <project>\.zombiecoder\.state\audit.jsonl
```

---

## ৬. OpenAI-compatible URL পরিবর্তন

### ৬.১ Recommended: installer আবার চালানো

বর্তমান install root `.opencode` হলে Linux:

```bash
export ZOMBIECODER_PROVIDER_URL="https://new-provider.example/v1"
export ZOMBIECODER_PROVIDER_KEY="new-api-key"
export ZOMBIECODER_PROVIDER_ID="my-gateway"

npm run install-pack -- --config-dir "$HOME/.opencode" --yes
```

Windows PowerShell:

```powershell
$env:ZOMBIECODER_PROVIDER_URL = "https://new-provider.example/v1"
$env:ZOMBIECODER_PROVIDER_KEY = "new-api-key"
$env:ZOMBIECODER_PROVIDER_ID = "my-gateway"

npm.cmd run install-pack -- --config-dir "$env:USERPROFILE\.opencode" --yes

Remove-Item Env:ZOMBIECODER_PROVIDER_KEY
```

নিয়ম:

- URL অবশ্যই OpenAI-compatible base URL হতে হবে, সাধারণত `/v1` পর্যন্ত।
- নতুন key না দিলে installer আগের saved key ব্যবহার করে।
- Provider ID না দিলে আগের provider ID ব্যবহার হয়।
- URL পরিবর্তন করলে installer নতুন provider model plan তৈরি করে।
- `/v1/models` খালি হলে custom model assign হয় না; free fallback active থাকে।

### ৬.২ Manual configuration (advanced)

Installer না চালিয়ে দুই ফাইল একসাথে update করতে হবে:

1. `~/.opencode/zombiecoder/config.json`
2. `~/.opencode/opencode.json`

`config.json`-এ:

```json
{
  "customProviderUrl": "https://new-provider.example/v1",
  "customProviderID": "my-gateway",
  "customProviderApiKey": "<api-key>",
  "modelStrategy": "auto"
}
```

`opencode.json`-এ provider entry-এর `settings.baseURL`, `settings.apiKey` এবং
প্রয়োজনীয় `models` update করতে হবে। এরপর:

```bash
opencode reload
opencode models
```

> শুধু `config.json` edit করলে `opencode.json`-এর provider base URL নিজে থেকে
> বদলায় না। তাই installer ব্যবহার করা নিরাপদ।

### ৬.৩ Model strategy

`~/.opencode/zombiecoder/config.json`-এ:

| Value | আচরণ |
|---|---|
| `auto` | Custom provider → free model → baseline |
| `custom` | Custom provider; ব্যর্থ হলে baseline |
| `free` | শুধু OpenCode-এর cost `0/0` model |
| `baseline` | শুধু baseline model |
| `random` | Auto routing, কিন্তু agent mapping random |

Environment override:

```bash
export ZOMBIECODER_MODEL_STRATEGY="auto"
export ZOMBIECODER_BASELINE_MODEL="opencode/big-pickle"
```

Windows PowerShell:

```powershell
$env:ZOMBIECODER_MODEL_STRATEGY = "auto"
$env:ZOMBIECODER_BASELINE_MODEL = "opencode/big-pickle"
```

### ৬.৪ `.environment` থেকে provider ও MCP

Project-এর root-এ `.environment` ফাইল তৈরি/সম্পাদনা করুন:

```dotenv
EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL=https://your-gateway.example/v1
EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY=your-provider-api-key
EXTERNAL_MCP_URL=https://your-mcp.example/mcp
```

`EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY` হলো ওই OpenAI-compatible
provider-এর key—এটি MCP key নয়। `.environment` ফাইল shell script হিসেবে execute হয় না; কেবল `KEY=value` পড়া
হয়। Installer provider URL/key এবং MCP URL পড়ে; provider key
`opencode.json`-এ OpenCode ব্যবহার করার জন্য সংরক্ষণ করে। Secret-bearing
`.environment` এবং generated config commit করবেন না।

Plugin সক্রিয় project-এর `.environment`-এ provider URL/key পড়ে এবং
`EXTERNAL_MCP_URL`-এর MCP endpoint-এ read-only `initialize`/`tools/list` probe
করে। তবে project `.environment` থেকে MCP URL পড়া মানেই OpenCode-এর MCP
server auto-register হওয়া নয়: server-টি `opencode.json`-এ লিখতে installer
চালাতে হবে, যেমন `npm run install-pack -- --dir "$PWD" --yes` (provider/MCP
config OpenCode-এ project scope-এ রাখতে চাইলে)। `--dir` install target-এর
`.environment` installer পড়ে; global install-এ installer package root-এর
`.environment` পড়ে। Runtime সব সময় সক্রিয় project-এর `.environment` পড়ে।

Process environment-এ একই variable দিলে ফাইলের চেয়ে সেটি অগ্রাধিকার পায়।
Provider URL ফাঁকা/অনুপস্থিত হলে free-model strategy চলে। পরিবর্তনের পরে
OpenCode/plugin reload করুন। MCP endpoint-এর জন্য bearer/API authentication এই
probe path-এ এখনো সমর্থিত নয়; authenticated MCP server লাগলে installer probe
ও runtime probe দুটোই বর্তমানে fail করতে পারে।

### ৬.৫ Native tool calls

OpenCode tool execute করে רק যখন provider/model OpenAI-এর native
`tool_calls` return করে। Model text-এর ভিতরে JSON tool call দিলে OpenCode সেটি
execute করে না।

উদাহরণ—যা কাজ করে না:

```json
{"name": "glob", "arguments": {"pattern": "*"}}
```

Tool ব্যবহার করতে হলে gateway/model-এ native tool calling সক্রিয় থাকতে হবে।
llama.cpp-ভিত্তিক gateway-এ প্রযোজ্য হলে chat template/`--jinja` এবং
tool-capable model ব্যবহার করুন।

যাচাইয়ের নিয়ম: response-এ `choices[0].message.tool_calls` থাকতে হবে। শুধু
text-এর ভিতরে JSON থাকলে সেটি OpenCode execute করবে না—তখন model অথবা chat
template বদলাতে হবে, plugin-এ tool যোগ করলে সমস্যা মিটবে না।

### ৬.৬ Origin URL handshake (URL-only)

Cloud runtime-এ provider-এর public URL মাঝে মাঝে বদলাতে পারে, কিন্তু API key
একই থাকতে হবে। এই ক্ষেত্রে একটি trusted **origin URL** সেট করা যায়; plugin সেখান
থেকে শুধু base URL পড়ে এবং দরকার হলে provider URL update করে।

Origin URL সেট করার দুটি উপায়:

Linux/macOS:

```bash
export ZOMBIECODER_ORIGIN_URL="https://gpu.zombiecoder.my.id"
npm run install-pack -- --config-dir "$HOME/.opencode" --yes
```

Windows PowerShell:

```powershell
$env:ZOMBIECODER_ORIGIN_URL = "https://gpu.zombiecoder.my.id"
npm.cmd run install-pack -- --config-dir "$env:USERPROFILE\.opencode" --yes
```

অথবা `~/.opencode/zombiecoder/config.json`-এ একটি field যোগ করুন:

```json
{
  "originUrl": "https://gpu.zombiecoder.my.id"
}
```

Origin-কে `GET /gateway_url.json` public endpoint দিতে হবে। প্রত্যাশিত response:

```json
{
  "base_url": "https://gpu.zombiecoder.my.id/v1",
  "hostname": "gpu.zombiecoder.my.id",
  "auth_required": true
}
```

নিরাপত্তা ও আচরণ:

- Handshake request শুধু `GET`; কোনো `Authorization` header, cookie বা browser
  session path এতে যুক্ত হয় না।
- API key কখনো origin-এ পাঠানো হয় না এবং origin থেকে পড়া হয় না।
- শুধু `settings.baseURL` (এবং `customProviderUrl`) update হয়; model, permission
  বা API key অপরিবর্তিত থাকে।
- Origin unreachable হলে handshake step fail হিসেবে report হয়; plugin আগের
  configured URL দিয়েই কাজ চালিয়ে যায়।
- `originUrl` খালি থাকলে handshake সম্পূর্ণ বন্ধ থাকে। Global config-এ originUrl
  থাকলেও সাময়িকভাবে বন্ধ করতে `ZOMBIECODER_ORIGIN_URL=off` ব্যবহার করুন।

---

## ৭. MCP configuration

MCP URL installer flag অথবা environment দিয়ে দিন:

```bash
export ZOMBIECODER_MCP_URL="https://mcp.example.com/mcp"
npm run install-pack -- --config-dir "$HOME/.opencode" --yes
```

Windows PowerShell:

```powershell
$env:ZOMBIECODER_MCP_URL = "https://mcp.example.com/mcp"
npm.cmd run install-pack -- --config-dir "$env:USERPROFILE\.opencode" --yes
```

Installer শুধু probe-verified MCP server register করে। Probe fail করলে কোনো dead
URL `opencode.json`-এ লেখা হয় না। MCP state:

```text
~/.opencode/zombiecoder/mcp.json
```

---

## ৮. এজেন্ট পার্সোনা পরিবর্তন

### ৮.১ Source of truth

Agent-এর একমাত্র source:

```text
src/roster.ts
```

প্রত্যেক entry-তে থাকে:

- `id`, `name`, `callSign`
- `role`, `description`
- `mode` — `all` (প্রতিটি agent primary হিসেবে selectable, আবার parent চাইলে subagent-ও)
- `model` — installer/runtime resolve করে
- `mission`, `persona`, `duties`, `rule`

সব agent-এর shared rules (দুটো ব্লক — behaviour ও execution doctrine):

```text
SHARED_RULES + SHARED_EXECUTION
```

`SHARED_RULES` বা `SHARED_EXECUTION` পরিবর্তন করলে সব agent-এর prompt পরিবর্তিত হয়। `SHARED_EXECUTION`-এ আছে: কম planning, target-file focus, full-slice (create/edit/delete/view), no mock/watermark, shortcut/codegen, training-cutoff websearch আর বরিশাল টোন।

### ৮.২ Persona পরিবর্তনের ধাপ

1. `src/roster.ts` খুলুন।
2. নির্দিষ্ট agent-এর `mission`, `persona`, `duties` অথবা `rule` edit করুন।
3. `mode: "all"` রাখুন (roster-এর সব agent `all`; `primary` শুধু নির্বাচনযোগ্যতার জন্য, subagent হিসেবে ডাকা যাবে না)।
4. Validation চালান:

```bash
npm run typecheck
npm test
```

5. Documentation regenerate করুন:

```bash
npm run generate
```

6. Install root update করুন:

```bash
npm run install-pack -- --config-dir "$HOME/.opencode" --yes
```

7. OpenCode reload করুন:

```bash
opencode reload
```

Windows PowerShell-এ শেষ দুই ধাপ:

```powershell
npm.cmd run generate
npm.cmd run install-pack -- --config-dir "$env:USERPROFILE\.opencode" --yes
opencode reload
```

### ৮.৩ শুধু installed copy edit (temporary)

দ্রুত পরীক্ষার জন্য:

```text
~/.opencode/agents/<agent-id>.md
~/.opencode/opencode.json → agents.<agent-id>.system
```

এরপর `opencode reload` করুন। সতর্কতা: পরবর্তী installer run
`src/roster.ts` থেকে generated agent markdown ও config আবার লিখে দেবে।

### ৮.৪ নতুন agent যোগ করা

1. `src/roster.ts`-এর `ROSTER`-এ নতুন unique `id` দিয়ে entry যোগ করুন।
2. `mode: "all"` দিন।
3. `npm run typecheck && npm test` চালান।
4. `npm run generate` চালান।
5. Installer আবার চালান।

Installer নতুন agent-এর markdown ও `opencode.json` entry তৈরি করবে।

### ৮.৫ Agent removal

কোনো agent বাদ দিতে:

1. `ROSTER` থেকে entry সরান।
2. প্রযোজ্য হলে `LEGACY_AGENT_IDS`-এ সেই `id` যোগ করুন।
3. Installer আবার চালান।

`LEGACY_AGENT_IDS`-এ না থাকলে installer অচেনা agent automatically prune করে না।
প্রয়োজনে installed `agents/<id>.md` এবং `opencode.json`-এর entry manually
সরাতে হবে।

### ৮.৬ Agent handoff — ব্যবহারকারীকে কী দেবে

নতুন ব্যবহারকারী repo clone করলে শুধু code পায়; persona নিজে থেকে inject হয় না।
তাই [`docs/AGENT-HANDOFF.md`](docs/AGENT-HANDOFF.md) তৈরি করা হয়েছে। এতে আছে:

- `AGENTS.md`/system prompt-এ paste করার মূল নির্দেশ
- জম্বি persona আর neutral persona — দুই mode
- persona inject হয়েছে কি না, তার ৬টি চেক
- টুল, secret, LSP, Cloudflare, license-এর সীমা
- ব্যবহারকারীকে বলার ছোট disclaimer

Persona inject না হলে model generic উত্তর দেবে — এটা model-এর দোষ নয়, handoff-এর
ঘাটতি। তাই প্রথমে handoff, তারপর code।

---

## ৯. Agent roster

| # | ID | Name | Role | Call Sign |
|---|---|---|---|---|
| ১ | `manu` | Manu | Chief Systems Architect | The Builder |
| ২ | `jarin` | Jarin | Principal Debug & Root Cause Engineer | The Hunter |
| ৩ | `brishti` | Brishti | Chief Security & Trust Analyst | The Guardian |
| ৪ | `rashed` | Rashed | Principal Performance Engineer | The Optimizer |
| ৫ | `halim` | Halim | Documentation & Knowledge Engineer | The Librarian |
| ৬ | `majnu` | Majnu | Chief Quality Assurance Engineer | The Judge |
| ৭ | `nila` | Nila | UI/UX Designer | The Painter |
| ৮ | `tuhin` | Tuhin | AIML & Model Auditor | The Auditor |
| ৯ | `zombiecoder` | ZombieCoder | Chief Arbiter | The Chair |

সব agent:

- `mode: all`
- একই shared rules ও cross-domain baseline ব্যবহার করে
- আলাদা model assignment installer/runtime থেকে পায়
- agent dropdown-এ সরাসরি selectable

---

## ১০. Tools

| Tool | কাজ |
|---|---|
| `zombiecoder.read_ssot` | Project SSOT পড়া |
| `zombiecoder.read_syllabus` | Syllabus ও lessons পড়া |
| `zombiecoder.get_working_directory` | Working directory ও `.zombiecoder` layout দেখা |
| `zombiecoder.project_fingerprint` | Live project scan |
| `zombiecoder.context_status` | SSOT/syllabus/memory context pack-এর ছোট status ও `uiLine` |
| `zombiecoder.evidence_gate` | Claim/response evidence যাচাই; `FAIL`/`SKIP` = `UNVERIFIED` |
| `zombiecoder.memory_archive` | Archive করা conversation পড়া |
| `zombiecoder.append_syllabus` | নতুন lesson append করা |
| `zombiecoder.syntax_check` | Syntax fallback (LSP নয়): JSON, JS, TS, Python, Bash, PHP |
| `zombiecoder.skill_catalog` | Shared skill list/install/auto; user-requested skill gate/git থেকে নামিয়ে install root-এ রাখে |

Tool execute না হলে `৬.৪ Native tool calls` দেখুন।

### MCP — দুটি local server (installer নিজেই register করে)

`mcp/` ফোল্ডারে দুটি আলাদা local stdio MCP server আছে; কোনো LLM বা API key নেই।
Installer clone থেকে চালালে এগুলো install root-এ কপি হয় এবং `opencode.json`-এর
`mcp.servers`-এ absolute path সহ নিজে থেকেই বসে (`node bin/install.mjs --yes`)।

| Server | Tools | কাজ |
|---|---|---|
| `image-brand` | 5 | PD/CC0 ছবি search (`image_search`), provenance সহ download (`image_fetch`), বাংলা title+logo branding (`image_brand`), exact-size clean crop (`image_fit`), batch (`image_batch`) |
| `public-api` | 8 | Wikipedia search/page/onthisday/featured, weather, currency, country, QR PNG |

`opencode mcp list` → `✓ image-brand connected`, `✓ public-api connected`।
Install-এর পরে কনফিগ যাচাই: `node scripts/audit-install.mjs`।
বিস্তারিত: [`mcp/image-brand/README.md`](mcp/image-brand/README.md),
[`mcp/public-api/README.md`](mcp/public-api/README.md)।

---

## ১১. Skills, memory ও refresh

### Skills

```text
<install>/zombiecoder/skills/*.md        # active, shared by every working directory
<install>/zombiecoder/skills-catalog/*.md # offline source cache
```

Skill আর প্রতিটি project-এ copy হয় না। Install root-এ একবার থাকে, তাই ১০টি
working directory খুললেও ১০টি skill tree তৈরি হয় না। Installer catalog seed করে
এবং core skill (`first-principles`, `evidence-before-confidence`,
`resource-optimization`, `server`) shared store-এ রাখে।

User কোনো skill/ডোমেইন বললে agent সঙ্গে সঙ্গে
`skill_catalog` `action=install` (id সহ) call করে। Tool ক্যাটালগে থাকলে local
copy ব্যবহার করে, না থাকলে configured repo থেকে clone/raw fetch করে
`skills-catalog`-এ নামায়, তারপর `skills/`-এ install করে এবং OpenCode-এর skill
registry reload করে — অর্থাৎ পরের request থেকেই সেটি পাওয়া যায়। Project-এর
ভিতরে কোনো skill file লেখা হয় না।

Skill একটি ছোট markdown + frontmatter; `registerSkills` install root-এর shared
store-কে OpenCode-এর skill door-এ register করে। `action=auto` current project-এর
marker দেখে দরকারি id বেছে নেয়, কিন্তু install target একই shared store।

### Memory

- শেষ ৫টি message context-এ রাখা হয়।
- `session.idle` হলে OpenCode-এর session context থেকে দৃশ্যমান message text
  `.zombiecoder/memory/<session>.jsonl`-এ append হয়; message ID দিয়ে duplicate
  বাদ দেওয়া হয়। Reasoning/thinking block archive করা হয় না। OpenCode-এর
  session context API না থাকলে setup report-এ subscription skipped দেখাবে;
  archive চলাকালীন error হলে audit/console-এ দেখা যাবে। কেবল memory index তৈরি
  হওয়া মানেই conversation archive হওয়া নয়।
- Archive index: `.zombiecoder/memory/index.json`।
- প্রতিটি model call-এ full history নয় — SSOT/syllabus/recent memory-র bounded
  context pack inject হয়; বিস্তারিত দরকার হলে `context_status` তারপর নির্দিষ্ট
  file/section পড়ুন।
- Runtime tool-এ পরপর তিনটি execution error হলে একই session-এ পরের roster agent-এ
  একবার handoff চেষ্টা হয়; switch ব্যর্থ হলে audit log-এ স্পষ্ট error থাকে।
  Semantic ভুল যা tool execution error হিসেবে ধরা পড়ে না, তা এই counter
  স্বয়ংক্রিয়ভাবে শনাক্ত করে না। Evidence gate-ও evidence-এর কাঠামো পরীক্ষা করে,
  দাবির সত্যতা প্রমাণ করে না।

### SSOT refresh

Plugin প্রতি ৫ মিনিটে project SSOT refresh করে। Manual refresh করতে RPC door ব্যবহার করুন:

```text
POST /api/rpc/zombiecoder/ssot_refresh
```

`zombiecoder.get_working_directory` শুধু path/layout দেয়; এটি SSOT refresh করে না।

### RPC control surface

Plugin-এর `ctx.rpc` door `POST /api/rpc/zombiecoder/<method>`-এ reachable। এটি আলাদা server নয়—একই plugin process-এর read-mostly control surface।

| Method | কাজ |
|---|---|
| `working_directory`, `status`, `agents` | Bound root, plugin version, roster |
| `ssot`, `ssot_refresh` | SSOT পড়া / refresh |
| `syllabus`, `syllabus_append` | Syllabus পড়া / append-only lesson |
| `memory`, `memory_index`, `audit` | Recent context, archive index, audit log |
| `models`, `fingerprint` | Current model plan, live project scan |
| `context_status` | SSOT/syllabus/memory pack status (`uiLine`) |

---

## ১২. Installer flags

| Flag | কাজ |
|---|---|
| `--global` | OpenCode global config directory-তে install (default) |
| `--dir <path>` | নির্দিষ্ট project-এ `.opencode` install |
| `--config-dir <path>` | Self-contained install root |
| `--home` | পুরনো OS-root `~/.opencode` layout |
| `--provider-url <url>` | OpenAI-compatible base URL; `none` দিলে free model |
| `--provider-id <id>` | Provider ID |
| `--provider-key <key>` | API key; log-এ print হয় না |
| `--mcp-url <url>` | MCP URL; `none`/বাদ দিলে skip |
| `--origin-url <url>` | URL-only origin handshake; `none` দিলে বন্ধ |
| `--yes` | কোনো prompt ছাড়া install |
| `--no-install` | `npm install` skip |
| `--no-lsp` | LSP server install ও `lsp` config generation skip |
| `--no-space-check` | free-space preflight skip |
| `--keep-cache` | npm cache স্বয়ংক্রিয়ভাবে পরিষ্কার করবে না |
| `--force-low-space` | জায়গা কম হলেও install চালিয়ে যাবে (ঝুঁকিসহ) |
| `--force-install` | dependency satisfy থাকলেও `npm install` আবার চালাবে |
| `--no-provider-config` | `opencode.json` provider merge skip |

Environment variables:

```text
ZOMBIECODER_PROVIDER_URL
ZOMBIECODER_PROVIDER_ID
ZOMBIECODER_PROVIDER_KEY
ZOMBIECODER_API_KEY
ZOMBIECODER_BASELINE_MODEL
ZOMBIECODER_MODEL_STRATEGY
ZOMBIECODER_MCP_URL
ZOMBIECODER_ORIGIN_URL
OPENCODE_API_URL
OPENCODE_BASE
```

---

## ১৩. আপডেট, clean reinstall ও uninstall

### Update

এক-ক্লিক (clone ছাড়া, recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/azurebluezone/ZombieCoder-Autonomous-Plugin/murubbi/install.sh | bash
```

এটি নতুন source tarball নামায়, integrity যাচাই করে, existing install update করে
এবং already-satisfied dependency আবার ডাউনলোড করে না।

Clone করা repo থেকে:

```bash
cd ZombieCoder-Autonomous-Plugin
git pull --ff-only
npm ci
npm run typecheck
npm test
npm run install-pack -- --config-dir "$HOME/.opencode" --yes
opencode reload
```

Windows PowerShell:

```powershell
cd ZombieCoder-Autonomous-Plugin
git pull --ff-only
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run install-pack -- --config-dir "$env:USERPROFILE\.opencode" --yes
opencode reload
```

Installer existing `opencode.json` merge করে; user-এর নিজের permissions রাখে এবং
legacy `kobir` entry prune করে।

### Clean reinstall

পুরনো generated state না রেখে install করতে:

```bash
mv "$HOME/.opencode" "$HOME/.opencode.bak-$(date +%s)"
npm run install-pack -- --config-dir "$HOME/.opencode" --yes
```

Windows PowerShell:

```powershell
Move-Item "$env:USERPROFILE\.opencode" "$env:USERPROFILE\.opencode.bak-$(Get-Date -Format yyyyMMddHHmmss)"
npm.cmd run install-pack -- --config-dir "$env:USERPROFILE\.opencode" --yes
```

Backup-এ API key থাকতে পারে; permission restrict করুন।

### Uninstall

1. OpenCode বন্ধ করুন।
2. `~/.opencode` অথবা `~/.config/opencode` থেকে ZombieCoder entry সরান।
3. চাইলে install root backup/delete করুন।
4. Project-level `.zombiecoder` রাখতে পারেন; এটি project data, install নয়।

---

## ১৪. সমস্যা সমাধান

| লক্ষণ | কারণ ও সমাধান |
|---|---|
| `node: command not found` | Node 22.6+ install করুন; `node --version` যাচাই করুন |
| `npm.ps1 cannot be loaded` | PowerShell-এ `npm.cmd` ব্যবহার করুন |
| `Location plugins did not finish activating` | Install root-এ `npm install` হয়নি; installer আবার চালান |
| Provider 401/403 | `ZOMBIECODER_PROVIDER_KEY` অথবা `config.json`-এর key যাচাই করুন |
| `/v1/models` empty | Provider-এ model load হয়নি; free fallback active থাকবে |
| Agent dropdown-এ নেই | `opencode debug agents`; `mode: all` এবং install root যাচাই করুন |
| Agent tool execute করছে না | Native `tool_calls` নেই; tool-capable model বা gateway template ঠিক করুন |
| `origin-handshake` step fail | `originUrl`/public `/gateway_url.json` reachable কি দেখুন; fail হলেও configured URL কাজ করবে |
| `.opencode` অন্য directory-তে পাওয়া যাচ্ছে না | `~/.config/opencode`-এ symlink/pointer দিন |
| Windows symlink তৈরি হচ্ছে না | Developer Mode চালু করুন অথবা Administrator PowerShell ব্যবহার করুন |
| MCP register হয়নি | `~/.opencode/zombiecoder/mcp.json`-এর error দেখুন |
| কোনো setup step fail | `.zombiecoder/.state/setup-report.json` দেখুন |
| SSOT stale | ৫ মিনিট অপেক্ষা করুন অথবা plugin tool দিয়ে refresh করুন |
| পুরনো session ভিন্ন model ব্যবহার করছে | নতুন session নিন অথবা model picker থেকে বদলান |
| `No LSP servers configured` | `~/.opencode/opencode.json`-এ `lsp` server নেই বা binary missing; install + config + restart; [`docs/LSP.md`](docs/LSP.md) দেখুন। |

### ১৪.১ LSP — installer auto-generate করে

OpenCode V2.1.1-এ LSP runtime আছে। `No LSP servers configured`-এর মানে `lsp`
config বা language-server binary নেই। এখন installer নিজেই `<install>/lsp`-এ ৪টি
server install করে এবং resolve হওয়া binary path দিয়ে `opencode.json`-এর `lsp`
block লেখে (`syncLspConfig`; পুরনো entry অক্ষত থাকে)। এই machine-এ
`typescript`, `python`, `bash`, `json` — ৪টি server configured এবং
`npm run lsp:probe` exit `0` (4/4 initialize pass)। Config `config.updated`
event-এ reload হয়েছে, কিন্তু desktop editor-এ LSP child process এখনো দেখা যায়নি।
তাই editor diagnostics `NOT_TESTED`:
OpenCode পুনরায় চালু করে একটি `.ts` file খুলুন, তারপর যাচাই করুন।

- Config: `<install>/opencode.json` → `lsp` (installer-generated)
- Binaries: `<install>/lsp/node_modules/.bin/`
- Probe: `npm run lsp:probe -- --root "$PWD"`
- `--no-lsp` দিলে toolchain ও config generation skip হয়।
- LSP না মিললে [`docs/LSP.md`](docs/LSP.md) §5 দেখুন।
- `syntax_check` শুধু fallback; LSP নয়। CI-তে `npm run typecheck`, `npm test` চালান।

Debug command:

```bash
opencode debug config
opencode debug agents
opencode debug paths
opencode plugin list
opencode models
```

---

## ১৫. নিরাপত্তা

- API key `opencode.json` এবং `zombiecoder/config.json`-এ থাকে।
- Installer এই দুই ফাইলের POSIX permission নিজেই `600` করে; ম্যানুয়ালি বদলালে
  আবার ঠিক করে নিন:

```bash
chmod 600 "$HOME/.opencode/opencode.json" "$HOME/.opencode/zombiecoder/config.json"
```

Windows PowerShell:

```powershell
icacls "$env:USERPROFILE\.opencode\opencode.json" /inheritance:r /grant:r "$env:USERNAME:(R,W)"
icacls "$env:USERPROFILE\.opencode\zombiecoder\config.json" /inheritance:r /grant:r "$env:USERNAME:(R,W)"
```

- `~/.opencode` বা `~/.config/opencode` Git-এ commit করবেন না।
- Chat, log বা screenshot-এ API key প্রকাশ করবেন না।
- Key প্রকাশ হলে provider dashboard থেকে rotate করুন এবং দুই config ফাইলে নতুন key দিন।
- Installer key কখনো stdout-এ print করে না।

---

## ১৬. ফাইল স্ট্রাকচার

```text
ZombieCoder-Autonomous-Plugin/
├── bin/
│   └── install.mjs
├── docs/
│   └── 100c-runtime-template.md
├── scripts/
│   ├── configure.mjs
│   └── setup.mjs
├── tools/
│   ├── evidence_gate.py
│   ├── hulia_100c.py
│   ├── origin_profile.py
│   ├── render_nginx.py
│   └── tls_verify.py
├── tls/
│   └── nginx.conf.template
├── src/
│   ├── agents.ts
│   ├── ethics.ts
│   ├── generate.ts
│   ├── identity.ts
│   ├── plugin.ts
│   ├── roster.ts
│   ├── runtime.ts
│   └── zombie/
│       ├── defaults.ts
│       ├── io.ts
│       ├── mcp.ts
│       ├── memory.ts
│       ├── models.ts
│       ├── origin.ts
│       ├── paths.ts
│       ├── scan.ts
│       ├── server.ts
│       ├── skills.ts
│       ├── ssot.ts
│       ├── syllabus.ts
│       └── transform.ts
├── test/
├── doc/
│   ├── identity.js
│   ├── ethics.js
│   ├── runtime-operations.js
│   ├── index.js
│   └── *.md (legacy generated artifacts)
├── model.mjs
├── package.json
└── README.md
```

`doc/*.js` runtime-readable documentation; legacy `doc/*.md` build artifacts
`npm run generate` দিয়ে তৈরি হয়। Runtime template-এর নতুন scanner/model/TLS
tools `tools/` ও `tls/`-এ আছে।

---

## ১৭. Development

```bash
npm run typecheck        # TypeScript check
npm test                # node:test suite
npm run generate        # doc/*.md ও doc/identity.json
npm run integrity       # SHA-256 seal + docs/INTEGRITY.md + footer
npm run integrity:check # verify; mismatch = exit 1
npm run lsp:probe       # configured LSP servers: initialize probe
npm run check           # typecheck + test + integrity
```

Test labels:

- `SOURCE_VERIFIED` — source ও test pass
- `CONFIG_VALIDATED` — OpenCode config load pass
- `LIVE_PROBE_PASSED` — live provider/models or LSP initialize probe pass
- `END_TO_END_TESTED` — setup + inference path pass
- `NOT_TESTED` — 해당 path এখনো probe করা হয়নি
- `UNVERIFIED` — প্রমাণ নেই

---

## ১৮. License — Local Freedom, Non-Commercial

**সংক্ষেপে:** নিজের কম্পিউটারে, localhost-এ, শেখার ও ব্যক্তিগত কাজে ব্যবহার
করার স্বাধীনতা আছে। কিন্তু এই repo থেকে ডাউনলোড করা কোড দিয়ে **ব্যবসা করা যাবে
না**, ব্যবসায়িক পণ্য বা paid service বানানো যাবে না।

### করা যাবে

- নিজের machine-এ install ও ব্যবহার, localhost/offline সহ।
- ব্যক্তিগত, শিক্ষামূলক, research ও non-profit কাজে ব্যবহার।
- শেখার জন্য পড়া, modify করা, নিজের প্রয়োজনে ছোট পরিবর্তন করা।
- Attribution রাখলে non-commercial ভাবে share করা।

### করা যাবে না

- এই repo বা এর download করা copy দিয়ে কোনো business, startup, agency,
  client work, paid service, SaaS, hosted product বা commercial training চালানো।
- কোডটি sell, sublicense, paid bundle বা commercial product-এ embed করা।
- License/credit notice মুছে ফেলা বা commercial use-এর অনুমতি আছে বলে দাবি করা।

"Commercial use" মানে টাকা, barter বা business benefit-এর জন্য ব্যবহার — সরাসরি
বা কোনো paid product/service-এর ভিতরে। কোনো doubt থাকলে commercial ধরে নিন এবং
আগে owner-এর লিখিত অনুমতি নিন।

### কেন এই শর্ত

আমরা কষ্ট করি মানুষের উপকারের জন্য। কেউ যদি এই কাজকে মানুষের উপর ব্যবসার হাতিয়ার
বানায়, সেটা আমাদের নীতির বিরুদ্ধে। ব্যক্তিগত স্বাধীনতা আর commercial শোষণ এক
জিনিস নয়।

### সীমা

এই লেখা legal advice নয়। License-এর শর্ত দেশভেদে ভিন্নভাবে প্রয়োগ হতে পারে;
commercial অনুমতি বা আইনি পরামর্শের জন্য owner-এর সাথে যোগাযোগ করুন। Software
"as is" — কোনো warranty নেই।

---

<!-- INTEGRITY:START -->
<div align="center">

### 🔐 ZombieCoder Integrity Seal

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  083d0b49457369ca18b2cb490f4fb0db52062fcf8934a1f1367e7140c82b9d17  ║
║  files 103 · bytes 976585 · base 9d8234c · dirty                         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

[Full manifest](docs/INTEGRITY.md) · Verify: `npm run integrity:check`

> SHA-256 over source, scripts, tests, skills, package metadata and license.
> Detects accidental or unauthorized changes. Not a legal identity signature.
> Base commit is the code tree before this seal commit. Generated: 2026-11-01T09:30:28.558Z

</div>
<!-- INTEGRITY:END -->
