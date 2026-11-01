import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, parseYamlSubset } from "../src/zombie/frontmatter.ts";

test("parses scalars, quoted colons and inline comments", () => {
  const values = parseYamlSubset(
    [
      "name: demo",
      "count: 3",
      "enabled: true",
      "ratio: 1.5",
      "missing: null",
      'quoted: "Use when: the build fails"',
      "single: 'it''s fine'",
      "comment: value # trailing comment",
    ].join("\n"),
  );
  assert.equal(values.name, "demo");
  assert.equal(values.count, 3);
  assert.equal(values.enabled, true);
  assert.equal(values.ratio, 1.5);
  assert.equal(values.missing, null);
  assert.equal(values.quoted, "Use when: the build fails");
  assert.equal(values.single, "it's fine");
  assert.equal(values.comment, "value");
});

test("parses literal and folded block scalars without dropping later keys", () => {
  const values = parseYamlSubset(
    [
      "description: |",
      "  line one",
      "  line two: with colon",
      "plain: >-",
      "  folded",
      "  text",
      "tail: kept",
    ].join("\n"),
  );
  assert.equal(values.description, "line one\nline two: with colon\n");
  assert.equal(values.plain, "folded text");
  assert.equal(values.tail, "kept");
});

test("parses flow and block lists, including inline maps", () => {
  const values = parseYamlSubset(
    [
      'tags: [a, "b, c", 4]',
      "steps:",
      "  - one",
      "  - name: two",
      "    body: nested",
    ].join("\n"),
  );
  assert.deepEqual(values.tags, ["a", "b, c", 4]);
  assert.deepEqual(values.steps, ["one", { name: "two", body: "nested" }]);
});

test("parses one level of nested maps", () => {
  const values = parseYamlSubset(
    ["meta:", "  owner: manu", "  flags: [x, y]", "after: yes"].join("\n"),
  );
  assert.deepEqual(values.meta, { owner: "manu", flags: ["x", "y"] });
  assert.equal(values.after, true);
});

test("parseFrontmatter keeps the body intact after CRLF frontmatter", () => {
  const raw = ["---", "name: demo", 'description: "Use when: x"', "---", "# Body", "", "text", ""].join(
    "\r\n",
  );
  const parsed = parseFrontmatter(raw);
  assert.equal(parsed.data.name, "demo");
  assert.equal(parsed.data.description, "Use when: x");
  assert.equal(parsed.values.name, "demo");
  assert.match(parsed.body, /^# Body/);
  assert.doesNotMatch(parsed.body, /^---/);
});

test("returns the source as body when there is no frontmatter", () => {
  const parsed = parseFrontmatter("# Just a file\n");
  assert.deepEqual(parsed.data, {});
  assert.deepEqual(parsed.values, {});
  assert.equal(parsed.body, "# Just a file\n");
});

test("rejects tab indentation and duplicate keys with a line number", () => {
  assert.throws(() => parseYamlSubset("meta:\n\towner: x"), /tab indentation at line 2/);
  assert.throws(() => parseYamlSubset("name: one\nname: two"), /duplicate key "name" at line 2/);
});

test("rejects unsupported anchors and unterminated strings", () => {
  assert.throws(() => parseYamlSubset("value: &anchor x"), /anchors, aliases and tags are not supported/);
  assert.throws(() => parseYamlSubset('value: "unterminated'), /unterminated string/);
});
