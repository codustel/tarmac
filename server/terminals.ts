import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { IPty } from '@lydell/node-pty';
import type { Project } from './scanner.js';
import { tr } from './i18n.js';
import { commandArgs, interactiveArgs, killTree, prependPath, shell as currentShell } from './platform.js';

/** Cible d'une console : un projet, ou une cible « système » (ex. `gh auth login`). */
export type TerminalTarget = Pick<Project, 'id' | 'dir' | 'env' | 'pathPrepend'>;
export const SYSTEM_ID = '__system__';

// node-pty est natif (binaires précompilés) : chargé à la demande pour que Tarmac démarre même s'il manque.
let ptyModule: typeof import('@lydell/node-pty') | null = null;
let ptyError: string | null = null;
async function loadPty() {
  if (ptyModule || ptyError) return ptyModule;
  try {
    ptyModule = await import('@lydell/node-pty');
  } catch (e: any) {
    ptyError = e.message;
  }
  return ptyModule;
}

const MAX_BUFFER = 512 * 1024;

export type TerminalKind = 'command' | 'shell' | 'claude' | 'codex' | 'system';

export interface TerminalSummary {
  id: string;
  projectId: string;
  projectName: string;
  kind: TerminalKind;
  /** Session Claude Code associée (onglet lancé depuis Tarmac). */
  claudeSessionId: string | null;
  /** Session Codex associée : connue à la reprise, ou repérée après le lancement (process rattaché à son transcript). */
  codexSessionId: string | null;
  label: string;
  command: string | null;
  status: 'running' | 'exited';
  exitCode: number | null;
  pid: number | null;
  startedAt: string;
  /** Dernière sortie ou saisie dans la console. */
  lastActivityAt: string | null;
}

interface Session extends TerminalSummary {
  pty: IPty;
  buffer: string;
  /** Dernière sortie (et non saisie) : sert à savoir si une session Claude est au repos. */
  lastOutputAt: string | null;
}

class TerminalManager extends EventEmitter {
  private sessions = new Map<string, Session>();

  constructor() {
    super();
    this.setMaxListeners(0);
  }

  get available() {
    return ptyError === null;
  }

  findByClaude(sessionId: string) {
    return [...this.sessions.values()].find((s) => s.claudeSessionId === sessionId && s.status === 'running')?.id ?? null;
  }

  findByCodex(sessionId: string) {
    return [...this.sessions.values()].find((s) => s.kind === 'codex' && s.codexSessionId === sessionId && s.status === 'running')?.id ?? null;
  }

  /** Session Codex repérée pour une console Codex de Tarmac (une seule fois : la première trouvée reste). */
  setCodexSession(id: string, sessionId: string) {
    const s = this.sessions.get(id);
    if (s?.kind === 'codex' && !s.codexSessionId) s.codexSessionId = sessionId;
  }

  list(projectId?: string): TerminalSummary[] {
    return [...this.sessions.values()].filter((s) => !projectId || s.projectId === projectId).map(this.summary);
  }

  private summary = (s: Session): TerminalSummary => ({
    id: s.id, projectId: s.projectId, projectName: s.projectName, kind: s.kind, claudeSessionId: s.claudeSessionId,
    codexSessionId: s.codexSessionId, label: s.label, command: s.command, status: s.status,
    exitCode: s.exitCode, pid: s.status === 'running' ? s.pty.pid : null, startedAt: s.startedAt, lastActivityAt: s.lastActivityAt,
  });

  /** `command` null → shell interactif dans le dossier du projet (venv activé le cas échéant). */
  async create(project: TerminalTarget, opts: { command: string | null; label: string; cols?: number; rows?: number; unsetEnv?: string[]; kind?: TerminalKind; projectName?: string; claudeSessionId?: string | null; codexSessionId?: string | null }) {
    const pty = await loadPty();
    if (!pty) throw new Error(tr({ en: 'Console unavailable (node-pty): {error}', fr: 'Console indisponible (node-pty) : {error}' }, { error: String(ptyError) }));

    const shell = currentShell();
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...project.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      PYTHONUNBUFFERED: '1',
    };
    prependPath(env, project.pathPrepend);
    for (const k of opts.unsetEnv ?? []) delete env[k];

    // Commande : shell non-login (`-c`, `-NoProfile`) pour garder le PATH de Tarmac (et le venv) intact.
    const args = opts.command ? commandArgs(opts.command, shell) : interactiveArgs(shell);
    const p = pty.spawn(shell.file, args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 32,
      cwd: project.dir,
      env,
    });

    const s: Session = {
      id: crypto.randomUUID().slice(0, 8),
      projectId: project.id,
      projectName: opts.projectName ?? '',
      kind: opts.kind ?? (opts.command ? 'command' : 'shell'),
      claudeSessionId: opts.claudeSessionId ?? null,
      codexSessionId: opts.codexSessionId ?? null,
      label: opts.label,
      command: opts.command,
      status: 'running',
      exitCode: null,
      pid: p.pid,
      startedAt: new Date().toISOString(),
      lastActivityAt: null,
      lastOutputAt: null,
      pty: p,
      buffer: opts.command ? `\x1b[38;5;111m$ ${opts.command}\x1b[0m\r\n` : '',
    };
    this.sessions.set(s.id, s);

    p.onData((data) => {
      s.lastActivityAt = s.lastOutputAt = new Date().toISOString();
      s.buffer += data;
      if (s.buffer.length > MAX_BUFFER) s.buffer = s.buffer.slice(-MAX_BUFFER);
      this.emit('data', s.id, data);
    });
    p.onExit(({ exitCode }) => {
      s.status = 'exited';
      s.exitCode = exitCode;
      const msg = `\r\n\x1b[38;5;244m— ${tr({ en: 'process exited (code {code})', fr: 'processus terminé (code {code})' }, { code: exitCode })} —\x1b[0m\r\n`;
      s.buffer += msg;
      this.emit('data', s.id, msg);
      this.emit('change', s.projectId);
      this.emit('exit', s.id, s.projectId, exitCode);
    });

    this.emit('change', s.projectId);
    return this.summary(s);
  }

  /** Fin de la sortie d'une console en cours (état d'une session Claude), avec la date de la dernière sortie. */
  screen(id: string, chars = 16_000) {
    const s = this.sessions.get(id);
    return s?.status === 'running' ? { text: s.buffer.slice(-chars), lastOutputAt: s.lastOutputAt } : null;
  }

  replay(id: string) {
    return this.sessions.get(id)?.buffer ?? null;
  }

  write(id: string, data: string) {
    const s = this.sessions.get(id);
    if (s?.status !== 'running') return;
    s.lastActivityAt = new Date().toISOString();
    s.pty.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const s = this.sessions.get(id);
    if (s?.status === 'running' && cols > 0 && rows > 0) {
      try { s.pty.resize(Math.min(cols, 500), Math.min(rows, 200)); } catch { /* pty fermé */ }
    }
  }

  kill(id: string) {
    const s = this.sessions.get(id);
    if (s?.status !== 'running') return;
    if (!killTree(s.pty.pid)) s.pty.kill();
    setTimeout(() => {
      if (s.status === 'running') killTree(s.pty.pid, 'SIGKILL');
    }, 3000);
  }

  close(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.kill(id);
    this.sessions.delete(id);
    this.emit('change', s.projectId);
  }

  killAll() {
    for (const id of this.sessions.keys()) this.kill(id);
  }
}

export const terminals = new TerminalManager();
