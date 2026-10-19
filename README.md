# ZombieCoder Autonomous Plugin

OpenCode-এর জন্য একটি লোকাল-ফার্স্ট, স্বয়ংসম্পূর্ণ এজেন্ট প্যাক। প্লাগইনটি যেকোনো
ওয়ার্কিং ডিরেক্টরিতে `.zombiecoder/` SSOT তৈরি করে, নয়টি এজেন্টের persona ও
shared rules লেখে, প্রতিটি সেশনের মেমোরি রাখে, ৫ মিনিট পরপর SSOT refresh করে, এবং
কাস্টম OpenAI-compatible provider বা MCP URL না থাকলে OpenCode-এর ফ্রি মডেলে
নিরবে ফলব্যাক করে — কিছুই ভাঙে না।

> **ZombieCoder** — যেখানে কোড ও কথা বলে
> Owner: Sahon Srabon (Developer Zone), Dhaka, Bangladesh

## Requirements

- Node.js **22.6+** (type stripping; Node 24 recommended)
- OpenCode **2.0.32+**
- ইন্টারনেট (শুধু কাস্টম provider/MCP probe-এর জন্য; না থাকলে ফ্রি মডেল)

## Quick install

```bash
git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git
cd ZombieCoder-Autonomous-Plugin
npm install
npm run install-pack -- --dir /path/to/your/project
```

`--dir` না দিলে ইনস্টলার **OS-এর root working directory** টার্গেট করে, অর্থাৎ
`/home/<user>` (এই মেশিনে `/home/xubuntu`)। নির্দিষ্ট কোনো প্রজেক্টে চাইলে
`--dir /path/to/your/project` দিন — দুই জায়গাতেই `.zombiecoder` আলাদা থাকবে,
তাই প্রজেক্টের memory আর root-এর memory মিশে যাবে না।

ইনস্টলার **প্রশ্ন করবে** (TTY থাকলে):

```text
ZombieCoder setup — press Enter to accept the bracketed value.
OpenAI-compatible URL [https://gpu.zombiecoder.my.id/v1] ("none" = OpenCode free models only):
MCP URL [skip]:
```

- **OpenAI-compatible URL** — Enter চাপলে ডিফল্ট gateway ব্যবহার হবে; `none` লিখলে
  শুধু OpenCode-এর ফ্রি মডেল।
- **MCP URL** — দিলে installer `initialize → notifications/initialized → tools/list`
  probe করে টুলের তালিকা আনে; খালি রাখলে কোনো MCP server register হয় না।

নন-ইন্টারঅ্যাকটিভ (CI বা `--yes`) হলে প্রশ্ন থাকে না; flag না দিলে ডিফল্ট provider
URL এবং কোনো MCP নয়।

### Flags

| Flag | অর্থ |
| --- | --- |
| `--dir <path>` | ইনস্টল টার্গেট (default: `$HOME`) |
| `--provider-url <url>` | কাস্টম OpenAI-compatible URL; `none` দিলে ফ্রি মডেল |
| `--mcp-url <url>` | MCP URL; `none`/বাদ দিলে skip |
| `--yes` / `--defaults` | কোনো প্রশ্ন নয়, ডিফল্ট ব্যবহার |
| `--no-install` | `.opencode`-এ `npm install` চালাবে না |
| `--no-provider-config` | `opencode.json` merge করবে না |

## Installer যা করে

1. `<project>/.opencode/{agents,plugins,skills}` এবং `<project>/.zombiecoder` বানায়
2. প্লাগইন runtime graph কপি করে (`plugin.ts`, `roster.ts`, `zombie/*`)
3. `.opencode/package.json`-এ `@opencode/plugin@^2.0.32` যোগ করে (merge, কখনো clobber নয়)
4. `.opencode`-এ `npm install` চালায়
5. `.zombiecoder/config.json` seed/update করে
6. MCP URL দিলে probe করে `.zombiecoder/mcp.json` লেখে
7. `opencode.json`-এ provider + MCP merge করে (শুধু probe-verified MCP)
8. নয়টি agent markdown লেখে (runtime plan থাকলে resolved model, নাহলে baseline)
9. `.opencode/plugins/zombiecoder.ts` entrypoint **সবার শেষে** লেখে, যাতে OpenCode
   কখনো half-finished install boot না করে

সব write atomic (temp + rename)। কোনো `.bak`, archive বা silent overwrite নেই।

> **Note:** পুরনো concept-এ লেখা `.open`, `.agent`, `.package` — OpenCode-এর নিজের
> ভাষায় এগুলোই `.opencode/`, `.opencode/agents/` এবং `.opencode/package.json`।
> আলাদা `.open`/`.agent`/`.package` বানালে সেগুলো dead directory হতো, তাই বানানো হয় না।

## চালু করার পর কী হয়

ওই প্রজেক্টে OpenCode খুললেই `setup()` চলে:

