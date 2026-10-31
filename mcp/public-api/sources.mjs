/**
 * Live public-data sources for the public-api MCP server.
 *
 * Every URL is fixed here — no caller-supplied host — so the only SSRF surface
 * is the query string. Each source is a plain object so adding a new API means
 * adding one entry, not a new server.
 */

import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const VERSION = "1.0.0";
const UA = "zombie-public-api/1.0 (local stdio MCP; +https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin)";
const TIMEOUT_MS = 20000;
const DEFAULT_DIR = process.env.PUBLIC_API_DIR || path.join(os.homedir(), ".local", "share", "zombie-public-api");
const cache = new Map();

const WMO = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

async function fetchWith(url, { timeout = TIMEOUT_MS, headers = {}, accept = "application/json" } = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept, ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).host}`);
  return response;
}

export async function fetchJson(url, options) {
  return (await fetchWith(url, options)).json();
}

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  if (cache.size > 200) {
    for (const [id, entry] of cache) if (entry.expires <= Date.now()) cache.delete(id);
  }
  return value;
}

export function langCode(value, fallback = "en") {
  const lang = String(value ?? fallback).trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,11}$/.test(lang)) throw new Error(`invalid language code ${JSON.stringify(value)}`);
  return lang;
}

export function clampInt(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) throw new Error(`expected an integer, got ${JSON.stringify(value)}`);
  return Math.min(Math.max(Math.round(number), min), max);
}

export function cleanHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function weatherText(code) {
  return WMO[Number(code)] ?? `WMO ${code}`;
}

export function isoDate(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`date must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`invalid calendar date ${text}`);
  }
  return date;
}

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function coordinate(value, name, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return number;
}

export function titleSlug(title) {
  const text = String(title ?? "").trim();
  if (!text) throw new Error("title is required");
  return encodeURIComponent(text.replace(/\s+/g, "_"));
}

