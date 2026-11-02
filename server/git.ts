import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { isDemo } from './demo/index.js';

const exec = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };

export type SyncState = 'synced' | 'ahead' | 'behind' | 'diverged' | 'no-upstream' | 'no-remote' | 'error';

export interface GitStatus {
  branch: string | null;
  remoteUrl: string | null;
  /** Clé normalisée `github.com/owner/repo` pour rapprocher local et distant. */
  remoteKey: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: number;
  untracked: number;
  sync: SyncState;
  lastCommitAt: string | null;
  lastCommitMsg: string | null;
  fetchedAt: string | null;
  /** Fichier modifié (non commité) le plus récent. */
  dirtyAt: string | null;
  /** Dernier `git push` depuis cette machine (reflog de la branche distante). */
  lastPushAt: string | null;
  error?: string;
}

/** Date du dernier « update by push » dans le reflog de `origin/<branche>`. */
function lastPush(dir: string, upstream: string | null): string | null {
  if (!upstream) return null;
  try {
    const log = fs.readFileSync(path.join(dir, '.git', 'logs', 'refs', 'remotes', ...upstream.split('/')), 'utf8');
    const line = log.trimEnd().split('\n').reverse().find((l) => l.includes('\tupdate by push'));
    const ts = line?.match(/> (\d{9,11}) [+-]\d{4}\t/)?.[1];
    return ts ? new Date(Number(ts) * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

export function normalizeRemote(url: string): string | null {
  const m =
    url.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/) ??
    url.match(/^(?:ssh|https?|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

async function git(cwd: string, args: string[], timeout = 10_000) {
  const { stdout } = await exec('git', args, { cwd, env: GIT_ENV, timeout, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

const fetchedAt = new Map<string, string>();

export async function gitFetch(dir: string) {
  if (!isDemo()) await git(dir, ['fetch', '--quiet', '--prune', 'origin'], 30_000); // mode démo : aucun accès réseau
  fetchedAt.set(dir, new Date().toISOString());
}

export async function gitStatus(dir: string): Promise<GitStatus> {
  const base: GitStatus = {
    branch: null, remoteUrl: null, remoteKey: null, upstream: null, ahead: 0, behind: 0,
    changes: 0, untracked: 0, sync: 'no-remote', lastCommitAt: null, lastCommitMsg: null,
    fetchedAt: fetchedAt.get(dir) ?? null, dirtyAt: null, lastPushAt: null,
  };
  try {
    const [status, remote, last] = await Promise.all([
      git(dir, ['status', '--porcelain=v2', '--branch']),
      git(dir, ['remote', 'get-url', 'origin']).catch(() => ''),
      git(dir, ['log', '-1', '--format=%cI%x00%s']).catch(() => ''),
    ]);
    const dirty: string[] = [];
    for (const line of status.split('\n')) {
      if (dirty.length < 200) {
        if (line.startsWith('? ')) dirty.push(line.slice(2));
        else if (line.startsWith('1 ')) dirty.push(line.split(' ').slice(8).join(' '));
        else if (line.startsWith('2 ')) dirty.push(line.split(' ').slice(9).join(' ').split('\t')[0]);
      }
      if (line.startsWith('# branch.head ')) base.branch = line.slice(14);
      else if (line.startsWith('# branch.upstream ')) base.upstream = line.slice(18);
      else if (line.startsWith('# branch.ab ')) {
        const [, a, b] = line.match(/\+(\d+) -(\d+)/) ?? [];
        base.ahead = Number(a ?? 0);
        base.behind = Number(b ?? 0);
      } else if (line.startsWith('?')) base.untracked++;
      else if (/^[12u] /.test(line)) base.changes++;
    }
    if (last) [base.lastCommitAt, base.lastCommitMsg] = last.split('\0');
    const mt = Math.max(0, ...dirty.map((f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } }));
    base.dirtyAt = mt ? new Date(mt).toISOString() : null;
    base.lastPushAt = lastPush(dir, base.upstream);
    base.remoteUrl = remote || null;
    base.remoteKey = remote ? normalizeRemote(remote) : null;
    base.sync = !remote
      ? 'no-remote'
      : !base.upstream
        ? 'no-upstream'
        : base.ahead && base.behind
          ? 'diverged'
          : base.ahead
            ? 'ahead'
            : base.behind
              ? 'behind'
              : 'synced';
  } catch (e: any) {
    base.sync = 'error';
    base.error = String(e.stderr || e.message).slice(0, 300);
  }
  return base;
}

/** Exécute `fn` sur `items` avec une concurrence bornée. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}
