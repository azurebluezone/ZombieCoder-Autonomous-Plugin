import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  assignModels,
  extractBaseUrl,
  freeModels,
  modelRef,
  modelsUrl,
  probeOpenAiCompatible,
  readCatalog,
  resolveModels,
  stableHash,
  type Catalog,
} from "../src/zombie/models.ts";
import { ROSTER } from "../src/roster.ts";

function withServer<T>(handler: http.RequestListener, run: (base: string) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      try {
        resolve(await run(base));
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test("stableHash is deterministic", () => {
  assert.equal(stableHash("manu"), stableHash("manu"));
  assert.notEqual(stableHash("manu"), stableHash("jarin"));
});

test("assignModels is deterministic by default and random when asked", () => {
  const candidates = ["a/1", "b/2", "c/3"];
  const first = assignModels(ROSTER, candidates);
  const second = assignModels(ROSTER, candidates);
  assert.deepEqual(first, second);
  for (const model of Object.values(first)) assert.ok(candidates.includes(model));

  const random = assignModels(ROSTER, candidates, true);
  for (const model of Object.values(random)) assert.ok(candidates.includes(model));
});

test("assignModels spreads agents across the candidate pool", () => {
  const candidates = ["a/1", "b/2", "c/3"];
  const assigned = assignModels(ROSTER, candidates);
  const used = new Set(Object.values(assigned));
  assert.equal(used.size, candidates.length, "every candidate should carry at least one agent");
});

test("assignModels pins to baseline when there are no candidates", () => {
  const assigned = assignModels(ROSTER, []);
  assert.equal(assigned.manu, "opencode/big-pickle");
});

test("random assignment shuffles the pool and uses every candidate before repeating", () => {
  const candidates = ["a/1", "b/2", "c/3"];
  const first = assignModels(ROSTER, candidates, true, undefined, () => 0);
  const second = assignModels(ROSTER, candidates, true, undefined, () => 0);
  assert.deepEqual(first, second, "an injected random source must be reproducible");
  assert.equal(new Set(Object.values(first)).size, candidates.length, "every candidate must be used");
  for (const model of Object.values(first)) assert.ok(candidates.includes(model));

  const three = assignModels(ROSTER.slice(0, 3), candidates, true, undefined, () => 0.5);
  assert.deepEqual(new Set(Object.values(three)), new Set(candidates));
  assert.equal(Object.keys(three).length, 3);
});

test("free strategy spreads every free model across the roster instead of pinning one", async () => {
  const free = Array.from({ length: 9 }, (_, index) => ({
    providerID: "opencode",
    modelID: `free-${index}`,
    cost: [{ input: 0, output: 0 }],
    status: "active",
    capabilities: { tools: true },
    enabled: true,
  }));
  const plan = await resolveModels(
    {
      provider: { list: async () => ({ data: [] }) },
      model: { list: async () => ({ data: free }) },
    },
    ROSTER,
    { customProviderUrl: "", strategy: "free" },
  );
  assert.equal(plan.strategy, "free-fallback");
  assert.equal(plan.candidates.length, 9);
  const used = new Set(Object.values(plan.assignment));
  assert.equal(used.size, 9, "nine agents must land on nine distinct free models");
  assert.ok(!used.has("opencode/big-pickle"), "the baseline placeholder must not survive a free plan");
});

test("freeModels keeps only cost 0/0 active models", () => {
  const catalog: Catalog = {
    providers: [],
    models: [
      { ref: "a/free", providerID: "a", modelID: "free", inputCost: 0, outputCost: 0, status: "active", tools: true, enabled: true },
      { ref: "a/paid", providerID: "a", modelID: "paid", inputCost: 1, outputCost: 1, status: "active", tools: true, enabled: true },
      { ref: "a/off", providerID: "a", modelID: "off", inputCost: 0, outputCost: 0, status: "active", tools: true, enabled: false },
      { ref: "a/notext", providerID: "a", modelID: "notext", inputCost: 0, outputCost: 0, status: "active", tools: false, enabled: true },
    ],
  };
  assert.deepEqual(freeModels(catalog).map((m) => m.ref), ["a/free"]);
});

test("modelsUrl handles base and /v1 URLs", () => {
  assert.equal(modelsUrl("https://x.test"), "https://x.test/v1/models");
  assert.equal(modelsUrl("https://x.test/v1/"), "https://x.test/v1/models");
});

test("modelRef never builds provider/undefined", () => {
  assert.equal(modelRef("missionbarisal", "m1"), "missionbarisal/m1");
  assert.equal(modelRef("missionbarisal", undefined), null);
  assert.equal(modelRef("missionbarisal", ""), null);
  assert.equal(modelRef("", "m1"), null);
});

test("readCatalog reads provider.list and model.list", async () => {
  const catalog = await readCatalog({
    provider: { list: async () => ({ data: [{ id: "custom", name: "Custom", settings: { baseURL: "https://api.test/v1" } }] }) },
    model: {
      list: async () => ({
        data: [
          { providerID: "custom", modelID: "m1", cost: [{ input: 0, output: 0 }], status: "active", capabilities: { tools: true }, enabled: true },
        ],
      }),
    },
  });
  assert.equal(catalog.providers.length, 1);
  assert.equal(extractBaseUrl({ settings: { baseURL: "https://api.test/v1" } }), "https://api.test/v1");
  assert.equal(catalog.models[0].ref, "custom/m1");
});

test("probeOpenAiCompatible accepts a data[] list without object:list", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "live-model" }] }));
    },
    async (base) => {
      const result = await probeOpenAiCompatible(base, 2000);
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, ["live-model"]);
    },
  );
});

