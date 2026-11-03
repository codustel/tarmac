import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { SuiviService } from './service.js';
import { countTasks } from './types.js';

const fresh = () => {
  const changed: string[] = [];
  const s = new SuiviService(openDb(':memory:'), (id) => changed.push(id));
  s.registerProject({ projectId: 'acme/demo', name: 'demo' });
  return { s, changed };
};
const file = (tasks: object[], exportedAt = '2026-10-10T00:00:00Z') => ({ collection: 'tasks', exportedAt, tasks });
const T = (id: string, order: number, over: object = {}) => ({ id, order, phase: 1, phaseTitle: 'Phase 1', num: `1.${order}`, title: `Tâche ${id}`, who: 'toi', minutes: 30, ...over });

test('import puis ré-import idempotent', () => {
  const { s } = fresh();
  const r1 = s.importFile('acme/demo', file([T('a', 1), T('b', 2, { done: true }), T('c', 3, { toTest: true })]));
  assert.deepEqual([r1.created, r1.updated, r1.unchanged], [3, 0, 0]);
  const r2 = s.importFile('acme/demo', file([T('a', 1), T('b', 2, { done: true }), T('c', 3, { toTest: true })]));
  assert.deepEqual([r2.created, r2.updated, r2.unchanged], [0, 0, 3]);
  const c = countTasks(s.tasks('acme/demo'));
  assert.deepEqual([c.total, c.done, c.toTest, c.minutesLeft, c.next?.id], [3, 1, 1, 60, 'a']);
});

test('une copie plus récente coche ; une copie ancienne ne défait pas une coche Tarmac', () => {
  const { s } = fresh();
  s.importFile('acme/demo', file([T('a', 1), T('b', 2)]));
  const a = s.task('acme/demo', 'a')!;
  s.patchTask('acme/demo', 'a', a.rev, { done: true }, 'tarmac');
  // Copie exportée avant la coche : `a` reste cochée, la valeur écartée est journalisée.
  const r = s.importFile('acme/demo', file([T('a', 1), T('b', 2, { done: true })], '2026-10-10T00:00:00Z'));
  assert.equal(s.task('acme/demo', 'a')!.done, true);
  assert.equal(s.task('acme/demo', 'b')!.done, true, 'b : même date que la version locale → le fichier fait foi');
  assert.equal(r.lost, 1, 'a : valeur entrante écartée et journalisée');
  // Copie exportée maintenant : `b` est cochée.
  s.importFile('acme/demo', file([T('a', 1, { done: true }), T('b', 2, { done: true })], new Date(Date.now() + 1000).toISOString()));
  assert.equal(s.task('acme/demo', 'b')!.done, true);
});

test('patch : conflit 409, champs refusés 403, journal', () => {
  const { s, changed } = fresh();
  s.importFile('acme/demo', file([T('a', 1)]));
  const a = s.task('acme/demo', 'a')!;
  const a2 = s.patchTask('acme/demo', 'a', a.rev, { note: 'Testé sur iPhone' }, 'tarmac');
  assert.equal(a2.rev, a.rev + 1);
  assert.throws(() => s.patchTask('acme/demo', 'a', a.rev, { done: true }, 'tarmac'), (e: any) => e.statusCode === 409);
  assert.throws(() => s.patchTask('acme/demo', 'a', a2.rev, { title: 'x' }, 'tarmac'), (e: any) => e.statusCode === 403);
  assert.throws(() => s.patchTask('acme/demo', 'a', a2.rev, { archived: true }, 'artifact'), (e: any) => e.statusCode === 403);
  const h = s.history('acme/demo', 'a');
  assert.equal(h[0].field, 'note');
  assert.equal(h[0].after, 'Testé sur iPhone');
  assert.ok(changed.includes('acme/demo'));
});

