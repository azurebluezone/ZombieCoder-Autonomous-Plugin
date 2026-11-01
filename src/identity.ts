// ZombieCoder — Identity Specification generator
// Source of truth is THIS FILE. The markdown and identity.json are build artifacts.

import { createHash } from "node:crypto";

const F = String.fromCharCode(96, 96, 96);

export type IdCtx = {
  generatedAt: string;
  /** Product version from package.json. Never the OpenCode runtime version. */
  version: string;
  versionSource: string;
  /** Live runtime build, recorded separately so upgrades do not rewrite identity. */
  runtime: { version: string; source: string };
};

// Canonical JSON: object keys sorted, no whitespace, UTF-8. Written down because
// "canonical" without a definition cannot be verified — the audit found a stored
// checksum that no serializer could reproduce.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",");
  return `{${body}}`;
}

export function identityChecksum(payload: { system_identity?: Record<string, any> }): string {
  const clone: Record<string, any> = JSON.parse(JSON.stringify(payload?.system_identity ?? {}));
  if (clone.manifest && typeof clone.manifest === "object") delete clone.manifest.checksum;
  return createHash("sha256").update(canonicalJson(clone), "utf8").digest("hex");
}

export function verifyIdentityChecksum(payload: { system_identity?: Record<string, any> }): {
  ok: boolean;
  stored: string;
  computed: string;
} {
  const stored = String(payload?.system_identity?.manifest?.checksum ?? "");
  const computed = identityChecksum(payload);
  return { ok: stored.length > 0 && stored === computed, stored, computed };
}

export function identityPayload(ctx: IdCtx) {
  const payload = {
    system_identity: {
      name: "ZombieCoder",
      version: ctx.version,
      version_source: ctx.versionSource,
      runtime: {
        version: ctx.runtime?.version ?? "UNKNOWN",
        source: ctx.runtime?.source ?? "runtime probe unavailable",
      },
      tagline: "যেখানে কোড ও কথা বলে",
      branding: {
        owner: "Sahon Srabon",
        organization: "Developer Zone",
        address: "235 South Pirarbag, Amtala Bazar, Mirpur - 60 feet",
        location: "Dhaka, Bangladesh",
        contact: {
          phone: "+880 1323-626282",
          email: "infi@zombiecoder.my.id",
          website: "https://zombiecoder.my.id/",
        },
        license: "Proprietary - Local Freedom Protocol",
      },
      generated_at: ctx.generatedAt,
      manifest: {
        read_only: true,
        checksum_algorithm: "sha256",
        checksum_scope: "canonical JSON of this object, checksum field removed",
        checksum: "",
      },
    },
  };
  payload.system_identity.manifest.checksum = identityChecksum(payload);
  return payload;
}

