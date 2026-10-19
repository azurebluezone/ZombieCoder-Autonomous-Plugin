# Runtime Operations

> এই ফাইল একটি build artifact। মূল সোর্স `src/runtime.ts`।
> এখানে লেখা সবকিছুর ভিত্তি হলো **আগেই বিদ্যমান** যন্ত্রাংশ; আমরা নতুন কিছু বানাই না, শুধু জোড়া দিই।

## ০. স্থাপত্যের মূল সূত্র

```text
      URL (OpenAI-compatible) ──┐
                                ├──► protocol probe (কথা বলে কি না?)
      URL (MCP JSON-RPC 2.0) ───┘              │
                                               ▼
                                  GENERATOR (TS/JS source)
                                               │
            ┌──────────────────────────────────┼──────────────────────────┐
            ▼                                  ▼                          ▼
   .opencode/agents/*.md            .zombiecoder/*.md             opencode.json
        (frontmatter সহ)          (SSOT / syllabus / memory)   (provider + mcp)
            │
            ▼
   runtime (OpenCode-এর নিজের surface):
   ctx.location · ctx.storage · ctx.skill · ctx.rpc · ctx.tool · ctx.agent · ctx.mcp
```

তিনটি সিদ্ধান্ত, যা অনড়:

| # | সিদ্ধান্ত | কারণ |
|---|---|---|
| ১ | **আলাদা কোনো সার্ভার নেই** | প্লাগইনের ভেতরেই `ctx.rpc`, `ctx.tool`, `ctx.storage`, `ctx.skill` আছে। দ্বিতীয় সার্ভার = দ্বিতীয় state, দ্বিতীয় failure mode |
| ২ | **সার্ভারের নাম নয়, শুধু URL** | URL OpenAI-compatible বা MCP জবাব দিতে পারলে নেব; না পারলে OpenCode-এর ডিফল্ট চলবে |
| ৩ | **markdown কখনো সোর্স নয়** | সোর্স TS; markdown আউটপুট, সঠিক লোকেশনে generator নিজে লিখবে |

## ১. দুই প্রোটোকল প্রোব (URL-driven)

### OpenAI-compatible

| ধাপ | অনুরোধ | কী দেখে সিদ্ধান্ত |
|---|---|---|
| ১ | `GET {url}/models` | মডেল তালিকা ফেরত এলেই প্রোভাইডার হিসেবে গ্রহণ |
| ২ | `POST {url}/chat/completions` (minimal, non-streaming) | সত্যিকারের উত্তর এলে `ChatCompletions: PASS` |
| ৩ | একই অনুরোধ, forced tool call | tool calling তখনই enable, যখন এই প্রোব PASS |

### MCP (JSON-RPC 2.0)

| ধাপ | method |
|---|---|
| ১ | `initialize` |
| ২ | `notifications/initialized` |
| ৩ | `tools/list` |
| ৪ | `tools/call` |

modern (`2025-03-26`) ও legacy (`2024-11-05`) — দুই protocol era-তেই `initialize` probe হয়। `tools/list` পর্যন্ত read-only; `tools/call` শুধু ব্যবহারকারী/এজেন্ট নির্দিষ্ট tool দিলে, কারণ tool-এর side effect থাকতে পারে। ফলাফল `.zombiecoder/mcp.json`-এ; ব্যর্থ হলে `NOT_CONFIGURED`/`NOT_TESTED`, কখনো "সফল" নয়।

## ২. ছয়টি লুপ

| # | Trigger | বিদ্যমান যন্ত্রাংশ | আমাদের জোড়া | আউটপুট |
|---|---|---|---|---|
| ১ | ডিরেক্টরি খোলা / বদল | `ctx.location` (built-in), `location-watcher` | working root নিশ্চিত করা | `.zombiecoder/` |
| ২ | ফাইল বদল (debounce ~২ সে.) | `config.watcher`, `glob`/`grep`/`read_file` | স্ক্যান → SSOT রিরাইট | `SSOT.md` |
| ৩ | অজানা প্রজেক্ট | `read_ssot`, `list_directory`, logs | footprint → syllabus append | `syllabus.md` |
| ৪ | প্রতিটি টার্ন | `session_message`, `event`, `ctx.storage` | context assembler → slice | prompt প্রসঙ্গ |
| ৫ | প্রয়োজন হলে | `ctx.skill` (`add`/`remove`/`reload`) | workstation ⇄ project দুই স্তর | skill install |
| ৬ | মডেল কল | `provider`, `catalog` | fallback resolver | resolved model |

## ৩. Model Fallback Resolver

