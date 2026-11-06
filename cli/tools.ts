/**
 * `tarmac setup` : installation des outils (git, gh, claude, codex). Mêmes commandes et même état que l'écran
 * Réglages → Outils (server/tools/*, qui n'importent ni config ni settings : R2). Les réglages sont écrits
 * ici, dans le dossier de données de la CLI, jamais par server/settings.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { warn, which, type Ctx, type Out, type Runner } from './context.js';
import type { Step } from './plan.js';
import { settingsAgents } from './codex.js';
import { installCommand, MANAGED, TOOLS, type ManagedId, type Method } from '../server/tools/registry.js';
import { toolStatus, type StatusDeps, type ToolStatus } from '../server/tools/status.js';
import { addToolDirs } from '../server/tools/path.js';

/** Dépendances de `toolStatus` branchées sur l'exécuteur de la CLI (faux dans les tests, réel sinon). */
export function cliStatusDeps(ctx: Ctx, runner: Runner): StatusDeps {
  return {
    env: ctx.env,
    home: ctx.home,
    platform: ctx.platform,
    exec: async (file, args, o) => {
      const stdout = runner.capture([file, ...args], { timeoutMs: o.timeout });
      return stdout === null ? { stdout: '', code: 1 } : { stdout, code: 0 };
    },
  };
}

export const managedStatuses = (ctx: Ctx, runner: Runner): Promise<ToolStatus[]> =>
  Promise.all(MANAGED.map((id) => toolStatus(id, cliStatusDeps(ctx, runner))));

const METHOD_LABEL: Record<Method, string> = {
  brew: 'brew', npm: 'npm', winget: 'winget', official: 'the official installer', xcode: 'the Xcode command line tools',
};

/** Outils absents que Tarmac sait installer. */
const installable = (statuses: ToolStatus[]) => statuses.filter((s) => s.state === 'absent' && s.managed && s.installMethod);

/**
 * Outils à installer : avec `--yes` tous les absents ; en interactif une question par outil absent ; sinon aucun
 * (avec l'indication pour les installer).
 */
export async function toolsWanted(
  flags: { yes: boolean },
  interactive: boolean,
  ask: (question: string, def: boolean) => Promise<boolean>,
  statuses: ToolStatus[],
  out: Out,
): Promise<ManagedId[]> {
  const todo = installable(statuses);
  if (!todo.length) return [];
  if (flags.yes) return todo.map((s) => s.id as ManagedId);
  if (!interactive) {
    out.log('Tools not installed: tarmac setup --yes, or Settings → Tools');
    return [];
  }
  out.log('Recommended: install everything for the best experience.');
  const chosen: ManagedId[] = [];
  for (const s of todo) {
    if (await ask(`Install ${TOOLS[s.id].label} with ${METHOD_LABEL[s.installMethod!]}?`, true)) chosen.push(s.id as ManagedId);
  }
  return chosen;
}

/**
 * Ajoute les agents installés (et `toolsWelcomeSeen`) à `settings.json` du dossier de données, autres réglages gardés.
 * Fichier illisible ou qui n'est pas un objet JSON : jamais réécrit (avertissement). Écriture atomique, mode conservé.
 */
export function writeAgents(ctx: Ctx, agents: { claude?: boolean; codex?: boolean }, welcome: boolean, out: Out): boolean {
  const file = path.join(ctx.dataDir, 'settings.json');
  let cur: Record<string, unknown> = {};
  let mode = 0o600;
  let text: string | null = null;
  try { text = fs.readFileSync(file, 'utf8'); mode = fs.statSync(file).mode & 0o777; } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { warn(out, `${file} cannot be read: agents not ticked (Settings → Agents).`); return false; }
  }
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      cur = parsed as Record<string, unknown>;
    } catch {
      warn(out, `${file} is not a valid settings file: left untouched, tick the agents in Settings → Agents.`);
      return false;
    }
  }
  const next: Record<string, unknown> = { ...cur };
  if (agents.claude || agents.codex) next.agents = { ...settingsAgents(ctx), ...agents };
  if (welcome) next.toolsWelcomeSeen = true;
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode });
  fs.renameSync(tmp, file);
  return true;
}

/** Vrai si `bin` est maintenant trouvable, y compris dans les dossiers d'installation des outils. */
function installed(ctx: Ctx, bin: string): boolean {
  const env = { ...ctx.env };
  addToolDirs(env, ctx.toolDirs, ctx.platform);
  return which(bin, env) !== null;
}

/**
 * Étape « outils » : une action `exec` par outil choisi (erreurs ignorées : un échec n'arrête pas le setup),
 * puis les agents installés cochés dans les réglages, comme l'écran Outils. `git` par `xcode` : un message,
 * puis `xcode-select --install`, sans attente de la boîte de dialogue.
 */
export function planToolsInstall(ctx: Ctx, chosen: ManagedId[], statuses: ToolStatus[], o: { welcome?: boolean } = {}): Step {
  const actions: Step['actions'] = [];
  const agentOf: { id: ManagedId; agent: 'claude' | 'codex' }[] = [];
  for (const id of chosen) {
    const st = statuses.find((s) => s.id === id);
    if (!st?.installMethod) continue;
    if (st.installMethod === 'xcode') {
      const msg = 'git: a macOS dialog installs the Xcode command line tools; follow it (setup does not wait for it)';
      actions.push({ kind: 'task', label: msg, run: (rt) => { rt.out.log(msg); } });
    }
    const cmd = installCommand(id, st.installMethod, ctx.platform);
    // Commandes figées ; un shell n'est utilisé que pour les enchaînements (tube, `;`).
    const simple = !/[|;$&"'(]/.test(cmd);
    actions.push({ kind: 'exec', argv: simple ? cmd.split(' ') : ['/bin/sh', '-c', cmd], allowFail: true });
    const agent = TOOLS[id].agent;
    if (agent) agentOf.push({ id, agent });
  }
  if (agentOf.length || o.welcome) {
    actions.push({
      kind: 'task',
      label: `tick the installed agents in Settings → Agents${o.welcome ? ' and mark the Tools welcome as seen' : ''}`,
      run: (rt) => {
        const agents: { claude?: boolean; codex?: boolean } = {};
        for (const a of agentOf) if (installed(ctx, TOOLS[a.id].bin)) agents[a.agent] = true;
        if (agents.claude || agents.codex || o.welcome) writeAgents(ctx, agents, !!o.welcome, rt.out);
      },
    });
  }
  return { id: 'tools', title: `Install the missing tools: ${chosen.map((id) => TOOLS[id].label).join(', ') || 'none'}`, actions };
}
