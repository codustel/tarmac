/**
 * Contexte de la CLI `tarmac` : chemins (dossier de l'app, données, LaunchAgent, pf), lecture du fichier `env`
 * et exécution des commandes. Tout dépend de `home` et `env` passés en paramètre : les tests utilisent un
 * dossier temporaire et un exécuteur factice, jamais la vraie machine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toolDirs } from '../server/tools/path.js';

export const PKG_NAME = '@codustel/tarmac';
export const LABEL = 'com.codustel.tarmac';
export const DEFAULT_DOMAIN = 'tarmac.localhost';
export const ALIAS_DOMAIN = 'tarmac.test';
export const DEFAULT_PORT = 7777;
/** Version minimale : `node:sqlite` est disponible sans option depuis Node 22.13. */
export const MIN_NODE = [22, 13] as const;

/** Anciennes installations (App Manager, puis Dev Manager avant lui). */
export const OLD_LABEL = 'com.codustel.app-manager';
export const OLD_DOMAINS = ['manager.localhost', 'manager.test'];
export const DEV_MANAGER_LABEL = 'com.codustel.dev-manager';

export interface Ctx {
  home: string;
  env: NodeJS.ProcessEnv;
  uid: number;
  appDir: string;
  /** Installation depuis un clone git (contributeurs) plutôt que depuis le paquet npm. */
  isClone: boolean;
  version: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  dataDir: string;
  envFile: string;
  logFile: string;
  plist: string;
  pfAnchor: string;
  pfDaemon: string;
  hostsFile: string;
  oldDataDir: string;
  oldPlist: string;
  oldPfAnchor: string;
  oldPfDaemon: string;
  devManagerPlist: string;
  serverJs: string;
  mcpJs: string;
  /** Dossiers d'installation des outils (git, gh, claude, codex), ajoutés au PATH pour les retrouver après installation. */
  toolDirs: string[];
}

/** Dossier du paquet : premier parent dont le package.json porte le nom de Tarmac (sources ou dist/cli). */
export function findAppDir(from = path.dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === PKG_NAME) return dir;
    } catch { /* pas de package.json ici */ }
    if (path.dirname(dir) === dir) throw new Error(`${PKG_NAME} package.json not found above ${from}`);
  }
}

export interface CtxOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  appDir?: string;
  uid?: number;
  nodeVersion?: string;
  platform?: NodeJS.Platform;
  hostsFile?: string;
  /** Préfixe des chemins système (/etc, /Library) : un dossier temporaire dans les tests. */
  sysRoot?: string;
  /** Dossiers d'installation des outils : par défaut ceux du service (server/tools/path.ts) ; un bac à sable dans les tests. */
  toolDirs?: string[];
}

export function makeCtx(o: CtxOptions = {}): Ctx {
  const home = o.home ?? os.homedir();
  const env = o.env ?? process.env;
  const appDir = o.appDir ?? findAppDir();
  const sys = o.sysRoot ?? '';
  const expand = (p: string) => path.resolve(p.replace(/^~(?=$|\/)/, home));
  const dataDir = env.DATA_DIR ? expand(env.DATA_DIR) : path.join(home, '.tarmac');
  let version = '0.0.0';
  try { version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version; } catch { /* absent */ }
  return {
    home,
    env,
    uid: o.uid ?? process.getuid?.() ?? 501,
    appDir,
    isClone: fs.existsSync(path.join(appDir, '.git')),
    version,
    nodeVersion: o.nodeVersion ?? process.versions.node,
    platform: o.platform ?? process.platform,
    dataDir,
    envFile: path.join(dataDir, 'env'),
    logFile: path.join(dataDir, 'tarmac.log'),
    plist: path.join(home, 'Library/LaunchAgents', `${LABEL}.plist`),
    pfAnchor: `${sys}/etc/pf.anchors/${LABEL}`,
    pfDaemon: `${sys}/Library/LaunchDaemons/${LABEL}.pf.plist`,
    hostsFile: o.hostsFile ?? `${sys}/etc/hosts`,
    oldDataDir: path.join(home, '.app-manager'),
    oldPlist: path.join(home, 'Library/LaunchAgents', `${OLD_LABEL}.plist`),
    oldPfAnchor: `${sys}/etc/pf.anchors/${OLD_LABEL}`,
    oldPfDaemon: `${sys}/Library/LaunchDaemons/${OLD_LABEL}.pf.plist`,
    devManagerPlist: path.join(home, 'Library/LaunchAgents', `${DEV_MANAGER_LABEL}.plist`),
    serverJs: path.join(appDir, 'dist/server/index.js'),
    mcpJs: path.join(appDir, 'dist/server/mcp.js'),
    toolDirs: o.toolDirs ?? toolDirs(home, o.platform ?? process.platform, process.execPath),
  };
}