```text
১) hardcode:  opencode/big-pickle            (cost 0/0, active — verified)
২) কাস্টম প্রোভাইডার নিজের baseURL live probe-এ সাড়া দিলে: missionbarisal/llama3-groq-tool-use:8b
৩) না হলে:  /api/model → cost[0].input == 0 && output == 0  (বর্তমানে ১০টি)
৪) ম্যাপিং:  agent id → stable hash → নির্দিষ্ট ফ্রি মডেল
৫) ব্যর্থ হলে: rotation → পরের ফ্রি মডেল; কখনো hard-fail নয়
৬) ফলাফল cache:  .zombiecoder/models.json (+ .zombiecoder/config.json-এ strategy)
```

ডিফল্ট deterministic — random হলে একই agent প্রতিবার ভিন্ন মডেলে চলে এবং "কেন এই উত্তর এল" ফেরানো যায় না।
তবে মালিক চাইলে config-এ `"modelStrategy": "random"` দিয়ে random mapping চালু করতে পারেন।

## ৪. প্লাগইন surface — যা নতুন সার্ভার বানানো ঠেকায়

| ক্ষমতা | ব্যবহার |
|---|---|
| `ctx.location` | বর্তমান ডিরেক্টরি — built-in, watcher লাগে না |
| `ctx.storage` (`get`/`set`/`remove`/`scan`) | memory ও state (DB-backed) |
| `ctx.session.hook` | `context`, `compaction`, `http.request`, `http.response` |
| `ctx.skill` (`list`/`add`/`reload`) | workstation-tier skill register; project-tier `.opencode/skills/` OpenCode নিজেই পড়ে |
| `ctx.rpc.register` | প্লাগইনের নিজের endpoint — "ছোট সার্ভার" এখানেই |
| `ctx.tool` (`transform`/`list`/`reload`) | প্লাগইনের নিজের টুল, `zombiecoder` namespace-এ |
| `ctx.agent` (`reload`) + `.opencode/agents/*.md` | agent-এর **ফাইলই** আসল door: frontmatter-এ model, body-তে shared rules |
| `ctx.mcp` / `opencode.json` `mcp.servers` | MCP server নিবন্ধন (শুধু probe-verified URL) |

## ৫. Install / Bootstrap

- প্লাগইন ফোল্ডার **যেকোনো লোকেশনে** থাকতে পারে — কোনো absolute path বা symlink নির্ভরতা নেই।
- চালু হলে generator OS-এর স্ট্যান্ডার্ড রুটে `.opencode` তৈরি করে নেয়, তারপর ভিতরের ফাইলগুলো।
- `.opencode` না থাকলে: নিজে তৈরি → package manifest → dependency install → config → provider/MCP merge → agent md → `.zombiecoder`।
- বিদ্যমান ফাইল **কখনো নীরব overwrite নয়**: merge করে রাখা হয়, লেখা atomic (temp → rename), কোনো `.bak`/archive নয়।
- provider/mcp URL না মিললে কিছুই ভাঙে না — শুধু `NOT_CONFIGURED` লেখা থাকে, আর OpenCode-এর ডিফল্ট মডেল আমাদের agent/persona/meta নিয়ে কাজ চালিয়ে যায়।

## ৬. কেন এই ফাইল আগে ছিল না

আগের খসড়া `Agent Architecture.md` ছিল ৮৬২ লাইন, যার পুরো দ্বিতীয়ার্ধ ছিল প্রথমার্ধের হুবহু কপি (এক লাইন টাইপো ছাড়া),
আর ভেতরে মিশে ছিল চ্যাটের অবশিষ্টাংশ (`এটাই তোর পরের ধাপ`, `এখন তোর সিস্টেম হচ্ছে`)।
আসল রোগটা স্পষ্ট: **persona, ethics আর runtime spec এক ফাইলে মেশানো ছিল**। তাই এখন তিনটি আলাদা:

| ফাইল | এক লাইনে |
|---|---|
| `Identity Specification.md` | কে আমরা — DNA ও পরিচয় |
| `Agent Architecture.md` | কারা কাজ করে — রোল ও orchestration |
| `Persona & Ethics.md` | কীভাবে চলে — আচরণের নিয়ম |
| `Runtime Operations.md` | কী দিয়ে চলে — জোড়া দেওয়ার কারিগরি |
---

**ZombieCoder** — যেখানে কোড ও কথা বলে

- Generated by: `zombiecoder-docs-generator`
- Generated at: 2026-10-19T15:04:02.267Z
- Source of truth: `Plugins/src/*.ts` (this markdown is a build artifact)
- Owner: Sahon Srabon (Developer Zone), Dhaka, Bangladesh
- License: Proprietary - Local Freedom Protocol
