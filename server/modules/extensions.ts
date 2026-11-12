/**
 * Points d'extension de `ModuleContext.core` au-delà des événements : Todolist en lecture, envoi d'une tâche à une
 * nouvelle session, usage des forfaits, consoles. Le cœur ne fait que relayer ce qu'il sait déjà ; sans module qui
 * les appelle, rien ne se passe. Construits avec des dépendances injectées (testables sans serveur).
 * Aucun jeton, en-tête ni valeur du trousseau ne traverse ces fonctions : les retours sont recopiés champ par champ.
 */
import type { ClaudeUsage } from '../claudeUsage.js';
import type { CodexUsage } from '../codex.js';
import type { DispatchResult } from '../suivi/dispatch.js';
import type { SuiviProject, Task } from '../suivi/types.js';
import { taskStatus } from './events.js';
import type { ModuleContext, ModuleUsage, ModuleUsageWindow } from './api.js';

export type CoreExtensions = Pick<ModuleContext['core'], 'suivi' | 'dispatch' | 'usage' | 'terminals'>;

export interface ExtensionDeps {
  projects(): SuiviProject[];
  tasks(suiviProjectId: string): Task[];
  /** Projet scanné où une session de ce suivi s'ouvre, null si aucun dossier n'est scanné. */
  appProjectId(project: SuiviProject): string | null;
  dispatch(projectId: string, taskId: string, target: 'new', agent: 'claude' | 'codex', opts: { autopilot: true }): Promise<DispatchResult>;
  /** Identifiant de session de l'agent d'une console, null si pas encore connu. */
  sessionIdOf(terminalId: string): string | null;
  claudeUsage(): Promise<ClaudeUsage>;
  /** Usage Codex, null si Codex n'est pas coché ou si l'affichage est coupé. */
  codexUsage(): CodexUsage | null;
  terminals(): Array<{ id: string; projectId: string; status: 'running' | 'exited'; exitCode: number | null }>;
}

const window = (limits: Array<{ kind: string; utilization: number; resetsAt: string | null }>): ModuleUsageWindow | null => {
  const s = limits.find((l) => l.kind === 'session');
  return s ? { utilization: s.utilization, resetsAt: s.resetsAt } : null;
};

export function buildCoreExtensions(deps: ExtensionDeps): CoreExtensions {
  return {
    suivi: {
      projects: () => deps.projects().map((p) => ({ suiviProjectId: p.projectId, name: p.name, appProjectId: deps.appProjectId(p) })),
      tasks: (suiviProjectId) => deps.tasks(suiviProjectId)
        .map((t) => ({ id: t.id, num: t.num, title: t.title, order: t.order, status: taskStatus(t), auto: t.auto, archived: t.archived }))
        .sort((a, b) => a.order - b.order),
    },
    async dispatch(suiviProjectId, taskId, opts = {}) {
      const agent = opts.agent === 'codex' ? 'codex' : 'claude';
      const r = await deps.dispatch(suiviProjectId, taskId, 'new', agent, { autopilot: true });
      return { terminalId: r.terminalId, sessionId: deps.sessionIdOf(r.terminalId) };
    },
    async usage(): Promise<ModuleUsage> {
      const c = await deps.claudeUsage();
      const x = deps.codexUsage();
      return {
        claude: { status: c.status, session: c.status === 'ok' ? window(c.limits) : null },
        codex: !x || x.status === 'disabled' ? null : { status: x.status === 'ok' || x.status === 'none' ? x.status : 'error', session: x.status === 'ok' ? window(x.limits) : null },
      };
    },
    terminals: () => deps.terminals().map((t) => ({ id: t.id, projectId: t.projectId, status: t.status, exitCode: t.exitCode })),
  };
}

/** Valeurs par défaut quand le cœur n'en fournit pas (tests, chargeur seul) : lecture vide, envoi refusé. */
export const NO_EXTENSIONS: CoreExtensions = {
  suivi: { projects: () => [], tasks: () => [] },
  dispatch: async () => { throw new Error('core.dispatch is not available'); },
  usage: async () => ({ claude: { status: 'error', session: null }, codex: null }),
  terminals: () => [],
};
