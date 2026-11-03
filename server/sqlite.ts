/**
 * SQLite (`node:sqlite`) avec migrations numérotées par `PRAGMA user_version` : base du suivi et bases des modules.
 */
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// `node:sqlite` est encore expérimental en Node 22 : on tait son avertissement, et lui seul.
const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: any[]) => {
  if (String(warning).includes('SQLite')) return;
  return (emitWarning as any).call(process, warning, ...rest);
}) as typeof process.emitWarning;
// Spécificateur calculé : esbuild (tsup) réécrirait sinon `node:sqlite` en `sqlite`, introuvable.
const SQLITE = 'node:sqlite';
const { DatabaseSync } = (await import(SQLITE)) as typeof import('node:sqlite');
process.emitWarning = emitWarning;

export type Db = DatabaseSyncType;

/** Ouvre (ou crée) la base et applique, chacune dans une transaction, les migrations pas encore passées. */
export function openSqlite(file: string, migrations: readonly string[]): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = version; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
