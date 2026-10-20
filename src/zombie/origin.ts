// URL-only origin handshake.
//
// The owner's rule: a cloud runtime and a local client may agree on exactly one
// thing — the public base URL. There is no browser session, no cookie, no key
// transfer and no session manipulation in this path.
//
// The origin is a trusted HTTP(S) endpoint that publishes a small JSON document:
//
//   GET <origin>/gateway_url.json
//   { "base_url": "https://host/v1", "hostname": "host", "auth_required": true }
//
// This module reads that document and nothing else. The API key never leaves the
// local config; the handshake request never carries it.

export type OriginHandshake = {
  originUrl: string;
  endpoint: string | null;
  ok: boolean;
  baseUrl: string | null;
  hostname: string | null;
  authRequired: boolean | null;
  ms: number;
  error?: string;
};

export const ORIGIN_HANDSHAKE_PATH = "/gateway_url.json";
export const DEFAULT_ORIGIN_TIMEOUT_MS = 3000;
export const MAX_ORIGIN_BYTES = 64 * 1024;

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

// Build the public handshake endpoint from a configured origin URL.
// https is required everywhere except localhost, where http is allowed for tests.
// A `/v1` suffix is accepted and removed; an explicit `/gateway_url.json` is kept.
export function originHandshakeUrl(originUrl: string): string | null {
  const raw = (originUrl ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) return null;

  let pathname = stripTrailingSlash(url.pathname);
  if (pathname.endsWith("/v1")) pathname = pathname.slice(0, -3);
  if (!pathname.endsWith(ORIGIN_HANDSHAKE_PATH)) pathname += ORIGIN_HANDSHAKE_PATH;

  return `${url.origin}${pathname}`;
}

export function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return stripTrailingSlash(url.toString());
  } catch {
    return null;
  }
}

// Read the origin's public URL document. The request is deliberately plain:
// GET, no Authorization header, no cookies, no redirect following, small timeout.
export async function fetchOriginHandshake(
  originUrl: string,
  timeoutMs: number = DEFAULT_ORIGIN_TIMEOUT_MS,
): Promise<OriginHandshake> {
  const endpoint = originHandshakeUrl(originUrl);
  const started = Date.now();
  if (!endpoint) {
    return {
      originUrl,
      endpoint: null,
      ok: false,
      baseUrl: null,
      hostname: null,
      authRequired: null,
      ms: 0,
      error: "origin URL must be https (http is allowed only on localhost)",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`origin redirect refused (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`origin HTTP ${response.status}`);
    }

    const text = await response.text();
    if (text.length > MAX_ORIGIN_BYTES) {
      throw new Error(`origin response too large (${text.length} bytes)`);
    }

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("origin response is not JSON");
    }

    const baseUrl = normalizeBaseUrl(payload?.base_url);
    if (!baseUrl) throw new Error("origin response has no usable base_url");

    const reportedHostname = typeof payload?.hostname === "string" ? payload.hostname.trim() : "";
    const baseHost = new URL(baseUrl).host;
    if (reportedHostname && reportedHostname !== baseHost) {
      throw new Error("origin hostname does not match base_url host");
    }

    return {
      originUrl,
      endpoint,
      ok: true,
      baseUrl,
      hostname: reportedHostname || baseHost,
      authRequired: typeof payload?.auth_required === "boolean" ? payload.auth_required : null,
      ms: Date.now() - started,
    };
  } catch (error: any) {
    const message =
      error?.name === "AbortError"
        ? `origin timeout after ${Math.max(250, timeoutMs)}ms`
        : String(error?.message ?? error);
    return {
      originUrl,
      endpoint,
      ok: false,
      baseUrl: null,
      hostname: null,
      authRequired: null,
      ms: Date.now() - started,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}