test('création par Claude : numéros, sous-tâche lettrée juste sous la mère', () => {
  const { s } = fresh();
  s.importFile('acme/demo', file([T('t-1-01', 1, { num: '1.1' }), T('t-1-02', 2, { num: '1.2' })]));
  const n = s.upsertTask('acme/demo', { title: 'Nouvelle', phase: 1 });
  assert.equal(n.num, '1.3');
  assert.equal(n.order, 3);
  const sub = s.upsertTask('acme/demo', { title: 'Remarque', parent: 't-1-01' });
  assert.equal(sub.num, '1.1a');
  assert.ok(sub.order > 1 && sub.order < 2);
  const sub2 = s.upsertTask('acme/demo', { title: 'Autre remarque', parent: 't-1-01' });
  assert.equal(sub2.num, '1.1b');
  assert.ok(sub2.order > sub.order && sub2.order < 2);
  assert.deepEqual(s.tasks('acme/demo').map((t) => t.num), ['1.1', '1.1a', '1.1b', '1.2', '1.3']);
  // Les sous-tâches lettrées ne décalent pas la numérotation.
  assert.equal(s.upsertTask('acme/demo', { title: 'Encore', phase: 1 }).num, '1.4');
  // Mise à jour partielle : les autres champs sont conservés.
  const up = s.upsertTask('acme/demo', { id: n.id, toTest: true });
  assert.equal(up.title, 'Nouvelle');
  assert.equal(up.toTest, true);
});

test('archivage : la tâche sort de la vue mais reste en base', () => {
  const { s } = fresh();
  s.importFile('acme/demo', file([T('a', 1), T('b', 2)]));
  s.upsertTask('acme/demo', { id: 'a', archived: true });
  assert.equal(s.tasks('acme/demo').length, 1);
  assert.equal(s.tasks('acme/demo', { archived: true }).length, 2);
});

test('curseur de changements (pull)', () => {
  const { s } = fresh();
  s.importFile('acme/demo', file([T('a', 1), T('b', 2)]));
  const c0 = s.changedSince('acme/demo', 0);
  assert.equal(c0.tasks.length, 2);
  const b = s.task('acme/demo', 'b')!;
  s.patchTask('acme/demo', 'b', b.rev, { done: true }, 'artifact');
  const c1 = s.changedSince('acme/demo', c0.cursor);
  assert.deepEqual(c1.tasks.map((t) => t.id), ['b']);
});

test('persistance : une coche survit à la réouverture de la base', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'suivi-')), 'suivi.db');
  const s1 = new SuiviService(openDb(f));
  s1.registerProject({ projectId: 'x', name: 'x' });
  s1.importFile('x', file([T('a', 1)]));
  s1.patchTask('x', 'a', 1, { done: true }, 'tarmac');
  const s2 = new SuiviService(openDb(f));
  assert.equal(s2.task('x', 'a')!.done, true);
});

