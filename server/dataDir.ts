/**
 * Dossier de données de Tarmac : `DATA_DIR`, sinon `~/.tarmac`.
 * Tarmac s'appelait App Manager (`~/.app-manager`) : au premier démarrage du serveur, l'ancien dossier est
 * copié (jamais déplacé) vers `~/.tarmac` si celui-ci n'existe pas encore. Si `~/.tarmac` existe déjà mais que
 * `~/.app-manager` a des données plus récentes (copie faite trop tôt), le serveur avertit seulement ; `tarmac setup`
 * propose de mettre `~/.tarmac` de côté puis de copier.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const expandHome = (p: string) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
export const defaultDataDir = () => expandHome('~/.tarmac');
export const legacyDataDir = () => expandHome('~/.app-manager');

/** Variable d'environnement `TARMAC_<name>`, sinon l'ancien nom `MANAGER_<name>`. */
export const envVar = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined =>
  env[`TARMAC_${name}`] ?? env[`MANAGER_${name}`];

/**
 * Chemin du dossier de données, sans effet de bord (serveur MCP) : l'ancien dossier tant que le serveur
 * ne l'a pas encore copié.
 */
export function dataDirOf(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATA_DIR) return expandHome(env.DATA_DIR);
  const dir = defaultDataDir();
  const legacy = legacyDataDir();
  return !fs.existsSync(dir) && fs.existsSync(legacy) ? legacy : dir;
}

/** Fichier `env` de l'ancienne installation : variables `MANAGER_*` → `TARMAC_*`, domaine `manager.*` → `tarmac.*`. */
export function migrateEnvText(text: string): string {
  return text
    .replace(/^(\s*(?:export\s+)?)MANAGER_(HOST|PORT|URL)=/gm, '$1TARMAC_$2=')
    .replace(/^(\s*(?:export\s+)?)APP_MANAGER_URL=/gm, '$1TARMAC_API_URL=')
    .replace(/\bmanager\.(localhost|test)\b/g, 'tarmac.$1')
    .replace(/Configuration App Manager/g, 'Configuration Tarmac')
    .replace(/serveur MCP app-manager/g, 'serveur MCP tarmac');
}

/** Fichiers dont la date dit si un dossier de données sert encore (base du suivi, état des apps). */
export const ACTIVITY_FILES = ['suivi.db', 'suivi.db-wal', 'suivi.db-shm', 'state.json'];

/** Date (ms) de la dernière écriture d'un fichier d'activité du dossier, 0 s'il n'y en a aucun. */
export function lastActivity(dir: string): number {
  let last = 0;
  for (const f of ACTIVITY_FILES) {
    try { last = Math.max(last, fs.statSync(path.join(dir, f)).mtimeMs); } catch { /* absent */ }
  }
  return last;
}

/**
 * `target` et `legacy` existent tous deux et `legacy` a des données plus récentes : `target` est probablement
 * une copie périmée (migration faite trop tôt, App Manager utilisé ensuite). Renvoie les deux dates, sinon null.
 */
export function staleDataDir(target = defaultDataDir(), legacy = legacyDataDir()): { target: number; legacy: number } | null {
  if (!fs.existsSync(target) || !fs.existsSync(legacy)) return null;
  const t = lastActivity(target);
  const l = lastActivity(legacy);
  // Marge d'une seconde : une copie qui conserve les dates peut perdre les fractions de milliseconde.
  return l > t + 1000 ? { target: t, legacy: l } : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Horodatage local `AAAAMMJJ-HHMMSS`. */
export const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Date locale lisible `AAAA-MM-JJ HH:MM`, « never » pour 0. */
export function localTime(ms: number): string {
  if (!ms) return 'never';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Nom libre pour mettre de côté un dossier de données périmé : `<target>.old-AAAAMMJJ-HHMMSS[-n]`. */
export function asideName(target: string, now = new Date()): string {
  const base = `${target}.old-${stamp(now)}`;
  let name = base;
  for (let i = 2; fs.existsSync(name); i++) name = `${base}-${i}`;
  return name;
}

/**
 * Met `target` de côté (renommé en `aside`, jamais supprimé) puis copie `legacy` à sa place.
 * Renvoie le dossier mis de côté.
 */
export function replaceStaleDataDir(target: string, legacy: string, aside = asideName(target)): string {
  if (fs.existsSync(aside)) throw new Error(`${aside} already exists`);
  fs.renameSync(target, aside);
  migrateDataDir(target, legacy);
  return aside;
}

/** Avertissement du serveur au démarrage (il ne déplace rien lui-même : c'est le rôle de `tarmac setup`). */
export function staleDataWarning(target = defaultDataDir(), legacy = legacyDataDir()): string | null {
  const s = staleDataDir(target, legacy);
  if (!s) return null;
  return `Warning: ${legacy} has newer data (last write ${localTime(s.legacy)}) than ${target} (${localTime(s.target)}). `
    + `Tarmac uses ${target}. To start from the App Manager data instead, run: tarmac setup `
    + `(it moves ${target} aside, nothing is deleted).`;
}

/**
 * Copie `legacy` vers `target` si `target` n'existe pas (journal de l'ancien service exclu). La copie passe
 * par un dossier temporaire renommé à la fin : deux processus lancés en même temps ne se gênent pas.
 * Renvoie true si une copie a eu lieu.
 */
export function migrateDataDir(target = defaultDataDir(), legacy = legacyDataDir()): boolean {
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return false;
  const tmp = `${target}.migration-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    fs.cpSync(legacy, tmp, { recursive: true, preserveTimestamps: true, filter: (src) => path.basename(src) !== 'manager.log' });
    const env = path.join(tmp, 'env');
    if (fs.existsSync(env)) fs.writeFileSync(env, migrateEnvText(fs.readFileSync(env, 'utf8')), { mode: 0o600 });
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (fs.existsSync(target)) return false; // copié entre-temps par un autre processus
    throw e;
  }
}
