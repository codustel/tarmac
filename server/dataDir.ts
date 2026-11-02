/**
 * Dossier de données de Tarmac : `DATA_DIR`, sinon `~/.tarmac`.
 * Tarmac s'appelait App Manager (`~/.app-manager`) : au premier démarrage du serveur, l'ancien dossier est
 * copié (jamais déplacé) vers `~/.tarmac` si celui-ci n'existe pas encore.
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
