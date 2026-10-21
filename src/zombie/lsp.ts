// A small LSP-shaped syntax helper.
//
// This is not a language server. It is the one function an agent needs before it
// claims "the code is fine": give me a snippet and a language, and I will return
// line/column diagnostics from the cheapest real checker available (JSON.parse,
// node --check, tsc, python compile, bash -n, php -l) plus a bracket balance
// fallback. The plugin exposes it as the `syntax_check` tool.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

export type DiagnosticSeverity = "error" | "warning";

export type Diagnostic = {
  line: number;
  column: number;
  message: string;
  severity: DiagnosticSeverity;
};

export type SyntaxResult = {
  language: string;
  ok: boolean;
  diagnostics: Diagnostic[];
  checkedBy: string;
};

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  jsonc: "json",
  php: "php",
  md: "markdown",
  markdown: "markdown",
  text: "text",
  txt: "text",
};

export function normalizeLanguage(input?: string): string {
  const key = String(input ?? "").trim().toLowerCase().replace(/^\./, "");
  return LANGUAGE_ALIASES[key] ?? key ?? "text";
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, safeOffset);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  return { line, column: safeOffset - lastBreak };
}

function makeDiagnostic(
  text: string,
  offset: number,
  message: string,
  severity: DiagnosticSeverity = "error",
): Diagnostic {
  const { line, column } = lineColumn(text, offset);
  return { line, column, message: message.trim() || "syntax error", severity };
}

/** Cheap bracket/quote balance check that works for every language. */
export function balanceDiagnostics(code: string): Diagnostic[] {
  const stack: { char: string; index: number }[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    const next = code[i + 1];
    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (!inDouble && !inTemplate && char === "'" && code[i - 1] !== "\\") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && char === '"' && code[i - 1] !== "\\") {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && char === "`" && code[i - 1] !== "\\") {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) continue;
    if (char === "(" || char === "[" || char === "{") {
      stack.push({ char, index: i });
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      const top = stack.pop();
      if (!top || top.char !== pairs[char]) {
        return [makeDiagnostic(code, i, `unexpected closing '${char}'`)];
      }
    }
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return [makeDiagnostic(code, top.index, `unclosed '${top.char}'`)];
  }
  return [];
}

function withTempFile(extension: string, code: string, fn: (file: string) => Diagnostic[]): Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-lsp-"));
  const file = path.join(dir, "snippet" + extension);
  try {
    fs.writeFileSync(file, code, "utf8");
    return fn(file);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

function nodeBinary(): string {
  const explicit = process.env.ZOMBIECODER_NODE?.trim();
  if (explicit) return explicit;
  return "node";
}

function parseNodeCheck(code: string, file: string): Diagnostic[] {
  // The plugin runs inside OpenCode, where process.execPath may be the desktop
  // app, not Node. `node --check` is the reliable checker; process.execPath is
  // only a fallback when it actually looks like a node binary.
  const binaries = [nodeBinary()];
  if (/node(\.exe)?$/i.test(path.basename(process.execPath))) binaries.push(process.execPath);
  let lastStderr = "";
  for (const binary of binaries) {
    const result = spawnSync(binary, ["--check", file], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error) {
      lastStderr = String(result.error.message ?? result.error);
      continue;
    }
    if (result.status === 0) return [];
    const stderr = String(result.stderr ?? "");
    lastStderr = stderr;
    const match = /:(\d+)\s*\n(?:.*\n)*?(\w*Error):\s*([^\n]+)/.exec(stderr);
    if (match) {
      const line = Number(match[1]);
      return [
        {
          line: Number.isFinite(line) && line > 0 ? line : 1,
          column: 1,
          message: `${match[2]}: ${match[3]}`,
          severity: "error",
        },
      ];
    }
  }
  return [
    makeDiagnostic(
      code,
      0,
      lastStderr.split("\n").find((line) => line.trim()) ?? "node --check failed",
    ),
  ];
}

async function nodeStripTypeScriptDiagnostics(
  code: string,
): Promise<{ diagnostics: Diagnostic[]; checkedBy: string } | null> {
  try {
    const moduleApi: any = await import("node:module");
    const strip = moduleApi.stripTypeScriptTypes;
    if (typeof strip !== "function") return null;
    let javascript: string;
    try {
      javascript = strip(code, { mode: "strip" });
    } catch (error: any) {
      return {
        diagnostics: [makeDiagnostic(code, 0, String(error?.message ?? error))],
        checkedBy: "node stripTypeScriptTypes",
      };
    }
    const diagnostics = withTempFile(".mjs", javascript, (file) =>
      parseNodeCheck(javascript, file),
    );
    return { diagnostics, checkedBy: "node stripTypeScriptTypes + node --check" };
  } catch {
    return null;
  }
}

async function typescriptDiagnostics(code: string): Promise<Diagnostic[] | null> {
  try {
    const ts: any = await import("typescript");
    const fileName = "snippet.tsx";
    const result = ts.transpileModule(code, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        noEmit: true,
        isolatedModules: true,
      },
    });
    const diagnostics = (result.diagnostics ?? []).filter(
      (diagnostic: any) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (diagnostics.length === 0) return [];
    return diagnostics.map((diagnostic: any) => {
      const start = typeof diagnostic.start === "number" ? diagnostic.start : 0;
      return makeDiagnostic(
        code,
        start,
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      );
    });
  } catch {
    return null;
  }
}