test('projet : URL et thème venus d’un dépôt sont validés', () => {
  const s = new SuiviService(openDb(':memory:'));
  const p = s.registerProject({
    projectId: 'x', name: 'x', artifactUrl: 'javascript:alert(1)',
    theme: { primary: '#E91E63', fonts: { display: 'x;}body{', body: 'Inter', mono: 'Mono' }, dark: { bg: 'red;}' }, light: {} } as any,
  });
  assert.equal(p.artifactUrl, null);
  assert.equal(p.theme.primary, '#E91E63');
  assert.equal(p.theme.fonts.display, 'Inter');
  assert.match(p.theme.dark.bg, /^#[0-9A-F]{6}$/);
  assert.equal(s.registerProject({ projectId: 'x', name: 'x', artifactUrl: 'https://claude.ai/artifact/Ab12Cd34Ef56Gh78Ij90Kl' }).artifactUrl, 'https://claude.ai/artifact/Ab12Cd34Ef56Gh78Ij90Kl');
});

test('push depuis une page d’artefact : coche et note seulement, pas de création', () => {
  const { s } = fresh();
  s.importFile('acme/demo', file([T('a', 1)]));
  const later = new Date(Date.now() + 1000).toISOString();
  const r = s.pushTasks('acme/demo', [
    { ...T('a', 1), title: 'Titre piraté', done: true, note: 'vu sur iPhone', updatedAt: later, rev: 5 },
    { ...T('nouvelle', 2), updatedAt: later },
  ], 'A', { uiOnly: true });
  assert.equal(r.refused, 1);
  const a = s.task('acme/demo', 'a')!;
  assert.deepEqual([a.title, a.done, a.note], ['Tâche a', true, 'vu sur iPhone']);
  assert.equal(s.task('acme/demo', 'nouvelle'), null);
  assert.equal(s.syncs('acme/demo').find((x) => x.channel === 'A')?.channel, 'A');
});

test('nom de copie : jamais de chemin', () => {
  const s = new SuiviService(openDb(':memory:'));
  assert.equal(s.registerProject({ projectId: 'x', name: 'x', copyFile: '../../.zshrc.json' }).copyFile, 'suivi.json');
  assert.equal(s.registerProject({ projectId: 'x', name: 'x', copyFile: 'suivi-lancement.json' }).copyFile, 'suivi-lancement.json');
});

test('ré-import d’une copie à la même date : les champs ajoutés au schéma sont repris', () => {
  const { s } = fresh();
  s.importFile('acme/demo', file([T('a', 1)]));
  const r = s.importFile('acme/demo', file([T('a', 1, { tested: true, testedAt: '2026-11-01T16:49:07.961Z', testNote: 'ok sur iPhone' })]));
  assert.equal(r.updated, 1);
  const a = s.task('acme/demo', 'a')!;
  assert.deepEqual([a.tested, a.testNote], [true, 'ok sur iPhone']);
  // Le badge « Testé » est modifiable depuis l'interface.
  const b = s.patchTask('acme/demo', 'a', a.rev, { tested: false, toTest: true, testedAt: null }, 'artifact');
  assert.deepEqual([b.tested, b.toTest], [false, true]);
});

test('ancien nom : l’origine `app-manager` (artefacts déjà publiés) est lue comme `tarmac`', () => {
  const { s } = fresh();
  s.importFile('acme/demo', file([T('a', 1, { updatedBy: 'app-manager', updatedAt: '2026-10-09T00:00:00Z' })]));
  assert.equal(s.task('acme/demo', 'a')!.updatedBy, 'tarmac');
});

test('migration de la base : origines `app-manager` → `tarmac`', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'suivi-')), 'suivi.db');
  const db = openDb(f);
  // Base telle qu'une version antérieure au renommage l'a laissée (schéma v2).
  db.exec('PRAGMA user_version = 2');
  db.prepare('INSERT INTO tasks (project_id, task_id, ord, rev, updated_at, archived, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('x', 'a', 1, 1, null, 0, JSON.stringify({ id: 'a', title: 'A', updatedBy: 'app-manager' }));
  db.prepare('INSERT INTO journal (project_id, task_id, rev, field, before, after, origin, lost, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('x', 'a', 1, 'done', 'false', 'true', 'app-manager', 0, '2026-10-10T00:00:00Z');
  db.close();
  const db2 = openDb(f);
  const row = db2.prepare('SELECT data FROM tasks').get() as { data: string };
  assert.equal(JSON.parse(row.data).updatedBy, 'tarmac');
  assert.equal((db2.prepare('SELECT origin FROM journal').get() as { origin: string }).origin, 'tarmac');
});

test('note réécrite par Claude pendant que l’artefact renvoie l’ancienne version : aucun bloc ⟂', () => {
  const { s } = fresh();
  s.importFile('acme/demo', file([T('a', 1)]));
  const v1 = s.upsertTask('acme/demo', { id: 'a', note: 'Première note' });
  const v2 = s.upsertTask('acme/demo', { id: 'a', note: 'Note réécrite' });
  assert.equal(v2.note, 'Note réécrite');
  // Le pont de l'artefact renvoie la version qu'il avait avant (canal A), puis Claude y copie la nouvelle.
  s.pushTasks('acme/demo', [v1], 'A', { uiOnly: true });
  s.pushTasks('acme/demo', [v2], 'A', { uiOnly: true });
  assert.equal(s.task('acme/demo', 'a')!.note, 'Note réécrite');
  // Une note déjà empilée est nettoyée par une simple réécriture.
  s.upsertTask('acme/demo', { id: 'a', note: 'Note réécrite\n⟂ (autre appareil, 01/11/2026 10:00) Première note' });
  assert.equal(s.upsertTask('acme/demo', { id: 'a', note: 'Note réécrite' }).note, 'Note réécrite');
  s.pushTasks('acme/demo', [v1, v2], 'A', { uiOnly: true });
  assert.equal(s.task('acme/demo', 'a')!.note, 'Note réécrite');
});
