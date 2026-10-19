# ZombieCoder Autonomous Plugin

> **ZombieCoder** — যেখানে কোড ও কথা বলে  
> Owner: **Sahon Srabon** (Developer Zone), Dhaka, Bangladesh

[![OpenCode](https://img.shields.io/badge/OpenCode-2.0.32%2B-111111)](https://opencode.ai)
[![Node](https://img.shields.io/badge/Node-22.6%2B-339933)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Proprietary%20%E2%80%94%20Local%20Freedom-blue)](#license)

OpenCode-এর জন্য একটি **লোকাল-ফার্স্ট, স্বয়ংসম্পূর্ণ** এজেন্ট প্যাক। একবার ইনস্টল
করলে যেকোনো working directory-তে:

- `.zombiecoder/SSOT.md` — live filesystem থেকে তৈরি Single Source of Truth
- `.zombiecoder/syllabus.md` — footprint + append-only lessons
- `.zombiecoder/memory/` — শেষ ১০টি message রাখে, বাকিগুলো archive করে
- `.zombiecoder/footprint.jsonl` — প্রতিটি action-এর audit line
- ৯টি এজেন্টের persona, shared rules, model ও permission
- ৬টি `zombiecoder.*` টুল
- ৫ মিনিট পরপর SSOT refresh

কাস্টম OpenAI-compatible provider বা MCP URL না থাকলে এটি OpenCode-এর ফ্রি
মডেলে **নিরবে ফলব্যাক** করে — কিছুই ভাঙে না।

---

## সূচিপত্র

1. [কেন এই প্যাক](#কেন-এই-প্যাক)
2. [এক নজরে আর্কিটেকচার](#এক-নজরে-আর্কিটেকচার)
3. [Requirements](#requirements)
4. [Quick install — global (default)](#quick-install--global-default)
5. [Installer flags](#installer-flags)
6. [Installer কী কী করে](#installer-কী-কী-করে)
7. [Global `opencode.json` — V2 shape](#global-opencodejson--v2-shape)
8. [চালু করার পর কী হয়](#চালু-করার-পর-কী-হয়)
9. [Model routing](#model-routing)
10. [MCP](#mcp)
11. [Memory ও archive index](#memory-ও-archive-index)
12. [Tools](#tools)
13. [Skills — lazy, দুই স্তর](#skills--lazy-দুই-স্তর)
14. [Layout](#layout)
15. [`.zombiecoder/config.json`](#zombiecoderconfigjson)
16. [Agent roster](#agent-roster)
17. [Verification checklist](#verification-checklist)
18. [Troubleshooting](#troubleshooting)
19. [Development](#development)
20. [Evidence labels](#evidence-labels)
21. [License](#license)

---

## কেন এই প্যাক

বেশিরভাগ এজেন্ট প্যাক একটা project-এ আটকে থাকে, অথবা প্রতিটি working
directory-তে `.opencode` তৈরি করে জায়গা নষ্ট করে। ZombieCoder উল্টো পথে চলে:

| সমস্যা | ZombieCoder-এর উত্তর |
| --- | --- |
| প্রতিটি project-এ আলাদা ইনস্টল | **একটি global install** (`~/.config/opencode`) সব working directory-তে কাজ করে |
| project-এর ভেতরে `.opencode` clutter | working directory-তে শুধু **`.zombiecoder`**; `.opencode` নেই |
| সবসময় মৃত provider-এ request | provider **live probe**; না পেলে free model |
| ভুলে যাওয়া context | শেষ ১০টি message + **archive index** |
| অন্ধভাবে SSOT লেখা | bounded filesystem scan, signature, setup report |
| agent-এর নাম বদলালেও পুরনো agent থেকে যায় | rename করলে পুরনো markdown ও config entry **prune** হয় |

## এক নজরে আর্কিটেকচার

```text
┌──────────────────────────────────────────────────────────────────────┐
│  ~/.config/opencode  (GLOBAL — একবার)                                │
│  ├── opencode.json      provider + models + agents + permissions+MCP │
│  ├── agents/*.md        ৯টি persona (markdown door)                  │
│  ├── plugins/           ZombieCoder runtime (auto-discovered)        │
│  └── zombiecoder/       config.json · models.json · mcp.json         │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  একই plugin সব জায়গায়
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  /project/a/.zombiecoder  /project/b/.zombiecoder  /project/c/.zombiecoder
  ├── SSOT.md              ├── SSOT.md              ├── SSOT.md
  ├── syllabus.md          ├── syllabus.md          ├── syllabus.md
  ├── memory/index.json    ├── memory/index.json    ├── memory/index.json
  ├── models.json          ├── models.json          ├── models.json
  ├── footprint.jsonl      ├── footprint.jsonl      ├── footprint.jsonl
  └── skills/ (lazy)       └── skills/ (lazy)       └── skills/ (lazy)
```

## Requirements

- Node.js **22.6+** (type stripping; Node 24 recommended)
- OpenCode **2.0.32+**
- ইন্টারনেট — শুধু কাস্টম provider/MCP probe-এর জন্য; না থাকলে free model

## Quick install — global (default)

```bash
git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git
cd ZombieCoder-Autonomous-Plugin
npm install
npm run install-pack -- --yes
```

এটি OpenCode-এর **প্রকৃত global config directory**-তে ইনস্টল করে:

| OS | Global target |
| --- | --- |
| Linux / macOS | `~/.config/opencode` (`$XDG_CONFIG_HOME` থাকলে সেটি) |
| Windows | `%USERPROFILE%\.config\opencode` |

> **গুরুত্বপূর্ণ:** `/home/<user>/.opencode` কোনো global directory নয় — এটি home
> directory-র project-local `.opencode`। সত্যিকারের global হলো
> `~/.config/opencode`। তাই একবার global ইনস্টল করলে **কোনো working
> directory-তে `.opencode` তৈরি হয় না**; শুধু `.zombiecoder` তৈরি হয়।

প্রয়োজনে project-local ইনস্টল:

```bash
npm run install-pack -- --dir /path/to/your/project --yes
```

পুরনো OS-root `.opencode` আচরণ চাইলে:

```bash
npm run install-pack -- --home --yes
```

ইনস্টলার TTY থাকলে প্রশ্ন করবে:

```text
ZombieCoder setup — press Enter to accept the bracketed value.
OpenAI-compatible URL [https://gpu.zombiecoder.my.id/v1] ("none" = OpenCode free models only):
MCP URL [skip]:
```

- **OpenAI-compatible URL** — Enter চাপলে ডিফল্ট gateway; `none` লিখলে শুধু
  OpenCode-এর ফ্রি মডেল।
- **MCP URL** — দিলে installer `initialize → notifications/initialized →
  tools/list` probe করে টুলের তালিকা আনে; খালি রাখলে কোনো MCP server register
  হয় না।

CI বা `--yes`-এ কোনো প্রশ্ন থাকে না; flag না দিলে ডিফল্ট provider URL এবং
কোনো MCP নয়।

## Installer flags

| Flag | অর্থ |
| --- | --- |
| `--global` | OpenCode global config directory-তে ইনস্টল (default) |
| `--dir <path>` | নির্দিষ্ট project-এ `.opencode`-সহ ইনস্টল |
| `--home` | পুরনো OS-root `~/.opencode` ইনস্টল |
| `--provider-url <url>` | কাস্টম OpenAI-compatible URL; `none` দিলে free model |
| `--mcp-url <url>` | MCP URL; `none`/বাদ দিলে skip |
| `--yes` / `--defaults` | কোনো প্রশ্ন নয়, ডিফল্ট ব্যবহার |
| `--no-install` | `npm install` চালাবে না |
| `--no-provider-config` | `opencode.json` merge করবে না |

## Installer কী কী করে

1. install root scaffold — global: `~/.config/opencode/{agents,plugins}`,
   project: `<project>/.opencode/{agents,plugins}`; **skills directory বানায় না**
2. plugin runtime graph কপি — `plugin.ts`, `roster.ts`, `zombie/*`
3. `package.json`-এ `@opencode/plugin@^2.0.32` যোগ করে (merge, clobber নয়)
4. `npm install` চালায়
5. `zombiecoder/config.json` seed/update করে
6. MCP URL দিলে probe করে `zombiecoder/mcp.json` লেখে
7. provider live probe করে deterministic model plan তৈরি করে
8. `opencode.json`-এ **provider + models + V2 agents + permissions + MCP** merge করে
9. ৯টি agent markdown লেখে; পুরনো `kobir.md` ও `agents.kobir` prune করে
10. **শুধু project-local install-এ** `.zombiecoder/SSOT.md`, `syllabus.md` ও
    `memory/` seed করে; global install-এ skip — কারণ `.zombiecoder` প্রতি
    working directory-তে first boot-এ তৈরি হয়
11. plugin entrypoint **সবার শেষে** লেখে, যাতে OpenCode কখনো half-finished
    install boot না করে

সব write atomic (temp + rename)। কোনো `.bak`, archive বা silent overwrite নেই।

## Global `opencode.json` — V2 shape

OpenCode **V2** uses `agents` (plural), `permissions` (plural), `shell` (not
`bash`), and `mcp.servers`. পুরনো `agent` / `permission` / `bash` shape হলো V1;
এই installer সেটি লেখে না।

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "missionbarisal/llama3-groq-tool-use:8b",
  "default_agent": "zombiecoder",
  "providers": {
    "missionbarisal": {
      "name": "ZombieCoder Gateway",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://gpu.zombiecoder.my.id/v1",
        "apiKey": "public"
      },
      "models": {
        "llama3-groq-tool-use:8b": {
          "name": "llama3-groq-tool-use:8b",
          "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
          "cost": { "input": 0, "output": 0 }
        }
      }
    }
  },
  "permissions": [
    { "action": "read", "resource": "*", "effect": "allow" },
    { "action": "edit", "resource": "*", "effect": "allow" },
    { "action": "shell", "resource": "*", "effect": "ask" },
    { "action": "shell", "resource": "git status *", "effect": "allow" },
    { "action": "shell", "resource": "git push *", "effect": "ask" }
  ],
  "agents": {
    "zombiecoder": {
      "description": "Chief Arbiter — aggregation, conflict resolution, priority and final decision.",
      "mode": "all",
      "model": "missionbarisal/llama3-groq-tool-use:8b",
      "system": "# ZombieCoder — The Chair\n\n…shared rules…",
      "permissions": [
        { "action": "subagent", "resource": "*", "effect": "allow" }
      ]
    },
    "manu": {
      "description": "Chief Systems Architect — architecture, data flow, agent orchestration, SSOT.",
      "mode": "subagent",
      "model": "missionbarisal/llama3-groq-tool-use:8b",
      "system": "# Manu — The Builder\n\n…shared rules…",
      "permissions": [
        { "action": "subagent", "resource": "*", "effect": "deny" }
      ]
    }
  },
  "mcp": {
    "servers": {
      "zombiecoder": { "type": "remote", "url": "https://…/mcp" }
    }
  }
}
```

- **provider** — শুধু live probe-pass করা model config-এ ঢোকে।
- **agents** — ৯টি agent-এর description, mode, model, system prompt ও permissions।
- **permissions** — global rules আগে, user-এর নিজের rules পরে; তাই user-এর
  later rule শেষ কথা বলে।
- **mcp.servers** — শুধু probe-verified server।
- **plugins** — global `plugins/` directory auto-discovered; installer আপনার
  existing `plugins` array মুছে না।

## চালু করার পর কী হয়

ওই working directory-তে OpenCode খুললেই `setup()` চলে:

| ধাপ | ফল |
| --- | --- |
| `bootstrap-dirs` | শুধু `.zombiecoder/{memory,agents}`; skills lazy, `.opencode` নয় |
| `load-config` | shipped default < global `zombiecoder/config.json` < local `.zombiecoder/config.json` |
| `migrate-legacy-plan` | পুরনো `memory.json` (model plan) → `models.json` |
| `resolve-models` | কাস্টম provider live probe → না হলে cost 0/0 ফ্রি মডেল |
| `probe-mcp` | MCP URL থাকলে টুলের তালিকা `.zombiecoder/mcp.json`-এ |
| `write-ssot` | `.zombiecoder/SSOT.md` (live filesystem থেকে) |
| `ensure-syllabus` | `.zombiecoder/syllabus.md` (footprint + append-only lessons) |
| `agent-folder` / `agent-config` | install root-এ ৯টি markdown + V2 `agents` config |
| `agent-bind` | markdown ও config দুই door-এই resolved model + permissions verify |
| `register-tools` | `zombiecoder` namespace-এ ৬টি টুল |
| `register-skills` | `.zombiecoder/skills/*.md` থাকলে তবেই register |
| `hook-*` | context, compaction, model.request, session index, tool footprint |
| `refresh` | প্রতি ৫ মিনিটে SSOT rewrite + branded signature |

সবকিছুর durable প্রমাণ থাকে: `.zombiecoder/setup-report.json`।

### Model routing

1. কাস্টম provider-এর **নিজের** `baseURL` live probe করা হয় — শুধু config-এ
   লেখা আছে বলেই মৃত server-এ agent পাঠানো হয় না।
2. provider reachable + `opencode.json`-এ configured (নিজের, ancestor অথবা
   global) → সেখানকার মডেল। global config ব্যবহার করলে নিচের প্রতিটি working
   directory সেটাই inheritance হিসেবে পায়।
3. নাহলে OpenCode-এর cost `0/0` ফ্রি মডেল।
4. কিছুই না পেলে baseline `opencode/big-pickle`।

Mapping ডিফল্টে **deterministic** (agent id-এর stable hash), যাতে footprint
reproducible থাকে। চাইলে `.zombiecoder/config.json`-এ `"modelStrategy": "random"`।

> **Session model আলাদা:** OpenCode একটি session-এর selected model আলাদা রাখে।
> Agent config-এর `model` নতুন session-এর জন্য default দেয়; চলমান session-এর
> model বদলাতে desktop-এ model picker ব্যবহার করুন।

### MCP

- Installer শুধু **probe-verified** MCP server `mcp.servers`-এ লেখে; dead URL
  লিখে বুট slow করে না।
- Runtime-এ প্রতিবার `tools/list` probe হয় (read-only)। কোনো arbitrary tool
  call করা হয় না, কারণ tool-এর side effect থাকতে পারে।
- MCP tool-এর আসল call হয় OpenCode-এর নিজের MCP client দিয়ে।

### Memory ও archive index

- `.zombiecoder/memory/index.json` — প্রতি session-এর kept/archived count
  **এবং `archives[]`** — প্রতিটি archive file, sessionID, message count, bytes,
  first/last timestamp।
- `.zombiecoder/memory/<session>.jsonl` — archive (append-only)।
- শেষ ১০টি message RAM/context-এ থাকে; বাকিগুলো compaction hook-এ archive-এ যায়।
- `readIndex()` disk স্ক্যান করে index-এ না থাকা পুরনো `.jsonl`-ও খুঁজে নেয়,
  তাই agent `index.json` দেখলেই সব archive খুঁজে পায়।
- `.zombiecoder/footprint.jsonl` — প্রতিটি action-এর audit line।

### Tools

`zombiecoder` namespace-এ ৬টি টুল:

| Tool | কাজ |
| --- | --- |
| `get_working_directory` | working directory + `.zombiecoder` layout |
| `read_ssot` | SSOT markdown |
| `read_syllabus` | syllabus markdown |
| `append_syllabus` | append-only lesson যোগ |
| `project_fingerprint` | machine-readable fingerprint |
| `memory_archive` | `index.json`-এর sessionID নিয়ে archive rows পড়া |

### Skills — lazy, দুই স্তর

- **workstation tier:** `<project>/.zombiecoder/skills/*.md` — প্লাগইন register
  করে। ফোল্ডার **আগে থেকে তৈরি হয় না**; skill দরকার হলে নিজে বানান বা
  agent-কে বলুন।
- **project tier:** `<project>/.opencode/skills/*.md` — OpenCode নিজেই পায়, তাই
  duplicate এড়াতে প্লাগইন দ্বিতীয়বার register করে না।

## Layout

### Global install (default)

```text
~/.config/opencode/
├── opencode.json                 # provider + models + agents + permissions + MCP
├── agents/*.md                   # ৯টি agent persona (markdown door)
├── plugins/zombiecoder.ts        # entrypoint (auto-discovered)
├── plugins/zombiecoder/          # runtime graph
├── package.json                  # @opencode/plugin
├── node_modules/
└── zombiecoder/
    ├── config.json               # global ZombieCoder config
    ├── models.json               # install-time plan
    └── mcp.json                  # probe result (if configured)
```

### Every working directory (runtime)

```text
<project>/
├── opencode.json                 # optional project override (only if --dir install)
└── .zombiecoder/
    ├── config.json
    ├── SSOT.md
    ├── syllabus.md
    ├── fingerprint.json
    ├── models.json
    ├── mcp.json
    ├── footprint.jsonl
    ├── setup-report.json
    ├── memory/
    │   ├── index.json            # sessions + archives[]
    │   └── <session>.jsonl
    ├── skills/                   # only if a skill is added
    └── agents/<id>/metadata.json
```

**No `.opencode` in the working directory** when the plugin is installed globally.

## `.zombiecoder/config.json`

```json
{
  "version": "0.1.0",
  "customProviderUrl": "https://gpu.zombiecoder.my.id/v1",
  "customProviderID": "missionbarisal",
  "mcpUrl": "",
  "opencodeApiUrl": "http://127.0.0.1:49374",
  "ssotRefreshMs": 300000,
  "modelStrategy": "auto"
}
```

- `customProviderUrl: ""` → শুধু OpenCode ফ্রি মডেল।
- `mcpUrl: ""` → MCP নেই।
- `modelStrategy`: `auto` (deterministic, default), `random`, `custom`, `free`,
  `baseline`।
- Global install-এ `zombiecoder/config.json` baseline; প্রতিটি project-এর
  `.zombiecoder/config.json` সেটি override করতে পারে।

## Agent roster

| # | Agent ID | Name | Role |
| --- | --- | --- | --- |
| 1 | `manu` | Manu | Chief Systems Architect |
| 2 | `jarin` | Jarin | Principal Debug & Root Cause Engineer |
| 3 | `brishti` | Brishti | Chief Security & Trust Analyst |
| 4 | `rashed` | Rashed | Principal Performance Engineer |
| 5 | `halim` | Halim | Documentation & Knowledge Engineer |
| 6 | `majnu` | Majnu | Chief Quality Assurance Engineer |
| 7 | `nila` | Nila | UI/UX Designer |
| 8 | `tuhin` | Tuhin | AIML & Model Auditor |
| 9 | `zombiecoder` | ZombieCoder | Chief Arbiter |

`zombiecoder` হলো আগের `kobir`-এর নতুন নাম। পুরনো `kobir.md` ও `agents.kobir`
ইনস্টলার/রানটাইম দুই জায়গা থেকেই মুছে যায়।

## Verification checklist

Global install-এর পরে এই প্রমাণগুলো রাখুন:

```bash
# 1. global config-এ provider + ৯টি agent + permissions
python3 - <<'PY'
import json
d=json.load(open("/home/$USER/.config/opencode/opencode.json"))
print("providers:", list(d.get("providers", {})))
print("agents:", sorted(d.get("agents", {})))
print("permissions:", len(d.get("permissions", [])))
assert "zombiecoder" in d["agents"] and "kobir" not in d["agents"]
PY

# 2. global agents markdown-এ rename
ls ~/.config/opencode/agents | sort

# 3. working directory-তে .opencode নেই, .zombiecoder আছে
cd /path/to/project
test ! -d .opencode && echo "no .opencode (correct)"
find .zombiecoder -maxdepth 2 | sort

# 4. setup report
python3 - <<'PY'
import json
d=json.load(open(".zombiecoder/setup-report.json"))
print(d["outputs"]["install"])
print(d["outputs"].get("bound"))
print([(s["step"], s["ok"]) for s in d["steps"]])
PY

# 5. syllabus footprint
grep -n "Footprint" .zombiecoder/syllabus.md

# 6. memory index archives
python3 - <<'PY'
import json
d=json.load(open(".zombiecoder/memory/index.json"))
print("sessions:", len(d.get("sessions", {})), "archives:", len(d.get("archives", [])))
PY
```

লেবেল: install path = `CONFIG_VALIDATED`, live provider/models = `LIVE_PROBE_PASSED`,
setup report + tool list = `END_TO_END_TESTED`, LLM rule-following = `NOT_TESTED`
(এটি আলাদা behavioural test)।

## Troubleshooting

| লক্ষণ | কারণ / সমাধান |
| --- | --- |
| `Location plugins did not finish activating` | global `~/.config/opencode`-এ `npm install` হয়নি। `npm run install-pack -- --yes` আবার চালান। |
| agent-এ কাস্টম মডেল নেই | `opencode.json`-এ provider আছে কি দেখুন; `.zombiecoder/setup-report.json`-এর `resolve-models` ও `agent-bind`। |
| MCP register হয়নি | MCP URL probe fail করেছে; `.zombiecoder/mcp.json`-এর `error` দেখুন। |
| কিছু step fail | `setup-report.json`-এ প্রতিটি step-এর `ok`/`error`; কনসোলেও `[zombiecoder] step failed`। |
| SSOT stale | refresh ৫ মিনিট; `zombiecoder.get_working_directory` tool দিয়ে manual check। |
| `.opencode` এখনো আছে | পুরনো project-local ইনস্টল; global ব্যবহারে working directory থেকে `.opencode` মুছে ফেলুন। |
| পুরনো session ভিন্ন model ব্যবহার করছে | session-এর selected model আলাদা; নতুন session নিন বা model picker থেকে বদলান। |

## Development

```bash
npm run generate     # doc/*.md + doc/identity.json
npm run typecheck    # tsc --noEmit
npm test             # node:test (models, MCP, memory, plugin setup)
```

## Evidence labels

রিপোর্টে ব্যবহৃত label: `SOURCE_VERIFIED`, `CONFIG_VALIDATED`,
`LIVE_PROBE_PASSED`, `END_TO_END_TESTED`, `NOT_TESTED`, `UNVERIFIED`।
একটি label অন্য স্তরের প্রমাণ নয়।

## License

Proprietary — **Local Freedom Protocol**.