function pageUrl(lang, title) {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/\s+/g, "_"))}`;
}

export const SOURCES = [
  {
    name: "wiki_search",
    description: "Search Wikipedia and return titles, snippets and article URLs. Real-time, no API key.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        lang: { type: "string", default: "en", description: "Wikipedia language code, e.g. en or bn" },
        limit: { type: "number", default: 5, minimum: 1, maximum: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async run(args = {}) {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query is required");
      const lang = langCode(args.lang);
      const limit = clampInt(args.limit, 5, 1, 20);
      const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      url.search = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: query,
        srlimit: String(limit),
        srprop: "snippet|wordcount",
        format: "json",
        origin: "*",
      }).toString();
      const data = await fetchJson(url);
      const hits = data?.query?.search ?? [];
      return {
        ok: true,
        source: "wikipedia",
        lang,
        query,
        count: hits.length,
        results: hits.map((hit) => ({
          title: hit.title,
          snippet: cleanHtml(hit.snippet),
          words: hit.wordcount ?? null,
          url: pageUrl(lang, hit.title),
        })),
      };
    },
  },
  {
    name: "wiki_page",
    description: "Wikipedia page summary: description, plain-text extract, canonical URL and lead thumbnail.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        lang: { type: "string", default: "en" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    async run(args = {}) {
      const lang = langCode(args.lang);
      const slug = titleSlug(args.title);
      const data = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${slug}`);
      const title = data?.title ?? String(args.title);
      return {
        ok: true,
        source: "wikipedia",
        lang,
        title,
        description: data?.description ?? null,
        extract: data?.extract ?? null,
        url: data?.content_urls?.desktop?.page ?? pageUrl(lang, title),
        thumbnail: data?.thumbnail?.source ?? null,
        coordinates: data?.coordinates ?? null,
        license_note: "Wikipedia text is CC BY-SA 4.0; attribution required if republished",
      };
    },
  },
  {
    name: "wiki_onthisday",
    description: "Selected historical events for a date (defaults to today, UTC) from the Wikimedia feed API.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "number", minimum: 1, maximum: 12 },
        day: { type: "number", minimum: 1, maximum: 31 },
        lang: { type: "string", default: "en" },
        limit: { type: "number", default: 5, minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    async run(args = {}) {
      const lang = langCode(args.lang);
      const now = new Date();
      const month = clampInt(args.month ?? now.getUTCMonth() + 1, 1, 1, 12);
      const day = clampInt(args.day ?? now.getUTCDate(), 1, 1, 31);
      const limit = clampInt(args.limit, 5, 1, 20);
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const data = await fetchJson(`https://api.wikimedia.org/feed/v1/wikipedia/${lang}/onthisday/selected/${mm}/${dd}`);
      const events = (data?.selected ?? []).slice(0, limit).map((event) => {
        const first = event?.pages?.[0];
        return {
          year: event?.year ?? null,
          text: cleanHtml(event?.text),
          title: first?.title ?? null,
          url: first?.title ? pageUrl(lang, first.title) : null,
        };
      });
      return { ok: true, source: "wikimedia-feed", lang, month, day, count: events.length, events };
    },
  },
  {
    name: "wiki_featured",
    description: "Wikipedia featured content for a date: today's featured article plus picture of the day with license, artist and file page.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, default today (UTC)" },
        lang: { type: "string", default: "en" },
      },
      additionalProperties: false,
    },
    async run(args = {}) {
      const lang = langCode(args.lang);
      const iso = args.date ? isoDate(args.date).toISOString().slice(0, 10) : isoToday();
      const [year, month, day] = iso.split("-");
      const data = await fetchJson(`https://api.wikimedia.org/feed/v1/wikipedia/${lang}/featured/${year}/${month}/${day}`);
      const tfa = data?.tfa ?? null;
      const image = data?.image ?? null;
      return {
        ok: true,
        source: "wikimedia-feed",
        lang,
        date: iso,
        article: tfa
          ? {
              title: tfa.title,
              extract: cleanHtml(tfa.extract),
              url: tfa.content_urls?.desktop?.page ?? pageUrl(lang, tfa.title),
            }
          : null,
        image: image
          ? {
              title: image.title,
              source: image.image?.source ?? null,
              width: image.image?.width ?? null,
              height: image.image?.height ?? null,
              file_page: image.file_page ?? null,
              artist: cleanHtml(image.artist?.text),
              credit: cleanHtml(image.credit?.text),
              license: image.license?.type ?? null,
              license_code: image.license?.code ?? null,
            }
          : null,
      };
    },
  },
  {
    name: "weather",
    description: "Current weather and a short daily forecast from Open-Meteo (no key), with human-readable WMO conditions.",
    inputSchema: {
      type: "object",
      properties: {
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        days: { type: "number", default: 3, minimum: 1, maximum: 7 },
      },
      required: ["latitude", "longitude"],
      additionalProperties: false,
    },
    async run(args = {}) {
      const latitude = coordinate(args.latitude, "latitude", -90, 90);
      const longitude = coordinate(args.longitude, "longitude", -180, 180);
      const days = clampInt(args.days, 3, 1, 7);
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
        timezone: "auto",
        forecast_days: String(days),
      }).toString();
      const data = await fetchJson(url);
      const daily = data?.daily ?? {};
      return {
        ok: true,
        source: "open-meteo",
        latitude,
        longitude,
        timezone: data?.timezone ?? null,
        elevation: data?.elevation ?? null,
        current: data?.current
          ? {
              time: data.current.time,
              temperature_c: data.current.temperature_2m,
              feels_like_c: data.current.apparent_temperature,
              humidity: data.current.relative_humidity_2m,
              wind_kmh: data.current.wind_speed_10m,
              condition: weatherText(data.current.weather_code),
            }
          : null,
        daily: (daily.time ?? []).map((date, index) => ({
          date,
          condition: weatherText(daily.weather_code?.[index]),
          max_c: daily.temperature_2m_max?.[index] ?? null,
          min_c: daily.temperature_2m_min?.[index] ?? null,
          rain_chance: daily.precipitation_probability_max?.[index] ?? null,
          sunrise: daily.sunrise?.[index] ?? null,
          sunset: daily.sunset?.[index] ?? null,
        })),
      };
    },
  },
  {
    name: "currency",
    description: "Live exchange rates for any currency pair (open.er-api.com, includes BDT and other non-ECB currencies).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO 4217 base code, e.g. USD", default: "USD" },
        to: { type: "string", description: "Optional target code, e.g. BDT; omit for the full table" },
      },
      additionalProperties: false,
    },
    async run(args = {}) {
      const from = String(args.from ?? "USD").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(from)) throw new Error("from must be a three-letter currency code");
      const to = args.to ? String(args.to).trim().toUpperCase() : null;
      if (to && !/^[A-Z]{3}$/.test(to)) throw new Error("to must be a three-letter currency code");
      const data = await cached(`fx:${from}`, 60000, () => fetchJson(`https://open.er-api.com/v6/latest/${from}`));
      if (data?.result !== "success") throw new Error(`rate provider error: ${data?.["error-type"] ?? "unknown"}`);
      const rates = data.rates ?? {};
      if (to && !(to in rates)) throw new Error(`unknown target currency ${to}`);
      const picked = to ? { [to]: rates[to] } : rates;
      return {
        ok: true,
        source: "open.er-api.com",
        base: data.base_code ?? from,
        updated: data.time_last_update_utc ?? null,
        count: Object.keys(picked).length,
        rates: picked,
        ...(to ? { rate: rates[to] } : {}),
      };
    },
  },
  {
    name: "country",
    description: "Country facts: capital, currency and flag image URL from countriesnow.space (no key).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        limit: { type: "number", default: 3, minimum: 1, maximum: 10 },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async run(args = {}) {
      const query = String(args.name ?? "").trim();
      if (!query) throw new Error("name is required");
      const limit = clampInt(args.limit, 3, 1, 10);
      const data = await cached("countries", 600000, () =>
        fetchJson("https://countriesnow.space/api/v0.1/countries/info?returns=currency,flag,capital"),
      );
      if (data?.error) throw new Error(String(data.msg ?? "country provider error"));
      const needle = query.toLowerCase();
      const matches = (data?.data ?? [])
        .filter((row) => String(row?.name ?? "").toLowerCase().includes(needle))
        .slice(0, limit)
        .map((row) => ({
          name: row.name,
          capital: row.capital ?? null,
          currency: row.currency ?? null,
          flag: row.flag ?? null,
          iso2: row.iso2 ?? null,
          iso3: row.iso3 ?? null,
        }));
      return { ok: true, source: "countriesnow.space", query, count: matches.length, matches };
    },
  },
  {
    name: "qr",
    description: "Generate a QR code PNG at an exact pixel size and write it (plus a sidecar) into a directory. Data is hashed, not stored in the sidecar.",
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "string", minLength: 1, maxLength: 1200 },
        size: { type: "number", default: 320, minimum: 80, maximum: 1000 },
        output_dir: { type: "string" },
      },
      required: ["data"],
      additionalProperties: false,
    },
    async run(args = {}) {
      const data = String(args.data ?? "");
      if (!data) throw new Error("data is required");
      if (data.length > 1200) throw new Error("data is longer than 1200 characters");
      const size = clampInt(args.size, 320, 80, 1000);
      const dir = path.resolve(args.output_dir || DEFAULT_DIR);
      await fsp.mkdir(dir, { recursive: true });
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&format=png&data=${encodeURIComponent(data)}`;
      const response = await fetchWith(url, { accept: "image/png" });
      const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (type !== "image/png") throw new Error(`unexpected content-type ${JSON.stringify(type)}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 2 * 1024 * 1024) throw new Error("QR image is larger than 2 MB");
      const sha256 = createHash("sha256").update(body).digest("hex");
      const file = path.join(dir, `qr-${Date.now()}-${sha256.slice(0, 8)}.png`);
      await fsp.writeFile(file, body);
      const sidecar = {
        ok: true,
        file,
        bytes: body.length,
        sha256,
        size,
        data_sha256: createHash("sha256").update(data).digest("hex"),
        created: new Date().toISOString(),
      };
      const sidecarFile = file.replace(/\.png$/, ".json");
      await fsp.writeFile(sidecarFile, JSON.stringify(sidecar, null, 2) + "\n");
      return { ...sidecar, sidecar: sidecarFile, source: "api.qrserver.com" };
    },
  },
];

export function sourceByName(name) {
  return SOURCES.find((source) => source.name === name) ?? null;
}
