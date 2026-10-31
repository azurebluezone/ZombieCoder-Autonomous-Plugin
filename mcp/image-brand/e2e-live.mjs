#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "./mcp-client.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-brand-live-"));
const client = await startServer({ timeoutMs: 180000 });
try {
  const init = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "e2e-live", version: "1" },
  });
  assert.equal(init.serverInfo.name, "image-brand");

  const list = await client.request("tools/list", {});
  assert.equal(list.tools.length, 5);

  const search = await client.callTool("image_search", { query: "tea caddy", provider: "met", limit: 2 });
  assert.ok(search.results?.length > 0, "Met search returned no PD images");
  const hit = search.results[0];
  assert.match(hit.image_url, /^https:\/\//);
  assert.equal(hit.license, "Public Domain");

  const fetched = await client.callTool("image_fetch", {
    url: hit.image_url,
    title: hit.title,
    creator: hit.creator,
    license: hit.license,
    page: hit.page_url,
    provider: hit.provider,
    output_dir: dir,
  });
  assert.ok(fs.existsSync(fetched.file), "fetched file missing");

  const branded = await client.callTool("image_brand", {
    input: fetched.file,
    output: path.join(dir, "branded.jpg"),
    title: "চায়ের কাপে ইতিহাস",
    subtitle: "মেট মিউজিয়াম · পাবলিক ডোমেইন",
    attribution: `Image: ${hit.creator} · ${hit.license}`,
    source: { provider: hit.provider, license: hit.license, page: hit.page_url, creator: hit.creator },
  });
  assert.ok(fs.existsSync(branded.output), "branded output missing");
  assert.ok(branded.output_bytes > 10000, `output too small: ${branded.output_bytes}`);
  const sidecar = JSON.parse(fs.readFileSync(branded.sidecar, "utf8"));
  assert.equal(sidecar.title, "চায়ের কাপে ইতিহাস");
  assert.equal(sidecar.license, "Public Domain");

  const fitted = await client.callTool("image_fit", {
    input: fetched.file,
    output: path.join(dir, "fit-1200x630.jpg"),
    width: 1200,
    height: 630,
    fit: "cover",
    quality: 88,
    source: { provider: hit.provider, license: hit.license, page: hit.page_url, creator: hit.creator },
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(fitted.sidecar, "utf8")).canvas, [1200, 630]);

  console.log(`tools=5 source=met image=ok fit=${fitted.width}x${fitted.height} bytes=${branded.output_bytes} sha=${branded.output_sha256.slice(0, 12)}`);
  console.log(`hit=${hit.title} | ${hit.creator} | ${hit.license}`);
  console.log(`output=${branded.output}`);
} finally {
  await client.close();
}