/** `~` à la place du dossier personnel, pour l'affichage. */
export const tilde = (ctx: Ctx, p: string) => (p === ctx.home || p.startsWith(ctx.home + '/') ? '~' + p.slice(ctx.home.length) : p);

/** Valeurs `CLÉ=valeur` du fichier `env` (sans interprétation shell). */
export function readEnv(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, 'utf8').split('\n')
        .map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)=(.*)$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => [m[1], m[2].trim().replace(/^(['"])(.*)\1$/, '$2')]),
    );
  } catch {
    return {};
  }
}

/** Port et URL configurés (fichier `env`, anciens noms `MANAGER_*` compris), sinon les valeurs par défaut. */
export function configured(ctx: Ctx): { port: number; url: string; domain: string } {
  const e = readEnv(ctx.envFile);
  const port = Number(ctx.env.TARMAC_PORT ?? e.TARMAC_PORT ?? e.MANAGER_PORT ?? DEFAULT_PORT) || DEFAULT_PORT;
  const url = ctx.env.TARMAC_URL ?? e.TARMAC_URL ?? e.MANAGER_URL ?? `http://${DEFAULT_DOMAIN}:${port}`;
  let domain = DEFAULT_DOMAIN;
  try { domain = new URL(url).hostname || DEFAULT_DOMAIN; } catch { /* URL invalide */ }
  return { port, url, domain };
}

export function nodeOk(version: string): boolean {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/** Exécuteur de commandes : réel (spawnSync) ou factice dans les tests. */
export interface Runner {
  /** Lance une commande, sortie visible ; renvoie le code de sortie. */
  run(argv: string[], opts?: { input?: string }): number;
  /** Lance une commande sans rien afficher ; renvoie sa sortie, ou null si elle échoue. */
  capture(argv: string[], opts?: { timeoutMs?: number }): string | null;
}

export const realRunner: Runner = {
  run(argv, opts = {}) {
    const r = spawnSync(argv[0], argv.slice(1), {
      stdio: [opts.input !== undefined ? 'pipe' : 'inherit', 'inherit', 'inherit'],
      input: opts.input,
    });
    return r.status ?? 1;
  },
  capture(argv, opts = {}) {
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeoutMs ?? 10_000 });
    return r.status === 0 ? r.stdout : null;
  },
};

/** Cherche un exécutable dans le PATH. */
export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) {
    const f = path.join(dir, cmd);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      if (fs.statSync(f).isFile()) return f;
    } catch { /* absent */ }
  }
  return null;
}

// ─── Affichage ───────────────────────────────────────────────────────────────
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = { blue: paint('1;34'), green: paint('1;32'), yellow: paint('1;33'), red: paint('1;31'), dim: paint('2'), bold: paint('1') };

export interface Out {
  log(s?: string): void;
  error(s: string): void;
}
export const consoleOut: Out = { log: (s = '') => console.log(s), error: (s) => console.error(s) };

export const say = (o: Out, s: string) => o.log(`${c.blue('▸')} ${s}`);
export const ok = (o: Out, s: string) => o.log(`${c.green('✓')} ${s}`);
export const warn = (o: Out, s: string) => o.log(`${c.yellow('!')} ${s}`);
