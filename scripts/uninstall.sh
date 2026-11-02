#!/usr/bin/env bash
# Désinstalle le service Tarmac depuis un clone (même logique que `tarmac uninstall`).
# Conserve ~/.tarmac (config + historique) sauf avec --purge. Options : --purge, --dry-run, --no-sudo, --yes.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$APP_DIR/dist/cli/tarmac.js"
[[ -f "$CLI" ]] || { echo "✗ $CLI not found: run pnpm build first." >&2; exit 1; }
exec node "$CLI" uninstall "$@"
