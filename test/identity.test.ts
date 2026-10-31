// Identity checksum tests.
//
// The audit found a stored checksum that no serializer could reproduce. These
// tests pin the canonical form and prove the shipped identity.json verifies.

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
  const payload = identityPayload({ generatedAt: "2026-10-25T00:00:00.000Z", version: "0.1.0", versionSource: "test" });
  const result = verifyIdentityChecksum(payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stored, /^[0-9a-f]{64}$/);
});

test("changing one value breaks the checksum", () => {
  const payload = identityPayload({ generatedAt: "2026-10-25T00:00:00.000Z", version: "0.1.0", versionSource: "test" });
  payload.system_identity.branding.owner = "someone else";
  assert.equal(verifyIdentityChecksum(payload).ok, false);
});

test("checksum ignores its own field", () => {
  const payload = identityPayload({ generatedAt: "2026-10-25T00:00:00.000Z", version: "0.1.0", versionSource: "test" });
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
