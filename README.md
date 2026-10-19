# ZombieCoder Autonomous Plugin

OpenCode-এর জন্য একটি লোকাল-ফার্স্ট এজেন্ট প্যাক। প্লাগইনটি প্রজেক্ট খুললেই
`.zombiecoder/` তৈরি করে, SSOT ও syllabus লেখে, ৯টি এজেন্টের markdown বানায়,
প্রতি ওয়ার্কিং ডিরেক্টরির জন্য মেমোরি রাখে এবং কাস্টম OpenAI-compatible
প্রোভাইডার না থাকলে OpenCode-এর ফ্রি মডেলে ফলব্যাক করে।

> **ZombieCoder** — যেখানে কোড ও কথা বলে
> Owner: Sahon Srabon (Developer Zone), Dhaka, Bangladesh

## Requirements

- Node.js **22.6+** (type stripping; Node 24 recommended)
- OpenCode **2.0.32+**

## Install

```bash
git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git
cd ZombieCoder-Autonomous-Plugin
npm install
npm run install-pack -- --dir /path/to/your/project
```

`--dir` না দিলে ইনস্টলার হোম ডিরেক্টরিকে টার্গেট করে। নিরাপদভাবে নির্দিষ্ট
প্রজেক্টে ইনস্টল করতে সবসময় `--dir` দিন।

ইনস্টলার যা করে:

1. `<project>/.opencode/{agents,plugins,skills}` এবং `<project>/.zombiecoder` তৈরি করে
2. প্লাগইন runtime graph কপি করে
3. `.opencode/package.json`-এ `@opencode/plugin` যোগ করে ও `npm install` চালায়
4. `.zombiecoder/config.json` seed করে
5. `opencode.json`-এ কাস্টম provider ও MCP URL merge করে
6. ৯টি agent markdown লেখে

তারপর সেই প্রজেক্টে OpenCode চালু করুন। প্রথম `setup()`-এ SSOT, syllabus,
মেমোরি, agent binding ও tools/skills register হবে।

## Configuration

`<project>/.zombiecoder/config.json`:

```json
{
  "version": "0.1.0",
  "customProviderUrl": "https://gpu.zombiecoder.my.id/v1",
  "customProviderID": "missionbarisal",
  "mcpUrl": "http://127.0.0.1:5000/mcp",
  "opencodeApiUrl": "http://127.0.0.1:49374",
  "ssotRefreshMs": 300000,
  "modelStrategy": "auto"
}
```

- কাস্টম provider সাড়া দিলে সেখানকার মডেল ব্যবহার হবে।
- না দিলে `opencode/big-pickle`সহ OpenCode-এর cost `0/0` মডেলে ফলব্যাক হবে।
- `modelStrategy` = `auto` (default, deterministic), `random`, `custom`, `free`, `baseline`.

## Layout

```text
<project>/
├── opencode.json                 # provider + mcp
├── .opencode/
│   ├── agents/*.md               # 9 agents
│   ├── plugins/zombiecoder.ts    # entrypoint
│   └── plugins/zombiecoder/      # runtime graph
└── .zombiecoder/
    ├── config.json
    ├── SSOT.md
    ├── syllabus.md
    ├── fingerprint.json
    ├── footprint.jsonl
    ├── memory/
    └── agents/<id>/metadata.json
```

## Development

```bash
npm run generate     # doc/*.md + doc/identity.json
npm run typecheck
npm test
```

## License

Proprietary — Local Freedom Protocol.
