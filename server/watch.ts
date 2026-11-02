import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Surveillance des projets ouverts dans l'IDE : un `fs.watch` récursif par projet (partagé entre
 * les onglets / clients, compteur de références) et, si le dépôt est au-dessus du projet, un second
 * sur son `.git`. Émet `change(projectId, paths, all)` après un court anti-rebond ; `paths` sont
 * relatifs au projet, `all` signale une rafale trop grosse pour être détaillée.
 */

const IGNORED = /(^|\/)(node_modules|\.next|\.turbo|\.expo|\.cache|dist|build|coverage|\.git\/(objects|logs|lfs))(\/|$)|\.git\/[^/]*\.lock$/;
const MAX_PATHS = 500;
const DEBOUNCE_MS = 200;
const MAX_WAIT_MS = 1000;

interface Entry {
  refs: number;
  watchers: fs.FSWatcher[];
  paths: Set<string>;
  all: boolean;
  timer: NodeJS.Timeout | null;
  first: number;
}

export class ProjectWatcher extends EventEmitter {
  private entries = new Map<string, Entry>();

  watch(projectId: string, dir: string, repoDir: string | null) {
    const e = this.entries.get(projectId);
    if (e) return void e.refs++;
    const entry: Entry = { refs: 1, watchers: [], paths: new Set(), all: false, timer: null, first: 0 };
    this.entries.set(projectId, entry);
    const add = (root: string, toRel: (f: string) => string) => {
      try {
        const w = fs.watch(root, { recursive: true }, (_ev, f) => {
          const rel = f ? toRel(f.toString().split(path.sep).join('/')) : null;
          if (rel !== null && IGNORED.test(rel)) return;
          this.queue(projectId, entry, rel);
        });
        w.on('error', () => w.close());
        entry.watchers.push(w);
      } catch { /* dossier disparu */ }
    };
    add(dir, (f) => f);
    const gitDir = repoDir ? path.join(repoDir, '.git') : null;
    if (gitDir && !gitDir.startsWith(dir + path.sep) && fs.statSync(gitDir, { throwIfNoEntry: false })?.isDirectory()) {
      add(gitDir, (f) => `.git/${f}`);
    }
  }

  unwatch(projectId: string) {
    const e = this.entries.get(projectId);
    if (!e || --e.refs > 0) return;
    for (const w of e.watchers) w.close();
    if (e.timer) clearTimeout(e.timer);
    this.entries.delete(projectId);
  }

  private queue(projectId: string, e: Entry, rel: string | null) {
    if (rel === null || e.paths.size >= MAX_PATHS) e.all = true;
    else e.paths.add(rel);
    const now = Date.now();
    if (!e.timer) e.first = now;
    else clearTimeout(e.timer);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, e.first + MAX_WAIT_MS - now));
    e.timer = setTimeout(() => {
      e.timer = null;
      const paths = [...e.paths];
      const all = e.all;
      e.paths.clear();
      e.all = false;
      this.emit('change', projectId, paths, all);
    }, wait);
  }
}