test("probeOpenAiCompatible sends the configured bearer key", async () => {
  let authorization = "";
  await withServer(
    (req, res) => {
      authorization = String(req.headers.authorization ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "secured-model" }] }));
    },
    async (base) => {
      const result = await probeOpenAiCompatible(base, 2000, "secret-key");
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, ["secured-model"]);
    },
  );
  assert.equal(authorization, "Bearer secret-key");
});

test("probeOpenAiCompatible reports HTTP failures", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503).end("nope");
    },
    async (base) => {
      const result = await probeOpenAiCompatible(base, 2000);
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /503/);
    },
  );
});

test("resolveModels uses the live probe when the provider is configured but not yet in the catalog", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
    },
    async (base) => {
      const plan = await resolveModels(
        {
          provider: { list: async () => ({ data: [] }) },
          model: { list: async () => ({ data: [] }), default: async () => ({ data: null }) },
        },
        ROSTER,
        { customProviderUrl: base, customProviderID: "missionbarisal", providerConfigured: true, probeTimeoutMs: 2000 },
      );
      assert.equal(plan.strategy, "custom-provider");
      assert.deepEqual(plan.candidates, ["missionbarisal/probe-model"]);
    },
  );
});

test("resolveModels falls back to free models when no custom provider is configured", async () => {
  const plan = await resolveModels(
    {
      provider: { list: async () => ({ data: [] }) },
      model: {
        list: async () => ({
          data: [
            { providerID: "opencode", modelID: "big-pickle", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
          ],
        }),
        default: async () => ({ data: { providerID: "opencode", modelID: "big-pickle" } }),
      },
    },
    ROSTER,
    { customProviderUrl: "" },
  );
  assert.equal(plan.strategy, "free-fallback");
  assert.deepEqual(plan.candidates, ["opencode/big-pickle"]);
});

test("resolveModels respects modelStrategy: free without probing the custom provider", async () => {
  let requests = 0;
  await withServer(
    (_req, res) => {
      requests += 1;
      res.end(JSON.stringify({ data: [{ id: "should-not-be-used" }] }));
    },
    async (base) => {
      const plan = await resolveModels(
        {
          provider: { list: async () => ({ data: [] }) },
          model: {
            list: async () => ({
              data: [
                { providerID: "opencode", modelID: "free-one", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
              ],
            }),
          },
        },
        ROSTER,
        { customProviderUrl: base, strategy: "free" },
      );
      assert.equal(plan.strategy, "free-fallback");
      assert.deepEqual(plan.candidates, ["opencode/free-one"]);
    },
  );
  assert.equal(requests, 0, "strategy=free must not call the custom provider");
});

test("resolveModels respects modelStrategy: baseline without probing", async () => {
  const plan = await resolveModels(
    { provider: { list: async () => ({ data: [] }) }, model: { list: async () => ({ data: [] }) } },
    ROSTER,
    { customProviderUrl: "http://127.0.0.1:9/v1", strategy: "baseline" },
  );
  assert.equal(plan.strategy, "baseline");
  assert.deepEqual(plan.candidates, ["opencode/big-pickle"]);
  assert.equal(plan.probe.ok, false);
});

test("resolveModels treats an empty /models list as unusable and prefers free models", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [] }));
    },
    async (base) => {
      const plan = await resolveModels(
        {
          provider: { list: async () => ({ data: [] }) },
          model: {
            list: async () => ({
              data: [
                { providerID: "opencode", modelID: "free-empty-fallback", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
              ],
            }),
          },
        },
        ROSTER,
        { customProviderUrl: base, providerConfigured: true, strategy: "auto" },
      );
      assert.equal(plan.strategy, "free-fallback");
      assert.deepEqual(plan.candidates, ["opencode/free-empty-fallback"]);
    },
  );
});

test("resolveModels sends the provider key while probing", async () => {
  let authorization = "";
  await withServer(
    (req, res) => {
      authorization = String(req.headers.authorization ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "keyed-model" }] }));
    },
    async (base) => {
      const plan = await resolveModels(
        { provider: { list: async () => ({ data: [] }) }, model: { list: async () => ({ data: [] }) } },
        ROSTER,
        {
          customProviderUrl: base,
          customProviderID: "gateway",
          providerConfigured: true,
          customProviderApiKey: "gateway-key",
        },
      );
      assert.equal(plan.strategy, "custom-provider");
      assert.deepEqual(plan.candidates, ["gateway/keyed-model"]);
    },
  );
  assert.equal(authorization, "Bearer gateway-key");
});

test("resolveModels with strategy custom never assigns a dead provider", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503).end("down");
    },
    async (base) => {
      const plan = await resolveModels(
        { provider: { list: async () => ({ data: [] }) }, model: { list: async () => ({ data: [] }) } },
        ROSTER,
        { customProviderUrl: base, providerConfigured: true, strategy: "custom" },
      );
      assert.equal(plan.strategy, "baseline");
      assert.deepEqual(plan.candidates, ["opencode/big-pickle"]);
    },
  );
});
