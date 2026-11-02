#!/usr/bin/env bash
# Pilotage du service depuis un clone : ./scripts/service.sh {status|restart|stop|start|logs|open|doctor}
# (raccourci de `node dist/cli/tarmac.js <commande>`, ou `tarmac <commande>` depuis le paquet npm).
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$APP_DIR/dist/cli/tarmac.js"
[[ -f "$CLI" ]] || { echo "✗ $CLI not found: run pnpm build first." >&2; exit 1; }
case "${1:-status}" in
  status|restart|stop|start|logs|open|doctor) exec node "$CLI" "${1:-status}" ;;
  *) echo "Usage: $0 {status|restart|stop|start|logs|open|doctor}"; exit 1 ;;
esac
