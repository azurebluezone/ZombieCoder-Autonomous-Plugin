import test from "node:test";
import assert from "node:assert/strict";
import { planInstallSpace, SPACE_ESTIMATE } from "../src/install/space.ts";

const MB = 1024 * 1024;

test("enough space passes without touching the cache", () => {
  const plan = planInstallSpace({
    freeBytes: SPACE_ESTIMATE.base + SPACE_ESTIMATE.deps + SPACE_ESTIMATE.lsp + 100 * MB,
    needDeps: true,
    needLsp: true,
    cacheBytes: 300 * MB,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.cleanCache, false);
  assert.equal(plan.shortfallBytes, 0);
});

test("a small shortfall is covered by the regenerable npm cache", () => {
  const plan = planInstallSpace({
    freeBytes: 270 * MB,
    needDeps: true,
    needLsp: true,
    cacheBytes: 310 * MB,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.cleanCache, true);
  assert.match(plan.messages.join("\n"), /npm cache/);
});

test("--keep-cache blocks the automatic clean", () => {
  const plan = planInstallSpace({
    freeBytes: 270 * MB,
    needDeps: true,
    needLsp: true,
    cacheBytes: 310 * MB,
    keepCache: true,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.cleanCache, false);
  assert.match(plan.messages.join("\n"), /--keep-cache/);
  assert.match(plan.messages.join("\n"), /--no-lsp/);
});

test("no cache and no space is a hard stop with exact numbers", () => {
  const plan = planInstallSpace({
    freeBytes: 100 * MB,
    needDeps: true,
    needLsp: true,
    cacheBytes: 0,
  });
  assert.equal(plan.ok, false);
  assert.ok(plan.shortfallBytes > 0);
  assert.match(plan.messages.join("\n"), /কিছুই লেখা হয়নি/);
});

test("--force-low-space proceeds but warns", () => {
  const plan = planInstallSpace({
    freeBytes: 100 * MB,
    needDeps: true,
    needLsp: true,
    cacheBytes: 0,
    force: true,
  });
  assert.equal(plan.ok, true);
  assert.match(plan.messages.join("\n"), /--force-low-space/);
});

test("an update that skips deps and LSP needs almost no space", () => {
  const plan = planInstallSpace({
    freeBytes: 40 * MB,
    needDeps: false,
    needLsp: false,
    cacheBytes: 0,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.requiredBytes, Math.ceil(SPACE_ESTIMATE.base * 1.1));
});
