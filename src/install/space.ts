// Install-space planning.
//
// A live USB can run out of space halfway through `npm install`, leaving a
// half-written tree that looks installed but is not. This module is pure: the
// installer measures the real filesystem and passes the numbers in, so the
// decision can be tested without filling a disk.

const MB = 1024 * 1024;

/** Conservative estimates from a real install (deps 136 MB, LSP 147 MB). */
export const SPACE_ESTIMATE = {
  base: 32 * MB,
  deps: 180 * MB,
  lsp: 180 * MB,
};

export type SpaceInput = {
  freeBytes: number;
  needDeps: boolean;
  needLsp: boolean;
  /** Size of the npm cache, when it could be measured. */
  cacheBytes?: number;
  /** Do not touch the npm cache. */
  keepCache?: boolean;
  /** Proceed even when the estimate says the disk is too small. */
  force?: boolean;
};

export type SpacePlan = {
  ok: boolean;
  freeBytes: number;
  requiredBytes: number;
  shortfallBytes: number;
  cacheBytes: number;
  /** The installer should run `npm cache clean --force` before writing. */
  cleanCache: boolean;
  bytesAfterCleanup: number;
  messages: string[];
};

export function formatMb(bytes: number): string {
  return `${(Math.max(0, Number(bytes) || 0) / MB).toFixed(1)} MB`;
}

export function planInstallSpace(input: SpaceInput): SpacePlan {
  const freeBytes = Math.max(0, Number(input.freeBytes) || 0);
  const cacheBytes = Math.max(0, Number(input.cacheBytes) || 0);
  const raw =
    SPACE_ESTIMATE.base +
    (input.needDeps ? SPACE_ESTIMATE.deps : 0) +
    (input.needLsp ? SPACE_ESTIMATE.lsp : 0);
  const requiredBytes = Math.ceil(raw * 1.1);
  const shortfallBytes = Math.max(0, requiredBytes - freeBytes);
  const messages = [
    `জায়গা যাচাই: খালি ${formatMb(freeBytes)}, দরকার ≈ ${formatMb(requiredBytes)}` +
      ` (deps ${input.needDeps ? formatMb(SPACE_ESTIMATE.deps) : "skip"},` +
      ` LSP ${input.needLsp ? formatMb(SPACE_ESTIMATE.lsp) : "skip"}).`,
  ];

  let cleanCache = false;
  let bytesAfterCleanup = freeBytes;

  if (shortfallBytes > 0) {
    messages.push(`${formatMb(shortfallBytes)} কম পড়ছে।`);
    if (!input.keepCache && cacheBytes > 0) {
      cleanCache = true;
      bytesAfterCleanup = freeBytes + cacheBytes;
      messages.push(
        `npm cache ${formatMb(cacheBytes)} পুনরায় ডাউনলোডযোগ্য — ইনস্টলের আগে পরিষ্কার করা হবে ` +
          "(--keep-cache দিয়ে বন্ধ করা যায়)।",
      );
    } else if (input.keepCache) {
      messages.push("npm cache পরিষ্কার করা হচ্ছে না (--keep-cache)।");
    }
  }

  if (shortfallBytes > 0 && bytesAfterCleanup < requiredBytes) {
    const stillShort = requiredBytes - bytesAfterCleanup;
    if (input.force) {
      messages.push(
        `⚠️ জায়গা এখনো ${formatMb(stillShort)} কম, কিন্তু --force-low-space দেওয়া আছে; ` +
          "মাঝপথে fail করতে পারে।",
      );
    } else {
      messages.push(`cache পরিষ্কারের পরেও ${formatMb(stillShort)} কম। কিছুই লেখা হয়নি।`);
      messages.push(
        "বিকল্প: --no-lsp (≈180 MB বাঁচে), --no-install (deps আগে থেকে থাকলে), " +
          "অথবা --config-dir দিয়ে বেশি জায়গার path দিন।",
      );
    }
  }

  const ok = shortfallBytes === 0 || bytesAfterCleanup >= requiredBytes || Boolean(input.force);
  return {
    ok,
    freeBytes,
    requiredBytes,
    shortfallBytes,
    cacheBytes,
    cleanCache,
    bytesAfterCleanup,
    messages,
  };
}
