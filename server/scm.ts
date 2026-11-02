import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { appError, tr } from './i18n.js';
import { resolveInside } from './ide.js';

/**
 * Source Control de l'IDE (équivalent du panneau « Source Control » de VS Code) : statut, graphe,
 * contenus HEAD / index pour les diffs, et un jeu fermé d'actions git (pas de commande libre).
 * Tout s'exécute dans le dossier du projet ; un projet situé dans un sous-dossier du dépôt ne voit
 * que ses propres fichiers (pathspec `.`), avec des chemins relatifs au projet.
 */

const exec = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', GIT_OPTIONAL_LOCKS: '0' };
/** Fichiers affichés par groupe (VS Code s'arrête à 10 000). */
export const MAX_CHANGES = 5000;

export type ScmCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '!';
export interface ScmChange { path: string; orig?: string; code: ScmCode }
export interface ScmStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  conflicts: ScmChange[];
  staged: ScmChange[];
  changes: ScmChange[];
  /** Totaux réels (les listes sont tronquées à MAX_CHANGES). */
  counts: { conflicts: number; staged: number; changes: number };
}

async function git(cwd: string, args: string[], opts: { timeout?: number; input?: string } = {}) {
  const { stdout } = await exec('git', args, { cwd, env: GIT_ENV, timeout: opts.timeout ?? 15_000, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Message d'erreur git lisible (stderr plutôt que « Command failed: … »). */
export function gitError(e: any): Error {
  const msg = String(e?.stderr || e?.message || e).trim().split('\n').filter((l) => l && !l.startsWith('hint:')).slice(-4).join('\n');
  return Object.assign(new Error(msg || tr({ en: 'git command failed', fr: 'Échec de la commande git' })), { statusCode: 400 });
}

// ─── Statut ──────────────────────────────────────────────────────────────────

/** Analyse `git status --porcelain=v2 -z --branch` ; `prefix` = dossier du projet dans le dépôt (`apps/web/`). */
export function parseStatus(out: string, prefix: string): ScmStatus {
  const s: ScmStatus = { branch: null, upstream: null, ahead: 0, behind: 0, conflicts: [], staged: [], changes: [], counts: { conflicts: 0, staged: 0, changes: 0 } };
  const rel = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : null);
  const push = (group: 'conflicts' | 'staged' | 'changes', c: ScmChange) => {
    s.counts[group]++;
    if (s[group].length < MAX_CHANGES) s[group].push(c);
  };
  const recs = out.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r) continue;
    if (r.startsWith('# ')) {
      const [key, ...v] = r.slice(2).split(' ');
      if (key === 'branch.head') s.branch = v[0] === '(detached)' ? null : v.join(' ');
      else if (key === 'branch.upstream') s.upstream = v.join(' ');
      else if (key === 'branch.ab') { s.ahead = Math.abs(Number(v[0])); s.behind = Math.abs(Number(v[1])); }
      continue;
    }
    const kind = r[0];
    if (kind === '?') {
      const p = rel(r.slice(2));
      if (p !== null) push('changes', { path: p, code: 'U' });
      continue;
    }
    if (kind !== '1' && kind !== '2' && kind !== 'u') continue;
    const nFields = kind === '1' ? 8 : kind === '2' ? 9 : 10;
    const fields = r.split(' ');
    const p = rel(fields.slice(nFields).join(' '));
    const orig = kind === '2' ? recs[++i] : undefined;
    if (p === null) continue;
    if (kind === 'u') { push('conflicts', { path: p, code: '!' }); continue; }
    const [x, y] = fields[1];
    const o = orig === undefined ? undefined : rel(orig) ?? orig;
    if (x !== '.') push('staged', { path: p, code: x as ScmCode, ...(o !== undefined ? { orig: o } : {}) });
    if (y !== '.') push('changes', { path: p, code: y as ScmCode });
  }
  return s;
}

const prefixCache = new Map<string, string>();
async function prefixOf(dir: string) {
  let p = prefixCache.get(dir);
  if (p === undefined) {
    p = (await git(dir, ['rev-parse', '--show-prefix'])).trim();
    prefixCache.set(dir, p);
  }
  return p;
}

