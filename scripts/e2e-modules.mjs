#!/usr/bin/env node
// End-to-end proof for the module work, using real binaries and real files.
//
//   node --experimental-strip-types scripts/e2e-modules.mjs
//
// Every check is a live observation, not a fixture:
//   opencode          a V2 binary answers --version
//   mcp_tools         image-brand/public-api answer initialize + tools/list over stdio
//   web_decorate      a real Pillow decoration pack is written and read back
//   design_sketch     sketch.md + design.json are written for a real brief
//   skills            a bundled skill is installed as skills/<name>/SKILL.md and parsed
//   lsp_diagnostics   a language server reports an injected type error
//
// The final line is the goal-contract output and must be exact:
//   E2E_MODULES: PASS opencode=present web_decorate=ok design_sketch=ok skills=ok lsp_diagnostics=ok mcp_tools=ok

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { startServer } from "../mcp/shared/client.mjs";
import {
  findOpenCodeBinary,
  inspectVersion,
} from "../src/zombie/opencodeRuntime.ts";
import { buildDesignSketch } from "../src/zombie/design.ts";
import { installNativeSkill, listSkillCatalog, SKILL_CATALOG } from "../src/zombie/skillCatalog.ts";
import { parseFrontmatter } from "../src/zombie/frontmatter.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-e2e-modules-"));
const results = new Map();

function note(text) {
  if (text) console.log(`      ${text}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.set(name, { ok: true, detail });
    console.log(`ok    ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    const message = String(error?.stack ?? error?.message ?? error);
    results.set(name, { ok: false, error: message });
    console.error(`FAIL  ${name} — ${message}`);
  }
}

async function rpcTools(serverFile) {
  const client = await startServer(serverFile, { timeoutMs: 25000 });
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "zombiecoder-e2e", version: "1" },
    });
    const list = await client.request("tools/list", {});
    const names = (Array.isArray(list?.tools) ? list.tools : [])
      .map((tool) => tool?.name)
      .filter((name) => typeof name === "string");
    return { client, init, names };
  } catch (error) {
    await client.close();
    throw error;
  }
}

await check("opencode", () => {
  const binary =
    process.env.OPENCODE_BIN || findOpenCodeBinary({ home: os.homedir(), env: process.env });
  if (!binary) throw new Error("no opencode binary found on PATH");
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 20000 });
  if (probe.error) throw new Error(String(probe.error.message ?? probe.error));
  if (probe.status !== 0) throw new Error(`${binary} --version exited ${probe.status}`);
  const info = inspectVersion(binary, () => `${probe.stdout ?? ""}${probe.stderr ?? ""}`);
  if (!info.found) throw new Error(`cannot parse version: ${probe.stdout}`);
  if (info.major < 2) throw new Error(`${binary} is V${info.major}; V2 is required`);
  return `${info.version} at ${binary}`;
});

await check("mcp_tools", async () => {
  const image = await rpcTools(path.join(ROOT, "mcp", "image-brand", "server.mjs"));
  try {
    if (image.init?.serverInfo?.name !== "image-brand") {
      throw new Error(`unexpected image-brand serverInfo: ${JSON.stringify(image.init?.serverInfo)}`);
    }
    if (image.names.length !== 6) {
      throw new Error(`image-brand tools=${image.names.length}, expected 6`);
    }
    for (const required of ["image_search", "image_fetch", "image_brand", "image_fit", "image_batch", "web_decorate"]) {
      if (!image.names.includes(required)) throw new Error(`image-brand missing ${required}`);
    }
  } finally {
    await image.client.close();
  }

  const pub = await rpcTools(path.join(ROOT, "mcp", "public-api", "server.mjs"));
  try {
    if (pub.init?.serverInfo?.name !== "public-api") {
      throw new Error(`unexpected public-api serverInfo: ${JSON.stringify(pub.init?.serverInfo)}`);
    }
    if (pub.names.length < 4) throw new Error(`public-api tools=${pub.names.length}, expected >=4`);
    return `image-brand=${image.names.length}, public-api=${pub.names.length}`;
  } finally {
    await pub.client.close();
  }
});

await check("web_decorate", async () => {
  const fixtures = path.join(TMP, "fixtures");
  execFileSync("python3", [path.join(ROOT, "mcp", "image-brand", "fixtures.py"), "--dir", fixtures], {
    stdio: "ignore",
    timeout: 60000,
  });
  const input = path.join(fixtures, "input.jpg");
  const logo = path.join(fixtures, "logo.png");
  if (!fs.existsSync(input) || !fs.existsSync(logo)) throw new Error("fixture generation failed");

  const client = await startServer(path.join(ROOT, "mcp", "image-brand", "server.mjs"), {
    timeoutMs: 60000,
  });
  try {
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "zombiecoder-e2e", version: "1" },
    });
    const out = path.join(TMP, "site");
    const site = await client.callTool("web_decorate", {
      site: "lms",
      brand: "E2E Academy",
      headline: "শেখা হোক প্রতিদিনের অভ্যাস",
      subheadline: "লাইভ ক্লাস, রেকর্ডিং আর প্রগ্রেস এক জায়গায়।",
      logo,
      images: [input, input],
      output_dir: out,
    });
    if (site.cards !== 3) throw new Error(`expected 3 cards, got ${site.cards}`);
    for (const key of ["html", "css", "logo", "hero", "og", "manifest"]) {
      const file = site.files?.[key];
      if (!file || !fs.existsSync(file)) throw new Error(`missing generated file: ${key}`);
    }
    const html = fs.readFileSync(site.files.html, "utf8");
    if (!html.includes("E2E Academy")) throw new Error("html does not contain the brand");
    if (!html.includes("loading")) throw new Error("html does not include a loading state");
    const manifest = JSON.parse(fs.readFileSync(site.manifest, "utf8"));
    if (manifest.tool !== "web_decorate") throw new Error("manifest tool is wrong");
    if (!manifest.hashes?.html) throw new Error("manifest has no html hash");
    if (path.basename(site.files.logo) !== "e2e-academy-logo.png") {
      throw new Error(`logo is not site-named: ${site.files.logo}`);
    }
    return `${site.files.html} (${site.cards} cards, ${Object.keys(manifest.hashes).length} hashes)`;
  } finally {
    await client.close();
  }
});