| ধাপ | ফল |
| --- | --- |
| `bootstrap-dirs` | `.zombiecoder/{memory,skills,agents}` + `.opencode/*` |
| `resolve-models` | কাস্টম provider live probe → না হলে cost 0/0 ফ্রি মডেল |
| `probe-mcp` | MCP URL থাকলে টুলের তালিকা `.zombiecoder/mcp.json`-এ |
| `write-ssot` | `.zombiecoder/SSOT.md` (live filesystem থেকে) |
| `ensure-syllabus` | `.zombiecoder/syllabus.md` (append-only) |
| `agent-folder` / `agent-bind` | নয়টি `.opencode/agents/*.md`-এ resolved model + shared rules |
| `register-tools` | `zombiecoder` namespace-এ ৫টি টুল |
| `register-skills` | workstation-tier skills `.zombiecoder/skills/*.md` থেকে |
| `hook-*` | context, compaction, model.request, session index, tool footprint |
| `refresh` | প্রতি ৫ মিনিটে SSOT rewrite + branded signature |

সবকিছুর durable প্রমাণ থাকে: `.zombiecoder/setup-report.json`।

### Model routing

1. কাস্টম provider-এর **নিজের** `baseURL` live probe করা হয় — শুধু config-এ লেখা আছে
   বলেই মৃত server-এ agent পাঠানো হয় না।
2. provider reachable + `opencode.json`-এ configured → সেখানকার মডেল।
3. নাহলে OpenCode-এর cost `0/0` ফ্রি মডেল।
4. কিছুই না পেলে baseline `opencode/big-pickle`।

Mapping ডিফল্টে **deterministic** (agent id-এর stable hash), যাতে footprint
reproducible থাকে। চাইলে `.zombiecoder/config.json`-এ `"modelStrategy": "random"`।

### MCP

- Installer শুধু **probe-verified** MCP server `opencode.json`-এ লিখে; dead URL লিখে
  বুট slow করে না।
- Runtime-এ প্রতিবার `tools/list` probe হয় (read-only)। কোনো arbitrary tool call
  করা হয় না, কারণ tool-এর side effect থাকতে পারে।
- MCP tool-এর আসল call হয় OpenCode-এর নিজের MCP client দিয়ে।

### Memory

- `.zombiecoder/memory/index.json` — কোন session-এ কত message রাখা/archive হয়েছে।
- `.zombiecoder/memory/<session>.jsonl` — archive।
- শেষ ১০টি message RAM/context-এ থাকে; বাকিগুলো archive-এ যায় (`compaction` hook)।
- `.zombiecoder/footprint.jsonl` — প্রতিটি action-এর audit line।

### Tools (৫টি)

`get_working_directory`, `read_ssot`, `read_syllabus`, `append_syllabus`,
`project_fingerprint` — সবই `zombiecoder` namespace-এ, `ctx.tool` transform দিয়ে।

### Skills (দুই স্তর)

- **workstation tier:** `<project>/.zombiecoder/skills/*.md` — প্লাগইন register করে।
- **project tier:** `<project>/.opencode/skills/*.md` — OpenCode নিজেই পায়, তাই
  duplicate এড়াতে প্লাগইন দ্বিতীয়বার register করে না।

## Layout

```text
<project>/
├── opencode.json                 # provider + MCP (merge করা, clobber নয়)
├── .opencode/                    # OpenCode-এর ঘর
│   ├── agents/*.md               # ৯টি agent (model + shared rules)
│   ├── plugins/zombiecoder.ts    # entrypoint
│   ├── plugins/zombiecoder/      # runtime graph
│   ├── skills/                   # project-tier skills
│   └── package.json
└── .zombiecoder/                 # আমাদের ঘর
    ├── config.json
    ├── SSOT.md
    ├── syllabus.md
    ├── fingerprint.json
    ├── models.json
    ├── mcp.json
    ├── footprint.jsonl
    ├── setup-report.json
    ├── memory/
    ├── skills/                   # workstation-tier skills
    └── agents/<id>/metadata.json
```

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
- `modelStrategy`: `auto` (deterministic, default), `random`, `custom`, `free`, `baseline`।

## Troubleshooting

| লক্ষণ | কারণ / সমাধান |
| --- | --- |
| `Location plugins did not finish activating` | `.opencode`-এ `npm install` হয়নি। `npm run install-pack -- --dir …` আবার চালান। |
| agent-এ কাস্টম মডেল নেই | `opencode.json`-এ provider আছে কি দেখুন; `.zombiecoder/setup-report.json`-এর `resolve-models`। |
| MCP register হয়নি | MCP URL probe fail করেছে; `.zombiecoder/mcp.json`-এর `error` দেখুন। |
| কিছু step fail | `setup-report.json`-এ প্রতিটি step-এর `ok`/`error`; কনসোলেও `[zombiecoder] step failed`। |
| SSOT stale | refresh ৫ মিনিট; `zombiecoder.get_working_directory` tool দিয়ে manual check। |

## Development

```bash
npm run generate     # doc/*.md + doc/identity.json
npm run typecheck    # tsc --noEmit
npm test             # node:test (models, MCP, plugin setup)
```

## Evidence labels

রিপোর্টে ব্যবহৃত label: `SOURCE_VERIFIED`, `CONFIG_VALIDATED`,
`LIVE_PROBE_PASSED`, `END_TO_END_TESTED`, `NOT_TESTED`, `UNVERIFIED`।
একটি label অন্য স্তরের প্রমাণ নয়।

## License

Proprietary — Local Freedom Protocol.