export async function scmStatus(dir: string): Promise<ScmStatus> {
  try {
    const [prefix, out] = await Promise.all([
      prefixOf(dir),
      git(dir, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--', '.']),
    ]);
    return parseStatus(out, prefix);
  } catch (e) {
    throw gitError(e);
  }
}

// ─── Graphe ──────────────────────────────────────────────────────────────────

export interface ScmCommit {
  hash: string;
  parents: string[];
  author: string;
  date: number;
  refs: string[];
  subject: string;
  /** Commit pas encore poussé (`out`) ou pas encore récupéré (`in`). */
  flow?: 'out' | 'in';
}
/** Segments d'une ligne du graphe : [colonne de départ, colonne d'arrivée] sur la moitié haute / basse. */
export interface GraphRow { col: number; top: Array<[number, number]>; bottom: Array<[number, number]> }

/**
 * Couloirs du graphe (ordre topologique). Les colonnes restent stables d'une ligne à l'autre ;
 * une colonne libérée est réutilisée par la branche suivante.
 */
export function computeGraph(commits: Array<Pick<ScmCommit, 'hash' | 'parents'>>): GraphRow[] {
  let lanes: Array<string | null> = [];
  const rows: GraphRow[] = [];
  const freeCol = (except = -1) => {
    const i = lanes.findIndex((l, j) => l === null && j !== except);
    return i === -1 ? lanes.length : i;
  };
  for (const c of commits) {
    let col = lanes.indexOf(c.hash);
    if (col === -1) col = freeCol();
    const top: Array<[number, number]> = [];
    lanes.forEach((l, i) => { if (l !== null) top.push(l === c.hash ? [i, col] : [i, i]); });
    const before = lanes.map((l) => (l === c.hash ? null : l));
    lanes = [...before];
    const bottom: Array<[number, number]> = [];
    c.parents.forEach((p, k) => {
      const j = lanes.indexOf(p);
      if (j !== -1) { bottom.push([col, j]); return; }
      const at = k === 0 ? col : freeCol(col);
      lanes[at] = p;
      bottom.push([col, at]);
    });
    lanes.forEach((l, i) => { if (l !== null && before[i] === l) bottom.push([i, i]); });
    while (lanes.length && lanes.at(-1) === null) lanes.pop();
    rows.push({ col, top, bottom });
  }
  return rows;
}

export function parseLog(out: string): ScmCommit[] {
  return out.split('\0').filter((r) => r.trim()).map((r) => {
    const [hash, parents, author, date, refs, subject] = r.replace(/^\n/, '').split('\x1f');
    return {
      hash,
      parents: parents ? parents.split(' ') : [],
      author,
      date: Number(date),
      refs: refs ? refs.split(', ').filter((x) => x !== 'origin/HEAD') : [],
      subject: subject ?? '',
    };
  });
}

export async function scmLog(dir: string, limit = 150) {
  try {
    const upstream = await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then((s) => s.trim(), () => null);
    const heads = upstream ? ['HEAD', upstream] : ['HEAD'];
    const out = await git(dir, ['log', '-z', '--topo-order', `-n${limit}`, '--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s', ...heads, '--']).catch(() => '');
    const commits = parseLog(out);
    if (upstream) {
      const list = (range: string) => git(dir, ['rev-list', '-n', String(limit), range, '--']).then((s) => new Set(s.split('\n').filter(Boolean)));
      const [outgoing, incoming] = await Promise.all([list(`${upstream}..HEAD`), list(`HEAD..${upstream}`)]);
      for (const c of commits) c.flow = outgoing.has(c.hash) ? 'out' : incoming.has(c.hash) ? 'in' : undefined;
    }
    return { upstream, commits, graph: computeGraph(commits) };
  } catch (e) {
    throw gitError(e);
  }
}

// ─── Contenus pour les diffs ─────────────────────────────────────────────────

/** Fichier tel qu'il est dans HEAD ou dans l'index (chaîne vide s'il n'y existe pas). */
export async function scmShow(dir: string, rel: string, from: 'HEAD' | 'INDEX') {
  await resolveInside(dir, rel);
  const spec = `${from === 'HEAD' ? 'HEAD' : ''}:./${rel.replace(/^\/+/, '')}`;
  try {
    const content = await git(dir, ['show', spec]);
    if (content.slice(0, 8000).includes('\0')) return { kind: 'binary' as const };
    return { kind: 'text' as const, content };
  } catch {
    return { kind: 'text' as const, content: '' };
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Une action à la fois par dossier (évite les conflits sur `index.lock`). */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(dir) ?? Promise.resolve();
  const next = prev.catch(() => null).then(fn);
  queues.set(dir, next);
  return next;
}

async function checkPaths(dir: string, paths: unknown): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== 'string' || !p || p.includes('\0'))) {
    throw Object.assign(new Error(tr({ en: 'Invalid paths', fr: 'Chemins invalides' })), { statusCode: 400 });
  }
  for (const p of paths as string[]) await resolveInside(dir, p);
  return (paths as string[]).map((p) => p.replace(/^\/+/, ''));
}

