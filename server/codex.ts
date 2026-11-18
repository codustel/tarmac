import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { tr } from './i18n.js';
import { isDemo } from './demo/index.js';
import { attachSessions, scanAgentProcs } from './agentProcs.js';
import { claudeDir, type ClaudeSession, type TurnState } from './claude.js';
import { quote } from './platform.js';

/**
 * Sessions Codex (ChatGPT) locales, en lecture seule.
 *
 * Codex écrit chaque session dans `$CODEX_HOME/sessions/AAAA/MM/JJ/rollout-<horodatage>-<id>.jsonl`
 * (`CODEX_HOME` = `~/.codex` par défaut ; les fichiers de plus de 7 jours peuvent être compressés en
 * `.jsonl.zst`). Une ligne JSON par élément : `{ timestamp, type, payload }` avec `type` = `session_meta`
 * (id, cwd, horodatage, version, origine, branche git), `response_item`, `event_msg` (`user_message`,
 * `agent_message`, `task_started`, `task_complete`, `turn_aborted`, `token_count` avec les limites d'usage…),
 * `turn_context`… Les noms donnés par `/rename` sont dans `$CODEX_HOME/session_index.jsonl`
 * (`{ id, thread_name, updated_at }`, la dernière ligne l'emporte).
 * Source : code ouvert de Codex (openai/codex, `codex-rs/rollout`, `codex-rs/protocol`). La doc officielle
 * (« Hooks ») prévient que ce format n'est pas une interface stable : tout champ inconnu est ignoré, et une ligne
 * illisible n'est jamais une erreur.
 */
export type CodexSession = Omit<ClaudeSession, 'terminalId'> & { agent: 'codex' };

export const codexDir = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

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

export const parseLines = (txt: string) =>
  txt.split('\n').flatMap((l) => {
    if (!l.startsWith('{')) return [];
    try { return [JSON.parse(l)]; } catch { return []; } // ligne tronquée en bord de tranche
  });

/** Décompression zstd (Node ≥ 22.15) ; sans elle, les anciens transcripts compressés sont ignorés. */
const zstd = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync;

/** Texte d'une consigne de l'utilisateur, hors contexte injecté par Codex (`<environment_context>`, AGENTS.md…). */
function realPrompt(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.startsWith('<') || /^# AGENTS\.md/i.test(t)) return null;
  return t.replace(/\s+/g, ' ').slice(0, 200);
}

function promptOf(l: any): string | null {
  const p = l?.payload;
  if (l?.type === 'event_msg' && p?.type === 'user_message') return realPrompt(p.message);
  if (l?.type === 'response_item' && p?.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
    return realPrompt(p.content.find((c: any) => c?.type === 'input_text' && typeof c.text === 'string')?.text);
  }
  return null;
}

/** Sous-agent (Codex lancé par Codex) : pas une session de l'utilisateur. */
function isSubAgent(meta: any): boolean {
  const src = meta?.source;
  return (!!src && typeof src === 'object' && 'subagent' in src) || meta?.thread_source === 'subagent';
}

/** Résumé d'un transcript à partir de ses lignes (testable). `null` : pas une session listable. */
export function summarizeRollout(lines: any[], o: { file: string; sizeBytes: number; mtime: Date; exact: boolean }): Omit<CodexSession, 'active'> | null {
  const meta = lines.find((l) => l?.type === 'session_meta')?.payload;
  if (!meta || typeof meta.cwd !== 'string' || isSubAgent(meta)) return null;
  const idFromName = path.basename(o.file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[^.]*)?\.jsonl(?:\.zst)?$/i)?.[1];
  const id = typeof meta.id === 'string' ? meta.id : idFromName;
  if (!id) return null;
  const firstPrompt = lines.map(promptOf).find(Boolean) ?? null;
  const stamps = lines.map((l) => l?.timestamp).filter((t) => typeof t === 'string').sort();
  const events = lines.filter((l) => l?.type === 'event_msg' && (l.payload?.type === 'user_message' || l.payload?.type === 'agent_message')).length;
  const items = lines.filter((l) => l?.type === 'response_item' && l.payload?.type === 'message' && (l.payload.role === 'assistant' || promptOf(l))).length;
  const counted = events || items;
  const messages = o.exact ? counted : Math.round((counted * o.sizeBytes) / HEAD);
  const title = firstPrompt ?? '';
  return {
    agent: 'codex',
    id,
    cwd: meta.cwd,
    title: title.length > 120 ? title.slice(0, 117) + '…' : title,
    titleSource: firstPrompt ? 'prompt' : 'none',
    firstPrompt,
    gitBranch: typeof meta.git?.branch === 'string' ? meta.git.branch : null,
    createdAt: typeof meta.timestamp === 'string' ? meta.timestamp : stamps[0] ?? null,
    updatedAt: stamps.at(-1) ?? o.mtime.toISOString(),
    messages,
    sizeBytes: o.sizeBytes,
    version: typeof meta.cli_version === 'string' ? meta.cli_version : null,
  };
}

