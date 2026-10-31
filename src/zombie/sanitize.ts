// External payload hygiene.
//
// Pasted documents and model-generated pages often carry invisible characters:
// zero-width space/joiners, bidi controls, soft hyphens, BOMs. They are used as
// carriage for watermarking, and a zero-width joiner inside "create" is also a
// real bug source (copy-pasted identifiers stop matching). We treat them as data
// noise, never as signal.

const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

export type InvisibleReport = {
  count: number;
  suspicious: boolean;
  kinds: string[];
};

const NAMED: Array<{ re: RegExp; label: string }> = [
  { re: /\u200B/g, label: "zero-width space" },
  { re: /\u200C/g, label: "zero-width non-joiner" },
  { re: /\u200D/g, label: "zero-width joiner" },
  { re: /\uFEFF/g, label: "byte-order mark" },
  { re: /\u00AD/g, label: "soft hyphen" },
  { re: /[\u202A-\u202E]/g, label: "bidi control" },
  { re: /[\u2060-\u2064\u206A-\u206F]/g, label: "invisible operator" },
];

/** Remove invisible formatting characters. Idempotent. */
export function stripInvisible(text: string): string {
  return String(text ?? "").replace(INVISIBLE, "");
}

/** Report invisible characters without changing the text. */
export function detectInvisible(text: string): InvisibleReport {
  const value = String(text ?? "");
  const matches = value.match(INVISIBLE) ?? [];
  const kinds = NAMED.filter((entry) => entry.re.test(value)).map((entry) => entry.label);
  return { count: matches.length, suspicious: matches.length >= 3, kinds };
}

/**
 * Trailing whitespace steganography: many lines ending in exactly two spaces is a
 * classic markdown-side channel. Two or three such lines happen by accident;
 * a sustained pattern does not.
 */
export function detectTrailingMark(text: string): boolean {
  const lines = String(text ?? "").split(/\r?\n/);
  const marked = lines.filter((line) => /[^ \t] {2,}$/.test(line)).length;
  return lines.length >= 12 && marked >= Math.ceil(lines.length * 0.4);
}

export function isExternallyMarked(text: string): InvisibleReport & { trailing: boolean } {
  return { ...detectInvisible(text), trailing: detectTrailingMark(text) };
}
