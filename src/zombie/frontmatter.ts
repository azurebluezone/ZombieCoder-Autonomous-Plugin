// YAML subset parser for frontmatter.
//
// Skill/agent frontmatter is YAML, but the old parser split on the first colon
// per line. A description like `description: "Use when: the build fails"` or a
// folded block scalar then arrived truncated. This parser covers the subset the
// ecosystem actually writes: scalars, quoted strings, block scalars, flow and
// block lists, and one level of nested maps. It rejects tabs and duplicate keys
// with a line number instead of guessing.

export type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlValue[] | { [key: string]: YamlValue };
export type YamlMap = { [key: string]: YamlValue };

type SourceLine = {
  raw: string;
  indent: number;
  text: string;
  number: number;
};

function toLines(source: string): SourceLine[] {
  return source
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((raw, index) => {
      if (/^\t/.test(raw)) throw new Error(`frontmatter: tab indentation at line ${index + 1}`);
      const indent = raw.length - raw.trimStart().length;
      return { raw, indent, text: raw.trim(), number: index + 1 };
    });
}

function isBlank(line: SourceLine): boolean {
  return line.text.length === 0 || line.text.startsWith("#");
}

function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === "\\" && quote === '"') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}

function decodeDoubleQuoted(value: string, line: number): string {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`frontmatter: invalid double-quoted string at line ${line}`);
  }
}

function parseScalar(raw: string, line: number): YamlScalar {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new Error(`frontmatter: unterminated string at line ${line}`);
    return decodeDoubleQuoted(value, line);
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(`frontmatter: unterminated string at line ${line}`);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    throw new Error(`frontmatter: unexpected flow collection at line ${line}`);
  }
  if (value === "~" || /^null$/i.test(value)) return null;
  if (/^(true|yes|on)$/i.test(value)) return true;
  if (/^(false|no|off)$/i.test(value)) return false;
  if (/^[-+]?\d+$/.test(value)) return Number(value);
  if (/^[-+]?(?:\d+\.\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value)) return Number(value);
  if (/^[&*!]/.test(value)) {
    throw new Error(`frontmatter: anchors, aliases and tags are not supported (line ${line})`);
  }
  return value;
}

function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"') {
        current += inner[i + 1] ?? "";
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() || inner.trim()) parts.push(current.trim());
  return parts.filter((part) => part.length > 0);
}

function parseFlow(raw: string, line: number): YamlValue {
  const value = raw.trim();
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new Error(`frontmatter: unterminated list at line ${line}`);
    return splitFlow(value.slice(1, -1)).map((part) => parseFlow(part, line));
  }
  if (value.startsWith("{")) {
    if (!value.endsWith("}")) throw new Error(`frontmatter: unterminated map at line ${line}`);
    const map: YamlMap = {};
    for (const part of splitFlow(value.slice(1, -1))) {
      const match = /^([^:]+):\s*(.*)$/.exec(part);
      if (!match) throw new Error(`frontmatter: invalid flow map entry at line ${line}`);
      map[match[1].trim()] = parseFlow(match[2], line);
    }
    return map;
  }
  return parseScalar(value, line);
}

type Cursor = { lines: SourceLine[]; index: number };

function nextContent(cursor: Cursor): SourceLine | null {
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index];
    if (!isBlank(line)) return line;
    cursor.index += 1;
  }
  return null;
}

function parseBlockScalar(cursor: Cursor, header: string, parentIndent: number, lineNumber: number): string {
  const style = header[0];
  const chomp = header.includes("-") ? "strip" : header.includes("+") ? "keep" : "clip";
  const collected: string[] = [];
  let contentIndent: number | null = null;
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index];
    if (line.text.length === 0) {
      collected.push("");
      cursor.index += 1;
      continue;
    }
    if (line.indent <= parentIndent) break;
    if (contentIndent === null) contentIndent = line.indent;
    if (line.indent < contentIndent) throw new Error(`frontmatter: bad block indentation at line ${line.number}`);
    collected.push(line.raw.slice(contentIndent));
    cursor.index += 1;
  }
  while (collected.length > 0 && collected.at(-1) === "") collected.pop();
  let text = collected.join("\n");
  if (style === ">") {
    text = collected.reduce((folded, entry, index) => {
      if (index === 0) return entry;
      const previous = collected[index - 1];
      if (entry && previous) return `${folded} ${entry}`;
      return `${folded}\n${entry}`;
    }, "");
  }
  if (chomp === "strip") return text;
  if (chomp === "keep") return text + "\n";
  return text.length > 0 ? text + "\n" : "";
}

