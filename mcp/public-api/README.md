# public-api MCP

রিয়েল-টাইম পাবলিক ডেটা, কোনো API key ছাড়া: Wikipedia, Wikimedia feeds, আবহাওয়া,
এক্সচেঞ্জ রেট, দেশের তথ্য আর QR PNG — একটাই local stdio MCP server
(`server.mjs`, শূন্য npm dependency)।

## Tools (৮টি)

| Tool | কী দেয় | উৎস |
|---|---|---|
| `wiki_search` | শিরোনাম, snippet, article URL | Wikipedia API |
| `wiki_page` | description, extract, thumbnail, canonical URL | Wikipedia REST |
| `wiki_onthisday` | ওই দিনের ঐতিহাসিক ঘটনা (default আজ, UTC) | Wikimedia feed |
| `wiki_featured` | আজকের featured article + picture of the day (license/artist/file page সহ) | Wikimedia feed |
| `weather` | current + daily forecast, WMO condition টেক্সটসহ | Open-Meteo |
| `currency` | live exchange rate; `to` না দিলে পুরো টেবিল | open.er-api.com |
| `country` | capital, currency, flag URL | countriesnow.space |
| `qr` | নির্দিষ্ট pixel size-এ QR PNG + sidecar | api.qrserver.com |

সব output-এ `ok`, `source` আর (যেখানে প্রযোজ্য) timestamp থাকে, তাই agent জানে
কোন ডেটা কতটা তাজা।

## উদাহরণ

```jsonc
// wiki_search
{ "query": "tea garden", "lang": "en", "limit": 3 }

// wiki_featured — ছবির license/artist সহ
{ "date": "2026-10-31" }

// weather
{ "latitude": 23.8103, "longitude": 90.4125, "days": 3 }

// currency
{ "from": "USD", "to": "BDT" }

// qr — project-এর assets ফোল্ডারে সরাসরি
{ "data": "https://example.com/product/42", "size": 512, "output_dir": "assets/qr" }
```

## Image delivery

ছবি নামানো → নির্দিষ্ট সাইজে crop — সেটার জন্য আলাদা `image-brand` MCP আছে:
`image_search` (PD/CC0) → `image_fetch` → `image_fit` (`width`×`height`, cover/contain)।
`public-api` ডেটা দেয়, `image-brand` ছবি ডেলিভার করে — দুটো আলাদা রাখা হয়েছে যাতে
একটা সোর্সfail করলে অন্যটা না পড়ে।

## চালানো

```bash
node mcp/public-api/server.mjs       # stdio MCP
node mcp/public-api/selfcheck.mjs    # live: ৮টি tool সত্যিই উত্তর দেয় কি না
node --test mcp/public-api/test/*.test.mjs
```

Expected শেষ লাইন: `tools=8 live=ok`।

## নিবন্ধন

Repo clone থেকে installer চালালে `mcp/` install root-এ কপি হয় এবং
`opencode.json`-এর `mcp.servers.public-api` নিজে থেকেই বসে (absolute path)।
হাতে করতে চাইলে:

```jsonc
{
  "mcp": {
    "servers": {
      "public-api": { "type": "local", "command": ["node", "/abs/path/mcp/public-api/server.mjs"] }
    }
  }
}
```

## সীমা ও নীতি

- প্রতিটি adapter-এর host কোডে fixed; caller কোনো URL দিতে পারে না — SSRF surface নেই।
- Wikipedia লেখা CC BY-SA 4.0; পুনঃপ্রকাশে attribution লাগবে (`wiki_page` সে কথা বলে)।
- Wikimedia feed-এর ছবি PD/CC0 নাও হতে পারে; `license`/`license_code` দেখে সিদ্ধান্ত নাও।
- REST Countries v3.1 deprecated (`success:false`), তাই বাদ; Frankfurter-এ BDT নেই
  (404), তাই open.er-api ব্যবহার করা হয়।
- `qr` শুধু `data`-র sha256 sidecar-এ রাখে, data নিজে নয় — secret leak কমাতে।
- কোনো LLM নেই, কোনো key নেই; ২০ সেকেন্ড timeout, ৬০ সেকেন্ড currency cache,
  ১০ মিনিট country cache।
