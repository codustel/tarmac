import type { ToolStatus } from '../api';
import type { GateRequest } from './gate';

/** Outils gérés par Tarmac, dans l'ordre d'installation. */
export const MANAGED_ORDER = ['git', 'gh', 'claude', 'codex'] as const;
export type ManagedId = (typeof MANAGED_ORDER)[number];

/** Noms affichés des outils. */
export const TOOL_NAMES: Record<string, string> = { git: 'Git', gh: 'GitHub CLI', claude: 'Claude Code', codex: 'Codex', docker: 'Docker', supabase: 'Supabase CLI' };

/** Écran d'accueil : jamais vu et au moins un outil géré absent (Docker et Supabase ne comptent pas). */
export function shouldShowWelcome(tools: ToolStatus[], seen: boolean): boolean {
  return !seen && tools.some((x) => x.managed && x.state === 'absent');
}

/** Tarmac peut installer l'outil : géré, absent, avec un moyen d'installation sur cette machine. */
export function canInstall(x: ToolStatus): boolean {
  return x.managed && x.state === 'absent' && !!x.installMethod;
}

/** Lien vers la page officielle : outil non géré, ou outil géré absent sans aucun moyen d'installation. */
export function showOfficialLink(x: ToolStatus): boolean {
  return !x.managed || (x.state === 'absent' && !x.installMethod);
}

/**
 * Case de la ligne : `active` si l'outil s'installe ; à l'accueil, `locked` (figée, décochée) pour les autres outils
 * gérés, qui gardent l'alignement de la liste ; en Réglages, aucune case pour ce qui ne s'installe pas.
 */
export function installCheckbox(x: ToolStatus, mode: 'welcome' | 'settings'): 'active' | 'locked' | 'none' {
  if (!x.managed) return 'none';
  if (canInstall(x)) return 'active';
  return mode === 'welcome' ? 'locked' : 'none';
}

/** Outils à installer : cochés et installables, dans l'ordre git, gh, claude, codex. */
export function installQueue(tools: ToolStatus[], checked: ReadonlySet<ManagedId>): ManagedId[] {
  return MANAGED_ORDER.filter((id) => checked.has(id) && tools.some((x) => x.id === id && canInstall(x)));
}

/** Choix de la garde : se connecter, installer, ou ouvrir la page officielle quand aucun moyen d'installation n'existe. */
export function gateAction(req: GateRequest): 'login' | 'install' | 'doc' {
  if (req.state === 'logged-out') return 'login';
  return req.installMethod === null && req.docUrl ? 'doc' : 'install';
}

/** Étape suivante de la file après la fin d'une console : un échec marque l'outil mais la file continue. */
export function nextStep(rest: ManagedId[], exitCode: number | null): { failed: boolean; next: ManagedId | null; rest: ManagedId[] } {
  const [next = null, ...others] = rest;
  return { failed: exitCode !== 0, next, rest: others };
}

/** Issue d'une console d'après la liste des sessions : terminée (code), disparue (code null = échec) ou encore en cours. */
export function sessionOutcome(list: { id: string; status: string; exitCode: number | null }[], id: string): { done: false } | { done: true; exitCode: number | null } {
  const s = list.find((x) => x.id === id);
  if (!s) return { done: true, exitCode: null };
  return s.status === 'exited' ? { done: true, exitCode: s.exitCode } : { done: false };
}

/** Attente maximale de la fenêtre d'installation macOS de Git (méthode xcode). */
export const XCODE_MAX_MS = 15 * 60_000;

/** Git par xcode : la fin de la console signifie seulement que la fenêtre macOS est ouverte. */
export function isXcodeInstall(id: string, kind: string, installMethod: string | null | undefined): boolean {
  return id === 'git' && kind === 'install' && installMethod === 'xcode';
}

/** Décision du relevé périodique pendant l'attente xcode : prêt, on attend encore, ou délai dépassé. */
export function xcodeWait(gitState: string | undefined, now: number, until: number): 'ready' | 'wait' | 'timeout' {
  if (gitState === 'ready') return 'ready';
  return now >= until ? 'timeout' : 'wait';
}

export type NavAlerts = Partial<Record<'docker' | 'supabase' | 'claude' | 'codex' | 'github', boolean>>;

/** Alertes du menu latéral : outil manquant, arrêté (Docker) ou déconnecté. `unknown` n'alerte jamais. */
export function navAlerts(tools: ToolStatus[]): NavAlerts {
  const st = (id: string) => tools.find((x) => x.id === id)?.state;
  const out: NavAlerts = {};
  if (st('docker') === 'absent' || st('docker') === 'stopped') out.docker = true;
  if (st('supabase') === 'absent') out.supabase = true;
  for (const id of ['claude', 'codex'] as const) if (st(id) === 'absent' || st(id) === 'logged-out') out[id] = true;
  if (st('gh') === 'absent' || st('gh') === 'logged-out') out.github = true;
  return out;
}
