/**
 * Intégration Codex (ChatGPT) de `tarmac setup` / `tarmac uninstall` / `tarmac doctor` : tout ce que Tarmac écrit
 * chez Codex est délimité et retrouvable, idempotent, avec une copie de sauvegarde de chaque fichier modifié.
 *
 * Emplacements (doc officielle de Codex, revérifiée pour la tâche 7.7) :
 * - serveur MCP : table `[mcp_servers.tarmac]` de `$CODEX_HOME/config.toml` (`~/.codex` par défaut) ;
 * - règle : `$CODEX_HOME/AGENTS.md` (instructions globales) ;
 * - skill : `~/.agents/skills/suivi/SKILL.md` (dossier de skills de l'utilisateur) ;
 * - hook SessionStart : `$CODEX_HOME/hooks.json` (Codex demande à l'utilisateur de l'approuver avec `/hooks`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { which, type Ctx } from './context.js';
import type { Action, Step } from './plan.js';

export const MCP_START = '# >>> tarmac: MCP server (managed by `tarmac setup`, removed by `tarmac uninstall`) >>>';
export const MCP_END = '# <<< tarmac <<<';
export const RULE_START = '<!-- tarmac:suivi:start (managed by `tarmac setup`) -->';
export const RULE_END = '<!-- tarmac:suivi:end -->';
export const HOOK_FILE = 'tarmac-suivi-check.sh';

export const codexHome = (ctx: Pick<Ctx, 'home' | 'env'>) => ctx.env.CODEX_HOME || path.join(ctx.home, '.codex');
export const codexSkillDir = (ctx: Pick<Ctx, 'home'>) => path.join(ctx.home, '.agents', 'skills', 'suivi');

const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const block = (start: string, end: string) => new RegExp(`\\n?${esc(start)}\\n[\\s\\S]*?${esc(end)}\\n?`);

/** Commande du serveur MCP : comme pour Claude Code, un shell de login (le Node de nvm / fnm n'a pas de chemin fixe). */
export const mcpArgs = (mcpJs: string) => ['-lc', `exec node "${mcpJs}"`];

export type TomlStatus = 'added' | 'updated' | 'unchanged' | 'user-defined' | 'invalid';

/**
 * `config.toml` avec la table `[mcp_servers.tarmac]` de Tarmac (bloc balisé, ajouté à la fin ou remplacé sur
 * place). Une table `tarmac` écrite à la main (hors balises) est laissée telle quelle ; un fichier TOML invalide
 * n'est jamais touché. Le texte de l'utilisateur (commentaires, ordre) est conservé.
 */
export function upsertMcpToml(text: string, mcpJs: string): { text: string; status: TomlStatus } {
  let parsed: any;
  try { parsed = parseToml(text); } catch { return { text, status: 'invalid' }; }
  const re = block(MCP_START, MCP_END);
  const ours = re.test(text);
  if (!ours && parsed?.mcp_servers?.tarmac) return { text, status: 'user-defined' };
  const body = `${MCP_START}\n[mcp_servers.tarmac]\ncommand = "/bin/zsh"\nargs = [${mcpArgs(mcpJs).map((a) => JSON.stringify(a)).join(', ')}]\n${MCP_END}\n`;
  let next: string;
  if (ours) next = text.replace(re, (m) => (m.startsWith('\n') ? '\n' : '') + body);
  else next = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text.trim() ? '\n' : ''}${body}`;
  try { parseToml(next); } catch { return { text, status: 'invalid' }; }
  return { text: next, status: next === text ? 'unchanged' : ours ? 'updated' : 'added' };
}

/** Retire le bloc de Tarmac de `config.toml` (rien d'autre). */
export function removeMcpToml(text: string): string {
  return text.replace(block(MCP_START, MCP_END), '\n').replace(/\n{3,}$/, '\n\n').replace(/^\n+/, '');
}

/** `AGENTS.md` avec la règle du suivi (bloc balisé : ajouté une fois, remplacé ensuite). */
export function upsertRule(text: string, rule: string): { text: string; status: 'added' | 'updated' | 'unchanged' } {
  const body = `${RULE_START}\n${rule.trim()}\n${RULE_END}\n`;
  const re = block(RULE_START, RULE_END);
  if (re.test(text)) {
    const next = text.replace(re, (m) => (m.startsWith('\n') ? '\n' : '') + body);
    return { text: next, status: next === text ? 'unchanged' : 'updated' };
  }
  return { text: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text.trim() ? '\n' : ''}${body}`, status: 'added' };
}

