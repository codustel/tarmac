import fs from 'node:fs/promises';
import path from 'node:path';
import { tr } from './i18n.js';

/** Fichiers masqués dans l'explorateur, comme `files.exclude` par défaut de VS Code. */
const HIDDEN = new Set(['.git', '.svn', '.hg', 'CVS', '.DS_Store', 'Thumbs.db']);
/** Au-delà, un fichier n'est pas ouvert dans l'éditeur. */
export const MAX_EDIT_BYTES = 5 * 1024 * 1024;

export interface DirEntry {
  name: string;
  type: 'dir' | 'file';
  size: number | null;
  /** Lien symbolique (affiché, suivi s'il reste dans le projet). */
  link: boolean;
}

/**
 * Chemin absolu d'un fichier du projet. Refuse toute sortie du dossier (`..`, chemin absolu,
 * lien symbolique pointant ailleurs).
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const abs = path.resolve(root, rel.replace(/^\/+/, ''));
  const inside = (p: string, r: string) => p === r || p.startsWith(r + path.sep);
  if (!inside(abs, root)) throw Object.assign(new Error(tr({ en: 'Path outside the project', fr: 'Chemin hors du projet' })), { statusCode: 403 });
  try {
    const [real, realRoot] = await Promise.all([fs.realpath(abs), fs.realpath(root)]);
    if (!inside(real, realRoot)) throw Object.assign(new Error(tr({ en: 'Link outside the project', fr: 'Lien hors du projet' })), { statusCode: 403 });
  } catch (e: any) {
    if (e.statusCode) throw e; // fichier inexistant : autorisé (création)
  }
  return abs;
}

export async function listDir(root: string, rel: string): Promise<DirEntry[]> {
  const dir = await resolveInside(root, rel);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = await Promise.all(
    entries.filter((e) => !HIDDEN.has(e.name)).map(async (e): Promise<DirEntry> => {
      let isDir = e.isDirectory();
      let size: number | null = null;
      if (e.isSymbolicLink() || e.isFile()) {
        try {
          const st = await fs.stat(path.join(dir, e.name));
          isDir = st.isDirectory();
          size = isDir ? null : st.size;
        } catch { /* lien cassé */ }
      }
      return { name: e.name, type: isDir ? 'dir' : 'file', size, link: e.isSymbolicLink() };
    }),
  );
  const coll = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  return out.sort((a, b) => (a.type === b.type ? coll.compare(a.name, b.name) : a.type === 'dir' ? -1 : 1));
}

export type ReadResult =
  | { kind: 'text'; content: string; mtime: number; size: number }
  | { kind: 'binary' | 'too-large'; mtime: number; size: number };

export async function readFile(root: string, rel: string): Promise<ReadResult> {
  const abs = await resolveInside(root, rel);
  const st = await fs.stat(abs);
  if (st.isDirectory()) throw Object.assign(new Error(tr({ en: 'Folder', fr: 'Dossier' })), { statusCode: 400 });
  const meta = { mtime: st.mtimeMs, size: st.size };
  if (st.size > MAX_EDIT_BYTES) return { kind: 'too-large', ...meta };
  const buf = await fs.readFile(abs);
  // Octet nul dans les 8 premiers Ko → binaire (même heuristique que git).
  if (buf.subarray(0, 8192).includes(0)) return { kind: 'binary', ...meta };
  return { kind: 'text', content: buf.toString('utf8'), ...meta };
}

export async function statFile(root: string, rel: string) {
  const st = await fs.stat(await resolveInside(root, rel));
  return { mtime: st.mtimeMs, size: st.size };
}

/**
 * Enregistre un fichier. `expectedMtime` : date de la version ouverte ; si le fichier a changé
 * depuis sur le disque, l'écriture est refusée (409) sauf `force`.
 */
export async function writeFile(root: string, rel: string, content: string, expectedMtime: number | null, force: boolean) {
  const abs = await resolveInside(root, rel);
  if (!force && expectedMtime !== null) {
    const cur = await fs.stat(abs).catch(() => null);
    if (cur && Math.abs(cur.mtimeMs - expectedMtime) > 1) {
      throw Object.assign(new Error(tr({ en: 'The file was changed on disk since it was opened', fr: 'Le fichier a été modifié sur le disque depuis son ouverture' })), { statusCode: 409 });
    }
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return statFile(root, rel);
}