await check("design_sketch", () => {
  const project = path.join(TMP, "design-project");
  fs.mkdirSync(project, { recursive: true });
  const sketch = buildDesignSketch(project, {
    brief: "E2E clinic appointment flow",
    brand: "E2E Clinic",
    site: "hospital",
    screens: ["Home", "Departments", "Appointment"],
  });
  if (!fs.existsSync(sketch.sketch)) throw new Error("sketch.md missing");
  if (!fs.existsSync(sketch.spec)) throw new Error("design.json missing");
  const spec = JSON.parse(fs.readFileSync(sketch.spec, "utf8"));
  if (spec.site !== "hospital") throw new Error(`site=${spec.site}`);
  if (!Array.isArray(spec.states) || spec.states.length !== 4) throw new Error("state matrix incomplete");
  const markdown = fs.readFileSync(sketch.sketch, "utf8");
  if (!markdown.includes("## Wireframe")) throw new Error("wireframe missing");
  return path.relative(ROOT, sketch.sketch);
});

await check("skills", () => {
  const installRoot = path.join(TMP, "skills-install");
  const spec = SKILL_CATALOG.find((entry) => entry.id === "first-principles");
  if (!spec) throw new Error("first-principles is not in the catalog");
  const source = path.join(ROOT, "docs", "skills", spec.file);
  const installed = installNativeSkill(installRoot, spec.id, source);
  if (installed.error) throw new Error(installed.error);
  const native = path.join(installRoot, "skills", "first-principles", "SKILL.md");
  if (!fs.existsSync(native)) throw new Error("native SKILL.md missing");
  const parsed = parseFrontmatter(fs.readFileSync(native, "utf8"));
  if (parsed.data.name !== "first-principles") {
    throw new Error(`frontmatter name=${JSON.stringify(parsed.data.name)}`);
  }
  if (!parsed.data.description) throw new Error("frontmatter description missing");
  const listing = listSkillCatalog(installRoot).skills.find((entry) => entry.id === spec.id);
  if (!listing?.native) throw new Error("catalog does not report the native copy");
  return `${native} (${parsed.data.description.slice(0, 48)}…)`;
});

await check("lsp_diagnostics", () => {
  const config =
    process.env.OPENCODE_CONFIG ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode", "opencode.json");
  if (!fs.existsSync(config)) {
    throw new Error(`no installed OpenCode config at ${config}; run bin/install.mjs first`);
  }
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts", "lsp-diagnostics.mjs"),
      "--file",
      path.join(ROOT, "src", "zombie", "lsp.ts"),
      "--inject",
      'const __probe: number = "x";',
      "--expect",
      "not assignable",
      "--root",
      ROOT,
      "--config",
      config,
      "--compact",
      "--timeout",
      "30000",
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  let payload = null;
  try {
    payload = JSON.parse(String(result.stdout ?? "").trim().split("\n").at(-1) ?? "");
  } catch {
    /* reported below */
  }
  if (!payload) {
    throw new Error(`probe produced no JSON (exit ${result.status}): ${result.stderr?.slice(0, 300)}`);
  }
  if (!payload.ok) {
    throw new Error(payload.error || `no diagnostic matched "${payload.expect}" (server=${payload.server})`);
  }
  if (!Array.isArray(payload.diagnostics) || payload.diagnostics.length === 0) {
    throw new Error("probe reported ok with no diagnostics");
  }
  return `${payload.server} pid=${payload.pid} diagnostics=${payload.diagnostics.length} matched=${payload.matched}`;
});

fs.rmSync(TMP, { recursive: true, force: true });

const order = ["opencode", "web_decorate", "design_sketch", "skills", "lsp_diagnostics", "mcp_tools"];
const summary = order
  .map((name) => `${name}=${results.get(name)?.ok ? (name === "opencode" ? "present" : "ok") : "fail"}`)
  .join(" ");
const failed = order.filter((name) => !results.get(name)?.ok);

if (failed.length === 0) {
  console.log(`E2E_MODULES: PASS ${summary}`);
  process.exit(0);
}
console.log(`E2E_MODULES: FAIL ${summary}`);
process.exit(1);