function parseBlock(cursor: Cursor, indent: number): YamlValue {
  const first = nextContent(cursor);
  if (!first) return null;
  if (first.indent < indent) return null;
  if (first.indent > indent) throw new Error(`frontmatter: unexpected indent at line ${first.number}`);
  if (first.text === "-" || first.text.startsWith("- ")) return parseList(cursor, indent);
  return parseMap(cursor, indent, first.number);
}

function parseMap(cursor: Cursor, indent: number, mapLine: number): YamlMap {
  const map: YamlMap = {};
  for (;;) {
    const line = nextContent(cursor);
    if (!line || line.indent < indent) break;
    if (line.indent > indent) throw new Error(`frontmatter: unexpected indent at line ${line.number}`);
    if (line.text === "-" || line.text.startsWith("- ")) {
      throw new Error(`frontmatter: list item where a key was expected at line ${line.number}`);
    }
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line.text);
    if (!match) {
      throw new Error(`frontmatter: expected "key: value" at line ${line.number} (map started at line ${mapLine})`);
    }
    const key = match[1];
    const rest = stripInlineComment(match[2]).trim();
    if (key in map) throw new Error(`frontmatter: duplicate key "${key}" at line ${line.number}`);
    cursor.index += 1;

    if (rest.startsWith("|") || rest.startsWith(">")) {
      const header = rest.replace(/\s+#.*$/, "").trim();
      map[key] = parseBlockScalar(cursor, header, indent, line.number);
      continue;
    }
    if (rest === "") {
      const child = nextContent(cursor);
      if (!child || child.indent <= indent) {
        map[key] = null;
        continue;
      }
      map[key] = parseBlock(cursor, child.indent);
      continue;
    }
    if (rest.startsWith("[") || rest.startsWith("{")) {
      map[key] = parseFlow(rest, line.number);
      continue;
    }
    map[key] = parseScalar(rest, line.number);
  }
  return map;
}

function parseList(cursor: Cursor, indent: number): YamlValue[] {
  const list: YamlValue[] = [];
  for (;;) {
    const line = nextContent(cursor);
    if (!line || line.indent < indent) break;
    if (line.indent > indent) throw new Error(`frontmatter: unexpected indent at line ${line.number}`);
    if (!(line.text === "-" || line.text.startsWith("- "))) break;
    const rest = stripInlineComment(line.text.slice(1)).trim();
    cursor.index += 1;
    if (!rest) {
      const child = nextContent(cursor);
      list.push(!child || child.indent <= indent ? null : parseBlock(cursor, child.indent));
      continue;
    }
    const inlineMap = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(rest);
    if (inlineMap) {
      const entry: YamlMap = {};
      entry[inlineMap[1]] = inlineMap[2] ? parseScalar(inlineMap[2], line.number) : null;
      const child = nextContent(cursor);
      if (child && child.indent > indent) {
        const nested = parseBlock(cursor, child.indent);
        if (nested && typeof nested === "object" && !Array.isArray(nested)) Object.assign(entry, nested);
      }
      list.push(entry);
      continue;
    }
    list.push(parseFlow(rest, line.number));
  }
  return list;
}

export function parseYamlSubset(source: string): YamlMap {
  const cursor: Cursor = { lines: toLines(source), index: 0 };
  const first = nextContent(cursor);
  if (!first) return {};
  if (first.text === "-" || first.text.startsWith("- ")) {
    throw new Error(`frontmatter: a mapping is required, got a list at line ${first.number}`);
  }
  return parseMap(cursor, first.indent, first.number);
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
  values: YamlMap;
} {
  const source = raw.replace(/^\uFEFF/, "");
  const match = FRONTMATTER.exec(source);
  if (!match) return { data: {}, body: source, values: {} };
  const values = parseYamlSubset(match[1]);
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) {
      data[key] = "";
    } else if (Array.isArray(value)) {
      data[key] = value.map((entry) => String(entry)).join(", ");
    } else if (typeof value === "object") {
      data[key] = JSON.stringify(value);
    } else {
      data[key] = String(value);
    }
  }
  return { data, body: source.slice(match[0].length), values };
}