export const removeRule = (text: string) => text.replace(block(RULE_START, RULE_END), '\n').replace(/\n{3,}$/, '\n\n').replace(/^\n+/, '');

/** `hooks.json` avec le hook SessionStart de Tarmac (une seule fois ; les autres hooks sont gardés). */
export function upsertHook(text: string | null, command: string): { text: string; status: 'added' | 'unchanged' | 'invalid' } {
  let cfg: any = {};
  if (text?.trim()) { try { cfg = JSON.parse(text); } catch { return { text: text ?? '', status: 'invalid' }; } }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { text: text ?? '', status: 'invalid' };
  const starts: any[] = ((cfg.hooks ??= {}).SessionStart ??= []);
  if (!Array.isArray(starts)) return { text: text ?? '', status: 'invalid' };
  if (starts.some((g) => (g?.hooks ?? []).some((h: any) => typeof h?.command === 'string' && h.command.includes(HOOK_FILE)))) {
    return { text: text ?? '', status: 'unchanged' };
  }
  starts.push({ matcher: 'startup|resume', hooks: [{ type: 'command', command, timeout: 10, statusMessage: 'Tarmac: Todolist' }] });
  return { text: JSON.stringify(cfg, null, 2) + '\n', status: 'added' };
}

/** Retire le hook de Tarmac de `hooks.json` (groupe vidé retiré, autres hooks gardés). */
export function removeHook(text: string): string {
  let cfg: any;
  try { cfg = JSON.parse(text); } catch { return text; }
  const starts = cfg?.hooks?.SessionStart;
  if (!Array.isArray(starts)) return text;
  cfg.hooks.SessionStart = starts
    .map((g: any) => ({ ...g, hooks: (g?.hooks ?? []).filter((h: any) => !(typeof h?.command === 'string' && h.command.includes(HOOK_FILE))) }))
    .filter((g: any) => g.hooks.length);
  if (!cfg.hooks.SessionStart.length) delete cfg.hooks.SessionStart;
  return JSON.stringify(cfg, null, 2) + '\n';
}

/** Codex installé (`codex` dans le PATH) et intégration de Tarmac en place. */
export function codexPresence(ctx: Pick<Ctx, 'home' | 'env'>) {
  const home = codexHome(ctx);
  const toml = read(path.join(home, 'config.toml')) ?? '';
  let mcp = false;
  try { mcp = !!(parseToml(toml) as any)?.mcp_servers?.tarmac; } catch { /* config illisible */ }
  return {
    installed: which('codex', ctx.env) !== null,
    mcp,
    rule: (read(path.join(home, 'AGENTS.md')) ?? '').includes(RULE_START),
    skill: fs.existsSync(path.join(codexSkillDir(ctx), 'SKILL.md')),
    hook: (read(path.join(home, 'hooks.json')) ?? '').includes(HOOK_FILE),
  };
}

