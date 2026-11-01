# image-brand MCP

ছবি খোঁজা → নামানো → crop → বাংলা title/logo বসিয়ে branded output — সব deterministic,
কোনো LLM বা API key নেই। একটি local stdio MCP server (`server.mjs`) + Pillow pipeline
(`pipeline.py`)।

## Tools

| Tool | কাজ |
|---|---|
| `image_search` | Met (PD), Cleveland (CC0), NASA (PD), Wikimedia Commons (PD/CC0 filter) — licence, creator, source page সহ |
| `image_fetch` | একটি image URL নামিয়ে sha256 + licence sidecar লেখে; https ছাড়া/private host বন্ধ |
| `image_brand` | cover-crop (aspect+focus বা normalized rect), bottom band, বাংলা title/subtitle, PNG logo/wordmark, attribution, JSON sidecar |
| `image_fit` | নির্দিষ্ট `width`×`height`-এ clean output (কোনো text নয়): `cover` (ধার কাটে) বা `contain` (background pad), JPEG/PNG/WebP + sidecar |
| `image_batch` | একাধিক item-এ `image_brand`, শেষে batch manifest |
| `web_decorate` | ecommerce / hospital / LMS / generic সাইটের জন্য ছোট কিন্তু আসল pack: site-নামের logo PNG, hero, OG, card image, `index.html`, `styles.css`, `decorate.json` (প্রতিটি ফাইলের sha256) |

`image_search`-এ `provider: "auto" | "met" | "cleveland" | "nasa" | "commons"`, `limit` 1–12।

## License policy

ডিফল্টে **শুধু PD/CC0**। `CC BY`, `CC BY-SA`, `GFDL` result বাদ পড়ে — branding একটি
derivative, আর CC BY-SA-এর share-alike বাধ্যবাধকতা client কাজে বিপজ্জনক। প্রতিটি
download-এর পাশে `.json` sidecar থাকে: `source_url`, `license`, `creator`, `sha256`,
`fetched_at`। Branded output-এর sidecar-এ `provider`, `source_page`, `license`,
`crop_box`, `fonts`, `raqm`, `output_sha256` থাকে — attribution না হারানোর জন্য।

## বাংলা লেখা

- Pillow অবশ্যই **raqm** সহ compiled হতে হবে; না হলে conjunct ভাঙবে। Pipeline sidecar-এ
  `fonts.raqm` লেখে, আর selfcheck `raqm=false` হলে fail করে।
- **Noto Sans Bengali-তে Latin glyph নেই** (মাঝের ডটও নেই)। তাই text script-run অনুযায়ী
  ভাগ হয়ে Bengali font + DejaVu Sans-এ আঁকা হয়; এক ফন্টে `draw.text` করলে tofu আসে।
- Word gap আলাদা করে বসানো হয়, কারণ Raqm-এ whitespace-only run-এর advance `0`।
- Font override: `IMAGE_BRAND_BN_FONT`, `IMAGE_BRAND_BN_FONT_REGULAR`,
  `IMAGE_BRAND_LATIN_FONT`, `IMAGE_BRAND_LATIN_FONT_REGULAR`।
- Title auto-wrap (max 2 lines) + shrink-to-fit; subtitle আলাদা; attribution নিচে।

## Crop ও branding

`crop.aspect` (যেমন `"4:5"`, `"1:1"`, `"16:9"`) + `crop.focus` (`center`, `top`,
`bottom`, `left`, `right`, চার কোণ) অথবা `crop.rect: [x, y, w, h]` (0–1 normalized)।
`canvas.width` না দিলে 1080; height aspect থেকে। `logo` PNG path; না দিলে text wordmark
(`theme.brand`, default `ZombieCoder`)। Band height/opacity/colors `theme`-এ override করা যায়।

## নির্দিষ্ট সাইজ (image_fit)

Product slide, OG card, thumbnail বা logo canvas-এর জন্য text ছাড়া exact-size crop:

```jsonc
{
  "input": "/path/photo.jpg",
  "output": "assets/cards/product-42.jpg",
  "width": 1200, "height": 630,
  "fit": "cover",                 // cover = ভরাট করে ধার কাটে; contain = পুরো ছবি + background pad
  "background": "#0b1220",        // contain-এ ব্যবহৃত
  "format": "jpg",                // jpg | png | webp
  "crop": { "aspect": "16:9", "focus": "top" }   // ঐচ্ছিক, তারপর fit
}
```

Output sidecar-এ `op: "fit"`, `width`, `height`, `fit`, `crop_box`, `source_sha256`,
`output_sha256` থাকে — কোন ছবি থেকে কীভাবে কী সাইজে এসেছে তা পরে যাচাই করা যায়।
`fit=cover` pixel dimension guarantee করে; `contain` letterbox/pillarbox দেয়।

## সাইট decoration (web_decorate)