const hasHead = (dir: string) => git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(() => true, () => false);
/** Chemins littéraux : `[id].tsx` (Next.js) ne doit pas être lu comme un motif. */
const lit = ['--literal-pathspecs'];

export type ScmAction = 'stage' | 'unstage' | 'discard' | 'stageAll' | 'unstageAll' | 'discardAll' | 'commit' | 'push' | 'pull' | 'sync' | 'fetch';
export const SCM_ACTIONS: ScmAction[] = ['stage', 'unstage', 'discard', 'stageAll', 'unstageAll', 'discardAll', 'commit', 'push', 'pull', 'sync', 'fetch'];

export interface ScmActionBody { paths?: string[]; message?: string; amend?: boolean; push?: boolean }

async function push(dir: string) {
  const upstream = await git(dir, ['rev-parse', '--abbrev-ref', '@{upstream}']).then(() => true, () => false);
  await git(dir, upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'], { timeout: 120_000 });
}
const pull = (dir: string) => git(dir, ['pull', '--no-edit'], { timeout: 120_000 });

export function scmAction(dir: string, action: ScmAction, body: ScmActionBody = {}) {
  return serial(dir, async () => {
    try {
      switch (action) {
        case 'stage': await git(dir, [...lit, 'add', '-A', '--', ...(await checkPaths(dir, body.paths))]); break;
        case 'stageAll': await git(dir, ['add', '-A', '--', '.']); break;
        case 'unstage':
        case 'unstageAll': {
          const paths = action === 'unstage' ? await checkPaths(dir, body.paths) : ['.'];
          if (await hasHead(dir)) await git(dir, [...lit, 'restore', '--staged', '--', ...paths]);
          else await git(dir, [...lit, 'rm', '--cached', '-r', '-q', '--', ...paths]);
          break;
        }
        case 'discard': {
          const paths = await checkPaths(dir, body.paths);
          const st = await scmStatus(dir);
          const untracked = new Set(st.changes.filter((c) => c.code === 'U').map((c) => c.path));
          const tracked = paths.filter((p) => !untracked.has(p));
          for (const p of paths.filter((x) => untracked.has(x))) await fs.rm(await resolveInside(dir, p), { force: true });
          if (tracked.length) await git(dir, [...lit, 'restore', '--', ...tracked]);
          break;
        }
        case 'discardAll':
          if (await hasHead(dir)) await git(dir, ['restore', '--', '.']).catch(() => null); // rien de suivi à restaurer
          await git(dir, ['clean', '-f', '-d', '-q', '--', '.']);
          break;
        case 'commit': {
          const message = String(body.message ?? '').trim();
          if (!message && !body.amend) throw Object.assign(new Error(tr({ en: 'Empty commit message', fr: 'Message de commit vide' })), { statusCode: 400 });
          // « Smart commit » de VS Code : rien d'indexé → tout est indexé.
          if (!body.amend) {
            const st = await scmStatus(dir);
            if (st.counts.staged === 0) {
              if (st.counts.changes === 0) throw Object.assign(new Error(tr({ en: 'Nothing to commit', fr: 'Aucune modification à commiter' })), { statusCode: 400 });
              await git(dir, ['add', '-A', '--', '.']);
            }
          }
          await git(dir, ['commit', ...(body.amend ? ['--amend'] : []), ...(message ? ['-m', message] : ['--no-edit'])], { timeout: 60_000 });
          if (body.push) await push(dir);
          break;
        }
        case 'push': await push(dir); break;
        case 'pull': await pull(dir); break;
        case 'sync': await pull(dir); await push(dir); break;
        case 'fetch': await git(dir, ['fetch', '--prune'], { timeout: 120_000 }); break;
        default: throw appError('api.unknownAction', undefined, 400);
      }
      return { ok: true };
    } catch (e: any) {
      throw e?.statusCode ? e : gitError(e);
    }
  });
}
