import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tr } from './i18n.js';
import { isDemo } from './demo/index.js';
import { attachSessions, scanAgentProcs } from './agentProcs.js';
import { quote } from './platform.js';


/**
 * Sessions Claude Code locales.
 *
 * Claude Code écrit chaque session dans `~/.claude/projects/<cwd encodé>/<sessionId>.jsonl` (une ligne JSON
 * par évènement, avec `cwd`, `sessionId`, `timestamp`, `gitBranch`…). Les titres viennent de
 * `sessions-index.json` quand il existe (customTitle via /rename, résumé auto), sinon des lignes
 * `summary` / `custom-title` du transcript.
 *
 * Le statut « archivé » est géré côté claude.ai : le transcript local reste présent tant que Claude Code ne
 * l'a pas purgé (`cleanupPeriodDays`, 30 jours par défaut) — toutes les sessions sont donc listées.
 */
export interface ClaudeSession {
  id: string;
  cwd: string;
  title: string;
  titleSource: 'custom' | 'summary' | 'prompt' | 'none';
  firstPrompt: string | null;
  gitBranch: string | null;
  createdAt: string | null;
  updatedAt: string;
  messages: number;
  sizeBytes: number;
  version: string | null;
  /** Session rattachée à un process `claude` en cours (voir attachSessions dans agentProcs.ts). */
  active: boolean;
  /** Session ouverte depuis Tarmac (onglet console). */
  terminalId: string | null;
}

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

interface FileCache { mtimeMs: number; size: number; s: Omit<ClaudeSession, 'active' | 'terminalId'> | null }
const fileCache = new Map<string, FileCache>();

const HEAD = 256 * 1024;
const TAIL = 128 * 1024;

function readSlice(file: string, start: number, length: number) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

const parseLines = (txt: string) =>
  txt.split('\n').flatMap((l) => {
    if (!l.startsWith('{')) return [];
    try { return [JSON.parse(l)]; } catch { return []; } // ligne tronquée en bord de tranche
  });

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const t = content.find((c: any) => c?.type === 'text' && typeof c.text === 'string');
    return t ? (t as any).text : null;
  }
  return null;
}

/** Premier vrai message utilisateur (on ignore les messages techniques : commandes, caveats, rappels). */
function isRealPrompt(line: any): string | null {
  if (line.type !== 'user' || line.isMeta || line.isSidechain) return null;
  const t = textOf(line.message?.content)?.trim();
  if (!t || /^<(command|local-command|system-reminder|bash-|user-memory)/.test(t) || t.startsWith('Caveat:')) return null;
  return t.replace(/\s+/g, ' ').slice(0, 200);
}

function parseTranscript(file: string, st: fs.Stats): Omit<ClaudeSession, 'active' | 'terminalId'> | null {
  const head = parseLines(readSlice(file, 0, Math.min(HEAD, st.size)));
  const tail = st.size > HEAD ? parseLines(readSlice(file, Math.max(0, st.size - TAIL), TAIL)) : [];
  const all = [...head, ...tail];
  const withCwd = all.find((l) => typeof l.cwd === 'string');
  if (!withCwd) return null;
  if (head.every((l) => l.isSidechain)) return null; // transcript de sous-agent

  let custom: string | null = null;
  let summary: string | null = null;
  for (const l of all) {
    if (l.type === 'custom-title' && l.customTitle) custom = l.customTitle;
    else if (typeof l.customTitle === 'string' && l.customTitle) custom = l.customTitle;
    if (l.type === 'summary' && l.summary) summary = l.summary;
    if (l.type === 'ai-title' && (l.title || l.aiTitle)) summary ??= l.title ?? l.aiTitle;
  }
  const firstPrompt = head.map(isRealPrompt).find(Boolean) ?? null;
  const stamps = all.map((l) => l.timestamp).filter((t) => typeof t === 'string').sort();
  const title = custom ?? summary ?? firstPrompt ?? ''; // sans titre : libellé traduit à la sortie (emptyTitle)
  // Estimation du nombre d'échanges : exact pour les petits fichiers, extrapolé sinon.
  const msgHead = head.filter((l) => (l.type === 'user' || l.type === 'assistant') && !l.isSidechain && !l.isMeta).length;
  const messages = st.size <= HEAD ? msgHead : Math.round((msgHead * st.size) / HEAD);

  return {
    id: path.basename(file, '.jsonl'),
    cwd: withCwd.cwd,
    title: title.length > 120 ? title.slice(0, 117) + '…' : title,
    titleSource: custom ? 'custom' : summary ? 'summary' : firstPrompt ? 'prompt' : 'none',
    firstPrompt,
    gitBranch: [...all].reverse().find((l) => l.gitBranch)?.gitBranch ?? null,
    createdAt: stamps[0] ?? null,
    updatedAt: stamps.at(-1) ?? st.mtime.toISOString(),
    messages,
    sizeBytes: st.size,
    version: withCwd.version ?? null,
  };
}

