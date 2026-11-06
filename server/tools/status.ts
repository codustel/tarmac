// État des outils (git, gh, claude, codex, docker, supabase) : présence, version, connexion, moyen d'origine.
// Aucune lecture de jeton : la connexion vient uniquement des commandes de statut des CLI.
// N'importe ni config, ni settings, ni docker (R2) : l'état du moteur Docker est injecté.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { latestVersion, compareVersions, type LatestDeps } from './latest.js';
import { chooseMethod, statusCommand, TOOLS, TOOLS_BIN_DIR, versionArgs, type ManagedId, type Method, type ToolId } from './registry.js';

export type ToolState = 'absent' | 'logged-out' | 'ready' | 'stopped' | 'unknown';

export interface ToolStatus {
  id: ToolId;
  state: ToolState;
  version: string | null;
  path: string | null;
  /** Moyen d'origine déduit du chemin ; `null` = installé hors Tarmac. */
  method: Method | null;
  /** Moyen que Tarmac utiliserait si l'outil est absent. */
  installMethod: Method | null;
  /** Dernière version disponible via le moyen d'origine ; `null` si inconnue. */
  latest: string | null;
  /** Moyen d'origine connu et version plus récente disponible. */
  updatable: boolean;
  managed: boolean;
  loginable: boolean;
  docUrl: string;
}

export type Exec = (file: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeout: number }) => Promise<{ stdout: string; code: number }>;

export interface StatusDeps {
  exec: Exec;
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
  /** Sans `fetch`, la dernière version n'est jamais cherchée (`latest` à null) : la garde du premier appel n'en fournit pas. */
  fetch?: LatestDeps['fetch'];
  /** État du moteur Docker, branché sur dockerOverview().engine par server/index.ts. */
  dockerEngine?: () => Promise<{ status: 'ok' | 'absent' | 'stopped' | 'error' }>;
}

const ORDER: ToolId[] = ['git', 'gh', 'claude', 'codex', 'docker', 'supabase'];
const STATUS_TIMEOUT = 5000;
const PROBE_TIMEOUT = 3000;
const CACHE_MS = 30_000;

/** `exec` réel : renvoie le code de sortie au lieu de lever ; lève seulement si le programme est introuvable ou tué (délai). */
export const realExec: Exec = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: opts.env, timeout: opts.timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout: String(stdout), code: 0 });
      const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
      if (e.killed || typeof e.code !== 'number') return reject(err);
      resolve({ stdout: `${stdout}${stderr}`, code: e.code });
    });
  });

const realPath = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };

/**
 * Moyen d'origine d'un binaire ; `null` = hors Tarmac / inconnu. Hors Windows, le chemin réel (liens résolus) passe
 * d'abord : un paquet npm global pointe vers `…/lib/node_modules/…` (même sous le préfixe de brew, quand node vient
 * de brew), une formule ou un cask vers `…/Cellar/…` ou `…/Caskroom/…`. Le préfixe de brew seul ne compte que s'il lui
 * est réservé (`/opt/homebrew`, `.linuxbrew`) : `/usr/local` (Mac Intel) est partagé avec npm et les poses à la main.
 */
