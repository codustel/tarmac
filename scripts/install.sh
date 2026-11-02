#!/usr/bin/env bash
# Installation de Tarmac depuis un clone (contributeurs) : dépendances, build, puis `tarmac setup`, la même
# logique que le paquet npm (`npm install -g @codustel/tarmac && tarmac setup`).
# Usage : ./scripts/install.sh [domaine] [options de tarmac setup]   (ex. --dry-run, --no-sudo, --no-claude)
# Une installation d'App Manager (ancien nom de Tarmac) est migrée par `tarmac setup`.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
say() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "Tarmac runs on macOS only."
command -v node >/dev/null || die "Node.js not found (22.13 or later required)."
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' \
  || die "Node $(node -v) found, 22.13 or later required (node:sqlite)."

# Premier argument sans tiret : domaine (compatibilité avec l'ancien usage `install.sh tarmac.localhost`).
args=()
if [[ $# -gt 0 && "$1" != -* ]]; then args+=(--domain "$1"); shift; fi

say "Installing dependencies and building…"
cd "$APP_DIR"
if command -v pnpm >/dev/null; then pnpm install --no-frozen-lockfile && pnpm build
else npm install && npm run build; fi
ok "Build done"

exec node "$APP_DIR/dist/cli/tarmac.js" setup ${args[@]+"${args[@]}"} "$@"
