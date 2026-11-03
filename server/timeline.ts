import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentKind } from './agentProcs.js';

const exec = promisify(execFile);

/**
 * Timeline de tous les projets : commits (toutes branches locales), push (reflog des branches distantes),
 * nouvelles sessions d'agent et tâches du suivi, sur les derniers jours.
 *
 * Les textes (sujets de commit, titres de session ou de tâche) sont des données non fiables : l'interface les
 * affiche en texte, jamais en HTML.
 */
export type TimelineType = 'commit' | 'push' | 'session' | 'task';
export type TaskStatus = 'created' | 'toTest' | 'done';

export interface TimelineEvent {
  id: string;
  type: TimelineType;
  at: string;
  projectId: string | null;
  projectName: string;
  /** Sujet du commit, titre de session ou de tâche (texte brut). */
  text: string;
  branch?: string | null;
  /** Commit : hash court et auteur. */
  hash?: string;
  author?: string;
  /** Push : dépôt distant et nombre de commits poussés (null : nouvelle branche ou non calculable). */
  remote?: string;
  commits?: number | null;
  /** Session d'agent. */
  agent?: AgentKind;
  sessionId?: string;
  /** Tâche du suivi. */
  task?: { suiviId: string; taskId: string; num: string; status: TaskStatus };
}

export const TIMELINE_DAYS = 7;
export const TIMELINE_LIMIT = 300;

// ─── Commits ────────────────────────────────────────────────────────────────
export const GIT_LOG_FORMAT = '%H%x1f%h%x1f%S%x1f%cI%x1f%an%x1f%s%x1e';

export interface RawCommit { hash: string; short: string; branch: string | null; at: string; author: string; subject: string }

/** Sortie de `git log --branches --source --format=GIT_LOG_FORMAT`. */
export function parseGitLog(out: string): RawCommit[] {
  return out.split('\x1e').flatMap((rec) => {
    const f = rec.replace(/^\n+/, '').split('\x1f');
    if (f.length < 6 || !/^[0-9a-f]{7,64}$/.test(f[0])) return [];
    const ref = f[2].trim();
    return [{
      hash: f[0],
      short: f[1],
      branch: ref ? ref.replace(/^refs\/(heads|remotes|tags)\//, '') : null,
      at: new Date(f[3]).toISOString(),
      author: f[4],
      subject: f.slice(5).join('\x1f').trim(),
    }];
  });
}

// ─── Push ───────────────────────────────────────────────────────────────────
export interface RawPush { old: string; new: string; at: string }

/**
 * Reflog d'une branche distante (`.git/logs/refs/remotes/<remote>/<branche>`) : seulement les entrées
 * « update by push » (les `fetch` / `pull` mettent aussi la référence à jour, mais ne sont pas des push).
 */
export function parsePushReflog(text: string): RawPush[] {
  return text.split('\n').flatMap((l) => {
    const m = l.match(/^([0-9a-f]{7,64}) ([0-9a-f]{7,64}) .*?> (\d{9,11}) [+-]\d{4}\t(.*)$/);
    if (!m || !/^update by push\b/.test(m[4])) return [];
    return [{ old: m[1], new: m[2], at: new Date(Number(m[3]) * 1000).toISOString() }];
  });
}

/** Dossier git d'un dépôt (et dossier commun pour une worktree), ou null. */
export function gitDirs(repoDir: string): { gitDir: string; commonDir: string } | null {
  const dotGit = path.join(repoDir, '.git');
  let gitDir = dotGit;
  try {
    const st = fs.statSync(dotGit);
    if (st.isFile()) {
      const m = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
      if (!m) return null;
      gitDir = path.resolve(repoDir, m[1].trim());
    }
  } catch { return null; }
  let commonDir = gitDir;
  try { commonDir = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch { /* dépôt principal */ }
  return { gitDir, commonDir };
}

/** Fichiers sous un dossier (récursif, borné). */
function walk(dir: string, max = 2000): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length && out.length < max) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) stack.push(f);
      else if (e.isFile()) out.push(f);
    }
  }
  return out;
}

/**
 * Signature d'un dépôt : dates de modification des reflogs (HEAD, branches locales et distantes) et des refs
 * compactées. Elle change à chaque commit, changement de branche, fetch ou push : pas de `git log` sinon.
 */
