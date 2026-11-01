// ZombieCoder — live runner identity.
//
// Two identities meet in every request and must not be confused:
//   - the runner (OpenCode + the provider/model it points at) belongs to OpenCode;
//   - the agent speaking belongs to ZombieCoder.
// This module states which side of that line the current request is on. It only
// upgrades "free" or "local" when the live catalog supports it (cost 0/0 or a
// loopback/LAN baseURL); everything else stays "remote" or "unknown" so the
// prompt cannot turn a guess into a claim.

export type LocalProvider = {
  providerID: string;
  baseURL: string | null;
};

export type RunnerFacts = {
  /** Model refs the live catalog reports at cost 0/0. */
  freeRefs?: readonly string[];
  /** Providers whose catalog baseURL resolves to loopback or a private network. */
  localProviders?: readonly LocalProvider[];
  /** The project's own custom provider id, when one is configured. */
  customProviderID?: string;
};

export type AgentIdentity = {
  id: string;
  name?: string | null;
  role?: string | null;
};

export type RunnerKind = "local" | "free" | "custom" | "remote" | "unknown";

export type RunnerIdentity = {
  ref: string | null;
  providerID: string | null;
  modelID: string | null;
  kind: RunnerKind;
  /** Why this kind won — audit material, never shown as a claim. */
  evidence: string;
  /** One-line self-introduction for the model prompt. */
  line: string;
};

// Provider ids cannot be verified as local on their own. This list only catches
// the common local servers when the catalog hides their baseURL; the baseURL
// check below stays the primary evidence.
const LOCAL_PROVIDER_IDS = new Set([
  "ollama",
  "lmstudio",
  "lm-studio",
  "llamacpp",
  "llama-cpp",
  "llama.cpp",
  "vllm",
  "localai",
  "local-ai",
  "koboldcpp",
  "jan",
]);

export function isLocalBaseUrl(url: string | null | undefined): boolean {
  const raw = String(url ?? "").trim();
  if (!raw) return false;
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "[::1]" || host === "0.0.0.0") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  // A dotless hostname cannot be public DNS; it is a machine/container name.
  if (!host.includes(".") && !host.includes(":")) return true;
  return false;
}

export function parseRunnerRef(ref: string | null | undefined): {
  ref: string;
  providerID: string;
  modelID: string;
} | null {
  const value = typeof ref === "string" ? ref.trim() : "";
  if (!value || /\s/.test(value)) return null;
  // Split on the first slash only: OpenRouter-style model ids contain more.
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return {
    ref: value,
    providerID: value.slice(0, slash),
    modelID: value.slice(slash + 1),
  };
}

export function classifyRunner(
  ref: string | null | undefined,
  facts: RunnerFacts = {},
): Omit<RunnerIdentity, "line"> {
  const parsed = parseRunnerRef(ref);
  if (!parsed) {
    return {
      ref: null,
      providerID: null,
      modelID: null,
      kind: "unknown",
      evidence: "no providerID/modelID reached the context hook",
    };
  }

  const local = facts.localProviders?.find((p) => p.providerID === parsed.providerID);
  if (local) {
    return {
      ...parsed,
      kind: "local",
      evidence: `provider ${parsed.providerID} baseURL ${local.baseURL ?? "(not exposed)"} is loopback/LAN`,
    };
  }
  if (LOCAL_PROVIDER_IDS.has(parsed.providerID.toLowerCase())) {
    return {
      ...parsed,
      kind: "local",
      evidence: `provider id "${parsed.providerID}" is a known local server (catalog baseURL not exposed)`,
    };
  }
  if ((facts.freeRefs ?? []).includes(parsed.ref)) {
    return {
      ...parsed,
      kind: "free",
      evidence: `live catalog reports ${parsed.ref} at cost 0/0`,
    };
  }
  if (facts.customProviderID && facts.customProviderID === parsed.providerID) {
    return {
      ...parsed,
      kind: "custom",
      evidence: `provider ${parsed.providerID} is the project's custom provider; no 0/0 evidence`,
    };
  }
  return {
    ...parsed,
    kind: "remote",
    evidence: `no cost 0/0 or local baseURL evidence for ${parsed.ref}`,
  };
}

// Display-only Bengali names. The roster keeps the canonical Latin id/name; this
// map exists so a Bengali self-introduction does not switch script mid-sentence.
// An unmapped agent (OpenCode builtins such as build/plan) keeps its own id.
const BENGALI_NAMES: Record<string, string> = {
  manu: "মনু",
  jarin: "জারিন",
  brishti: "বৃষ্টি",
  rashed: "রাশেদ",
  halim: "হালিম",
  majnu: "মজনু",
  nila: "নীলা",
  tuhin: "তুহিন",
  zombiecoder: "জম্বি কোডার",
};

function agentIntro(agent: AgentIdentity): string {
  const key = String(agent?.id ?? "").trim().toLowerCase();
  const canonicalName = String(agent?.name ?? "").trim() || String(agent?.id ?? "").trim() || "unknown";
  const name = BENGALI_NAMES[key] ?? canonicalName;
  const role = String(agent?.role ?? "").trim() || "OpenCode builtin runner";
  return `আমি ZombieCoder, এজেন্ট ${name} — ${role}।`;
}

function runnerSentence(identity: Omit<RunnerIdentity, "line">, facts: RunnerFacts): string {
  const local = facts.localProviders?.find((p) => p.providerID === identity.providerID);
  switch (identity.kind) {
    case "local":
      return `এই session-এ লোকাল মডেল ${identity.ref} ব্যবহার করছি। প্রমাণ: provider ${
        identity.providerID
      }-এর baseURL ${local?.baseURL ?? "(catalog-e local server)"}।`;
    case "free":
      return `এই session-এ OpenCode-এর ফ্রি মডেল ${identity.ref} ব্যবহার করছি। প্রমাণ: live catalog cost 0/0।`;
    case "custom":
      return `এই session-এ project-এর custom provider ${identity.providerID}-এর মডেল ${identity.ref} চলছে; cost 0/0 প্রমাণ ছাড়া ফ্রি বলব না।`;
    case "remote":
      return `এই session-এ ${identity.ref} চলছে (provider ${identity.providerID}); live catalog-এ ফ্রি বা লোকাল প্রমাণ নেই, তাই ওভাবে দাবি করব না।`;
    default:
      return "এই request-এ model ref পাওয়া যায়নি; ফ্রি বা লোকাল বলে দাবি করব না।";
  }
}

export function renderRunnerIdentity(
  agent: AgentIdentity,
  ref: string | null | undefined,
  facts: RunnerFacts = {},
): string {
  const identity = classifyRunner(ref, facts);
  const suffix =
    "Plugin identity: ZombieCoder (X-ZombieCoder-Powered-By); OpenCode-এর providerID/modelID ও metadata অপরিবর্তিত।";
  return [agentIntro(agent), runnerSentence(identity, facts), suffix].join(" ");
}

export function buildRunnerIdentity(
  agent: AgentIdentity,
  ref: string | null | undefined,
  facts: RunnerFacts = {},
): RunnerIdentity {
  const identity = classifyRunner(ref, facts);
  return { ...identity, line: renderRunnerIdentity(agent, ref, facts) };
}
