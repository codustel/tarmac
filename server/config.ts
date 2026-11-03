import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { dataDirOf, envVar, expandHome, migrateDataDir, staleDataWarning } from './dataDir.js';

const home = os.homedir();
const expand = (p: string) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);

/** Dossiers de code usuels ; par défaut, ceux qui existent sont scannés (sinon ~/Documents). */
// `~/source/repos` : dossier par défaut de Visual Studio sous Windows.
export const COMMON_ROOTS = ['~/Developer', '~/Projects', '~/projects', '~/dev', '~/_dev', '~/code', '~/src', '~/Documents/GitHub', '~/source/repos'];
function defaultRoots(): string {
  const found = COMMON_ROOTS.filter((r) => fs.existsSync(expandHome(r)));
  // ~/Projects et ~/projects désignent le même dossier sur un disque insensible à la casse (même inode).
  const unique = [...new Map(found.map((r) => { const st = fs.statSync(expandHome(r)); return [`${st.dev}:${st.ino}`, r]; })).values()];
  return unique.length ? unique.join(',') : '~/Documents';
}

// Ancien nom (App Manager, ~/.app-manager) : copie vers ~/.tarmac au premier démarrage.
// Si ~/.tarmac existe déjà mais que ~/.app-manager est plus récent, seulement un avertissement : `tarmac setup`
// propose de mettre l'ancien ~/.tarmac de côté (le serveur ne décide pas seul).
if (!process.env.DATA_DIR) {
  if (migrateDataDir()) console.log('Data from the previous installation copied: ~/.app-manager → ~/.tarmac (the original is kept).');
  else {
    const stale = staleDataWarning();
    if (stale) console.warn(stale);
  }
}

const [rangeStart, rangeEnd] = (process.env.PORT_RANGE ?? '4100-4999').split('-').map(Number);

export const config = {
  /** Dossiers scannés par défaut (avant tout réglage dans l'UI). `DEV_ROOT` reste accepté. */
  devRoots: (process.env.DEV_ROOTS ?? process.env.DEV_ROOT ?? defaultRoots())
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(expand(p))),
  dataDir: dataDirOf(),
  host: envVar('HOST') ?? '127.0.0.1',
  port: Number(envVar('PORT') ?? 7777),
  publicUrl: envVar('URL') ?? '',
  portRange: { start: rangeStart, end: rangeEnd },
  scanMaxDepth: Number(process.env.SCAN_MAX_DEPTH ?? 6),
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_S ?? 120) * 1000,
  gitFetchIntervalMs: Number(process.env.GIT_FETCH_INTERVAL_MIN ?? 15) * 60_000,
  githubToken: process.env.GITHUB_TOKEN ?? '',
  logBufferLines: Number(process.env.LOG_BUFFER_LINES ?? 2000),
};

fs.mkdirSync(config.dataDir, { recursive: true });

/** Sockets Docker usuels sur macOS (Docker Desktop, OrbStack, Colima) puis Linux. */
export function dockerSocketPath(): string | null {
  if (process.platform === 'win32') {
    // Docker Desktop sous Windows : named pipe (`npipe:////./pipe/docker_engine`).
    const pipe = process.env.DOCKER_HOST?.startsWith('npipe://') ? process.env.DOCKER_HOST.slice(8).replace(/\//g, '\\') : '\\\\.\\pipe\\docker_engine';
    return fs.existsSync(pipe) ? pipe : null;
  }
  const fromEnv = process.env.DOCKER_HOST?.replace(/^unix:\/\//, '');
  const candidates = [
    fromEnv,
    path.join(home, '.docker/run/docker.sock'),
    path.join(home, '.orbstack/run/docker.sock'),
    path.join(home, '.colima/default/docker.sock'),
    '/var/run/docker.sock',
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
