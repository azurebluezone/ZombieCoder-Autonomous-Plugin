// Spec §2 — dynamic provider + fallback model routing.
//
// The rule the owner set: never depend on one server, and never break when it is
// gone. So the chain is:
//
//   1. the configured custom provider — but ONLY after probing the provider's OWN
//      baseURL, not the URL written in our config. A provider can be listed in the
//      catalog while its server is dead; assigning agents to it would point every
//      request at a corpse.
//   2. OpenCode's own catalog, filtered to cost 0 / cost 0 — always present
//   3. a baseline model we observed live in the catalog
//
// The mapping agent -> model is DETERMINISTIC by default (stable hash of the agent
// id), because an unreproducible footprint is not evidence. The owner can opt into
// `modelStrategy: "random"` when they explicitly want random mapping.

import type { AgentDef } from "../roster.ts";

export const DEFAULT_CUSTOM_PROVIDER_URL =
  process.env.ZOMBIECODER_PROVIDER_URL ?? "https://gpu.zombiecoder.my.id/v1";
export const BASELINE_MODEL = "opencode/big-pickle";
export const DEFAULT_PROBE_TIMEOUT_MS = 4000;

export type CatalogModel = {
  ref: string;
  providerID: string;
  modelID: string;
  inputCost: number | null;
  outputCost: number | null;
  status: string | null;
  tools: boolean | null;
  enabled: boolean | null;
};

export type ProviderRecord = {
  providerID: string;
  name: string | null;
  baseURL: string | null;
  modelCount: number;
};

export type Catalog = {
  providers: ProviderRecord[];
  models: CatalogModel[];
};

export type ProbeResult = {
  url: string;
  ok: boolean;
  status: number | null;
  models: string[];
  ms: number;
  error?: string;
};

export type ModelPlan = {
  generatedAt: string;
  strategy: "custom-provider" | "free-fallback" | "baseline";
  customProviderUrl: string;
  customProviderID: string;
  providerBaseURL: string | null;
  defaultModel: string | null;
  probe: ProbeResult;
  candidates: string[];
  assignment: Record<string, string>;
  notes: string[];
};

// ---- 1. read OpenCode's own catalog through its real runtime doors ----
//
// The published d.ts declares `ctx.catalog`, but at runtime (desktop CLI 2.0.32)
// `ctx.catalog` is `undefined` while `ctx.provider` and `ctx.model` exist. Measured,
// not assumed:
//
//   surface:catalog  -> undefined
//   surface:provider -> ownKeys ["list","get","transform","reload"]
//   surface:model    -> ownKeys ["list","default","transform","reload"]
//   call:provider.list -> {location, data:[{id,name,settings:{baseURL},...}]}
//   call:model.list    -> {location, data:[{modelID,providerID,cost:[{input,output}],...}]}
//
// So the catalog is read with plain async methods. The transform door is NOT used
// for reading: its callback fires ~1.1s after setup returns, by which time any value
// read out of it has already been returned to the caller.

export type ProviderDoor = { list?: (input?: any) => Promise<any> };
export type ModelDoor = { list?: (input?: any) => Promise<any>; default?: (input?: any) => Promise<any> };
export type CatalogDoors = { provider?: ProviderDoor; model?: ModelDoor };

