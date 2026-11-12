/** Aides pures de « Enregistrer » / « Enregistrer sous » (testées sans navigateur). */

/** Ctrl+S (Windows/Linux) ou Cmd+S (Mac). `code` couvre la majuscule (verrouillage) et les autres dispositions de clavier. */
export function isSaveShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return false;
  return e.key.toLowerCase() === 's' || e.code === 'KeyS';
}

/**
 * Chemin saisi pour « Enregistrer sous » → chemin relatif au projet, ou null s'il est invalide
 * (vide, dossier, absolu, sortie du projet). Le serveur re-vérifie (`resolveInside`).
 */
export function normalizeSaveAsPath(input: string): string | null {
  const raw = input.trim().replace(/\\/g, '/');
  if (!raw || raw.endsWith('/') || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return null;
  const out: string[] = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); continue; }
    out.push(part);
  }
  return out.length ? out.join('/') : null;
}
