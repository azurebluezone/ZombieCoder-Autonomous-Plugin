// Identity checksum tests.
//
// The audit found a stored checksum that no serializer could reproduce. These
// tests pin the canonical form and prove the shipped identity.json verifies.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalJson,
  identityChecksum,
  identityPayload,
  verifyIdentityChecksum,
} from "../src/identity.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("canonicalJson sorts keys and drops whitespace", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, 4] } }), '{"a":{"c":[3,4],"d":2},"b":1}');
});

test("a new payload verifies against its own checksum", () => {
  const payload = identityPayload({ generatedAt: "2026-10-25T00:00:00.000Z", version: "0.1.0", versionSource: "test", runtime: { version: "2.2.3", source: "test" } });
  const result = verifyIdentityChecksum(payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stored, /^[0-9a-f]{64}$/);
});

test("changing one value breaks the checksum", () => {
  const payload = identityPayload({ generatedAt: "2026-10-25T00:00:00.000Z", version: "0.1.0", versionSource: "test", runtime: { version: "2.2.3", source: "test" } });
  payload.system_identity.branding.owner = "someone else";
  assert.equal(verifyIdentityChecksum(payload).ok, false);
});

test("checksum ignores its own field", () => {
  const payload = identityPayload({ generatedAt: "2026-10-25T00:00:00.000Z", version: "0.1.0", versionSource: "test", runtime: { version: "2.2.3", source: "test" } });
  const before = identityChecksum(payload);
  payload.system_identity.manifest.checksum = "0".repeat(64);
  assert.equal(identityChecksum(payload), before);
});

test("shipped doc/identity.json verifies (npm run identity:check contract)", () => {
  const file = path.join(ROOT, "doc", "identity.json");
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = verifyIdentityChecksum(payload);
  assert.equal(result.ok, true, `stored=${result.stored} computed=${result.computed}`);
});

test("identity version is the product version, never a runtime build", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, "doc", "identity.json"), "utf8")).system_identity;
  assert.equal(shipped.version, pkg.version, "identity.version must come from package.json");
  assert.equal(shipped.version_source, "package.json");
  assert.ok(shipped.runtime && typeof shipped.runtime.version === "string", "runtime build is recorded separately");

  const base = { generatedAt: "2026-10-25T00:00:00.000Z", version: pkg.version, versionSource: "package.json" };
  const oldRuntime = identityPayload({ ...base, runtime: { version: "2.2.3", source: "test" } });
  const newRuntime = identityPayload({ ...base, runtime: { version: "2.2.4", source: "test" } });
  assert.equal(oldRuntime.system_identity.version, newRuntime.system_identity.version);
  assert.notEqual(oldRuntime.system_identity.runtime.version, newRuntime.system_identity.runtime.version);
});

test("doc/identity.js is rebuilt from identity.json, not hand-written", async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, "doc", "identity.json"), "utf8")).system_identity;
  const mod: any = await import(pathToFileURL(path.join(ROOT, "doc", "identity.js")).href);
  assert.equal(mod.IDENTITY.version, pkg.version, "installed identity.js drifted from package.json");
  assert.equal(mod.IDENTITY.version, shipped.version);
  assert.equal(mod.IDENTITY.runtime?.version, shipped.runtime.version);
  assert.equal(mod.IDENTITY_MANIFEST.checksum, shipped.manifest.checksum);
});
