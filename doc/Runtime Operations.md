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

modern ও legacy — দুই protocol era-তেই probe হয়। কোনো ধাপ ব্যর্থ হলে সেটি `NOT_CONFIGURED`/`NOT_TESTED` লেখা হয়, কখনো "সফল" নয়।

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
২) কাস্টম প্রোভাইডার সাড়া দিলে:  zombiecoder/llama3-groq-tool-use:8b
৩) না হলে:  /api/model → cost[0].input == 0 && output == 0  (বর্তমানে ১০টি)
৪) ম্যাপিং:  agent id → stable hash → নির্দিষ্ট ফ্রি মডেল
৫) ব্যর্থ হলে: rotation → পরের ফ্রি মডেল; কখনো hard-fail নয়
৬) ফলাফল cache:  .zombiecoder/config.json
```

কেন random নয়: random হলে একই agent প্রতিবার ভিন্ন মডেলে চলে, উত্তরের মান বদলায়, আর পরে "কেন এই উত্তর এল" ফেরানো যায় না।
stable mapping reproducibility রাখে, আর rotation failure সামলায় — দুটোই পাওয়া যায়।

## ৪. প্লাগইন surface — যা নতুন সার্ভার বানানো ঠেকায়

| ক্ষমতা | ব্যবহার |
|---|---|
| `ctx.location` | বর্তমান ডিরেক্টরি — built-in, watcher লাগে না |
| `ctx.storage` (`get`/`set`/`remove`/`scan`) | memory ও state (DB-backed) |
| `ctx.session.hook` | `context`, `compaction`, `http.request`, `http.response` |
| `ctx.skill` (`list`/`add`/`update`/`remove`/`reload`) | দুটি স্তরের skill ব্যবস্থাপনা |
| `ctx.rpc.register` | প্লাগইনের নিজের endpoint — "ছোট সার্ভার" এখানেই |
| `ctx.tool` | প্লাগইনের নিজের টুল |
| `ctx.agent` | agent নিবন্ধন |
| `ctx.mcp` | MCP server নিবন্ধন |

## ৫. Install / Bootstrap

- প্লাগইন ফোল্ডার **যেকোনো লোকেশনে** থাকতে পারে — কোনো absolute path বা symlink নির্ভরতা নেই।
- চালু হলে generator OS-এর স্ট্যান্ডার্ড রুটে `.opencode` তৈরি করে নেয়, তারপর ভিতরের ফাইলগুলো।
- `.opencode` না থাকলে: নিজে তৈরি → package manifest → dependency install → config → agent md → `.zombiecoder`।
- বিদ্যমান ফাইল **কখনো নীরব overwrite নয়**: backup → temp → rename।
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
- Generated at: 2026-10-19T10:44:27.618Z
- Source of truth: `Plugins/src/*.ts` (this markdown is a build artifact)
- Owner: Sahon Srabon (Developer Zone), Dhaka, Bangladesh
- License: Proprietary - Local Freedom Protocol
