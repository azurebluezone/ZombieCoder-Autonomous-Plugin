import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDesignSketch, reviewDesign } from "../src/zombie/design.ts";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-design-"));
}

test("buildDesignSketch writes sketch.md and design.json before any code exists", () => {
  const root = tempProject();
  try {
    const sketch = buildDesignSketch(root, {
      brief: "Clinic appointment flow",
      brand: "Shohor Clinic",
      site: "hospital",
      screens: ["Home", "Departments", "Appointment"],
    });
    assert.ok(fs.existsSync(sketch.sketch), "sketch.md missing");
    assert.ok(fs.existsSync(sketch.spec), "design.json missing");
    assert.equal(sketch.site, "hospital");
    assert.deepEqual(sketch.screens, ["Home", "Departments", "Appointment"]);
    assert.ok(sketch.tokens.some((token) => token.name === "color.accent" && token.value === "#0f766e"));

    const spec = JSON.parse(fs.readFileSync(sketch.spec, "utf8"));
    assert.match(spec.id, /^clinic-appointment-flow-[a-f0-9]{6}$/);
    assert.equal(spec.brand, "Shohor Clinic");
    assert.deepEqual(spec.states, ["loading", "empty", "error", "success"]);
    assert.ok(Array.isArray(spec.a11y) && spec.a11y.length >= 5);

    const markdown = fs.readFileSync(sketch.sketch, "utf8");
    assert.match(markdown, /^# Design sketch — Shohor Clinic/);
    assert.match(markdown, /## Wireframe/);
    assert.match(markdown, /loading/);
    assert.match(markdown, /WCAG 2\.2 AA/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildDesignSketch defaults to one Home screen and rejects an empty brief", () => {
  const root = tempProject();
  try {
    const sketch = buildDesignSketch(root, { brief: "Landing page", site: "generic" });
    assert.deepEqual(sketch.screens, ["Home"]);
    assert.throws(() => buildDesignSketch(root, { brief: "   " }), /brief is required/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildDesignSketch refuses an output directory outside the project", () => {
  const root = tempProject();
  try {
    assert.throws(
      () => buildDesignSketch(root, { brief: "Escape", output: "../outside" }),
      /output must stay inside the project root/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reviewDesign reports missing alt, unnamed buttons and absent states with file:line", () => {
  const root = tempProject();
  try {
    fs.writeFileSync(
      path.join(root, "index.html"),
      [
        "<!doctype html>",
        "<html>",
        "<body>",
        '<img src="hero.jpg">',
        "<button><svg></svg></button>",
        "</body>",
        "</html>",
      ].join("\n"),
    );
    const review = reviewDesign(root, ".");
    assert.equal(review.method, "regex-heuristic");
    assert.equal(review.ok, false);
    const rules = review.findings.map((finding) => finding.rule);
    assert.ok(rules.includes("img-alt"), "img-alt missing");
    assert.ok(rules.includes("button-name"), "button-name missing");
    assert.ok(rules.includes("button-type"), "button-type missing");
    assert.ok(rules.includes("html-lang"), "html-lang missing");
    assert.ok(rules.includes("viewport"), "viewport missing");
    assert.equal(
      review.findings.filter((finding) => finding.rule === "state-completeness").length,
      4,
    );
    for (const finding of review.findings) {
      assert.ok(finding.line >= 1, `${finding.rule} has no line`);
      assert.equal(typeof finding.file, "string");
    }
    assert.ok(review.summary.high >= 2, "high findings must be counted");
    assert.match(review.note, /Heuristic only/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reviewDesign accepts a page that covers alt text, labels and the four states", () => {
  const root = tempProject();
  try {
    fs.writeFileSync(
      path.join(root, "index.html"),
      [
        '<!doctype html>',
        '<html lang="en">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<body>",
        '<img src="hero.jpg" alt="Clinic reception">',
        '<button type="button" aria-label="Close">×</button>',
        '<a href="/appointment">Book</a>',
        "<p>loading empty error success</p>",
        "</body>",
        "</html>",
      ].join("\n"),
    );
    const review = reviewDesign(root, ".");
    assert.equal(review.ok, true, JSON.stringify(review.findings));
    assert.equal(review.summary.high, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