`image_search` → `image_fetch` → `web_decorate` — এই ক্রমে চালান। শেষ ধাপে আসল ফাইল
লেখা হয়; কোনো model call নেই। `site` চারটি profile-এর একটি বেছে দেয় (card copy,
accent, layout), `brand` থেকে slug আর `<slug>-logo.png` তৈরি হয়।

```jsonc
{
  "site": "hospital",                       // ecommerce | hospital | lms | generic
  "brand": "Shohor Clinic",
  "headline": "প্রতিদিনের যত্ন, কাছেই",
  "subheadline": "একই ছাদের নিচে বিভাগ, ল্যাব ও অ্যাপয়েন্টমেন্ট।",
  "kicker": "ঢাকা · ২৪/৭",
  "accent": "#0f766e",
  "logo": "/path/logo.png",                 // ঐচ্ছিক; না দিলে wordmark PNG
  "images": ["/path/hero.jpg", "/path/card.jpg"],  // প্রথমটি hero, বাকিগুলো card
  "cards": [                                // ঐচ্ছিক; না দিলে site profile
    { "title": "কার্ডিওলজি", "body": "সকাল ৯টা–রাত ৮টা", "meta": "৩য় তলা" }
  ],
  "data": { "wiki": "Dhaka", "country": "Bangladesh" },  // ঐচ্ছিক, live public API
  "output_dir": "sites/shohor-clinic"
}
```

লেখা ফাইল:

| File | কী |
|---|---|
| `index.html` | responsive page; loading/empty/error/success state, skip link, `:focus-visible`, lazy image |
| `styles.css` | profile + accent থেকে tokenized CSS |
| `<slug>-logo.png` | site-নামের logo (provided PNG resize বা wordmark) |
| `hero.jpg`, `og.jpg` | hero (1600×900) আর Open Graph (1200×630) |
| `card-1.jpg` … | প্রথম ৩টি input image থেকে card crop |
| `decorate.json` | `tool`, `site`, `brand`, `files`, `hashes` (sha256), input image hashes, `data`, `data_errors`, `license_note` |

`data.wiki` / `data.country` দিলে Wikipedia summary আর capital/currency/flag আনা হয়;
API fail করলে output তৈরি হয় এবং failure `data_errors`-এ সত্যি করে লেখা থাকে — fake
fact বসানো হয় না। Wikipedia text CC BY-SA 4.0, page-এ source link থাকে; input ছবির
licence তার নিজের sidecar-এ থাকে। Manifest-এর `hashes` দিয়ে পরে যাচাই করা যায় কোন
ফাইল আসলে তৈরি হয়েছিল।

## চালানো

```bash
node mcp/image-brand/server.mjs          # stdio MCP
node mcp/image-brand/selfcheck.mjs       # offline: tools/list + fixture branding + logo + hospital site
node mcp/image-brand/e2e-live.mjs        # live: Met search → fetch → brand
node --test mcp/image-brand/test/*.test.mjs
npm run e2e:modules                      # installed OpenCode + both MCP servers + design + skills + LSP
```

OpenCode-এ connect (project config, repo root):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "image-brand": {
        "type": "local",
        "command": ["node", "mcp/image-brand/server.mjs"],
        "cwd": "."
      }
    }
  }
}
```

অন্য project-এ global করতে:

```bash
opencode mcp add image-brand --global -- node "$PWD/mcp/image-brand/server.mjs"
opencode mcp list
```

Config save করলেই OpenCode MCP server reload করে — restart লাগে না। Code Mode-এ tools
`tools.image_brand.*` নামে আসে।

## Security boundaries

- শুধু `https`; `localhost`, `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`,
  `100.64/10`, `::1`, `fc00::/7`, `fe80::/10` block; redirect-এর final host-ও যাচাই।
- Content-type `image/jpeg|png|webp`; সর্বোচ্চ 30 MB; fetch timeout 90 s; render 120 s।
- Download/branded output default: `~/.local/share/zombie-image-brand`
  (`IMAGE_BRAND_DIR` override); `output`/`output_dir` দিলে সেটাই।
- Logo SVG এখন সমর্থিত নয় — environment-এ rsvg/cairosvg নেই। PNG দিন।

## সীমা (সত্যি অবস্থা)

- `OPENVERSE`, Art Institute, Library of Congress probe-এ blocked/timeout — তাই যোগ করা হয়নি।
- CC BY/CC BY-SA search result ইচ্ছা করে বাদ; দরকার হলে আলাদা policy decision।
- User-এর আসল logo PNG এখনো পাওয়া যায়নি; fixture logo দিয়ে overlay path যাচাই হয়েছে।
- Batch sequential; 20 item cap; parallel download এখন নেই।
- NASA image public domain, তবে third-party material থাকতে পারে — sidecar-এ সতর্কতা লেখা থাকে।
