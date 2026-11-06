// Dernière version disponible d'un outil géré, pour le bouton « Mettre à jour ».
// Lecture seule : `brew info`, registre npm, API GitHub. Aucun jeton, aucune entrée utilisateur dans les URL.
// N'importe ni config, ni settings, ni docker (R2) : fetch et exec sont injectés.
import type { Exec } from './status.js';
import type { ManagedId, Method } from './registry.js';

export interface LatestDeps {
  fetch: (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  exec: Exec;
  env: NodeJS.ProcessEnv;
}

const TTL_MS = 24 * 3600 * 1000;
const FAIL_TTL_MS = 3600 * 1000; // hors ligne ou limite GitHub (60/h) : pas de nouvel essai avant 1 h
const TIMEOUT_MS = 5000;

const BREW: Record<ManagedId, { name: string; cask: boolean }> = {
  git: { name: 'git', cask: false },
  gh: { name: 'gh', cask: false },
  claude: { name: 'claude-code', cask: true },
  codex: { name: 'codex', cask: true },
};
const NPM: Partial<Record<ManagedId, string>> = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' };
const GITHUB: Partial<Record<ManagedId, string>> = { gh: 'cli/cli', codex: 'openai/codex' };

const VERSION_RE = /\d+(?:\.\d+)+/;
const parts = (v: string) => (v.match(VERSION_RE)?.[0] ?? '0').split('.').map(Number);

/** Compare deux versions numériques (préfixes `v`, `rust-v`… ignorés) : >0 si a est plus récente. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const cache = new Map<string, { at: number; value: string | null }>();
export const resetLatestCache = (): void => cache.clear();

const clean = (v: unknown): string | null => (typeof v === 'string' ? v.match(VERSION_RE)?.[0] ?? null : null);

async function getJson(deps: LatestDeps, url: string): Promise<unknown> {
  const r = await deps.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${url}`);
  return r.json();
}

async function fetchLatest(id: ManagedId, method: Method, deps: LatestDeps): Promise<string | null> {
  if (method === 'brew') {
    const { name, cask } = BREW[id];
    const r = await deps.exec('brew', ['info', '--json=v2', ...(cask ? ['--cask'] : []), name], { env: deps.env, timeout: TIMEOUT_MS });
    if (r.code !== 0) return null;
    const j = JSON.parse(r.stdout) as { formulae?: { versions?: { stable?: string } }[]; casks?: { version?: string }[] };
    return clean(cask ? j.casks?.[0]?.version : j.formulae?.[0]?.versions?.stable);
  }
  if (method === 'npm') {
    const pkg = NPM[id];
    if (!pkg) return null;
    return clean(((await getJson(deps, `https://registry.npmjs.org/${pkg}/latest`)) as { version?: string }).version);
  }
  if (method === 'official') {
    const repo = GITHUB[id];
    if (!repo) return null; // claude se met à jour seul
    return clean(((await getJson(deps, `https://api.github.com/repos/${repo}/releases/latest`)) as { tag_name?: string }).tag_name);
  }
  return null; // winget, xcode : pas de source fiable
}

/** Dernière version connue, `null` si inconnue ou source injoignable. Réussites en cache 24 h, échecs 1 h. */
export async function latestVersion(id: ManagedId, method: Method, deps: LatestDeps): Promise<string | null> {
  const key = `${id}:${method}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? TTL_MS : FAIL_TTL_MS)) return hit.value;
  let value: string | null = null;
  try { value = await fetchLatest(id, method, deps); } catch { /* injoignable : échec mis en cache */ }
  cache.set(key, { at: Date.now(), value });
  return value;
}
