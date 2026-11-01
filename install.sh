#!/usr/bin/env bash
# ZombieCoder — one-click remote installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/azurebluezone/ZombieCoder-Autonomous-Plugin/murubbi/install.sh | bash
#   curl -fsSL ... | bash -s -- --no-lsp
#
# The script downloads a source tarball to a temporary directory (never the
# working tree), verifies the repository integrity manifest, runs the real
# installer, and removes the temporary tree. Running it again updates an
# existing install; user config is merged, not replaced.
#
# Environment:
#   ZOMBIECODER_REPO      default azurebluezone/ZombieCoder-Autonomous-Plugin
#   ZOMBIECODER_REF       default murubbi
#   ZOMBIECODER_DIR       install root, default ~/.opencode
#   ZOMBIECODER_TARBALL   local tarball (offline/test); skips the download
#   ZOMBIECODER_SKIP_INTEGRITY=1  development only; prints a warning
set -euo pipefail

REPO="${ZOMBIECODER_REPO:-azurebluezone/ZombieCoder-Autonomous-Plugin}"
REF="${ZOMBIECODER_REF:-murubbi}"
TARGET="${ZOMBIECODER_DIR:-$HOME/.opencode}"
TARBALL="${ZOMBIECODER_TARBALL:-}"

say() { printf '%s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js পাওয়া যায়নি। https://nodejs.org থেকে 22.6+ LTS ইনস্টল করুন।"
command -v tar >/dev/null 2>&1 || die "tar পাওয়া যায়নি।"
if [ -z "$TARBALL" ]; then
  command -v curl >/dev/null 2>&1 || die "curl পাওয়া যায়নি।"
fi

NODE_VERSION="$(node -p 'process.versions.node')"
node -e '
const [a,b] = process.versions.node.split(".").map(Number);
process.exit(a > 22 || (a === 22 && b >= 6) ? 0 : 1);
' || die "Node.js 22.6+ দরকার। এখন চলছে ${NODE_VERSION}।"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/zombiecoder-install.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

if [ -n "$TARBALL" ]; then
  [ -f "$TARBALL" ] || die "TARBALL পাওয়া যায়নি: $TARBALL"
  cp "$TARBALL" "$WORK/source.tar.gz"
  say "▶ source: $TARBALL"
else
  URL="https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}"
  say "▶ download: $URL"
  curl -fsSL --retry 2 --connect-timeout 20 -o "$WORK/source.tar.gz" "$URL" \
    || die "ডাউনলোড ব্যর্থ। ইন্টারনেট বা ref ($REF) দেকো।"
fi

tar -xzf "$WORK/source.tar.gz" -C "$WORK" --strip-components=1 \
  || die "tarball খোলা যায়নি।"
[ -f "$WORK/package.json" ] || die "tarball-এ package.json নেই; ভাঙা ডাউনলোড।"

if [ "${ZOMBIECODER_SKIP_INTEGRITY:-0}" = "1" ]; then
  say "⚠️  integrity check skip করা হয়েছে (ZOMBIECODER_SKIP_INTEGRITY=1) — শুধু development-এ।"
else
  say "▶ integrity check"
  node "$WORK/scripts/integrity.mjs" --check >/dev/null \
    || die "integrity manifest মিলছে না। tarball বদলানো বা ভাঙা; ইনস্টল বন্ধ।"
fi

say "▶ install root: $TARGET"
node --experimental-strip-types "$WORK/bin/install.mjs" --config-dir "$TARGET" --yes "$@"

say ""
say "✅ install/update শেষ।"
say "   OpenCode বন্ধ করে আবার খুলুন — নতুন plugin load হবে।"
say "   আবার চালালে একই জায়গায় update হবে (config merge হয়, মুছে যায় না)।"
