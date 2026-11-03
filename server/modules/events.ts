/**
 * Événements du cœur offerts aux modules (`ctx.core.on`), en lecture seule. Le cœur ne fait que relayer ce qu'il
 * sait déjà : tour de parole des sessions d'agent, statut des apps lancées, statut des tâches de la Todolist.
 * Les suiveurs ci-dessous transforment des relevés successifs en transitions (testables sans serveur).
 */
import type {
  ModuleAgentState, ModuleAgentTurnEvent, ModuleCoreEventName, ModuleCoreEvents, ModuleProcessStatus, ModuleProcessStatusEvent,
  ModuleTaskStatus, ModuleTaskStatusEvent,
} from './api.js';

/** Noms d'événements connus (un module qui en demande un autre reçoit une erreur à l'abonnement). */
export const CORE_EVENTS: readonly ModuleCoreEventName[] = ['agent:turn', 'process:status', 'suivi:task'];

type Listener<E extends ModuleCoreEventName> = (payload: ModuleCoreEvents[E]) => void;

/** Bus des événements : un abonné qui lève une erreur est journalisé, jamais propagé. */
export class CoreEvents {
  private listeners = new Map<ModuleCoreEventName, Set<Listener<any>>>();

  constructor(private warn: (message: string) => void = (m) => console.warn(m)) {}

  on<E extends ModuleCoreEventName>(event: E, cb: Listener<E>): () => void {
    if (!CORE_EVENTS.includes(event)) throw new TypeError(`core.on: unknown event ${JSON.stringify(event)} (known: ${CORE_EVENTS.join(', ')})`);
    if (typeof cb !== 'function') throw new TypeError('core.on: callback must be a function');
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => { set.delete(cb); };
  }

  count(event: ModuleCoreEventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  emit<E extends ModuleCoreEventName>(event: E, payload: ModuleCoreEvents[E]) {
    const set = this.listeners.get(event);
    if (!set?.size) return;
    const frozen = Object.freeze({ ...payload });
    for (const cb of [...set]) {
      try { cb(frozen); } catch (e) { this.warn(`⚠ Module listener for ${event} failed: ${(e as Error)?.message ?? e}`); }
    }
  }
}

/** Relevé d'une session d'agent en cours (champs de `ModuleAgentTurnEvent` sans la transition). */
export type AgentSnapshot = Omit<ModuleAgentTurnEvent, 'previous' | 'previousMs' | 'at'>;

/** Transitions d'état des sessions d'agent entre deux relevés ; les sessions disparues sont oubliées. */
export class AgentTurnTracker {
  private seen = new Map<string, { state: ModuleAgentState; since: number }>();

  update(list: AgentSnapshot[], now = Date.now()): ModuleAgentTurnEvent[] {
    const out: ModuleAgentTurnEvent[] = [];
    const keys = new Set<string>();
    for (const a of list) {
      keys.add(a.key);
      const prev = this.seen.get(a.key);
      if (prev?.state === a.state) continue;
      this.seen.set(a.key, { state: a.state, since: now });
      out.push({ ...a, previous: prev?.state ?? null, previousMs: prev ? now - prev.since : null, at: new Date(now).toISOString() });
    }
    for (const k of this.seen.keys()) if (!keys.has(k)) this.seen.delete(k);
    return out;
  }

  reset() { this.seen.clear(); }
}

/** Transitions de statut des apps lancées (un même statut répété n'est pas un événement). */
export class ProcessStatusTracker {
  private last = new Map<string, ModuleProcessStatus>();

  update(projectId: string, projectName: string | null, status: ModuleProcessStatus, exitCode: number | null, now = Date.now()): ModuleProcessStatusEvent | null {
    const previous = this.last.get(projectId) ?? null;
    if (previous === status) return null;
    this.last.set(projectId, status);
    return { projectId, projectName, status, previous, exitCode, at: new Date(now).toISOString() };
  }
}

export const taskStatus = (t: { done: boolean; toTest: boolean }): ModuleTaskStatus => (t.done ? 'done' : t.toTest ? 'toTest' : 'todo');

/**
 * Transitions de statut des tâches d'un projet de suivi : le premier relevé d'un projet sert de référence (aucun
 * événement), les suivants donnent les tâches dont le statut a changé et les tâches créées (`previous` null).
 */
export class TaskStatusTracker {
  private last = new Map<string, Map<string, ModuleTaskStatus>>();

  has(projectId: string) { return this.last.has(projectId); }

  update(projectId: string, projectName: string | null, tasks: Array<{ id: string; num: string; title: string; done: boolean; toTest: boolean }>, now = Date.now()): ModuleTaskStatusEvent[] {
    const before = this.last.get(projectId);
    const next = new Map(tasks.map((t) => [t.id, taskStatus(t)] as const));
    this.last.set(projectId, next);
    if (!before) return [];
    const at = new Date(now).toISOString();
    return tasks.flatMap((t) => {
      const status = next.get(t.id)!;
      const previous = before.get(t.id) ?? null;
      return previous === status ? [] : [{ suiviProjectId: projectId, projectName, taskId: t.id, num: t.num, title: t.title, status, previous, at }];
    });
  }

  reset() { this.last.clear(); }
}