/** Agents cochés dans les réglages de Tarmac (`settings.json` du dossier de données), Claude seul par défaut. */
export function settingsAgents(ctx: Pick<Ctx, 'dataDir'>): { claude: boolean; codex: boolean } {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8'))?.agents ?? {};
    const out = { claude: a.claude !== false, codex: a.codex === true };
    return out.claude || out.codex ? out : { claude: true, codex: false };
  } catch {
    return { claude: true, codex: false };
  }
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
/** Écrit `file` avec une copie de sauvegarde de l'ancien contenu à côté (`.bak-<date>`). */
function writeWithBackup(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${stamp()}`);
  fs.writeFileSync(file, text);
}

/** Étape `codex` de `tarmac setup` : serveur MCP, règle AGENTS.md, skill `suivi`, hook SessionStart. */
export function planCodexSetup(ctx: Ctx): Step {
  const home = codexHome(ctx);
  const toml = path.join(home, 'config.toml');
  const agents = path.join(home, 'AGENTS.md');
  const hooks = path.join(home, 'hooks.json');
  const hook = path.join(home, 'hooks', HOOK_FILE);
  const skillDir = codexSkillDir(ctx);
  const actions: Action[] = [
    {
      kind: 'task',
      label: `MCP server "tarmac" → [mcp_servers.tarmac] in ${toml} (marked block, backup copy next to it)`,
      run: (rt) => {
        const r = upsertMcpToml(read(toml) ?? '', ctx.mcpJs);
        if (r.status === 'invalid') throw new Error(`${toml} is not valid TOML: nothing written (fix it, then run tarmac setup --with-codex again).`);
        if (r.status === 'user-defined') rt.out.log(`  ! [mcp_servers.tarmac] already defined by hand in ${toml}: kept as is.`);
        if (r.status === 'added' || r.status === 'updated') writeWithBackup(toml, r.text);
      },
    },
    {
      kind: 'task',
      label: `"Project tracking" rule → ${agents} (marked block, backup copy next to it)`,
      run: () => {
        const rule = fs.readFileSync(path.join(ctx.appDir, 'codex', 'AGENTS-suivi.md'), 'utf8');
        const r = upsertRule(read(agents) ?? '', rule);
        if (r.status !== 'unchanged') writeWithBackup(agents, r.text);
      },
    },
    {
      kind: 'task',
      label: `skill suivi ($suivi) → ${path.join(skillDir, 'SKILL.md')}`,
      run: () => {
        fs.mkdirSync(skillDir, { recursive: true });
        fs.copyFileSync(path.join(ctx.appDir, 'codex', 'skills', 'suivi', 'SKILL.md'), path.join(skillDir, 'SKILL.md'));
      },
    },
    {
      kind: 'task',
      label: `SessionStart hook → ${hook}, declared in ${hooks} (Codex asks you to trust it once: /hooks)`,
      run: () => {
        fs.mkdirSync(path.dirname(hook), { recursive: true });
        fs.copyFileSync(path.join(ctx.appDir, 'claude', 'hooks', 'suivi-check.sh'), hook);
        fs.chmodSync(hook, 0o755);
        const r = upsertHook(read(hooks), `"${hook}" codex`);
        if (r.status === 'invalid') throw new Error(`${hooks} is not valid JSON: hook not declared.`);
        if (r.status === 'added') writeWithBackup(hooks, r.text);
      },
    },
  ];
  return {
    id: 'codex',
    title: 'Set up the Codex integration: MCP server "tarmac", "Project tracking" rule in AGENTS.md, $suivi skill, SessionStart hook',
    actions,
  };
}

/** Étape `codex` de `tarmac uninstall` : retire seulement ce que Tarmac a écrit (blocs balisés, hook, skill). */
export function planCodexUninstall(ctx: Ctx): Step | null {
  const p = codexPresence(ctx);
  const home = codexHome(ctx);
  const toml = path.join(home, 'config.toml');
  const ourToml = (read(toml) ?? '').includes(MCP_START);
  const skill = path.join(codexSkillDir(ctx), 'SKILL.md');
  const ourSkill = (read(skill) ?? '').includes('Tarmac');
  if (!ourToml && !p.rule && !p.hook && !ourSkill) return null;
  const actions: Action[] = [];
  if (ourToml) actions.push({ kind: 'task', label: `remove the tarmac block from ${toml} (backup copy next to it)`, run: () => writeWithBackup(toml, removeMcpToml(read(toml) ?? '')) });
  if (p.rule) {
    const f = path.join(home, 'AGENTS.md');
    actions.push({ kind: 'task', label: `remove the "Project tracking" block from ${f} (backup copy next to it)`, run: () => writeWithBackup(f, removeRule(read(f) ?? '')) });
  }
  if (p.hook) {
    const f = path.join(home, 'hooks.json');
    actions.push({ kind: 'task', label: `remove the Tarmac SessionStart hook from ${f}`, run: () => writeWithBackup(f, removeHook(read(f) ?? '{}')) });
    actions.push({ kind: 'remove', path: path.join(home, 'hooks', HOOK_FILE) });
  }
  if (ourSkill) actions.push({ kind: 'remove', path: codexSkillDir(ctx), recursive: true });
  return { id: 'codex', title: 'Remove the Codex integration (MCP server "tarmac", rule, $suivi skill, hook)', actions };
}
