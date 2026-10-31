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
const VERSION = "1.0.0";
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
  const outDir = path.dirname(spec.output);
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