/** Lignes utiles d'un transcript : début et fin (fichier en clair) ou tout (compressé, borné). */
function readRollout(file: string, st: fs.Stats): { lines: any[]; exact: boolean } | null {
  if (file.endsWith('.zst')) {
    if (!zstd || st.size > 8 * 1024 * 1024) return null;
    const text = zstd(fs.readFileSync(file)).toString('utf8');
    return { lines: parseLines(text), exact: true };
  }
  const head = parseLines(readSlice(file, 0, Math.min(HEAD, st.size)));
  const tail = st.size > HEAD ? parseLines(readSlice(file, Math.max(0, st.size - TAIL), TAIL)) : [];
  return { lines: [...head, ...tail], exact: st.size <= HEAD };
}

/** Noms donnés par `/rename` (`session_index.jsonl`, la dernière ligne l'emporte). */
export function readSessionIndex(dir = codexDir()): Map<string, string> {
  const m = new Map<string, string>();
  let txt = '';
  try { txt = fs.readFileSync(path.join(dir, 'session_index.jsonl'), 'utf8'); } catch { return m; }
  for (const e of parseLines(txt)) {
    if (typeof e?.id === 'string' && typeof e.thread_name === 'string' && e.thread_name.trim()) m.set(e.id, e.thread_name.trim().slice(0, 120));
  }
  return m;
}

/** Fichiers `rollout-*.jsonl(.zst)` de `sessions/AAAA/MM/JJ`. */
export function rolloutFiles(dir = codexDir()): string[] {
  const base = path.join(dir, 'sessions');
  const out: string[] = [];
  const sub = (d: string) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  for (const y of sub(base)) {
    if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue;
    for (const m of sub(path.join(base, y.name))) {
      if (!m.isDirectory()) continue;
      for (const d of sub(path.join(base, y.name, m.name))) {
        if (!d.isDirectory()) continue;
        const dd = path.join(base, y.name, m.name, d.name);
        for (const f of sub(dd)) if (f.isFile() && /^rollout-.*\.jsonl(\.zst)?$/.test(f.name)) out.push(path.join(dd, f.name));
      }
    }
  }
  return out;
}

interface FileCache { mtimeMs: number; size: number; s: Omit<CodexSession, 'active'> | null }
const fileCache = new Map<string, FileCache>();
const fileOf = new Map<string, string>();
let cache: { at: number; dir: string; sessions: CodexSession[] } = { at: 0, dir: '', sessions: [] };

/** Process `codex` en cours (mode démo : seulement ceux du HOME factice). */
export const codexProcs = (strict = false) => scanAgentProcs({ claudeDir: claudeDir(), kinds: ['codex'], onlyUnder: isDemo() ? realHome() : null, strict });
/** Process `codex` vivants avec leur session rattachée (`sessionId`, null si inconnue) : `resume <id>`, sinon transcript du dossier. */
export async function codexProcsWithSession(strict = false) {
  const procs = await codexProcs(strict);
  const sessions = await listCodexSessions().catch(() => []);
  const att = attachSessions(procs, sessions.map((s) => ({ ...s, agent: 'codex' as const })));
  return procs.map((p) => ({ ...p, sessionId: att.get(p.pid)?.sessionId ?? null }));
}
const realHome = () => { try { return fs.realpathSync(os.homedir()); } catch { return os.homedir(); } };

