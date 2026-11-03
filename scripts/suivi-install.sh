#!/usr/bin/env bash
# Installe la partie Claude Code de la Todolist Claude :
#   - skill /suivi              → ~/.claude/skills/suivi/
#   - hook SessionStart         → ~/.claude/hooks/suivi-check.sh + ~/.claude/settings.json
#   - règle « Suivi de projet » → ajoutée à ~/.claude/CLAUDE.md (une seule fois)
# Une copie de sauvegarde de chaque fichier modifié est faite à côté (.bak-<date>).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CL="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STAMP=$(date +%Y%m%d-%H%M%S)
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
bak() { [[ -f "$1" ]] && cp "$1" "$1.bak-$STAMP"; return 0; }

mkdir -p "$CL/skills/suivi" "$CL/hooks"
cp "$APP_DIR/claude/skills/suivi/SKILL.md" "$CL/skills/suivi/SKILL.md"
ok "/suivi skill → $CL/skills/suivi/"

install -m 755 "$APP_DIR/claude/hooks/suivi-check.sh" "$CL/hooks/suivi-check.sh"
bak "$CL/settings.json"
python3 - "$CL/settings.json" "$CL/hooks/suivi-check.sh" <<'PY'
import json, os, sys
path, hook = sys.argv[1], sys.argv[2]
cfg = json.load(open(path)) if os.path.exists(path) else {}
starts = cfg.setdefault('hooks', {}).setdefault('SessionStart', [])
if not any(h.get('command') == hook for e in starts for h in e.get('hooks', [])):
    starts.append({'hooks': [{'type': 'command', 'command': hook, 'timeout': 10}]})
with open(path, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
PY
ok "SessionStart hook → $CL/hooks/suivi-check.sh"

# Titre de la section : anglais depuis la 4.8 ; « Suivi de projet (Todolist Claude) » = ancien titre français.
EN_TITLE='^## Project tracking \(Claude Todolist\)'
FR_TITLE='^## Suivi de projet \(Todolist Claude\)'
if ! grep -qE "$EN_TITLE|$FR_TITLE" "$CL/CLAUDE.md" 2>/dev/null; then
  bak "$CL/CLAUDE.md"
  cat "$APP_DIR/claude/CLAUDE-suivi.md" >> "$CL/CLAUDE.md"
  ok "\"Project tracking\" rule added to $CL/CLAUDE.md"
elif grep -qE "$FR_TITLE" "$CL/CLAUDE.md" && grep -qE 'App Manager|`app-manager`' "$CL/CLAUDE.md"; then
  # Règle en français (avant la 4.8), souvent personnalisée : on garde son texte et sa langue, seuls les anciens
  # noms (App Manager, serveur MCP `app-manager`) deviennent Tarmac / `tarmac` dans cette section.
  bak "$CL/CLAUDE.md"
  python3 - "$CL/CLAUDE.md" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path).read()
title = r'^## Suivi de projet \(Todolist Claude\)\n.*?(?=^## |\Z)'
rename = lambda m: re.sub(r"\b([dl])'App Manager", r'\1e Tarmac', m.group(0)).replace('App Manager', 'Tarmac').replace('`app-manager`', '`tarmac`')
text = re.sub(title, rename, text, count=1, flags=re.S | re.M)
open(path, 'w').write(text)
PY
  ok "\"Project tracking\" rule kept, old names renamed to Tarmac in $CL/CLAUDE.md"
else
  ok "\"Project tracking\" rule already present in $CL/CLAUDE.md"
fi

# Règle ajoutée en 5.6 (bouton ▶ Claude) : une ligne insérée dans la section existante, dans sa langue, une fois.
if grep -qE "$EN_TITLE|$FR_TITLE" "$CL/CLAUDE.md" 2>/dev/null && ! grep -q 'requestedAt' "$CL/CLAUDE.md"; then
  bak "$CL/CLAUDE.md"
  python3 - "$CL/CLAUDE.md" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path).read()
lines = {
    r'^## Project tracking \(Claude Todolist\)\n': '- Tasks marked for Claude (▶ Claude button, `requestedAt`) listed at session start: offer them in one line, start only once the user confirms; then mark them to test.\n',
    r'^## Suivi de projet \(Todolist Claude\)\n': '- Tâches marquées pour Claude (bouton ▶ Claude, `requestedAt`) signalées au début de session : les proposer en une ligne, ne commencer qu’après confirmation ; puis les passer « à tester ».\n',
}
for title, line in lines.items():
    m = re.search(title + r'.*?(?=^## |\Z)', text, flags=re.S | re.M)
    if not m: continue
    section = m.group(0)
    # Après la ligne « à tester » de la section, sinon à sa fin.
    hit = re.search(r'^- .*(to test|à tester).*\n', section, flags=re.M)
    at = m.start() + (hit.end() if hit else len(section.rstrip('\n')) + 1)
    text = text[:at] + line + text[at:]
    break
open(path, 'w').write(text)
PY
  ok "\"Project tracking\" rule: ▶ Claude line added in $CL/CLAUDE.md"
fi
