// Actions sur les outils gérés : commande à lancer dans la console système, et suites d'installation.
// N'importe ni config, ni settings, ni docker (R2) : les effets (scripts, plan Codex, réglages) sont injectés (R3).
import { installCommand, loginCommand, TOOLS, updateCommand, type ManagedId } from './registry.js';
import { invalidateToolStatus, type ToolStatus } from './status.js';

export type ActionKind = 'install' | 'login' | 'update';

/** Commande de l'action, `null` si elle n'a pas de sens pour cet état (jamais d'entrée utilisateur dans la commande). */
export function actionCommand(kind: ActionKind, st: ToolStatus, platform: NodeJS.Platform): string | null {
  if (!st.managed || !TOOLS[st.id].managed) return null;
  const id = st.id as ManagedId;
  switch (kind) {
    case 'install':
      return st.state === 'absent' && st.installMethod ? installCommand(id, st.installMethod, platform) : null;
    case 'update':
      return st.state !== 'absent' && st.method ? updateCommand(id, st.method, platform) : null;
    case 'login':
      return st.state !== 'absent' && st.loginable && (id === 'gh' || id === 'claude' || id === 'codex') ? loginCommand(id) : null;
  }
}

export interface LaunchSpec {
  command: string;
  label: string;
  unsetEnv?: string[];
}

const GH_LOGIN = 'gh auth login --hostname github.com --git-protocol https --web';
// gh refuse de stocker un token si GH_TOKEN / GITHUB_TOKEN est défini dans l'environnement.
const GH_UNSET_ENV = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN'];

/** Ce que la console système lance : la commande de l'action, avec les options du flux navigateur pour `gh`. */
export function launchSpec(kind: ActionKind, st: ToolStatus, platform: NodeJS.Platform): LaunchSpec | null {
  const label = actionCommand(kind, st, platform);
  if (!label) return null;
  if (kind === 'login' && st.id === 'gh') return { command: GH_LOGIN, label, unsetEnv: GH_UNSET_ENV };
  return { command: label, label };
}

export interface AfterInstallDeps {
  /** Lance un script de `scripts/` du paquet (bash) et renvoie sa sortie ; sans effet sous Windows. En échec, l'erreur
   *  peut porter la sortie dans `output`. */
  runScript: (script: string, args: string[]) => Promise<string>;
  /** Pose l'intégration Codex (plan `planCodexSetup`) et renvoie le journal du plan. */
  codexPlan: () => Promise<string>;
  setAgents: (agents: { claude?: boolean; codex?: boolean }) => void;
  invalidateGithub: () => void;
}

/** Intégration de Tarmac posée après l'installation de claude ou codex : annoncée sur la ligne de l'outil (décision 9). */
export interface IntegrationResult {
  ok: boolean;
  /** Sortie des scripts ou journal du plan (sans couleurs). */
  output: string;
  error?: string;
}

const clean = (parts: string[]) => parts.join('\n').replace(/\x1b\[[0-9;]*m/g, '').trim();

/**
 * Suite d'une installation réussie : intégration de Tarmac pour claude/codex (puis agent coché si elle réussit),
 * cache GitHub pour gh. `integration` est `null` pour les outils sans intégration.
 */
export async function afterInstall(id: ManagedId, deps: AfterInstallDeps): Promise<{ integration: IntegrationResult | null }> {
  const out: string[] = [];
  try {
    if (id === 'claude') {
      out.push(await deps.runScript('scripts/mcp-install.sh', ['--code']));
      out.push(await deps.runScript('scripts/suivi-install.sh', []));
      deps.setAgents({ claude: true });
    } else if (id === 'codex') {
      out.push(await deps.codexPlan());
      deps.setAgents({ codex: true });
    } else {
      if (id === 'gh') deps.invalidateGithub();
      return { integration: null };
    }
    return { integration: { ok: true, output: clean(out) } };
  } catch (e) {
    const err = e as Error & { output?: unknown };
    if (typeof err.output === 'string') out.push(err.output);
    return { integration: { ok: false, output: clean(out), error: err.message } };
  } finally {
    invalidateToolStatus(id);
  }
}
