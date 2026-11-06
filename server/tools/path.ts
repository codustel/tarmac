import path from 'node:path';
import { TOOLS_BIN_DIR } from './registry.js';

/** Dossiers où les outils (git, gh, claude, codex) s'installent : à ajouter au PATH du service, qui n'hérite pas du shell de connexion. */
export function toolDirs(home: string, platform: NodeJS.Platform, execPath: string): string[] {
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
    return [TOOLS_BIN_DIR(home, platform), path.win32.join(appData, 'npm'), path.win32.join(home, '.local', 'bin')];
  }
  // Le dossier de node est aussi le bin global npm (brew, nvm). Chemins posix quel que soit l'hôte.
  return [TOOLS_BIN_DIR(home, platform), path.posix.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.posix.dirname(execPath)];
}

/** Ajoute en fin de PATH les dossiers absents (la priorité de l'utilisateur est gardée). Clé `Path` conservée sous Windows. */
export function addToolDirs(env: Record<string, string | undefined>, dirs: string[], platform: NodeJS.Platform = process.platform): void {
  const win = platform === 'win32';
  const sep = win ? ';' : ':';
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
  const key = win ? keys[0] ?? 'Path' : 'PATH';
  const cur = env[key] ?? '';
  const have = new Set(cur.split(sep).filter(Boolean));
  const add: string[] = [];
  for (const d of dirs) if (!have.has(d)) { have.add(d); add.push(d); }
  if (!add.length) return;
  for (const k of keys) delete env[k];
  env[key] = [...(cur ? [cur] : []), ...add].join(sep);
}
