#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer } from "./mcp-client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-brand-selfcheck-"));
execFileSync("python3", [path.join(HERE, "fixtures.py"), "--dir", dir], { stdio: "ignore" });

const client = await startServer();
try {
  const init = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "selfcheck", version: "1" },
  });
  assert.equal(init.serverInfo.name, "image-brand");

  const list = await client.request("tools/list", {});
  assert.equal(list.tools.length, 4);

  const result = await client.callTool("image_brand", {
    input: path.join(dir, "input.jpg"),
    logo: path.join(dir, "logo.png"),
    output: path.join(dir, "branded.jpg"),
    title: "বাংলা ব্র্যান্ড টেস্ট",
    subtitle: "পাবলিক ডোমেইন · পরীক্ষা",
    attribution: "Selfcheck fixture · CC0",
    source: { provider: "fixture", license: "CC0", page: "local" },
  });

  assert.ok(fs.existsSync(result.output), "branded output missing");
  assert.ok(result.output_bytes > 10000, `output too small: ${result.output_bytes}`);
  const sidecar = JSON.parse(fs.readFileSync(result.sidecar, "utf8"));
  assert.equal(sidecar.title, "বাংলা ব্র্যান্ড টেস্ট");
  assert.equal(sidecar.license, "CC0");
  assert.equal(sidecar.fonts.raqm, true, "Pillow must have raqm for Bengali conjuncts");

  console.log(`tools=4 pipeline=ok bytes=${result.output_bytes} sha=${result.output_sha256.slice(0, 12)}`);
  console.log(`output=${result.output}`);
} finally {
  await client.close();
}
