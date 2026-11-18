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

export type CoreExtensions = Pick<ModuleContext['core'], 'suivi' | 'dispatch' | 'usage' | 'terminals' | 'ownedPids' | 'agents' | 'sessionTitle' | 'isDemo'>;

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
  terminals(): Array<{ id: string; projectId: string; status: 'running' | 'exited'; exitCode: number | null;
    kind?: string; pid?: number | null; claudeSessionId?: string | null; codexSessionId?: string | null }>;
  tarmacPid: number;
  bootId: string;
  /** Pids des projets lancés par Tarmac (`running` / `starting`). */
  projectPids(): number[];
  /** Dossier d'un projet scanné, null s'il est inconnu. */
  projectDirOf(projectId: string): string | null;
  agents(): Promise<Array<{ agent: 'claude' | 'codex'; pid: number; startedAt: string; cwd: string | null;
    /** Session rattachée hors fichier pid (Codex : transcript du dossier, argument `resume`). */
    sessionId?: string | null;
    pidFile: { sessionId: string | null; status: 'busy' | 'idle' | null; updatedAt: string | null } | null }>>;
  sessionTitle(agent: 'claude' | 'codex', sessionId: string): Promise<string | null>;
  isDemo(): boolean;
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
    ownedPids: () => ({
      tarmacPid: deps.tarmacPid,
      bootId: deps.bootId,
      projectPids: deps.projectPids(),
      terminals: deps.terminals().map((t) => ({
        id: t.id, shellPid: t.pid ?? null, status: t.status,
        agent: t.kind === 'claude' || t.kind === 'codex' ? t.kind : null,
        sessionId: t.claudeSessionId ?? t.codexSessionId ?? null,
        projectDir: deps.projectDirOf(t.projectId) ?? '',
      })),
    }),
    agents: async () => (await deps.agents()).map((a) => ({
      agent: a.agent, pid: a.pid, startedAt: a.startedAt, cwd: a.cwd,
      sessionId: a.pidFile?.sessionId ?? a.sessionId ?? null,
      status: a.pidFile?.status === 'busy' ? 'working' : a.pidFile?.status === 'idle' ? 'idle' : null,
      statusSince: a.pidFile?.updatedAt ?? null,
    })),
    sessionTitle: (agent, sessionId) => deps.sessionTitle(agent, sessionId),
    isDemo: () => deps.isDemo(),
  };
}

/** Valeurs par défaut quand le cœur n'en fournit pas (tests, chargeur seul) : lecture vide, envoi refusé. */
export const NO_EXTENSIONS: CoreExtensions = {
  suivi: { projects: () => [], tasks: () => [] },
  dispatch: async () => { throw new Error('core.dispatch is not available'); },
  usage: async () => ({ claude: { status: 'error', session: null }, codex: null }),
  terminals: () => [],
  ownedPids: () => ({ tarmacPid: process.pid, bootId: '', projectPids: [], terminals: [] }),
  agents: async () => [],
  sessionTitle: async () => null,
  isDemo: () => false,
};

/**
 * Tous les process d'agents vivants (Claude Code puis Codex), sans tenir compte des agents cochés dans les
 * réglages : un module qui croirait une session morte pourrait arrêter les enfants d'un agent encore vivant.
 * Rejette si un des deux scans échoue : une liste incomplète ferait croire des agents morts.
 */
export async function allAgentProcs<T>(claude: () => Promise<T[]>, codex: () => Promise<T[]>): Promise<T[]> {
  const [c, x] = await Promise.all([claude(), codex()]);
  return [...c, ...x];
}