const emptyTitle = <S extends { title: string; titleSource: ClaudeSession['titleSource'] }>(list: S[]): S[] =>
  list.map((s) => (s.titleSource === 'none' && !s.title ? { ...s, title: tr({ en: '(empty session)', fr: '(session vide)' }) } : s));

/** Sessions Codex (cache de 8 s ; chaque transcript n'est relu que s'il a changé). */
export async function listCodexSessions(force = false): Promise<CodexSession[]> {
  const dir = codexDir();
  if (!force && cache.dir === dir && Date.now() - cache.at < 8000) return emptyTitle(cache.sessions);
  const files = rolloutFiles(dir);
  const seen = new Set<string>();
  const found: Omit<CodexSession, 'active'>[] = [];
  for (const file of files) {
    seen.add(file);
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.size) continue;
    let c = fileCache.get(file);
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      c = { mtimeMs: st.mtimeMs, size: st.size, s: (() => {
        try {
          const r = readRollout(file, st);
          return r ? summarizeRollout(r.lines, { file, sizeBytes: st.size, mtime: st.mtime, exact: r.exact }) : null;
        } catch { return null; }
      })() };
      fileCache.set(file, c);
    }
    if (!c.s) continue;
    // Un même fil peut avoir plusieurs fichiers (retour arrière) : le plus récent l'emporte.
    const prev = found.findIndex((x) => x.id === c!.s!.id);
    if (prev >= 0) { if (found[prev].updatedAt >= c.s.updatedAt) continue; found.splice(prev, 1); }
    found.push(c.s);
    fileOf.set(c.s.id, file);
  }
  for (const k of fileCache.keys()) if (!seen.has(k)) fileCache.delete(k);

  const names = readSessionIndex(dir);
  const procs = await codexProcs().catch(() => []);
  const active = new Set([...attachSessions(procs, found.map((s) => ({ ...s, agent: 'codex' as const }))).values()].flatMap((a) => (a.sessionId ? [a.sessionId] : [])));
  const sessions: CodexSession[] = found
    .map((s) => {
      const name = names.get(s.id);
      return { ...s, ...(name ? { title: name, titleSource: 'custom' as const } : {}), active: active.has(s.id) };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  cache = { at: Date.now(), dir, sessions };
  return emptyTitle(sessions);
}

const ID_RE = /^[0-9a-f][0-9a-f-]{7,63}$/i;

/** Transcript d'une session Codex, ou null (après une première liste). */
export function codexTranscriptFile(sessionId: string): string | null {
  if (!ID_RE.test(sessionId)) return null;
  let f = fileOf.get(sessionId);
  if (f && fs.existsSync(f)) return f;
  f = rolloutFiles().filter((x) => x.includes(sessionId)).sort().at(-1);
  if (f) fileOf.set(sessionId, f);
  return f ?? null;
}

/**
 * Tour de parole d'après les derniers évènements du transcript : `task_started` (ou `turn_started`) sans
 * `task_complete` / `turn_complete` / `turn_aborted` après lui = `working` ; sinon `idle` ; aucun = `none`.
 */
export function codexTurnFromLines(lines: any[]): TurnState {
  let state: TurnState = 'none';
  for (const l of lines) {
    if (l?.type !== 'event_msg') continue;
    const t = l.payload?.type;
    if (t === 'task_started' || t === 'turn_started') state = 'working';
    else if (t === 'task_complete' || t === 'turn_complete' || t === 'turn_aborted') state = 'idle';
  }
  return state;
}

export function codexTurnState(sessionId: string): TurnState {
  const file = codexTranscriptFile(sessionId);
  if (!file || file.endsWith('.zst')) return 'none';
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return 'none'; }
  return codexTurnFromLines(parseLines(readSlice(file, Math.max(0, st.size - TAIL), Math.min(TAIL, st.size))));
}

/**
 * Commande shell : nouvelle session (premier message facultatif) ou reprise (`codex resume <id>`).
 * Codex n'a pas d'option par session comme `--remote-control` de Claude Code : son « Remote Control » passe par
 * l'app ChatGPT (doc « Remote connections »).
 */