/** Index officiel (titres /rename, résumés) quand Claude Code l'a écrit. */
function readIndex(dir: string): Map<string, any> {
  const m = new Map<string, any>();
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'sessions-index.json'), 'utf8'));
    for (const e of idx.entries ?? idx.sessions ?? []) if (e.sessionId) m.set(e.sessionId, e);
  } catch { /* pas d'index */ }
  return m;
}

/** Process `claude` en cours (mode démo : seulement ceux du HOME factice, sans app parente). */
export const claudeProcs = (strict = false) => scanAgentProcs({ claudeDir: claudeDir(), onlyUnder: isDemo() ? realHome() : null, strict });
const realHome = () => { try { return fs.realpathSync(os.homedir()); } catch { return os.homedir(); } };

let cache: { at: number; sessions: Omit<ClaudeSession, 'terminalId'>[] } = { at: 0, sessions: [] };

/** Session sans titre : libellé dans la langue de la requête (le cache reste neutre). */
const emptyTitle = <S extends { title: string; titleSource: ClaudeSession['titleSource'] }>(list: S[]): S[] =>
  list.map((s) => (s.titleSource === 'none' && !s.title ? { ...s, title: tr({ en: '(empty session)', fr: '(session vide)' }) } : s));

export async function listClaudeSessions(force = false): Promise<Omit<ClaudeSession, 'terminalId'>[]> {
  if (!force && Date.now() - cache.at < 8000) return emptyTitle(cache.sessions);
  const base = path.join(claudeDir(), 'projects');
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(base); } catch { return (cache = { at: Date.now(), sessions: [] }).sessions; }

  const found: Omit<ClaudeSession, 'active' | 'terminalId'>[] = [];
  const seen = new Set<string>();
  for (const d of dirs) {
    const dir = path.join(base, d);
    let files: string[];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-')); } catch { continue; }
    const index = readIndex(dir);
    for (const f of files) {
      const file = path.join(dir, f);
      seen.add(file);
      let st: fs.Stats;
      try { st = fs.statSync(file); } catch { continue; }
      if (!st.size) continue;
      let c = fileCache.get(file);
      if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
        c = { mtimeMs: st.mtimeMs, size: st.size, s: (() => { try { return parseTranscript(file, st); } catch { return null; } })() };
        fileCache.set(file, c);
      }
      if (!c.s) continue;
      const e = index.get(c.s.id);
      const s = { ...c.s };
      if (e?.customTitle) Object.assign(s, { title: e.customTitle, titleSource: 'custom' as const });
      else if (e?.summary && s.titleSource !== 'custom') Object.assign(s, { title: e.summary, titleSource: 'summary' as const });
      if (typeof e?.messageCount === 'number') s.messages = e.messageCount;
      found.push(s);
    }
  }
  for (const k of fileCache.keys()) if (!seen.has(k)) fileCache.delete(k);

  // Session active : rattachée à un process `claude` en cours (fichier de session, arguments, sinon transcript
  // le plus récent du dossier écrit depuis le début du process ; voir attachSessions).
  const procs = await claudeProcs().catch(() => []);
  const active = new Set([...attachSessions(procs, found).values()].flatMap((a) => (a.sessionId ? [a.sessionId] : [])));

  const sessions = found
    .map((s) => ({ ...s, active: active.has(s.id) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  cache = { at: Date.now(), sessions };
  return emptyTitle(sessions);
}

/**
 * Dépôt principal d'un worktree git lié (dossier voisin du projet, hors de son arbre), ou null : remonte jusqu'au
 * `.git` ; un *fichier* `.git` (`gitdir: <principal>/.git/worktrees/<nom>`) + `commondir` désignent le `.git` commun.
 */
export function worktreeMain(cwd: string): string | null {
  try {
    for (let d = cwd; ; d = path.dirname(d)) {
      const git = path.join(d, '.git');
      if (fs.existsSync(git)) {
        if (!fs.statSync(git).isFile()) return null;
        const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(git, 'utf8'));
        if (!m) return null;
        const gitdir = path.resolve(d, m[1].trim());
        const common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim());
        return path.basename(common) === '.git' ? path.dirname(common) : null;
      }
      if (path.dirname(d) === d) return null;
    }
  } catch {
    return null;
  }
}

