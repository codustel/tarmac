/**
 * Base du suivi (`~/.tarmac/suivi.db`, SQLite via `node:sqlite`) et ses migrations.
 * Une tâche est stockée en JSON (`data`) avec quelques colonnes dupliquées pour trier et filtrer.
 */
import { openSqlite, type Db } from '../sqlite.js';

export type { Db };

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

export const openDb = (file: string): Db => openSqlite(file, MIGRATIONS);