export function codexCommand(opts: { resume?: string; prompt?: string }) {
  const q = (s: string) => quote(s);
  if (opts.resume) return `codex resume ${q(opts.resume)}`;
  // Un message qui commencerait par « - » serait lu comme une option.
  const prompt = opts.prompt?.replace(/^-+/, '').trim();
  return `codex${prompt ? ' ' + q(prompt) : ''}`;
}

// ─── Usage (limites du plan ChatGPT) ────────────────────────────────────────

export interface CodexUsageLimit { id: string; kind: 'session' | 'week' | 'model'; label: string | null; utilization: number; resetsAt: string | null }
export interface CodexUsage {
  /** `none` : aucune limite lue (Codex pas encore utilisé avec un compte ChatGPT). */
  status: 'ok' | 'disabled' | 'none' | 'error';
  plan: string | null;
  limits: CodexUsageLimit[];
  /** Moment où Codex a reçu ces valeurs (ligne du transcript). */
  fetchedAt: string | null;
}

const PLAN_NAMES: Record<string, string> = {
  free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro Lite', promax: 'Pro Max', team: 'Team', business: 'Business',
  enterprise: 'Enterprise', edu: 'Edu', edu_plus: 'Edu Plus',
};
const planName = (p: unknown) => (typeof p === 'string' && p ? PLAN_NAMES[p] ?? p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null);

/** Fenêtre d'usage : 300 min = session de 5 h, 10 080 min = semaine, sinon sa durée en libellé. */
function windowOf(id: string, w: any, now: number): CodexUsageLimit | null {
  if (!w || typeof w.used_percent !== 'number' || !Number.isFinite(w.used_percent)) return null;
  const minutes = typeof w.window_minutes === 'number' ? w.window_minutes : null;
  const resetsAt = typeof w.resets_at === 'number' && w.resets_at > 0 ? new Date(w.resets_at * 1000).toISOString() : null;
  // Fenêtre déjà remise à zéro depuis la lecture : la valeur lue n'a plus cours (rien n'est deviné à la place).
  if (resetsAt && Date.parse(resetsAt) <= now) return null;
  const kind = minutes === 300 ? 'session' : minutes === 10080 ? 'week' : 'model';
  const label = kind !== 'model' ? null : minutes ? (minutes % 1440 === 0 ? `${minutes / 1440} d` : minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`) : null;
  return { id, kind, label, utilization: Math.max(0, w.used_percent), resetsAt };
}

/** Limites d'usage du dernier évènement `token_count` qui en porte (testable). */
export function usageFromLines(lines: any[], now = Date.now()): Omit<CodexUsage, 'status'> | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const rl = l?.type === 'event_msg' && l.payload?.type === 'token_count' ? l.payload.rate_limits : null;
    if (!rl || typeof rl !== 'object') continue;
    const limits = [windowOf('primary', rl.primary, now), windowOf('secondary', rl.secondary, now)].filter((x): x is CodexUsageLimit => !!x);
    return { plan: planName(rl.plan_type), limits, fetchedAt: typeof l.timestamp === 'string' ? l.timestamp : null };
  }
  return null;
}

/**
 * Usage lu dans les transcripts les plus récents (aucun réseau, aucun jeton) : Codex y enregistre les limites
 * renvoyées par OpenAI à chaque échange (`token_count.rate_limits` : pourcentage utilisé, durée de la fenêtre,
 * remise à zéro, plan). Ce sont les valeurs que montre `/status`, à la date du dernier échange.
 */
export function readCodexUsage(dir = codexDir(), now = Date.now()): CodexUsage {
  const files = rolloutFiles(dir)
    .filter((f) => !f.endsWith('.zst'))
    .map((f) => { try { return { f, m: fs.statSync(f).mtimeMs }; } catch { return null; } })
    .filter((x): x is { f: string; m: number } => !!x)
    .sort((a, b) => b.m - a.m)
    .slice(0, 8);
  for (const { f } of files) {
    try {
      const st = fs.statSync(f);
      const u = usageFromLines(parseLines(readSlice(f, Math.max(0, st.size - TAIL), Math.min(TAIL, st.size))), now);
      if (u) return { status: 'ok', ...u };
    } catch { /* fichier en cours d'écriture */ }
  }
  return { status: 'none', plan: null, limits: [], fetchedAt: null };
}