function unwrapList(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function firstCostEntry(cost: any): any {
  return Array.isArray(cost) ? cost[0] : cost;
}

// Provider.Info / Model.Info field names are not guaranteed stable across builds, so we
// look in several documented places instead of guessing one.
export function extractBaseUrl(provider: any): string | null {
  const candidates = [
    provider?.settings?.baseURL,
    provider?.settings?.baseUrl,
    provider?.baseURL,
    provider?.baseUrl,
    provider?.options?.baseURL,
    provider?.options?.baseUrl,
    provider?.request?.baseURL,
    provider?.transport?.url,
    provider?.url,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}

export async function readCatalog(doors: CatalogDoors | undefined): Promise<Catalog> {
  const out: Catalog = { providers: [], models: [] };
  if (!doors) return out;

  for (const raw of unwrapList(await safeCall(() => doors.provider?.list?.()))) {
    const providerID = raw?.id ?? raw?.providerID;
    if (typeof providerID !== "string" || !providerID) continue;
    out.providers.push({
      providerID,
      name: typeof raw?.name === "string" ? raw.name : null,
      baseURL: extractBaseUrl(raw),
      modelCount: 0,
    });
  }

  for (const raw of unwrapList(await safeCall(() => doors.model?.list?.()))) {
    const providerID = raw?.providerID;
    const modelID = raw?.modelID ?? raw?.id;
    if (typeof providerID !== "string" || typeof modelID !== "string") continue;
    const first = firstCostEntry(raw?.cost);
    out.models.push({
      ref: `${providerID}/${modelID}`,
      providerID,
      modelID,
      inputCost: typeof first?.input === "number" ? first.input : null,
      outputCost: typeof first?.output === "number" ? first.output : null,
      status: raw?.status ?? null,
      tools: raw?.capabilities?.tools ?? null,
      enabled: raw?.enabled ?? null,
    });
  }

  for (const provider of out.providers) {
    provider.modelCount = out.models.filter((m) => m.providerID === provider.providerID).length;
  }
  return out;
}

async function safeCall<T>(fn: () => Promise<T> | undefined): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

export async function readDefaultModel(doors: CatalogDoors | undefined): Promise<string | null> {
  const value = await safeCall(() => doors?.model?.default?.());
  const single = Array.isArray(value?.data) ? value.data[0] : value?.data;
  if (!single) return null;
  const providerID = single?.providerID;
  const modelID = single?.modelID ?? single?.id;
  return typeof providerID === "string" && typeof modelID === "string" ? `${providerID}/${modelID}` : null;
}

export function freeModels(catalog: Catalog): CatalogModel[] {
  return catalog.models.filter(
    (m) =>
      m.inputCost === 0 &&
      m.outputCost === 0 &&
      m.enabled !== false &&
      (m.status === null || m.status === "active"),
  );
}

export function findProvider(catalog: Catalog, providerID: string): ProviderRecord | undefined {
  return catalog.providers.find((p) => p.providerID === providerID);
}

// ---- 2. probe a URL: OpenAI-compatible or nothing ----

export function modelsUrl(url: string): string {
  const base = url.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

export async function probeOpenAiCompatible(
  url: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const started = Date.now();
  const target = modelsUrl(url);
  const result: ProbeResult = { url: target, ok: false, status: null, models: [], ms: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { signal: controller.signal });
    result.status = response.status;
    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }
    const body: any = await response.json();
    const data = Array.isArray(body?.data) ? body.data : [];
    // Some compatible gateways omit `object: "list"`. A well-formed model array is
    // the evidence that matters; the envelope field is not worth rejecting a live API.
    if (!Array.isArray(body?.data)) {
      result.error = "response is not an OpenAI-compatible model list";
      return result;
    }
    result.models = data.map((m: any) => m?.id).filter((x: any) => typeof x === "string");
    result.ok = true;
    return result;
  } catch (error: any) {
    result.error = error?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(error?.message ?? error);
    return result;
  } finally {
    clearTimeout(timer);
    result.ms = Date.now() - started;
  }
}

// ---- 3. deterministic mapping ----

export function stableHash(input: string): number {
  let h = 2166136261; // FNV-1a 32-bit
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function assignModels(
  agents: AgentDef[],
  candidates: string[],
  randomize = false,
): Record<string, string> {
  const assignment: Record<string, string> = {};
  if (candidates.length === 0) {
    for (const a of agents) assignment[a.id] = BASELINE_MODEL;
    return assignment;
  }
  for (const a of agents) {
    // A roster entry pinned by hand wins; otherwise the mapping is stable by
    // default, and intentionally random only when the owner asks for it.
    if (a.model && a.model !== BASELINE_MODEL && candidates.includes(a.model)) {
      assignment[a.id] = a.model;
      continue;
    }
    const index = randomize
      ? Math.floor(Math.random() * candidates.length)
      : stableHash(a.id) % candidates.length;
    assignment[a.id] = candidates[index];
  }
  return assignment;
}

export type ResolveOptions = {
  customProviderUrl?: string;
  customProviderID?: string;
  probeTimeoutMs?: number;
  skipProbe?: boolean;
  /** True when opencode.json already declares this provider (installer wrote it). */
  providerConfigured?: boolean;
  /** Spec §2 "random mapping" mode. Default is deterministic, for reproducible footprints. */
  randomize?: boolean;
};

export async function resolveModels(
  doors: CatalogDoors | undefined,
  agents: AgentDef[],
  options: ResolveOptions = {},
): Promise<ModelPlan> {
  const notes: string[] = [];
  const customProviderID = options.customProviderID ?? "missionbarisal";
  const configuredUrl = (options.customProviderUrl ?? DEFAULT_CUSTOM_PROVIDER_URL).trim();

  const catalog = await readCatalog(doors);
  const defaultModel = await readDefaultModel(doors);
  const free = freeModels(catalog);
  notes.push(
    `catalog(${doors?.provider ? "provider.list" : "no-provider-door"}/${
      doors?.model ? "model.list" : "no-model-door"
    }): ${catalog.providers.length} providers, ${catalog.models.length} models, ${free.length} at cost 0/0`,
  );
  if (defaultModel) notes.push(`OpenCode default model: ${defaultModel}`);

  const provider = configuredUrl ? findProvider(catalog, customProviderID) : undefined;
  const providerBase = provider?.baseURL ?? null;
  const probeTarget = providerBase ?? configuredUrl;

  let probe: ProbeResult;
  if (!configuredUrl) {
    // The owner chose "no custom provider" (installer `none` / empty config).
    // Do not probe a relative URL and do not quietly reuse a stale catalog entry.
    probe = {
      url: "",
      ok: false,
      status: null,
      models: [],
      ms: 0,
      error: "no custom provider configured",
    };
    notes.push("custom provider disabled by config — free-model fallback");
  } else if (options.skipProbe) {
    probe = { url: probeTarget, ok: false, status: null, models: [], ms: 0, error: "probe skipped" };
  } else {
    probe = await probeOpenAiCompatible(probeTarget, options.probeTimeoutMs);
  }

  if (configuredUrl) {
    if (provider) {
      notes.push(`custom provider "${customProviderID}" in catalog with ${provider.modelCount} models, baseURL ${providerBase ?? "(not exposed)"}`);
    } else {
      notes.push(`custom provider "${customProviderID}" not in catalog`);
    }
    notes.push(`probe ${probe.url} -> ${probe.ok ? `ok (${probe.models.length} models, ${probe.ms}ms)` : `failed: ${probe.error}`}`);
  }

  let strategy: ModelPlan["strategy"];
  let candidates: string[] = [];

  if (configuredUrl && (provider || options.providerConfigured) && probe.ok) {
    // Prefer the catalog's fully-hydrated model records, then the live probe.
    // The provider is often registered a moment AFTER setup starts (OpenCode
    // loads provider config in parallel), so a missing catalog entry must not
    // throw away a URL the installer already wrote.
    const fromCatalog = catalog.models
      .filter((m) => m.providerID === customProviderID)
      .map((m) => m.ref);
    candidates = fromCatalog.length > 0
      ? fromCatalog
      : probe.models.map((id) => `${customProviderID}/${id}`);
    strategy = candidates.length > 0 ? "custom-provider" : "free-fallback";
    if (candidates.length === 0) notes.push("provider reachable but exposes no models — falling back");
    else if (fromCatalog.length === 0) {
      notes.push("provider not in catalog yet — using model IDs from the live probe");
    }
  } else {
    // Either the provider is not registered, or it is registered and its server is down.
    strategy = "free-fallback";
    candidates = free.map((m) => m.ref);
    notes.push("custom provider unusable — agents move to OpenCode's free models");
  }

  if (candidates.length === 0) {
    candidates = [BASELINE_MODEL];
    strategy = "baseline";
    notes.push(`no free models available — pinned to baseline ${BASELINE_MODEL}`);
  }

  const assignment = assignModels(agents, candidates, options.randomize === true);
  notes.push(
    options.randomize
      ? `random mapping over ${candidates.length} candidate(s) (modelStrategy: random)`
      : `deterministic FNV-1a mapping over ${candidates.length} candidate(s)`,
  );

  return {
    generatedAt: new Date().toISOString(),
    strategy,
    customProviderUrl: configuredUrl,
    customProviderID,
    providerBaseURL: providerBase,
    defaultModel,
    probe,
    candidates,
    assignment,
    notes,
  };
}


