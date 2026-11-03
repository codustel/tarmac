#!/usr/bin/env bash
# Instance de démo de Tarmac, isolée : HOME factice, données, sessions Claude et fixtures factices.
#   scripts/demo/run-demo.sh            génère l'espace (si besoin), construit une copie, lance http://localhost:7790
#   scripts/demo/run-demo.sh --stop     arrête les apps de démo puis l'instance
# Variables : DEMO_HOME (~/tarmac-demo-home), DEMO_PORT (7790), DEMO_BUILD (dossier de build hors du dépôt),
#   TARMAC_MODULES (modules à charger, docs/extensions.md ; ex. TARMAC_MODULES="$PWD/examples/hello-module").
# Le service Tarmac habituel, ~/.claude, ~/.tarmac et la config gh ne sont jamais lus ni modifiés.
set -euo pipefail

say() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
DEMO_HOME="${DEMO_HOME:-$HOME/tarmac-demo-home}"
DEMO_PORT="${DEMO_PORT:-7790}"
DEMO_BUILD="${DEMO_BUILD:-${TMPDIR:-/tmp}/tarmac-demo-build}"
PIDFILE="$DEMO_HOME/tarmac-demo.pid"
URL="http://localhost:$DEMO_PORT"

[[ "$DEMO_HOME" != "$HOME" ]] || die "DEMO_HOME doit être un dossier dédié"
case "$(cd "$(dirname "$DEMO_BUILD")" && pwd -P)/" in "$(cd "$ROOT" && pwd -P)/"*) die "DEMO_BUILD doit être hors du dépôt" ;; esac

stop() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    curl -fsS -X POST "$URL/api/ports/free" -o /dev/null || true # arrête les apps lancées par l'instance
    kill "$(cat "$PIDFILE")" && ok "Instance de démo arrêtée"
  fi
  # Apps de démo encore en vie (détachées pour survivre à un redémarrage) : seulement celles du HOME de démo.
  # Repérées par leur dossier de travail (cwd), jamais par leur nom.
  lsof -a -d cwd -Fpn 2>/dev/null | awk -v d="$DEMO_HOME/Developer/" '/^p/{p=substr($0,2)} /^n/{if (index(substr($0,2), d)==1) print p}' \
    | sort -u | xargs kill 2>/dev/null || true
  rm -f "$PIDFILE"
}
if [[ "${1:-}" == "--stop" ]]; then stop; exit 0; fi

# 1. Espace de démo (idempotent).
node "$HERE/create-demo.mjs" --home "$DEMO_HOME"

# 2. Build dans une copie exportée de HEAD (jamais dans dist/ du dépôt).
HEAD_SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
if [[ "$(cat "$DEMO_BUILD/.demo-build" 2>/dev/null)" != "$HEAD_SHA" ]]; then
  say "Build de $HEAD_SHA dans $DEMO_BUILD"
  rm -rf "$DEMO_BUILD"
  "$ROOT/notes/publication/export-public.sh" "$DEMO_BUILD" >/dev/null
  (cd "$DEMO_BUILD" && pnpm install --frozen-lockfile --prefer-offline --silent && pnpm -s build >/dev/null)
  echo "$HEAD_SHA" > "$DEMO_BUILD/.demo-build"
fi

# 3. Lancement avec un environnement minimal (aucune variable du vrai HOME : jetons, ZDOTDIR, ANDROID_HOME…).
stop
NODE_DIR="$(dirname "$(realpath "$(command -v node)")")"
env -i \
  HOME="$DEMO_HOME" USER="$USER" LOGNAME="$USER" SHELL=/bin/zsh TERM=xterm-256color \
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TMPDIR="${TMPDIR:-/tmp}" \
  PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  DATA_DIR="$DEMO_HOME/.tarmac" CLAUDE_CONFIG_DIR="$DEMO_HOME/.claude" \
  TARMAC_DEMO_FIXTURES="$DEMO_HOME/demo-fixtures" TARMAC_PORT="$DEMO_PORT" DEV_ROOTS="$DEMO_HOME/Developer" \
  ${TARMAC_MODULES:+TARMAC_MODULES="$TARMAC_MODULES"} \
  GIT_CONFIG_NOSYSTEM=1 NO_UPDATE_NOTIFIER=1 npm_config_update_notifier=false DO_NOT_TRACK=1 ASTRO_TELEMETRY_DISABLED=1 \
  NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
  nohup node "$DEMO_BUILD/dist/server/index.js" > "$DEMO_HOME/tarmac-demo.log" 2>&1 &
echo $! > "$PIDFILE"
for _ in $(seq 1 50); do curl -fsS "$URL/api/meta" -o /dev/null 2>/dev/null && break; sleep 0.2; done
curl -fsS "$URL/api/meta" -o /dev/null || die "L'instance ne répond pas (journal : $DEMO_HOME/tarmac-demo.log)"
ok "Tarmac (démo) → $URL   (arrêt : $0 --stop)"
