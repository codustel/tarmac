/**
 * Base du suivi (`~/.tarmac/suivi.db`, SQLite via `node:sqlite`) et ses migrations.
 * Une tâche est stockée en JSON (`data`) avec quelques colonnes dupliquées pour trier et filtrer.
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

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
     project_id TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE tasks (
     project_id TEXT NOT NULL,
     task_id TEXT NOT NULL,
     ord REAL NOT NULL,
     rev INTEGER NOT NULL,
     updated_at TEXT,
     archived INTEGER NOT NULL DEFAULT 0,
     data TEXT NOT NULL,
     PRIMARY KEY (project_id, task_id)
   );
   CREATE INDEX tasks_order ON tasks (project_id, ord);
   CREATE TABLE journal (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id TEXT NOT NULL,
     task_id TEXT NOT NULL,
     rev INTEGER NOT NULL,
     field TEXT NOT NULL,
     before TEXT,
     after TEXT,
     origin TEXT NOT NULL,
     lost INTEGER NOT NULL DEFAULT 0,
     at TEXT NOT NULL
   );
   CREATE INDEX journal_task ON journal (project_id, task_id, seq);
   CREATE TABLE syncs (
     project_id TEXT NOT NULL,
     channel TEXT NOT NULL,
     at TEXT NOT NULL,
     result TEXT NOT NULL,
     marker TEXT,
     PRIMARY KEY (project_id, channel)
   );`,
  // v2 : champs `tested`, `testedAt`, `testNote` → ré-importer les copies des dépôts au prochain démarrage.
  `DELETE FROM syncs WHERE channel = 'file';`,
  // v3 : App Manager devient Tarmac → origine des modifications `app-manager` → `tarmac`.
  `UPDATE tasks SET data = json_set(data, '$.updatedBy', 'tarmac') WHERE json_extract(data, '$.updatedBy') = 'app-manager';
   UPDATE journal SET origin = 'tarmac' WHERE origin = 'app-manager';`,
];

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
