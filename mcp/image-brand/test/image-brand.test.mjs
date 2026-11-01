import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  TOOLS,
  filterLicense,
  normalizeCleveland,
  normalizeCommons,
  normalizeMet,
  normalizeNasa,
  parseAspect,
  pickCropBox,
  validateImageUrl,
} from "../server.mjs";
import { startServer } from "../mcp-client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("licence filter keeps PD/CC0 and rejects attribution/share-alike", () => {
  for (const license of ["CC0", "Public Domain", "PD-USGov", "No known copyright restrictions"]) {
    assert.equal(filterLicense(license), true, license);
  }
  for (const license of ["CC BY 4.0", "CC BY-SA 4.0", "Attribution 4.0", "GFDL", ""]) {
    assert.equal(filterLicense(license), false, license);
  }
});

test("crop math keeps the requested aspect and focus", () => {
  assert.equal(parseAspect("4:5"), 0.8);
  assert.deepEqual(pickCropBox(2000, 2000, "4:5", "center"), [200, 0, 1800, 2000]);
  assert.deepEqual(pickCropBox(1000, 2000, "1:1", "top"), [0, 0, 1000, 1000]);
  assert.deepEqual(pickCropBox(1000, 2000, "1:1", "bottom"), [0, 1000, 1000, 2000]);
  assert.throws(() => parseAspect("wide"), /W:H/);
});

test("URL guard refuses http, localhost and private ranges", () => {
  assert.ok(validateImageUrl("https://images.metmuseum.org/crdimages/ad/original/DP107556.jpg"));
  for (const url of ["http://images.metmuseum.org/x.jpg", "https://127.0.0.1/x.jpg", "https://localhost/x.jpg", "https://192.168.1.2/x.jpg", "file:///etc/passwd"]) {
    assert.throws(() => validateImageUrl(url), url);
  }
});

test("provider normalizers keep PD/CC0 and drop the rest", () => {
  const commons = (license) => ({
    pageid: 1,
    title: "File:Tea.jpg",
    imageinfo: [{ thumburl: "https://upload.wikimedia.org/x.jpg", url: "https://upload.wikimedia.org/x.jpg", width: 100, height: 80, extmetadata: { LicenseShortName: { value: license }, Artist: { value: "<a>Someone</a>" } } }],
  });
  assert.equal(normalizeCommons(commons("CC0")).license, "CC0");
  assert.equal(normalizeCommons(commons("CC BY-SA 4.0")), null);

  assert.equal(normalizeMet({ objectID: 1, isPublicDomain: true, primaryImage: "https://images.metmuseum.org/x.jpg", title: "Cup" }).license, "Public Domain");
  assert.equal(normalizeMet({ objectID: 1, isPublicDomain: false, primaryImage: "https://images.metmuseum.org/x.jpg" }), null);

  assert.equal(normalizeCleveland({ id: 1, share_license_status: "CC0", images: { web: { url: "https://openaccess-cdn.clevelandart.org/x.jpg" } } }).license, "CC0");
  assert.equal(normalizeCleveland({ id: 1, share_license_status: "Copyrighted", images: { web: { url: "https://x" } } }), null);

  assert.equal(normalizeNasa({ data: [{ nasa_id: "PIA1", title: "Earth" }], links: [{ href: "https://images-assets.nasa.gov/x.jpg" }] }).provider, "nasa");
});

test("stdio MCP exposes six tools and brands a real fixture", async () => {
  assert.equal(TOOLS.length, 6);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-brand-test-"));
  execFileSync("python3", [path.join(HERE, "..", "fixtures.py"), "--dir", dir], { stdio: "ignore" });
  const client = await startServer();
  try {
    const init = await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(init.serverInfo.name, "image-brand");
    const list = await client.request("tools/list", {});
    assert.deepEqual(list.tools.map((tool) => tool.name).sort(), ["image_batch", "image_brand", "image_fetch", "image_fit", "image_search", "web_decorate"]);

    const branded = await client.callTool("image_brand", {
      input: path.join(dir, "input.jpg"),
      logo: path.join(dir, "logo.png"),
      output: path.join(dir, "out.jpg"),
      title: "বাংলা ব্র্যান্ড টেস্ট",
      subtitle: "পাবলিক ডোমেইন · পরীক্ষা",
      attribution: "Fixture · CC0",
      source: { provider: "fixture", license: "CC0" },
    });
    assert.ok(fs.existsSync(branded.output));
    assert.ok(branded.output_bytes > 10000);
    const sidecar = JSON.parse(fs.readFileSync(branded.sidecar, "utf8"));
    assert.equal(sidecar.fonts.raqm, true);
    assert.equal(sidecar.license, "CC0");
    assert.equal(sidecar.title, "বাংলা ব্র্যান্ড টেস্ট");

    const batch = await client.callTool("image_batch", {
      output_dir: path.join(dir, "batch"),
      items: [
        { input: path.join(dir, "input.jpg"), title: "প্রথম" },
        { input: path.join(dir, "input.jpg"), title: "দ্বিতীয়" },
      ],
    });
    assert.equal(batch.count, 2);
    assert.ok(fs.existsSync(batch.manifest));

    const covered = await client.callTool("image_fit", {
      input: path.join(dir, "input.jpg"),
      output: path.join(dir, "fit-cover.png"),
      width: 640,
      height: 480,
      fit: "cover",
      format: "png",
    });
    assert.equal(covered.fit, "cover");
    const contain = await client.callTool("image_fit", {
      input: path.join(dir, "input.jpg"),
      output: path.join(dir, "fit-contain.jpg"),
      width: 500,
      height: 500,
      fit: "contain",
      background: "#112233",
    });
    const dims = (file) =>
      execFileSync("python3", ["-c", `from PIL import Image;print(Image.open(${JSON.stringify(file)}).size)`], {
        encoding: "utf8",
      }).trim();
    assert.equal(dims(covered.output), "(640, 480)");
    assert.equal(dims(contain.output), "(500, 500)");
    assert.deepEqual(JSON.parse(fs.readFileSync(contain.sidecar, "utf8")).canvas, [500, 500]);

    const site = await client.callTool("web_decorate", {
      site: "lms",
      brand: "Shikho Lab",
      headline: "হাতে-কলমে শেখা, নিজের গতিতে",
      logo: path.join(dir, "logo.png"),
      images: [path.join(dir, "input.jpg")],
      output_dir: path.join(dir, "site"),
    });
    assert.equal(site.cards, 3);
    assert.ok(fs.existsSync(site.files.html));
    assert.ok(fs.existsSync(path.join(dir, "site", "shikho-lab-logo.png")));
    assert.ok(fs.readFileSync(site.files.html, "utf8").includes("Shikho Lab"));
    const manifest = JSON.parse(fs.readFileSync(site.manifest, "utf8"));
    assert.equal(manifest.site, "lms");
    assert.ok(manifest.hashes.hero);
    assert.equal(manifest.hashes.cards.length, 0);
  } finally {
    await client.close();
  }
});
