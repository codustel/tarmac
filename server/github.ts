import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import { settings } from './settings.js';
import { tr } from './i18n.js';
import { demo, demoGithubRepos } from './demo/index.js';

const exec = promisify(execFile);

export interface GithubRepo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  defaultBranch: string;
  pushedAt: string;
  htmlUrl: string;
  sshUrl: string;
  key: string;
}

let cache: { at: number; key: string; repos: GithubRepo[]; login: string | null; owners: string[] } | null = null;
export const invalidateGithubCache = () => { cache = null; };
/** Repos GitHub déjà chargés (sans appel réseau). */
export const cachedGithubRepos = () => cache?.repos ?? [];
const TTL = 10 * 60_000;

/** Token : réglages, puis GITHUB_TOKEN, puis la CLI `gh` déjà authentifiée. */
async function resolveToken(): Promise<string | null> {
  if (settings.github.token) return settings.github.token;
  if (config.githubToken) return config.githubToken;
  try {
    const { stdout } = await exec('gh', ['auth', 'token'], { timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gh(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tarmac',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as any).message ?? res.statusText;
    throw new Error(res.status === 401
      ? tr({ en: 'Invalid or expired GitHub token ({error})', fr: 'Token GitHub invalide ou expiré ({error})' }, { error: msg })
      : tr({ en: 'GitHub {status}: {error}', fr: 'GitHub {status} : {error}' }, { status: res.status, error: msg }));
  }
  return res;
}

const toRepo = (r: any): GithubRepo => ({
  fullName: r.full_name,
  name: r.name,
  owner: r.owner.login,
  description: r.description,
  private: r.private,
  fork: r.fork,
  archived: r.archived,
  language: r.language,
  defaultBranch: r.default_branch,
  pushedAt: r.pushed_at,
  htmlUrl: r.html_url,
  sshUrl: r.ssh_url,
  key: `github.com/${r.full_name}`.toLowerCase(),
});

async function paginate(url: string | null, token: string) {
  const out: GithubRepo[] = [];
  while (url) {
    const res = await gh(url, token);
    out.push(...((await res.json()) as any[]).map(toRepo));
    url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return out;
}

/**
 * Repos à suivre :
 * - aucun owner configuré → tout ce qui est accessible au token (perso + orgs + collaborations) ;
 * - sinon, pour chaque owner : soi-même (privés inclus), une organisation, ou un autre compte (publics).
 */
export async function listGithubRepos(force = false) {
  const owners = settings.github.owners;
  const d = demo();
  if (d) {
    cache = { at: Date.now(), key: 'demo', repos: demoGithubRepos(d), login: d.github.login, owners };
    return { ...cache, configured: true };
  }
  const key = owners.join(',') + '|' + settings.github.token.slice(-6);
  if (!force && cache && cache.key === key && Date.now() - cache.at < TTL) return { ...cache, configured: true };
  const token = await resolveToken();
  if (!token) return { configured: false, repos: [] as GithubRepo[], login: null, owners, at: Date.now() };

  const login = ((await (await gh('https://api.github.com/user', token)).json()) as any).login as string;
  let repos: GithubRepo[];
  if (!owners.length) {
    repos = await paginate('https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token);
  } else {
    const lists = await Promise.all(
      owners.map(async (o) => {
        if (o.toLowerCase() === login.toLowerCase()) return paginate('https://api.github.com/user/repos?per_page=100&affiliation=owner', token);
        try {
          return await paginate(`https://api.github.com/orgs/${encodeURIComponent(o)}/repos?per_page=100&type=all`, token);
        } catch {
          return paginate(`https://api.github.com/users/${encodeURIComponent(o)}/repos?per_page=100&type=owner`, token);
        }
      }),
    );
    const seen = new Set<string>();
    repos = lists.flat().filter((r) => !seen.has(r.key) && seen.add(r.key));
  }
  repos.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
  cache = { at: Date.now(), key, repos, login, owners };
  return { ...cache, configured: true };
}