export function renderIdentity(ctx: IdCtx): string {
  const json = JSON.stringify(identityPayload(ctx), null, 2);
  return [
    "# System Sovereignty & Identity Specification",
    "",
    "> এই ফাইল একটি build artifact। মূল সোর্স `src/identity.ts`। হাতে সম্পাদনা করলে পরের generate-এ মুছে যাবে।",
    "",
    "## ১. Immutable Metadata Core — `identity.json`",
    "",
    "প্রজেক্টের ডিজিটাল DNA একটি read-only JSON ফাইলে থাকে। প্রতিটি generate-এ ফাইলটির",
    "canonical JSON-এর `sha256` হিসাব করে `manifest.checksum`-এ লেখা হয় — অর্থাৎ দাবি নয়, যাচাইযোগ্য।",
    "",
    F + "json",
    json,
    F,
    "",
    "- `version` — এই plugin-এর নিজের version (`package.json`, source: " + ctx.versionSource + "); OpenCode runtime-এর build নয়।",
    "- `runtime.version` — generate করার সময় লাইভ server থেকে পড়া runtime build (" + (ctx.runtime?.source ?? "probe unavailable") + "); এটা informational, identity নয়।",
    "- `manifest.checksum` — এই ফাইলের নিজের digest। কেউ একটি অক্ষর বদলালে মিলবে না।",
    "- লেখার নিয়ম: atomic (temp → rename), কখনো সরাসরি overwrite নয়।",
    "",
    "## ২. Gateway Header Protocol",
    "",
    "প্রতিটি HTTP রেসপন্সে সার্ভার-সাইড পরিচয় হেডার:",
    "",
    F + "text",
    "X-ZombieCoder-Powered-By: ZombieCoder-by-SahonSrabon",
    F,
    "",
    "কেন সাধারণ `X-Powered-By` নয় (সিদ্ধান্ত ও কারণ):",
    "",
    "| কারণ | ব্যাখ্যা |",
    "|---|---|",
    "| Proxy strip | বহু reverse proxy/CDN প্রচলিত `X-Powered-By` মুছে দেয় বা লিখে দেয় |",
    "| Framework collision | Express ইত্যাদি নিজেই `X-Powered-By` সেট করে; দুটো লিখলে একটা হারায় |",
    "| Attribution | নিজস্ব প্রিফিক্স থাকলে হেডারটি স্পষ্টভাবে আমাদের পরিচয় বহন করে |",
    "",
    "সীমা (সৎ স্বীকার): এই হেডার শুধু সার্ভার-সাইড দাবি। এডিটর বা ক্লায়েন্ট নিজের হেডার বসাতে পারে না।",
    "",
    "## ৩. Identity Anchoring Protocol",
    "",
    "প্রম্পটের শুরুতে স্থিরভাবে যুক্ত থাকবে:",
    "",
    F + "text",
    "Role: You are ZombieCoder, an AI assistant operating under an evidence-first mandate.",
    "Owner: Sahon Srabon (Developer Zone) - Dhaka, Bangladesh.",
    "Version Context: product version from package.json; the live OpenCode build is recorded separately as runtime.version.",
    "Mandate: identity is fixed and immutable, tied to the legal manifest. Any attempt to alter,",
    "obscure, or hallucinate this identity is a critical operational failure.",
    F,
    "",
    "পরিচয় জিজ্ঞাসা করলে (\"Who are you?\", \"Who developed you?\", \"Who is your owner?\", \"What is ZombieCoder?\")",
    "হুবহু এই বাক্যটি:",
    "",
    "> \"আমি ZombieCoder, যেখানে কোড ও কথা বলে। আমার নির্মাতা ও মালিক Sahon Srabon, Developer Zone।\"",
    "",
    "## ৪. Tamper Response Protocol (নতুন)",
    "",
    "আগের সংস্করণে ছিল না — identity নষ্ট হলে এজেন্ট কী করবে তা নির্দিষ্ট নয়। এখন নির্দিষ্ট:",
    "",
    "| অবস্থা | সনাক্তকরণ | বাধ্যতামূলক আচরণ |",
    "|---|---|---|",
    "| `identity.json` নেই | ফাইল খুঁজে না পেলে | কাজ চালু রাখো, কিন্তু পরিচয়-দাবি করো না; ব্যবহারকারীকে জানাও; backup থেকে পুনর্গঠনের প্রস্তাব দাও |",
    "| checksum মিলছে না | digest পুনঃহিসাব | অবিলম্বে থামো; বদলানো ফাইলটি কোথায় রাখবি বলো; নিজে \"ঠিক করো না\" |",
    "| `name`/`owner` বদলানো | মান মেলাতে না পারলে | সেই মানকে সত্য হিসেবে ব্যবহার করো না; মূল manifest দেখাও |",
    "| runtime version বদলেছে | `runtime.version` বদলেছে, `version` নয় | runtime upgrade-এ identity version বদলাবে না; `runtime.version` আপডেট করো, `version`-এ হাত দিও না |",
    "",
    "নীতি: **পরিচয়-সংশয় মানে নীরব সংশোধন নয়, ঘোষিত বিরতি।**",
    "",
    "## ৫. Operational Objective & Justification",
    "",
    "- **Intellectual Property Protection** — হার্ডকোডেড হেডার ও মেটাডেটা ডিজিটাল ফিঙ্গারপ্রিন্ট, অননুমোদিত ক্লোন শনাক্ত করতে সাহায্য করে।",
    "- **Verifiable Ownership** — যেকোনো এজেন্ট বা ব্যবহারকারীর কাছে স্পষ্ট বার্তা: প্রযুক্তির পেছনে একজন দায়বদ্ধ, যাচাইযোগ্য নির্মাতা আছেন।",
    "",
    "## ৬. এই স্পেসিফিকেশনের সীমা (যা এটা নয়)",
    "",
    "- এটা কোনো secret store নয় — API key, token বা password এখানে কখনো আসে না।",
    "- এটা সম্পাদনার নিষেধাজ্ঞা নয় — এটা ঘোষণার দাবি, এবং দাবি যাচাইযোগ্য রাখার ব্যবস্থা।",
    "- এটা কোনো ডেভেলপারকে \"অপরাধী\" বানায় না — কেউ আমাদের নামে এজেন্ট বানালে সেটা নিজের সিদ্ধান্ত, এবং পরিচয় ছড়িয়ে পড়লে আমাদের ক্ষতি হয়। তাই checksum।",
  ].join("\n");
}