/**
 * Rattache chaque session au projet le plus profond dont le dossier contient son `cwd` ; à défaut, un worktree git
 * lié (voisin du projet, hors de son arbre) va au projet de son dépôt principal.
 * `dirs` : dossiers des projets (apps et racines de groupe).
 */
export function assignSessions<T extends { cwd: string }>(sessions: T[], dirs: string[], mainOf: (cwd: string) => string | null = worktreeMain): Map<string, T[]> {
  const sorted = [...new Set(dirs)].sort((a, b) => b.length - a.length);
  const find = (cwd: string) => sorted.find((p) => cwd === p || cwd.startsWith(p + path.sep));
  const out = new Map<string, T[]>();
  for (const s of sessions) {
    const main = find(s.cwd) ? null : mainOf(s.cwd);
    const d = find(s.cwd) ?? (main ? find(main) : undefined);
    if (d) out.set(d, [...(out.get(d) ?? []), s]);
  }
  return out;
}

/** Commande shell : nouvelle session Remote Control, ou reprise d'une session existante. */
export function claudeCommand(opts: { name?: string; resume?: string; sessionId?: string; prompt?: string }) {
  const q = (s: string) => quote(s);
  // --session-id : on connaît l'ID du transcript dès le lancement (lien onglet ↔ session).
  // `prompt` : premier message (ex. `/suivi init`), après le nom consommé par --remote-control.
  if (opts.resume) return `claude --resume ${q(opts.resume)} --remote-control`;
  return `claude${opts.sessionId ? ` --session-id ${opts.sessionId}` : ''} --remote-control ${q(opts.name ?? 'Claude')}${opts.prompt ? ' ' + q(opts.prompt) : ''}`;
}

/**
 * Tour de parole d'une session d'après la fin de son transcript (`<sessionId>.jsonl`) :
 * - `idle` : le dernier message est une réponse de Claude sans outil en attente (tour terminé), ou une interruption ;
 * - `working` : dernier message de l'utilisateur (Claude répond) ou appel d'outil sans résultat (outil en cours ou
 *   permission demandée) ;
 * - `none` : pas de transcript ou aucun échange (session neuve, ou transcript ailleurs : reprise).
 */
export type TurnState = 'idle' | 'working' | 'none';
const transcriptPath = new Map<string, string>();

/** Transcript d'une session (`projects/<dossier>/<id>.jsonl`), ou null. */
export function transcriptFile(sessionId: string): string | null {
  if (!/^[0-9a-f-]{8,64}$/i.test(sessionId)) return null;
  let file = transcriptPath.get(sessionId);
  if (!file || !fs.existsSync(file)) {
    file = undefined;
    const base = path.join(claudeDir(), 'projects');
    try {
      for (const d of fs.readdirSync(base)) {
        const f = path.join(base, d, `${sessionId}.jsonl`);
        if (fs.existsSync(f)) { file = f; transcriptPath.set(sessionId, f); break; }
      }
    } catch { /* pas de dossier projects */ }
  }
  return file ?? null;
}

export function claudeTurnState(sessionId: string): TurnState {
  const file = transcriptFile(sessionId);
  if (!file) return 'none';
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return 'none'; }
  const lines = parseLines(readSlice(file, Math.max(0, st.size - TAIL), Math.min(TAIL, st.size)))
    .filter((l) => (l.type === 'user' || l.type === 'assistant') && !l.isSidechain && !l.isMeta);
  const last = lines.at(-1);
  if (!last) return 'none';
  const content = Array.isArray(last.message?.content) ? last.message.content : [];
  if (last.type === 'assistant') return content.some((c: any) => c?.type === 'tool_use') ? 'working' : 'idle';
  const text = textOf(last.message?.content) ?? '';
  return /^\[Request interrupted by user/.test(text.trim()) ? 'idle' : 'working';
}
