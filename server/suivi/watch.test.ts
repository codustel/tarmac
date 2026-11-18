import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from './db.js';
import { SuiviService } from './service.js';
import { TodolistWatcher, type ProjectRoot } from './watch.js';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' });

/** Dépôt principal + un worktree, chacun avec une copie `Todolist/suivi.json`. */
function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'suivi-wt-')));
  const main = path.join(base, 'app');
  const wt = path.join(base, 'app-fix');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'fix', wt);
  for (const d of [main, wt]) {
    fs.mkdirSync(path.join(d, 'Todolist'));
    fs.writeFileSync(path.join(d, 'Todolist', 'suivi.json'), JSON.stringify({ collection: 'tasks', exportedAt: '2026-01-01T00:00:00Z', tasks: [] }));
  }
  const service = new SuiviService(openDb(':memory:'), () => {});
  const w = new TodolistWatcher(service);
  const root = (dir: string): ProjectRoot => ({ dir, name: path.basename(dir), remoteKey: 'github.com/codustel/app' });
  return { base, main, wt, service, w, root };
}

for (const order of ['main-puis-worktree', 'worktree-puis-main'] as const) {
  test(`writeCopy préfère le worktree principal (${order})`, () => {
    const { main, wt, w, root } = setup();
    w.sync(order === 'main-puis-worktree' ? [root(main), root(wt)] : [root(wt), root(main)]);
    const f = w.writeCopy('codustel/app');
    assert.equal(f, path.join(main, 'Todolist', 'suivi.json'));
  });
}

test('writeCopy ne recrée jamais un dossier de projet absent', () => {
  const { base, main, service, w, root } = setup();
  w.sync([root(main)]);
  fs.rmSync(main, { recursive: true, force: true });
  assert.throws(() => w.writeCopy('codustel/app'));
  assert.equal(fs.existsSync(main), false);
  assert.ok(fs.existsSync(base));
});

test('writeCopy replie sur le premier chemin existant de p.paths', () => {
  const { base, service, w } = setup();
  const gone = path.join(base, 'absent');
  const ok = path.join(base, 'present');
  fs.mkdirSync(ok);
  service.registerProject({ projectId: 'solo', name: 'solo', paths: [gone, ok] });
  assert.equal(w.writeCopy('solo'), path.join(ok, 'Todolist', 'suivi.json'));
  assert.equal(fs.existsSync(gone), false);
});
