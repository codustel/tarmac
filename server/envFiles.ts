import fs from 'node:fs';
import path from 'node:path';
import { tr } from './i18n.js';

/** Fichiers `.env*` à la racine d'un projet, `.env` en premier. */
export function listEnvFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^\.env(\..+)?$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => (a === '.env' ? -1 : b === '.env' ? 1 : a.localeCompare(b)));
  } catch {
    return [];
  }
}

export type EnvLine = { type: 'comment'; text: string } | { type: 'entry'; key: string; value: string; line: number; disabled?: boolean };

/**
 * Parseur dotenv : `export` facultatif, valeurs entre guillemets simples, doubles (échappements \n,
 * multi-lignes) ou backticks, commentaires en fin de ligne pour les valeurs sans guillemets.
 * Les commentaires seuls sur leur ligne sont gardés pour afficher les sections du fichier.
 */
export function parseEnv(src: string): EnvLine[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: EnvLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // Variable commentée (`# CLÉ=valeur`) : entrée désactivée, masquée comme les autres.
    const disabled = /^#+\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*=/.test(raw);
    if (raw.startsWith('#') && !disabled) {
      const text = raw.replace(/^#+\s*/, '').replace(/^[-=*_─━#\s]+|[-=*_─━#\s]+$/g, '').trim();
      // Les commentaires courts servent de titres de section ; les explications longues sont ignorées.
      if (text && text.length <= 60) out.push({ type: 'comment', text });
      continue;
    }
    const m = raw.replace(/^#+\s*/, '').match(/^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key] = m;
    const rest = m[2];
    const line = i + 1;
    let value: string;
    const q = rest[0];
    if (q === '"' || q === "'" || q === '`') {
      // Valeur entre guillemets, éventuellement sur plusieurs lignes.
      let body = rest.slice(1);
      let j = 0;
      for (;;) {
        while (j < body.length && body[j] !== q) j += body[j] === '\\' && q === '"' ? 2 : 1;
        if (j < body.length || i + 1 >= lines.length) break;
        body += '\n' + lines[++i];
      }
      value = body.slice(0, j);
      if (q === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      value = rest.replace(/\s+#.*$/, '').trim();
    }
    out.push({ type: 'entry', key, value, line, ...(disabled ? { disabled } : {}) });
  }
  return out;
}

export function readEnvFile(dir: string, name: string) {
  if (!listEnvFiles(dir).includes(name)) throw Object.assign(new Error(tr({ en: '.env file not found', fr: 'Fichier .env introuvable' })), { statusCode: 404 });
  return parseEnv(fs.readFileSync(path.join(dir, name), 'utf8'));
}
