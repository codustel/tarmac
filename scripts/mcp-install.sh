#!/usr/bin/env bash
# Déclare le serveur MCP `tarmac` (Todolist Claude) :
#   - dans Claude desktop (canal A : la page de l'artefact appelle host:tarmac) ;
#   - dans Claude Code, portée utilisateur (canal B : Claude écrit les tâches pendant les sessions).
# Migration depuis App Manager (ancien nom) : `app-manager` est retiré de Claude Code ; dans Claude desktop,
# s'il existait, il est gardé comme alias (même commande) pour les artefacts déjà publiés avec
# host:app-manager, jusqu'à leur republication (/suivi upgrade --all).
# Usage : scripts/mcp-install.sh [--desktop] [--code]   (sans option : les deux, avec confirmation)
# Claude desktop doit être relancé ensuite ; Claude Code prend le serveur à la prochaine session.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MCP_JS="$APP_DIR/dist/server/mcp.js"
DESKTOP_CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

say() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

DESKTOP=0; CODE=0
for a in "$@"; do case "$a" in --desktop) DESKTOP=1 ;; --code) CODE=1 ;; *) die "Unknown option: $a" ;; esac; done
if [[ $DESKTOP == 0 && $CODE == 0 ]]; then
  read -r -p "Register tarmac in Claude desktop AND Claude Code? [y/N] " r
  [[ "$r" =~ ^[oOyY]$ ]] || exit 0
  DESKTOP=1; CODE=1
fi

[[ -f "$MCP_JS" ]] || die "$MCP_JS not found: run pnpm build first."

# Même lancement que le LaunchAgent : le Node de fnm n'a pas de chemin fixe.
CMD="exec node \"$MCP_JS\""

if [[ $DESKTOP == 1 ]]; then
  # L'app réécrit sa config quand elle enregistre ses préférences : une déclaration faite pendant qu'elle
  # tourne est effacée. On attend qu'elle soit fermée, on écrit, puis on la relance.
  # Pas de `grep -q` : avec pipefail, ps recevrait SIGPIPE et le test échouerait alors que l'app tourne.
  claude_running() { [[ -n "$(ps -axo comm= | grep '/Claude.app/Contents/MacOS/Claude$')" ]]; }
  if claude_running; then
    say "Quit Claude desktop (⌘Q): the config is written as soon as it closes, then it is relaunched."
    while claude_running; do sleep 2; done
    RELAUNCH=1
  fi
  say "Claude desktop: $DESKTOP_CFG"
  [[ -f "$DESKTOP_CFG" ]] && cp "$DESKTOP_CFG" "$DESKTOP_CFG.bak-$(date +%Y%m%d-%H%M%S)"
  python3 - "$DESKTOP_CFG" "$CMD" <<'PY'
import json, os, sys
path, cmd = sys.argv[1], sys.argv[2]
cfg = json.load(open(path)) if os.path.exists(path) else {}
# --artifact : les pages d'artefact n'ont accès qu'à suivi_pull / suivi_push (coche et note).
servers = cfg.setdefault('mcpServers', {})
entry = {'command': '/bin/zsh', 'args': ['-lc', cmd + ' --artifact']}
servers['tarmac'] = entry
# Alias de l'ancien nom, seulement s'il était déjà déclaré (artefacts publiés avec host:app-manager).
if 'app-manager' in servers:
    servers['app-manager'] = dict(entry)
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
PY
  if [[ ${RELAUNCH:-0} == 1 ]]; then
    open -a Claude
    ok "tarmac registered in Claude desktop (backup copy next to it); Claude relaunched."
  else
    ok "tarmac registered in Claude desktop (backup copy next to it); active on next launch."
  fi
fi

if [[ $CODE == 1 ]]; then
  command -v claude >/dev/null || die "claude CLI not found"
  say "Claude Code (user scope, ~/.claude.json)"
  claude mcp remove --scope user app-manager >/dev/null 2>&1 || true # ancien nom (App Manager)
  claude mcp remove --scope user tarmac >/dev/null 2>&1 || true
  claude mcp add --scope user tarmac -- /bin/zsh -lc "$CMD"
  ok "tarmac registered in Claude Code (active from the next session)."
fi