export function repoSignature(dirs: { gitDir: string; commonDir: string }): string {
  const files = [path.join(dirs.gitDir, 'logs', 'HEAD'), path.join(dirs.commonDir, 'packed-refs'), ...walk(path.join(dirs.commonDir, 'logs', 'refs'))];
  return files.map((f) => { try { const st = fs.statSync(f); return `${st.mtimeMs}:${st.size}`; } catch { return '-'; } }).join('|');
}

export interface TimelineRepo { dir: string; projectId: string | null; projectName: string }

const ZERO = /^0+$/;

/** Évènements git d'un dépôt, recalculés seulement quand sa signature change. */
export class RepoEventsCache {
  private entries = new Map<string, { sig: string; since: number; events: TimelineEvent[] }>();

  async events(repo: TimelineRepo, since: number): Promise<TimelineEvent[]> {
    const dirs = gitDirs(repo.dir);
    if (!dirs) return [];
    const sig = repoSignature(dirs);
    const hit = this.entries.get(repo.dir);
    if (hit && hit.sig === sig && hit.since <= since) return hit.events.map((e) => ({ ...e, projectId: repo.projectId, projectName: repo.projectName }));
    const from = since - 86_400_000; // un jour de marge : le cache reste valable quand la fenêtre avance
    const events = [...await this.commits(repo, from), ...await this.pushes(repo, dirs.commonDir, from)];
    this.entries.set(repo.dir, { sig, since: from, events });
    return events;
  }

  /** Oublie les dépôts qui ne sont plus scannés. */
  retain(dirs: string[]) {
    const keep = new Set(dirs);
    for (const k of this.entries.keys()) if (!keep.has(k)) this.entries.delete(k);
  }

  private async commits(repo: TimelineRepo, from: number): Promise<TimelineEvent[]> {
    try {
      const { stdout } = await exec('git', ['-C', repo.dir, 'log', '--branches', '--source', `--since=${new Date(from).toISOString()}`, '-n', String(TIMELINE_LIMIT), `--format=${GIT_LOG_FORMAT}`],
        { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
      return parseGitLog(stdout).map((c) => ({
        id: `commit:${c.hash}`, type: 'commit' as const, at: c.at, projectId: repo.projectId, projectName: repo.projectName,
        text: c.subject, branch: c.branch, hash: c.short, author: c.author,
      }));
    } catch {
      return []; // dépôt vide, sans branche, ou git indisponible
    }
  }

  private async pushes(repo: TimelineRepo, commonDir: string, from: number): Promise<TimelineEvent[]> {
    const base = path.join(commonDir, 'logs', 'refs', 'remotes');
    const out: TimelineEvent[] = [];
    for (const file of walk(base, 500)) {
      const rel = path.relative(base, file).split(path.sep);
      if (rel.length < 2 || rel.at(-1) === 'HEAD') continue;
      const [remote, ...rest] = rel;
      const branch = rest.join('/');
      let text: string;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      for (const p of parsePushReflog(text)) {
        if (Date.parse(p.at) < from) continue;
        let commits: number | null = null;
        if (!ZERO.test(p.old)) {
          try {
            const { stdout } = await exec('git', ['-C', repo.dir, 'rev-list', '--count', `${p.old}..${p.new}`], { timeout: 5000 });
            commits = Number(stdout.trim());
            if (!Number.isFinite(commits)) commits = null;
          } catch { /* commits disparus (gc) */ }
        }
        out.push({
          id: `push:${remote}/${branch}:${p.new}:${p.at}`, type: 'push', at: p.at, projectId: repo.projectId, projectName: repo.projectName,
          text: branch, branch, remote, commits,
        });
      }
    }
    return out;
  }
}

/** Fusion : fenêtre de temps, doublons (même commit vu depuis deux dossiers), du plus récent au plus ancien. */
export function mergeTimeline(lists: TimelineEvent[][], since: number, limit = TIMELINE_LIMIT): TimelineEvent[] {
  const seen = new Set<string>();
  return lists.flat()
    .filter((e) => Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) >= since && !seen.has(e.id) && (seen.add(e.id), true))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
