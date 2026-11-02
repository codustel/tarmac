import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { demo, demoEditors } from './demo/index.js';

const exec = promisify(execFile);

/**
 * Détection des dossiers ouverts dans VS Code (et forks) sur la machine.
 *
 * Chaque fenêtre ouverte a un dossier `workspaceStorage/<hash>/` dont la base SQLite (`state.vscdb`)
 * est ouverte par le process principal tant que la fenêtre existe. Avec `lsof`, on liste ces dossiers
 * actifs, puis on lit `workspace.json` pour retrouver le dossier (ou le `.code-workspace`) associé.
 */
const SUPPORT = path.join(os.homedir(), 'Library', 'Application Support');
export const EDITOR_APPS = [
  { id: 'vscode', label: 'VS Code', dir: 'Code', app: 'Visual Studio Code', cli: 'code' },
  { id: 'vscode-insiders', label: 'VS Code Insiders', dir: 'Code - Insiders', app: 'Visual Studio Code - Insiders', cli: 'code-insiders' },
  { id: 'cursor', label: 'Cursor', dir: 'Cursor', app: 'Cursor', cli: 'cursor' },
  { id: 'vscodium', label: 'VSCodium', dir: 'VSCodium', app: 'VSCodium', cli: 'codium' },
  { id: 'windsurf', label: 'Windsurf', dir: 'Windsurf', app: 'Windsurf', cli: 'windsurf' },
] as const;

export interface OpenFolder {
  editor: string;
  editorLabel: string;
  path: string;
  /** Fenêtre ouverte sur un workspace multi-racines : son fichier `.code-workspace`. */
  workspaceFile: string | null;
}

function uriToPath(uri: string): string | null {
  try {
    return uri.startsWith('file://') ? fileURLToPath(uri) : null;
  } catch {
    return null;
  }
}

/** Dossiers d'un workspace multi-racines (`.code-workspace`). */
function workspaceFolders(file: string): string[] {
  try {
    // JSONC : commentaires hors chaînes et virgules finales retirés.
    const raw = fs.readFileSync(file, 'utf8')
      .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str) => str ?? '')
      .replace(/,(\s*[}\]])/g, '$1');
    const ws = JSON.parse(raw);
    return (ws.folders ?? [])
      .map((f: any) => (f.uri ? uriToPath(f.uri) : f.path ? path.resolve(path.dirname(file), f.path) : null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function foldersOf(storageDir: string): Array<{ path: string; workspaceFile: string | null }> {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(storageDir, 'workspace.json'), 'utf8'));
    if (meta.folder) {
      const p = uriToPath(meta.folder);
      return p ? [{ path: p, workspaceFile: null }] : [];
    }
    if (meta.workspace) {
      const file = uriToPath(meta.workspace);
      return file ? workspaceFolders(file).map((p) => ({ path: p, workspaceFile: file })) : [];
    }
  } catch { /* fenêtre vide ou fichier absent */ }
  return [];
}

let cache: { at: number; folders: OpenFolder[] } = { at: 0, folders: [] };

export async function openEditorFolders(force = false): Promise<OpenFolder[]> {
  const d = demo();
  if (d) return demoEditors(d);
  if (process.platform !== 'darwin' && !process.env.EDITORS_DETECT_FORCE) return [];
  if (!force && Date.now() - cache.at < 4000) return cache.folders;

  const installed = EDITOR_APPS.filter((e) => fs.existsSync(path.join(SUPPORT, e.dir, 'User', 'workspaceStorage')));
  if (!installed.length) return (cache = { at: Date.now(), folders: [] }).folders;

  // Fichiers ouverts sous Application Support, tous process confondus (`+D` serait trop lent).
  let out = '';
  try {
    ({ stdout: out } = await exec('lsof', ['-nP', '-Fn', '-c', 'Electron', '-c', 'Code', '-c', 'Cursor', '-c', 'VSCodium', '-c', 'Windsurf'], {
      timeout: 8000,
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (e: any) {
    out = e.stdout ?? ''; // lsof renvoie 1 au moindre fichier illisible : la sortie reste exploitable
  }

  const folders: OpenFolder[] = [];
  const seen = new Set<string>();
  for (const line of out.split('\n')) {
    if (!line.startsWith('n')) continue;
    for (const ed of installed) {
      const base = path.join(SUPPORT, ed.dir, 'User', 'workspaceStorage') + path.sep;
      if (!line.startsWith('n' + base)) continue;
      const hash = line.slice(1 + base.length).split(path.sep)[0];
      const key = `${ed.id}:${hash}`;
      if (!hash || seen.has(key)) continue;
      seen.add(key);
      for (const f of foldersOf(path.join(base, hash))) folders.push({ editor: ed.id, editorLabel: ed.label, ...f });
    }
  }
  cache = { at: Date.now(), folders };
  return folders;
}

/**
 * Un projet est « ouvert » si une fenêtre a ouvert son dossier exact (match direct)
 * ou un dossier parent (ex. racine du monorepo / du repo).
 */
export function matchOpen(dir: string, folders: OpenFolder[]) {
  const exact = folders.find((f) => f.path === dir);
  if (exact) return { ...exact, via: 'exact' as const };
  const parent = folders
    .filter((f) => dir.startsWith(f.path + path.sep))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return parent ? { ...parent, via: 'parent' as const } : null;
}
