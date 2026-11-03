import fs from 'node:fs';
import path from 'node:path';
import { attachSessions, type AgentKind, type AgentProc, type AttachMatch } from './agentProcs.js';
import type { TurnState } from './claude.js';

/**
 * Agents en cours, partout (consoles de Tarmac, Terminal, app Claude, IDE) : process rattachés à leur session,
 * état (au travail / au repos) et agents en arrière-plan. Indépendant de l'agent : `agent` vaut `claude`
 * aujourd'hui (Codex : tâche 7.7, mêmes champs).
 */

/** Agent en arrière-plan d'une session (sous-agent lancé par l'outil Agent / Task de Claude Code). */
export interface BackgroundAgent {
  id: string;
  /** Type déclaré (`general-purpose`, `Explore`…), si connu. */
  type: string | null;
  description: string;
  startedAt: string | null;
  lastActivityAt: string;
}

export interface RunningAgent {
  /** Identifiant stable dans la liste : `<agent>:<pid>`. */
  key: string;
  agent: AgentKind;
  pid: number;
  sessionId: string | null;
  /** Comment le process a été rattaché à sa session (`tarmac` : console de Tarmac sans process repéré). */
  match: AttachMatch | 'tarmac';
  cwd: string | null;
  title: string | null;
  startedAt: string;
  lastActivityAt: string | null;
  where: 'tarmac' | 'external';
  /** App où tourne la session : « Tarmac », « Terminal », « VS Code », « Claude »… ou null. */
  app: string | null;
  /** Console de Tarmac (onglet) qui héberge la session. */
  terminalId: string | null;
  state: 'working' | 'idle';
  background: BackgroundAgent[];
  /** Au moins un agent travaille : tour en cours ou agent en arrière-plan actif (LED clignotante). */
  working: boolean;
}

/** Sans écriture depuis ce délai, un sous-agent non marqué « terminé » est considéré comme arrêté. */
export const BACKGROUND_IDLE_MS = 10 * 60_000;
/** Un tour « en cours » d'après le transcript seulement (pas de statut du process) n'est cru que s'il est récent. */
export const TURN_STALE_MS = 10 * 60_000;

/**
 * Sous-agents en cours d'une session : `<transcript sans .jsonl>/subagents/agent-<id>.meta.json` sans
 * `finished: true`, dont le transcript `agent-<id>.jsonl` a été écrit récemment.
 */
export function backgroundAgents(transcript: string, now = Date.now(), maxIdleMs = BACKGROUND_IDLE_MS): BackgroundAgent[] {
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  let files: string[];
  try { files = fs.readdirSync(dir).filter((f) => /^agent-[\w-]+\.meta\.json$/.test(f)); } catch { return []; }
  const out: BackgroundAgent[] = [];
  for (const f of files) {
    const base = f.slice(0, -'.meta.json'.length);
    let meta: any;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!meta || meta.finished === true) continue;
    let st: fs.Stats;
    try { st = fs.statSync(path.join(dir, `${base}.jsonl`)); } catch { continue; }
    if (now - st.mtimeMs > maxIdleMs) continue;
    out.push({
      id: base.slice('agent-'.length),
      type: typeof meta.agentType === 'string' ? meta.agentType : null,
      description: typeof meta.description === 'string' ? meta.description.slice(0, 200) : '',
      startedAt: st.birthtimeMs > 0 ? new Date(st.birthtimeMs).toISOString() : null,
      lastActivityAt: st.mtime.toISOString(),
    });
  }
  return out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 20);
}

export interface AgentTerminal {
  id: string;
  pid: number | null;
  kind: string;
  status: string;
  claudeSessionId: string | null;
  startedAt: string;
  cwd: string | null;
}

export interface BuildInput {
  procs: AgentProc[];
  sessions: Array<{ id: string; cwd: string; title: string; updatedAt: string }>;
  terminals: AgentTerminal[];
  turn: (sessionId: string) => TurnState;
  transcriptOf: (sessionId: string) => string | null;
  background?: (transcript: string) => BackgroundAgent[];
  now?: number;
}

/** Liste des agents en cours (testable : toutes les sources sont fournies). */
export function buildRunningAgents(input: BuildInput): RunningAgent[] {
  const now = input.now ?? Date.now();
  const background = input.background ?? ((f: string) => backgroundAgents(f, now));
  const sessions = new Map(input.sessions.map((s) => [s.id, s]));
  const running = input.terminals.filter((t) => t.status === 'running' && t.pid);
  const attached = attachSessions(input.procs, input.sessions);
  const usedTerminals = new Set<string>();

  const finish = (base: Omit<RunningAgent, 'key' | 'state' | 'background' | 'working' | 'title' | 'lastActivityAt'> & { status: 'busy' | 'idle' | null; statusAt: string | null; name: string | null }): RunningAgent => {
    const s = base.sessionId ? sessions.get(base.sessionId) : undefined;
    const lastActivityAt = [s?.updatedAt, base.statusAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
    let state: RunningAgent['state'] = 'idle';
    if (base.status) state = base.status === 'busy' ? 'working' : 'idle';
    else if (base.sessionId && input.turn(base.sessionId) === 'working' && lastActivityAt && now - Date.parse(lastActivityAt) < TURN_STALE_MS) state = 'working';
    const file = base.sessionId ? input.transcriptOf(base.sessionId) : null;
    const bg = file ? background(file) : [];
    const { status: _s, statusAt: _a, name, ...rest } = base;
    return { ...rest, key: `${base.agent}:${base.pid}`, title: s?.title || name || null, lastActivityAt, state, background: bg, working: state === 'working' || bg.length > 0 };
  };

  const out: RunningAgent[] = input.procs.map((p) => {
    const a = attached.get(p.pid) ?? { sessionId: null, match: 'none' as const };
    const term = running.find((t) => t.pid === p.pid || p.ancestors.includes(t.pid!))
      ?? (a.sessionId ? running.find((t) => t.claudeSessionId === a.sessionId) : undefined);
    if (term) usedTerminals.add(term.id);
    return finish({
      agent: p.agent, pid: p.pid, sessionId: a.sessionId, match: a.match, cwd: p.cwd, startedAt: p.startedAt,
      where: term ? 'tarmac' : 'external', app: term ? 'Tarmac' : p.app, terminalId: term?.id ?? null,
      status: p.pidFile?.status ?? null, statusAt: p.pidFile?.updatedAt ?? null, name: p.pidFile?.name ?? null,
    });
  });
  // Consoles Claude de Tarmac dont le process n'a pas (encore) été vu : connues sans `ps`.
  for (const t of running) {
    if (t.kind !== 'claude' || usedTerminals.has(t.id)) continue;
    if (t.claudeSessionId && out.some((x) => x.sessionId === t.claudeSessionId)) continue;
    out.push(finish({
      agent: 'claude', pid: t.pid!, sessionId: t.claudeSessionId, match: 'tarmac', cwd: t.cwd, startedAt: t.startedAt,
      where: 'tarmac', app: 'Tarmac', terminalId: t.id, status: null, statusAt: null, name: null,
    }));
  }
  return out.sort((a, b) => Number(b.working) - Number(a.working) || (b.lastActivityAt ?? b.startedAt).localeCompare(a.lastActivityAt ?? a.startedAt));
}
