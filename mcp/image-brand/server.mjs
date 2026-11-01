#!/usr/bin/env node
/**
 * image-brand MCP server (stdio, zero npm dependencies).
 *
 * Search keeps only public-domain / CC0 records by default: branded derivatives
 * of CC BY-SA photos inherit share-alike obligations, which is a bad default for
 * client work. Every download gets a sidecar so the licence travels with the file.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE = path.join(HERE, "pipeline.py");
const VERSION = "1.1.0";
const DEFAULT_OUT = process.env.IMAGE_BRAND_DIR || path.join(os.homedir(), ".local", "share", "zombie-image-brand");
const MAX_BYTES = 30 * 1024 * 1024;
const UA = `image-brand-mcp/${VERSION} (local; +https://opencode.ai)`;

export const TOOLS = [
  {
    name: "image_search",
    description:
      "Search public-domain/CC0 image sources without API keys: Met Museum, Cleveland Museum of Art, NASA, and Wikimedia Commons filtered to PD/CC0. Returns licence, creator and source page for every hit. CC BY / CC BY-SA results are rejected by design.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        provider: { type: "string", enum: ["auto", "met", "cleveland", "nasa", "commons"], default: "auto" },
        limit: { type: "number", minimum: 1, maximum: 12, default: 6 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "image_fetch",
    description:
      "Download one image URL from a search hit, verify it is an image under 30 MB, and write a licence/provenance sidecar next to it. http, localhost and private addresses are refused.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        creator: { type: "string" },
        license: { type: "string" },
        page: { type: "string" },
        provider: { type: "string" },
        output_dir: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "image_brand",
    description:
      "Compose a branded JPEG/PNG: cover-crop (aspect + focus, or normalized rect), bottom scrim, Bengali-safe title/subtitle with per-script font fallback, PNG logo or wordmark, attribution line, and a JSON sidecar. No model is called.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string" },
        output: { type: "string" },
        title: { type: "string" },
        subtitle: { type: "string" },
        attribution: { type: "string" },
        logo: { type: "string" },
        crop: {
          type: "object",
          properties: {
            aspect: { type: "string", default: "4:5" },
            focus: {
              type: "string",
              enum: ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
              default: "center",
            },
            rect: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
          },
          additionalProperties: false,
        },
        canvas: {
          type: "object",
          properties: { width: { type: "number" }, height: { type: "number" } },
          additionalProperties: false,
        },
        quality: { type: "number", minimum: 60, maximum: 100, default: 92 },
        source: { type: "object" },
      },
      required: ["input", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "image_fit",
    description:
      "Produce an exact-size delivery image with no text: cover (fill and crop edges) or contain (pad with a background colour), optional crop rect/aspect, JPEG/PNG/WebP output and a sidecar. Use for product slides, OG cards, thumbnails and logo canvases.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string" },
        output: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        fit: { type: "string", enum: ["cover", "contain"], default: "cover" },
        background: { type: "string", default: "#000000" },
        format: { type: "string", enum: ["jpg", "png", "webp"] },
        quality: { type: "number", minimum: 60, maximum: 100, default: 92 },
        crop: {
          type: "object",
          properties: {
            aspect: { type: "string" },
            focus: {
              type: "string",
              enum: ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
              default: "center",
            },
            rect: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
          },
          additionalProperties: false,
        },
        source: { type: "object" },
      },
      required: ["input", "width", "height"],
      additionalProperties: false,
    },
  },
  {
    name: "image_batch",
    description: "Run image_brand over a list of items and write one batch manifest JSON. Each item takes the same fields as image_brand.",
    inputSchema: {
      type: "object",
      properties: {
        items: { type: "array", minItems: 1, maxItems: 20, items: { type: "object" } },
        output_dir: { type: "string" },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "web_decorate",
    description:
      "Build a small, real site decoration pack for ecommerce, hospital, LMS or generic sites: <site>-named logo PNG, hero, OG card, card images, index.html, styles.css and decorate.json. Optional data.wiki / data.country pulls live public-API facts with source URLs. Use image_search → image_fetch → web_decorate; no model is called. Every generated file has a sha256 in the manifest.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string", enum: ["ecommerce", "hospital", "lms", "generic"] },
        brand: { type: "string", minLength: 1 },
        headline: { type: "string", minLength: 1 },
        subheadline: { type: "string" },
        kicker: { type: "string" },
        accent: { type: "string", default: "#e6b43c" },
        logo: { type: "string", description: "Optional PNG logo; otherwise a wordmark named <slug>-logo.png is generated." },
        images: { type: "array", maxItems: 4, items: { type: "string" }, description: "Local image paths. First is hero; next three become card images." },
        cards: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "string" }, meta: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
        data: {
          type: "object",
          properties: {
            wiki: { type: "string", description: "Wikipedia page title, e.g. Dhaka." },
            wiki_lang: { type: "string", default: "en" },
            country: { type: "string", description: "Country name for capital/currency/flag facts." },
          },
          additionalProperties: false,
        },
        output_dir: { type: "string" },
      },
      required: ["site", "brand", "headline"],
      additionalProperties: false,
    },
  },
];

export function parseAspect(value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(value ?? ""));
  if (!match) throw new Error(`aspect must look like W:H, got ${JSON.stringify(value)}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) throw new Error("aspect sides must be positive");
  return width / height;
}

export function focusOffsets(focus = "center") {
  const table = {
    center: [0.5, 0.5],
    top: [0.5, 0],
    bottom: [0.5, 1],
    left: [0, 0.5],
    right: [1, 0.5],
    "top-left": [0, 0],
    "top-right": [1, 0],
    "bottom-left": [0, 1],
    "bottom-right": [1, 1],
  };
  if (!table[focus]) throw new Error(`unknown focus ${JSON.stringify(focus)}`);
  return table[focus];
}

export function pickCropBox(width, height, aspect, focus = "center") {
  const ratio = parseAspect(aspect);
  const [fx, fy] = focusOffsets(focus);
  if (width / height > ratio) {
    const cropW = Math.round(height * ratio);
    return [Math.round((width - cropW) * fx), 0, Math.round((width - cropW) * fx) + cropW, height];
  }
  const cropH = Math.round(width / ratio);
  return [0, Math.round((height - cropH) * fy), width, Math.round((height - cropH) * fy) + cropH];
}

export function filterLicense(license) {
  const text = String(license ?? "").toLowerCase();
  if (!text) return false;
  if (/(^|\b)cc[ -]?by([ -]|$)|attribution|share[ -]?alike|gfdl|fal/.test(text)) return false;
  return /(^|\b)(cc0|public domain|pd|no known copyright|no restrictions)/.test(text);
}

export function isPrivateHost(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const family = net.isIP(host);
  if (family === 4) {
    const [a, b] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (family === 6) {
    if (host === "::1" || host === "::") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    if (host.startsWith("::ffff:")) return isPrivateHost(host.slice(7));
  }
  return false;
}

export function validateImageUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error("url must be an absolute http(s) URL");
  }
  if (url.protocol !== "https:") throw new Error("only https image URLs are allowed");
  if (isPrivateHost(url.hostname)) throw new Error("private/localhost URLs are not allowed");
  return url;
}

function cleanHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url, timeout = 20000) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.json();
}

export function normalizeCommons(page) {
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const license = cleanHtml(meta.LicenseShortName?.value);
  if (!filterLicense(license)) return null;
  return {
    id: String(page.pageid),
    provider: "commons",
    title: cleanHtml(String(page.title ?? "").replace(/^File:/, "")),
    creator: cleanHtml(meta.Artist?.value) || "Unknown",
    license,
    license_url: cleanHtml(meta.LicenseUrl?.value) || null,
    image_url: info.thumburl || info.url,
    thumbnail_url: info.thumburl || info.url,
    width: info.width ?? null,
    height: info.height ?? null,
    page_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title ?? "")}`,
  };
}

export function normalizeMet(object) {
  if (!object?.isPublicDomain || !object.primaryImage) return null;
  return {
    id: String(object.objectID),
    provider: "met",
    title: cleanHtml(object.title) || "Untitled",
    creator: cleanHtml(object.artistDisplayName) || "Unknown",
    date: cleanHtml(object.objectDate) || null,
    license: "Public Domain",
    license_url: "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
    image_url: object.primaryImage,
    thumbnail_url: object.primaryImageSmall || object.primaryImage,
    width: null,
    height: null,
    page_url: object.objectURL,
  };
}

export function normalizeCleveland(artwork) {
  if (String(artwork?.share_license_status ?? "").toUpperCase() !== "CC0") return null;
  const image = artwork?.images?.web?.url || artwork?.images?.print?.url;
  if (!image) return null;
  return {
    id: String(artwork.id),
    provider: "cleveland",
    title: cleanHtml(artwork.title) || "Untitled",
    creator: cleanHtml(artwork.creators?.[0]?.description) || "Unknown",
    date: cleanHtml(artwork.creation_date) || null,
    license: "CC0",
    license_url: "https://www.clevelandart.org/open-access",
    image_url: image,
    thumbnail_url: image,
    width: artwork?.images?.web?.width ?? null,
    height: artwork?.images?.web?.height ?? null,
    page_url: artwork.url || `https://www.clevelandart.org/art/${artwork.accession_number ?? artwork.id}`,
  };
}

export function normalizeNasa(item) {
  const data = item?.data?.[0];
  const thumb = item?.links?.[0]?.href;
  if (!data || !thumb) return null;
  return {
    id: String(data.nasa_id),
    provider: "nasa",
    title: cleanHtml(data.title) || "Untitled",
    creator: cleanHtml(data.center) || "NASA",
    date: cleanHtml(data.date_created)?.slice(0, 10) || null,
    license: "NASA public domain (verify third-party material)",
    license_url: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    image_url: thumb,
    thumbnail_url: thumb,
    width: null,
    height: null,
    page_url: `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
  };
}

async function searchCommons(query, limit) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(40, Math.max(limit * 4, 12))),
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiurlwidth: "1600",
    format: "json",
    origin: "*",
  }).toString();
  const data = await fetchJson(url);
  const pages = Object.values(data?.query?.pages ?? {});
  return pages.map(normalizeCommons).filter(Boolean).slice(0, limit);
}

async function searchMet(query, limit) {
  const search = await fetchJson(
    `https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=${encodeURIComponent(query)}&hasImages=true`,
  );
  const ids = (search?.objectIDs ?? []).slice(0, Math.max(limit * 3, 9));
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const object = await fetchJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
        return normalizeMet(object);
      } catch {
        return null;
      }
    }),
  );
  return results.filter(Boolean).slice(0, limit);
}

async function searchCleveland(query, limit) {
  const data = await fetchJson(
    `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(query)}&cc0=1&limit=${Math.min(limit * 2, 24)}`,
  );
  return (data?.data ?? []).map(normalizeCleveland).filter(Boolean).slice(0, limit);
}

async function searchNasa(query, limit) {
  const data = await fetchJson(
    `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image&page_size=${Math.min(limit * 2, 20)}`,
  );
  const items = (data?.collection?.items ?? []).slice(0, limit);
  const results = [];
  for (const item of items) {
    const normalized = normalizeNasa(item);
    if (!normalized) continue;
    try {
      const asset = await fetchJson(`https://images-api.nasa.gov/asset/${encodeURIComponent(normalized.id)}`);
      const hrefs = (asset?.collection?.items ?? []).map((entry) => entry.href).filter(Boolean);
      const original = hrefs.find((href) => /~orig\.(jpe?g|png)$/i.test(href)) || hrefs.find((href) => /\.(jpe?g|png)$/i.test(href));
      if (original) normalized.image_url = original;
    } catch {
      // Keep the thumbnail URL when the asset listing is unavailable.
    }
    results.push(normalized);
  }
  return results;
}

export async function searchImages({ query, provider = "auto", limit = 6 } = {}) {
  const text = String(query ?? "").trim();
  if (!text) throw new Error("query is required");
  const count = Math.min(Math.max(Number(limit) || 6, 1), 12);
  const order = provider === "auto" ? ["met", "cleveland", "nasa", "commons"] : [provider];
  const runners = { met: searchMet, cleveland: searchCleveland, nasa: searchNasa, commons: searchCommons };
  const results = [];
  const errors = [];
  for (const name of order) {
    const runner = runners[name];
    if (!runner) throw new Error(`unknown provider ${JSON.stringify(provider)}`);
    if (results.length >= count) break;
    try {
      results.push(...(await runner(text, count - results.length)));
    } catch (error) {
      errors.push({ provider: name, error: String(error?.message ?? error) });
    }
  }
  return {
    query: text,
    provider,
    license_policy: "PD/CC0 only",
    count: results.length,
    results,
    ...(errors.length ? { provider_errors: errors } : {}),
  };
}

export async function fetchImage(input = {}) {
  const url = validateImageUrl(input.url);
  const outDir = path.resolve(input.output_dir || DEFAULT_OUT);
  await fsp.mkdir(outDir, { recursive: true });
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  if (response.url) {
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || isPrivateHost(finalUrl.hostname)) throw new Error("redirect left the public https space");
  }
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
  if (!ext) throw new Error(`unsupported content-type ${JSON.stringify(type)}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error(`image is larger than ${MAX_BYTES} bytes`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error(`image is larger than ${MAX_BYTES} bytes`);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha256.slice(0, 10)}.${ext}`);
  await fsp.writeFile(file, body);
  const sidecar = {
    ok: true,
    file,
    bytes: body.length,
    sha256,
    content_type: type,
    source_url: url.toString(),
    title: input.title ?? null,
    creator: input.creator ?? null,
    license: input.license ?? null,
    page: input.page ?? null,
    provider: input.provider ?? null,
    fetched_at: new Date().toISOString(),
  };
  const sidecarFile = file.replace(/\.[^.]+$/, ".json");
  await fsp.writeFile(sidecarFile, JSON.stringify(sidecar, null, 2) + "\n");
  return { ...sidecar, sidecar: sidecarFile };
}

export async function brandImage(input = {}) {
  const spec = { ...input };
  if (!spec.input) throw new Error("input is required");
  if (!spec.title) throw new Error("title is required");
  spec.input = path.resolve(spec.input);
  if (!fs.existsSync(spec.input)) throw new Error(`input image not found: ${spec.input}`);
  if (spec.logo) {
    spec.logo = path.resolve(spec.logo);
    if (!fs.existsSync(spec.logo)) throw new Error(`logo not found: ${spec.logo}`);
  }
  spec.output = spec.output
    ? path.resolve(spec.output)
    : path.join(DEFAULT_OUT, `${path.basename(spec.input, path.extname(spec.input))}-branded.jpg`);
  return runPipeline(spec);
}

export async function fitImage(input = {}) {
  const spec = { ...input, op: "fit" };
  delete spec.logo;
  delete spec.title;
  if (!spec.input) throw new Error("input is required");
  spec.input = path.resolve(spec.input);
  if (!fs.existsSync(spec.input)) throw new Error(`input image not found: ${spec.input}`);
  const width = Number(spec.width);
  const height = Number(spec.height);
  if (!Number.isInteger(width) || width < 1 || width > 8000) throw new Error("width must be an integer 1..8000");
  if (!Number.isInteger(height) || height < 1 || height > 8000) throw new Error("height must be an integer 1..8000");
  spec.width = width;
  spec.height = height;
  const ext = { jpg: "jpg", png: "png", webp: "webp" }[String(spec.format ?? "").toLowerCase()] ?? "jpg";
  spec.output = spec.output
    ? path.resolve(spec.output)
    : path.join(DEFAULT_OUT, `${path.basename(spec.input, path.extname(spec.input))}-${width}x${height}.${ext}`);
  return runPipeline(spec);
}

async function runPipeline(spec) {
  const outDir = spec.output ? path.dirname(spec.output) : path.resolve(spec.output_dir || DEFAULT_OUT);
  await fsp.mkdir(outDir, { recursive: true });
  const specFile = path.join(outDir, `.image-brand-${Date.now()}-${process.pid}.json`);
  await fsp.writeFile(specFile, JSON.stringify(spec, null, 2) + "\n");
  try {
    const python = process.env.IMAGE_BRAND_PYTHON || "python3";
    const { stdout } = await execFileAsync(python, [PIPELINE, "--spec", specFile], {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    });
    const lines = stdout.trim().split("\n").filter(Boolean);
    const result = JSON.parse(lines.at(-1));
    if (!result.ok) throw new Error(result.error || "pipeline failed");
    return result;
  } finally {
    await fsp.rm(specFile, { force: true });
  }
}

export async function brandBatch(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new Error("items must be a non-empty array");
  if (items.length > 20) throw new Error("at most 20 items per batch");
  const outDir = path.resolve(input.output_dir || DEFAULT_OUT);
  await fsp.mkdir(outDir, { recursive: true });
  const results = [];
  for (const item of items) {
    const merged = { ...item };
    if (input.output_dir && !merged.output) {
      const stem = path.basename(String(merged.input ?? "image"), path.extname(String(merged.input ?? "")));
      merged.output = path.join(outDir, `${stem}-branded.jpg`);
    }
    results.push(await brandImage(merged));
  }
  const manifest = {
    ok: true,
    count: results.length,
    outputs: results.map((entry) => ({ output: entry.output, sha256: entry.output_sha256, sidecar: entry.sidecar })),
    created: new Date().toISOString(),
  };
  const manifestFile = path.join(outDir, `batch-${Date.now()}.json`);
  await fsp.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  return { ...manifest, manifest: manifestFile };
}

const SITE_PROFILES = {
  ecommerce: {
    label: "অনলাইন দোকান",
    nav: ["হোম", "পণ্য", "অফার"],
    section: "আজকের বাছাই",
    cta: "এখনই অর্ডার করুন",
    cards: [
      { title: "তাজা সবজি", body: "প্রতিদিন সকালে বাগান থেকে বাছাই করা।", meta: "৳ ৮০ / কেজি" },
      { title: "হাতে বানানো মিষ্টি", body: "ছোট ব্যাচ, সংরক্ষক ছাড়া।", meta: "৳ ৩২০ / বক্স" },
      { title: "ঘরের মসলা", body: "শীতল পাথরে ভাঙা, খাঁটি মিশ্রণ।", meta: "৳ ২৪০ / ২৫০ গ্রাম" },
    ],
  },
  hospital: {
    label: "হাসপাতাল ও ক্লিনিক",
    nav: ["হোম", "বিভাগ", "ডাক্তার"],
    section: "আমাদের বিভাগ",
    cta: "অ্যাপয়েন্টমেন্ট নিন",
    cards: [
      { title: "মেডিসিন", body: "জ্বর, সংক্রমণ ও দীর্ঘমেয়াদি রোগের পরামর্শ।", meta: "শনি–বৃহস্পতি · ৯টা–৫টা" },
      { title: "শিশু বিভাগ", body: "নবজাতক থেকে কিশোর — টিকা ও বৃদ্ধি পর্যবেক্ষণ।", meta: "প্রতিদিন · ১০টা–২টা" },
      { title: "ল্যাব", body: "রক্ত, ইউরিন ও ইসিজি — একই দিনে রিপোর্ট।", meta: "সকাল ৮টা–রাত ৮টা" },
    ],
  },
  lms: {
    label: "অনলাইন লার্নিং",
    nav: ["হোম", "কোর্স", "প্রগ্রেস"],
    section: "শুরু করার কোর্স",
    cta: "কোর্স শুরু করুন",
    cards: [
      { title: "Python দিয়ে শুরু", body: "ভেরিয়েবল থেকে প্রথম CLI — হাতে-কলমে।", meta: "১২ লেসন · ৩ ঘণ্টা" },
      { title: "Web Foundations", body: "HTML, CSS আর accessibility-র শক্ত ভিত।", meta: "১০ লেসন · ২.৫ ঘণ্টা" },
      { title: "Regex, ভয় ছাড়া", body: "১০ accept, ১০ reject — pattern আগে, কোড পরে।", meta: "৮ লেসন · ২ ঘণ্টা" },
    ],
  },
  generic: {
    label: "আমাদের কাজ",
    nav: ["হোম", "সেবা", "যোগাযোগ"],
    section: "যা আমরা করি",
    cta: "শুরু করুন",
    cards: [
      { title: "পরিকল্পনা", body: "লক্ষ্য, সীমা আর যাচাইয়ের মাপ আগে ঠিক করি।", meta: "ধাপ ১" },
      { title: "বাস্তবায়ন", body: "ছোট, যাচাইযোগ্য পরিবর্তনে কাজ এগোয়।", meta: "ধাপ ২" },
      { title: "প্রমাণ", body: "ফলাফল দেখাই — দাবি নয়, artifact দিই।", meta: "ধাপ ৩" },
    ],
  },
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function safeHttps(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function slugify(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "site";
}

async function fetchWiki(title, lang = "en") {
  const code = /^[a-z]{2,3}$/.test(String(lang)) ? String(lang) : "en";
  const slug = encodeURIComponent(String(title).trim().replace(/\s+/g, "_"));
  const data = await fetchJson(`https://${code}.wikipedia.org/api/rest_v1/page/summary/${slug}`);
  return {
    title: data?.title ?? String(title),
    description: data?.description ?? null,
    extract: data?.extract ?? null,
    url: safeHttps(data?.content_urls?.desktop?.page) ?? `https://${code}.wikipedia.org/`,
    thumbnail: safeHttps(data?.thumbnail?.source),
    license: "CC BY-SA 4.0",
    source: `https://${code}.wikipedia.org`,
  };
}

async function fetchCountry(name) {
  const data = await fetchJson(
    "https://countriesnow.space/api/v0.1/countries/info?returns=currency,flag,capital",
  );
  if (data?.error) throw new Error(String(data.msg ?? "country provider error"));
  const needle = String(name).toLowerCase();
  const row = (data?.data ?? []).find((entry) => String(entry?.name ?? "").toLowerCase() === needle)
    ?? (data?.data ?? []).find((entry) => String(entry?.name ?? "").toLowerCase().includes(needle));
  if (!row) throw new Error(`country not found: ${name}`);
  return {
    name: row.name,
    capital: row.capital ?? null,
    currency: row.currency ?? null,
    flag: safeHttps(row.flag),
    iso2: row.iso2 ?? null,
    source: "https://countriesnow.space",
  };
}

function renderCards(profile, cards, slug, fixture) {
  const cardImages = Array.isArray(fixture?.files?.cards) ? fixture.files.cards : [];
  return cards
    .map((card, index) => {
      const image = cardImages[index]
        ? `<img src="./${escapeHtml(path.basename(cardImages[index]))}" alt="${escapeHtml(card.title)}" width="640" height="420" loading="lazy">`
        : "";
      return [
        '<article class="card">',
        image,
        '<div class="card-body">',
        `<h3>${escapeHtml(card.title)}</h3>`,
        card.body ? `<p>${escapeHtml(card.body)}</p>` : "",
        card.meta ? `<p class="meta">${escapeHtml(card.meta)}</p>` : "",
        "</div>",
        "</article>",
      ].join("\n");
    })
    .join("\n");
}

function renderFacts(data) {
  const facts = [];
  if (data?.wiki) {
    const extract = String(data.wiki.extract ?? "").slice(0, 280);
    facts.push(
      [
        '<article class="fact">',
        `<h3>${escapeHtml(data.wiki.title)}</h3>`,
        extract ? `<p>${escapeHtml(extract)}${data.wiki.extract.length > 280 ? "…" : ""}</p>` : "",
        `<p class="source"><a href="${escapeHtml(data.wiki.url)}" rel="noopener noreferrer">Wikipedia</a> · ${escapeHtml(data.wiki.license)}</p>`,
        "</article>",
      ].join("\n"),
    );
  }
  if (data?.country) {
    const flag = data.country.flag
      ? `<img src="${escapeHtml(data.country.flag)}" alt="${escapeHtml(data.country.name)}-এর পতাকা" width="48" height="32" loading="lazy">`
      : "";
    facts.push(
      [
        '<article class="fact">',
        `<h3>${flag} ${escapeHtml(data.country.name)}</h3>`,
        `<dl><dt>রাজধানী</dt><dd>${escapeHtml(data.country.capital ?? "—")}</dd><dt>মুদ্রা</dt><dd>${escapeHtml(data.country.currency ?? "—")}</dd></dl>`,
        `<p class="source">${escapeHtml(data.country.source)}</p>`,
        "</article>",
      ].join("\n"),
    );
  }
  return facts.join("\n");
}

function renderStyle(accent) {
  return `:root {
  --accent: ${accent};
  --surface: #f8fafc;
  --ink: #0f172a;
  --muted: #475569;
  --line: #e2e8f0;
  --radius: 14px;
  --space: 4px;
  color-scheme: light;
}

* { box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  background: var(--surface);
  color: var(--ink);
  font-family: "Noto Sans Bengali", "Hind Siliguri", system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.6;
}

a { color: inherit; }

img { max-width: 100%; display: block; }

.skip {
  position: absolute;
  left: -999px;
  top: 0;
  background: var(--ink);
  color: #fff;
  padding: 12px 18px;
  z-index: 10;
}

.skip:focus { left: 12px; top: 12px; }

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.site-header {
  display: flex;
  align-items: center;
  gap: calc(var(--space) * 5);
  padding: calc(var(--space) * 4) calc(var(--space) * 6);
  background: #fff;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 5;
}

.brand img { width: 150px; height: auto; }

nav { display: flex; gap: calc(var(--space) * 4); margin-left: auto; }

nav a { text-decoration: none; color: var(--muted); font-weight: 600; }

nav a:hover { color: var(--ink); }

.cta {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  border-radius: 999px;
  background: var(--accent);
  color: #10131a;
  font-weight: 700;
  text-decoration: none;
  border: 2px solid transparent;
}

.cta-small { padding: 8px 16px; min-height: 40px; }

.ghost {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  color: #fff;
  text-decoration: none;
}

.hero {
  background-image: linear-gradient(90deg, rgba(9, 13, 22, 0.72), rgba(9, 13, 22, 0.18)), var(--hero);
  background-size: cover;
  background-position: center;
  color: #fff;
  min-height: min(78vh, 680px);
  display: flex;
  align-items: flex-end;
}

.hero-inner { padding: clamp(24px, 6vw, 88px); max-width: 900px; }

.kicker { text-transform: uppercase; letter-spacing: 0.14em; color: var(--accent); font-weight: 700; margin: 0 0 12px; }

h1 { font-size: clamp(2rem, 5vw, 4rem); line-height: 1.12; margin: 0 0 16px; }

.sub { font-size: clamp(1rem, 2vw, 1.3rem); color: #e5e7eb; max-width: 62ch; margin: 0 0 28px; }

.actions { display: flex; flex-wrap: wrap; gap: 12px; }

main section { padding: clamp(32px, 6vw, 72px) clamp(20px, 6vw, 88px); }

.cards h2, .data h2, .states h2 { font-size: clamp(1.4rem, 3vw, 2rem); margin: 0 0 24px; }

.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }

.card { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }

.card img { aspect-ratio: 640 / 420; object-fit: cover; width: 100%; }

.card-body { padding: 20px; }

.card h3 { margin: 0 0 8px; font-size: 1.15rem; }

.card p { margin: 0; color: var(--muted); }

.card .meta { margin-top: 14px; color: var(--ink); font-weight: 700; }

.data { background: #fff; border-top: 1px solid var(--line); }

.facts { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }

.fact { border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; }

.fact h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; }

.fact dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; }

.fact dt { color: var(--muted); }

.fact dd { margin: 0; font-weight: 600; }

.source { font-size: 0.85rem; color: var(--muted); margin: 12px 0 0; }

.states { border-top: 1px solid var(--line); }

.state-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }

.state-buttons button {
  min-height: 40px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: #fff;
  font: inherit;
  cursor: pointer;
}

.state-buttons button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #10131a; font-weight: 700; }

.state-panel { border: 1px dashed var(--line); border-radius: var(--radius); padding: 18px; background: #fff; }

footer { padding: 32px clamp(20px, 6vw, 88px); color: var(--muted); border-top: 1px solid var(--line); }

@media (max-width: 720px) {
  .site-header { flex-wrap: wrap; }
  nav { order: 3; width: 100%; overflow-x: auto; margin-left: 0; }
  .cta-small { margin-left: auto; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition: none !important; animation: none !important; }
}
`;
}

function renderHtml({ profile, brand, headline, subheadline, kicker, slug, cards, facts, site, fixture }) {
  const links = profile.nav.map((item) => `<a href="#main">${escapeHtml(item)}</a>`).join("");
  const bodyFacts = facts
    ? `<section id="data" class="data" aria-labelledby="data-title"><h2 id="data-title">তথ্যকোষ</h2><div class="facts">${facts}</div></section>`
    : "";
  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(brand)} — ${escapeHtml(headline)}</title>
<meta name="description" content="${escapeHtml(subheadline || headline)}">
<meta property="og:title" content="${escapeHtml(brand)}">
<meta property="og:description" content="${escapeHtml(subheadline || headline)}">
<meta property="og:image" content="./${escapeHtml(slug)}-og.jpg">
<link rel="icon" href="./${escapeHtml(slug)}-logo.png">
<link rel="stylesheet" href="./styles.css">
</head>
<body>
<a class="skip" href="#main">মূল কনটেন্টে যান</a>
<header class="site-header">
  <a class="brand" href="#main"><img src="./${escapeHtml(slug)}-logo.png" alt="${escapeHtml(brand)}" width="180" height="45"></a>
  <nav aria-label="প্রধান নেভিগেশন">${links}</nav>
  <a class="cta cta-small" href="#cards">${escapeHtml(profile.cta)}</a>
</header>
<main id="main">
  <section class="hero" style="--hero: url('./${escapeHtml(slug)}-hero.jpg')">
    <div class="hero-inner">
      <p class="kicker">${escapeHtml(kicker || profile.label)}</p>
      <h1>${escapeHtml(headline)}</h1>
      <p class="sub">${escapeHtml(subheadline || profile.label)}</p>
      <div class="actions">
        <a class="cta" href="#cards">${escapeHtml(profile.cta)}</a>
        <a class="ghost" href="#data">আরও জানুন</a>
      </div>
    </div>
  </section>
  <section id="cards" class="cards" aria-labelledby="cards-title">
    <h2 id="cards-title">${escapeHtml(profile.section)}</h2>
    <div class="grid">
${renderCards(profile, cards, slug, fixture)}
    </div>
  </section>
  ${bodyFacts}
  <section id="states" class="states" aria-labelledby="states-title">
    <h2 id="states-title">অবস্থা দেখুন</h2>
    <div class="state-buttons" role="group" aria-label="ইন্টারফেস অবস্থা">
      <button type="button" data-demo-state="loading" aria-pressed="false">loading</button>
      <button type="button" data-demo-state="empty" aria-pressed="false">empty</button>
      <button type="button" data-demo-state="error" aria-pressed="false">error</button>
      <button type="button" data-demo-state="success" aria-pressed="false">success</button>
    </div>
    <p class="state-panel" id="demo-panel" aria-live="polite">সব ঠিক আছে — একটি অবস্থা বেছে নিন।</p>
  </section>
</main>
<footer>
  <p>${escapeHtml(brand)} · ${escapeHtml(profile.label)} · ${escapeHtml(site)}</p>
</footer>
<script>
const copy = {
  loading: "লোড হচ্ছে… কার্ডের জায়গা ধরে রাখা হয়েছে।",
  empty: "এখনো কিছু নেই। ফিল্টার বদলান বা নতুন কিছু যোগ করুন।",
  error: "অনুরোধ ব্যর্থ হয়েছে। আবার চেষ্টা করুন; সমস্যা থাকলে যোগাযোগ করুন।",
  success: "সফল হয়েছে। পরের ধাপে যান।"
};
const panel = document.getElementById("demo-panel");
for (const button of document.querySelectorAll("[data-demo-state]")) {
  button.addEventListener("click", () => {
    const state = button.dataset.demoState;
    panel.textContent = copy[state];
    panel.dataset.state = state;
    for (const other of document.querySelectorAll("[data-demo-state]")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
  });
}
</script>
</body>
</html>
`;
}

export async function webDecorate(input = {}) {
  const site = String(input.site ?? "").toLowerCase();
  const profile = SITE_PROFILES[site];
  if (!profile) throw new Error("site must be ecommerce, hospital, lms or generic");
  const brand = String(input.brand ?? "").trim();
  const headline = String(input.headline ?? "").trim();
  if (!brand) throw new Error("brand is required");
  if (!headline) throw new Error("headline is required");
  const accent = String(input.accent ?? "#e6b43c").trim();
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new Error("accent must be #rrggbb");

  const slug = slugify(brand);
  const dir = path.resolve(input.output_dir || path.join(DEFAULT_OUT, "web", slug));
  await fsp.mkdir(dir, { recursive: true });

  const images = (Array.isArray(input.images) ? input.images : [])
    .map((entry) => path.resolve(String(entry)))
    .slice(0, 4);
  for (const image of images) if (!fs.existsSync(image)) throw new Error(`image not found: ${image}`);
  let logo = null;
  if (input.logo) {
    logo = path.resolve(String(input.logo));
    if (!fs.existsSync(logo)) throw new Error(`logo not found: ${logo}`);
  }

  const providedCards = Array.isArray(input.cards) ? input.cards : [];
  if (providedCards.length > 6) throw new Error("at most 6 cards");
  const cards = (providedCards.length > 0 ? providedCards : profile.cards).map((card, index) => ({
    title: String(card?.title ?? `কার্ড ${index + 1}`).trim(),
    body: String(card?.body ?? "").trim(),
    meta: String(card?.meta ?? "").trim(),
  }));

  const data = {};
  const dataErrors = [];
  if (input.data?.wiki) {
    try {
      data.wiki = await fetchWiki(input.data.wiki, input.data.wiki_lang || "en");
    } catch (error) {
      dataErrors.push({ source: "wikipedia", error: String(error?.message ?? error) });
    }
  }
  if (input.data?.country) {
    try {
      data.country = await fetchCountry(input.data.country);
    } catch (error) {
      dataErrors.push({ source: "countriesnow", error: String(error?.message ?? error) });
    }
  }

  const fixture = await runPipeline({
    op: "decorate",
    site,
    brand,
    headline,
    subheadline: String(input.subheadline ?? "").trim(),
    kicker: String(input.kicker ?? "").trim(),
    accent,
    logo,
    images,
    output_dir: dir,
  });

  const htmlFile = path.join(dir, "index.html");
  const cssFile = path.join(dir, "styles.css");
  const manifestFile = path.join(dir, "decorate.json");
  const css = renderStyle(accent);
  const html = renderHtml({
    profile,
    brand,
    headline,
    subheadline: String(input.subheadline ?? "").trim(),
    kicker: String(input.kicker ?? "").trim(),
    slug,
    cards,
    facts: renderFacts(data),
    site,
    fixture,
  });
  await fsp.writeFile(htmlFile, html, "utf8");
  await fsp.writeFile(cssFile, css, "utf8");

  const manifest = {
    ok: true,
    tool: "web_decorate",
    version: VERSION,
    site,
    brand,
    slug,
    created: fixture.created,
    files: {
      html: htmlFile,
      css: cssFile,
      logo: fixture.files.logo,
      hero: fixture.files.hero,
      og: fixture.files.og,
      cards: fixture.files.cards,
      manifest: manifestFile,
    },
    hashes: {
      ...fixture.hashes,
      cards: fixture.card_hashes ?? [],
      html: createHash("sha256").update(html).digest("hex"),
      css: createHash("sha256").update(css).digest("hex"),
    },
    inputs: {
      images: images.map((image) => ({
        path: image,
        sha256: createHash("sha256").update(fs.readFileSync(image)).digest("hex"),
      })),
      logo: logo ? { path: logo, sha256: createHash("sha256").update(fs.readFileSync(logo)).digest("hex") } : null,
    },
    cards,
    data,
    data_errors: dataErrors,
    license_note:
      "Wikipedia text is CC BY-SA 4.0 and is linked in the page; country facts come from countriesnow.space. Input images keep their own licence sidecars.",
  };
  await fsp.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return {
    ...fixture,
    files: manifest.files,
    hashes: manifest.hashes,
    cards: cards.length,
    data,
    data_errors: dataErrors,
    manifest: manifestFile,
  };
}


export async function handleRpc(request) {
  const { id, method, params } = request ?? {};
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "image-brand", version: VERSION },
      },
    };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      let result;
      if (name === "image_search") result = await searchImages(args);
      else if (name === "image_fetch") result = await fetchImage(args);
      else if (name === "image_brand") result = await brandImage(args);
      else if (name === "image_fit") result = await fitImage(args);
      else if (name === "image_batch") result = await brandBatch(args);
      else if (name === "web_decorate") result = await webDecorate(args);
      else throw new Error(`unknown tool ${JSON.stringify(name)}`);
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `Error: ${String(error?.message ?? error)}` }], isError: true },
      };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  process.stderr.write(`image-brand MCP ${VERSION} (stdio)\n`);
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    chain = chain.then(async () => {
      let request;
      try {
        request = JSON.parse(text);
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
        return;
      }
      if (request.id === undefined || request.id === null) return;
      try {
        const response = await handleRpc(request);
        process.stdout.write(JSON.stringify(response) + "\n");
      } catch (error) {
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: String(error?.message ?? error) } }) + "\n",
        );
      }
    });
  });
  await new Promise((resolve) => rl.on("close", resolve));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
