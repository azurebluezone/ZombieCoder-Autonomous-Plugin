import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  assignModels,
  extractBaseUrl,
  freeModels,
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

test("assignModels pins to baseline when there are no candidates", () => {
  const assigned = assignModels(ROSTER, []);
  assert.equal(assigned.manu, "opencode/big-pickle");
});

test("freeModels keeps only cost 0/0 active models", () => {
  const catalog: Catalog = {
    providers: [],
    models: [
      { ref: "a/free", providerID: "a", modelID: "free", inputCost: 0, outputCost: 0, status: "active", tools: true, enabled: true },
      { ref: "a/paid", providerID: "a", modelID: "paid", inputCost: 1, outputCost: 1, status: "active", tools: true, enabled: true },
      { ref: "a/off", providerID: "a", modelID: "off", inputCost: 0, outputCost: 0, status: "active", tools: true, enabled: false },
    ],
  };
  assert.deepEqual(freeModels(catalog).map((m) => m.ref), ["a/free"]);
});

test("modelsUrl handles base and /v1 URLs", () => {
  assert.equal(modelsUrl("https://x.test"), "https://x.test/v1/models");
  assert.equal(modelsUrl("https://x.test/v1/"), "https://x.test/v1/models");
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