function pythonDiagnostics(code: string): Diagnostic[] {
  const result = spawnSync(
    "python3",
    ["-c", "import sys; compile(sys.stdin.read(), '<snippet>', 'exec')"],
    { input: code, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.status === 0) return [];
  const stderr = String(result.stderr ?? "");
  const lineMatch = /line (\d+)/.exec(stderr);
  const offsetMatch = /offset (\d+)/.exec(stderr);
  const message = stderr.split("\n").find((line) => /Error:/.test(line)) ?? "Python syntax error";
  return [
    {
      line: Number(lineMatch?.[1] ?? 1) || 1,
      column: Number(offsetMatch?.[1] ?? 1) || 1,
      message,
      severity: "error",
    },
  ];
}

function bashDiagnostics(code: string): Diagnostic[] {
  const result = spawnSync("bash", ["-n"], {
    input: code,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status === 0) return [];
  const stderr = String(result.stderr ?? "").trim();
  const lineMatch = /line (\d+)/.exec(stderr);
  return [
    {
      line: Number(lineMatch?.[1] ?? 1) || 1,
      column: 1,
      message: stderr.split("\n")[0] || "bash syntax error",
      severity: "error",
    },
  ];
}

function phpDiagnostics(code: string): Diagnostic[] {
  const result = spawnSync("php", ["-l"], {
    input: code,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status === 0) return [];
  const stderr = String(result.stderr ?? "").trim();
  const lineMatch = /line (\d+)/.exec(stderr);
  return [
    {
      line: Number(lineMatch?.[1] ?? 1) || 1,
      column: 1,
      message: stderr.split("\n")[0] || "PHP syntax error",
      severity: "error",
    },
  ];
}

/**
 * Check a code snippet. Async because TypeScript is loaded only when needed.
 * A missing optional checker degrades to the bracket balance check and says so
 * in `checkedBy`; it never pretends the snippet was fully compiled.
 */
export async function syntaxCheck(code: string, language?: string): Promise<SyntaxResult> {
  const text = String(code ?? "");
  const lang = normalizeLanguage(language);
  const balance = balanceDiagnostics(text);

  if (lang === "json") {
    try {
      JSON.parse(text);
      return { language: lang, ok: true, diagnostics: [], checkedBy: "JSON.parse" };
    } catch (error: any) {
      const message = String(error?.message ?? error);
      const position = /position (\d+)/.exec(message);
      const diagnostic = makeDiagnostic(text, Number(position?.[1] ?? 0), message);
      return { language: lang, ok: false, diagnostics: [diagnostic], checkedBy: "JSON.parse" };
    }
  }

  if (lang === "javascript") {
    const diagnostics = withTempFile(".mjs", text, (file) => parseNodeCheck(text, file));
    return {
      language: lang,
      ok: diagnostics.length === 0 && balance.length === 0,
      diagnostics: diagnostics.length > 0 ? diagnostics : balance,
      checkedBy: "node --check",
    };
  }

  if (lang === "typescript") {
    const diagnostics = await typescriptDiagnostics(text);
    if (diagnostics !== null) {
      return {
        language: lang,
        ok: diagnostics.length === 0 && balance.length === 0,
        diagnostics: diagnostics.length > 0 ? diagnostics : balance,
        checkedBy: "typescript.transpileModule",
      };
    }
    const stripped = await nodeStripTypeScriptDiagnostics(text);
    if (stripped) {
      return {
        language: lang,
        ok: stripped.diagnostics.length === 0 && balance.length === 0,
        diagnostics: stripped.diagnostics.length > 0 ? stripped.diagnostics : balance,
        checkedBy: stripped.checkedBy,
      };
    }
    return {
      language: lang,
      ok: balance.length === 0,
      diagnostics: balance,
      checkedBy: "bracket-balance (no TypeScript checker available)",
    };
  }

  if (lang === "python") {
    const diagnostics = pythonDiagnostics(text);
    return {
      language: lang,
      ok: diagnostics.length === 0 && balance.length === 0,
      diagnostics: diagnostics.length > 0 ? diagnostics : balance,
      checkedBy: "python3 compile",
    };
  }

  if (lang === "bash") {
    const diagnostics = bashDiagnostics(text);
    return {
      language: lang,
      ok: diagnostics.length === 0 && balance.length === 0,
      diagnostics: diagnostics.length > 0 ? diagnostics : balance,
      checkedBy: "bash -n",
    };
  }

  if (lang === "php") {
    const diagnostics = phpDiagnostics(text);
    return {
      language: lang,
      ok: diagnostics.length === 0 && balance.length === 0,
      diagnostics: diagnostics.length > 0 ? diagnostics : balance,
      checkedBy: "php -l",
    };
  }

  return {
    language: lang,
    ok: balance.length === 0,
    diagnostics: balance,
    checkedBy: "bracket-balance",
  };
}

export type FencedBlock = { language: string; code: string };

/** Extract fenced code blocks so an agent can check a patch before applying it. */
export function extractFencedBlocks(markdown: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const pattern = /```([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push({ language: normalizeLanguage(match[1]), code: match[2] });
  }
  return blocks;
}