export function methodFromPath(bin: string, ctx: { home: string; brewPrefix: string | null; npmBin: string | null; platform: NodeJS.Platform }): Method | null {
  const win = ctx.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  // Windows : casse ignorée (lecteur `c:` / `C:`, dossiers du PATH tapés à la main).
  const norm = (s: string) => (win ? s.toLowerCase() : s);
  const under = (dir: string | null) => {
    if (!dir) return false;
    const b = norm(bin), d = norm(dir);
    return b === d || b.startsWith(d.endsWith(p.sep) ? d : d + p.sep);
  };
  if (!win) {
    const real = realPath(bin);
    if (real.includes('/lib/node_modules/')) return 'npm';
    if (/\/(Cellar|Caskroom)\//.test(real)) return 'brew';
  }
  if (under(TOOLS_BIN_DIR(ctx.home, ctx.platform)) || under(p.join(ctx.home, '.local', 'bin'))) return 'official';
  if (!win && ctx.brewPrefix && /(^|\/)(homebrew|\.linuxbrew)$/.test(ctx.brewPrefix) && under(ctx.brewPrefix)) return 'brew';
  if (under(ctx.npmBin)) return 'npm';
  return null;
}

async function run(deps: StatusDeps, file: string, args: string[], timeout = PROBE_TIMEOUT) {
  try {
    return await deps.exec(file, args, { env: deps.env, timeout });
  } catch {
    return null;
  }
}

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Tous les chemins d'un programme dans le PATH (`which -a` / `where`). */
async function findAll(deps: StatusDeps, bin: string): Promise<string[]> {
  const r = deps.platform === 'win32' ? await run(deps, 'where.exe', [bin]) : await run(deps, 'which', ['-a', bin]);
  return r && r.code === 0 ? lines(r.stdout) : [];
}
const findOne = async (deps: StatusDeps, bin: string) => (await findAll(deps, bin))[0] ?? null;

async function locate(deps: StatusDeps, id: ToolId): Promise<string | null> {
  const bin = TOOLS[id].bin;
  const found = await findAll(deps, bin);
  if (id === 'git' && deps.platform === 'darwin') {
    // /usr/bin/git n'est qu'un raccourci : sans outils Xcode il ouvre une boîte de dialogue.
    const real = found.find((p) => p !== '/usr/bin/git');
    if (real) return real;
    if (!found.length) return null;
    const x = await run(deps, 'xcode-select', ['-p']);
    return x && x.code === 0 ? '/usr/bin/git' : null;
  }
  return found[0] ?? null;
}

async function readVersion(deps: StatusDeps, id: ToolId, bin: string): Promise<string | null> {
  const r = await run(deps, bin, versionArgs(id));
  return r?.stdout.match(/\d+(?:\.\d+)+/)?.[0] ?? null;
}

async function availableManagers(deps: StatusDeps): Promise<Set<'brew' | 'npm' | 'winget'>> {
  const set = new Set<'brew' | 'npm' | 'winget'>();
  const names = deps.platform === 'win32' ? (['npm', 'winget'] as const) : (['brew', 'npm'] as const);
  const found = await Promise.all(names.map((n) => findOne(deps, n)));
  names.forEach((n, i) => { if (found[i]) set.add(n); });
  return set;
}

async function originMethod(deps: StatusDeps, bin: string): Promise<Method | null> {
  let brewPrefix: string | null = null;
  let npmBin: string | null = null;
  if (deps.platform !== 'win32') {
    const brew = await findOne(deps, 'brew');
    if (brew) brewPrefix = path.posix.dirname(path.posix.dirname(brew));
  }
  const npm = await findOne(deps, 'npm');
  if (npm) {
    const r = await run(deps, 'npm', ['prefix', '-g']);
    const prefix = r && r.code === 0 ? lines(r.stdout)[0] : undefined;
    if (prefix) npmBin = deps.platform === 'win32' ? prefix : path.posix.join(prefix, 'bin');
  }
  return methodFromPath(bin, { home: deps.home, brewPrefix, npmBin, platform: deps.platform });
}

/** Connexion d'après la commande de statut : code 0 prêt ; sinon le texte, puis le code 1 conventionnel. */
function loginState(id: 'gh' | 'claude' | 'codex', r: { stdout: string; code: number } | null): ToolState {
  if (!r) return 'unknown';
  if (r.code === 0) return 'ready';
  if (id === 'codex') {
    if (r.stdout.includes('Not logged in')) return 'logged-out';
    if (r.stdout.includes('Logged in')) return 'ready';
    return r.code === 1 ? 'logged-out' : 'unknown';
  }
  return 'logged-out';
}

export async function toolStatus(id: ToolId, deps: StatusDeps): Promise<ToolStatus> {
  const def = TOOLS[id];
  const base = { id, version: null, path: null, method: null, installMethod: null, latest: null, updatable: false, managed: def.managed, loginable: def.loginable, docUrl: def.docUrl };

  if (id === 'docker') {
    // Sans moteur injecté, l'état reste inconnu (jamais de `docker` lancé pour le deviner).
    let status: 'ok' | 'absent' | 'stopped' | 'error' = 'error';
    try { if (deps.dockerEngine) status = (await deps.dockerEngine()).status; } catch { /* état inconnu */ }
    const state: ToolState = status === 'ok' ? 'ready' : status === 'error' ? 'unknown' : status;
    if (state === 'absent') return { ...base, state };
    const bin = await findOne(deps, def.bin);
    return { ...base, state, path: bin, version: bin ? await readVersion(deps, id, bin) : null };
  }

  const bin = await locate(deps, id);
  if (!bin) {
    const installMethod = def.managed ? chooseMethod(id as ManagedId, await availableManagers(deps), deps.platform) : null;
    return { ...base, state: 'absent', installMethod };
  }
  const [version, method] = await Promise.all([readVersion(deps, id, bin), originMethod(deps, bin)]);
  let state: ToolState = 'ready';
  if (id === 'gh' || id === 'claude' || id === 'codex') {
    const [file, ...args] = statusCommand(id);
    state = loginState(id, await run(deps, file, args, STATUS_TIMEOUT));
  }
  let latest: string | null = null;
  if (deps.fetch && method && def.managed && (state === 'ready' || state === 'logged-out')) {
    latest = await latestVersion(id as ManagedId, method, { fetch: deps.fetch, exec: deps.exec, env: deps.env });
  }
  const updatable = !!method && !!latest && !!version && compareVersions(latest, version) > 0;
  return { ...base, state, version, path: bin, method, latest, updatable };
}

const cache = new Map<ToolId, { at: number; value: Promise<ToolStatus> }>();

export function invalidateToolStatus(id?: ToolId): void {
  if (id) cache.delete(id);
  else cache.clear();
}

export async function allToolStatus(deps: StatusDeps): Promise<ToolStatus[]> {
  const now = Date.now();
  return Promise.all(ORDER.map((id) => {
    const hit = cache.get(id);
    if (hit && now - hit.at < CACHE_MS) return hit.value;
    const value = toolStatus(id, deps);
    cache.set(id, { at: now, value });
    value.catch(() => cache.delete(id));
    return value;
  }));
}
