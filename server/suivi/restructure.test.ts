import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { SuiviService } from './service.js';
import { keepIncreasing } from './restructure.js';

const P = 'acme/demo';
const T = (id: string, order: number, phase: number, num: string, over: object = {}) =>
  ({ id, order, phase, phaseTitle: `Phase ${phase}`, num, title: `Tâche ${num}`, who: 'claude', ...over });

/** Phase 7 trop grosse (avec une sous-tâche), puis 8 et 9. */
const fresh = () => {
  const changed: string[] = [];
  const s = new SuiviService(openDb(':memory:'), (id) => changed.push(id));
  s.registerProject({ projectId: P, name: 'demo' });
  s.importFile(P, { collection: 'tasks', exportedAt: '2026-10-10T00:00:00Z', tasks: [
    T('t-7-01', 1, 7, '7.1'), T('t-7-02', 2, 7, '7.2'), T('t-7-02a', 2.5, 7, '7.2a', { parent: 't-7-02' }),
    T('t-7-03', 3, 7, '7.3'), T('t-7-04', 4, 7, '7.4', { done: true }), T('t-7-05', 5, 7, '7.5', { archived: true }),
    T('t-8-01', 6, 8, '8.1'), T('t-8-02', 7, 8, '8.2'), T('t-9-01', 8, 9, '9.1'),
  ] } as any);
  changed.length = 0;
  return { s, changed };
};
const SPLIT = {
  phases: [{ from: 8, to: 10 }, { from: 9, to: 11 }],
  moves: [{ taskId: 't-7-02', phase: 8 }, { taskId: 't-7-04', phase: 9 }],
  titles: [{ phase: 7, title: 'Backend' }, { phase: 8, title: 'Mobile' }, { phase: 9, title: 'Frontend' }],
};
const view = (s: SuiviService) => s.tasks(P, { archived: true }).map((t) => `${t.id}:${t.num}`);

test('redécoupage : phases décalées, tâches déplacées, sous-tâche avec sa mère, ids stables', () => {
  const { s, changed } = fresh();
  const r = s.restructure(P, SPLIT);
  assert.deepEqual(view(s), [
    't-7-01:7.1', 't-7-03:7.3', 't-7-05:7.5',
    't-7-02:8.1', 't-7-02a:8.1a',
    't-7-04:9.1',
    't-8-01:10.1', 't-8-02:10.2',
    't-9-01:11.1',
  ]);
  const byId = Object.fromEntries(s.tasks(P, { archived: true }).map((t) => [t.id, t]));
  assert.deepEqual([byId['t-7-01'].phaseTitle, byId['t-7-02a'].phaseTitle, byId['t-7-04'].phaseTitle, byId['t-8-01'].phaseTitle], ['Backend', 'Mobile', 'Frontend', 'Phase 8']);
  assert.equal(byId['t-7-02a'].phase, 8);
  assert.equal(byId['t-7-04'].done, true, 'le reste de la tâche ne change pas');
  assert.equal(byId['t-7-05'].archived, true);
  assert.ok(byId['t-8-01'].rev > 1);
  assert.deepEqual(r.phases.map((p) => [p.phase, p.title, p.tasks, p.from]), [
    [7, 'Backend', 3, [7]], [8, 'Mobile', 2, [7]], [9, 'Frontend', 1, [7]], [10, 'Phase 8', 2, [8]], [11, 'Phase 9', 1, [9]],
  ]);
  assert.equal(r.mapping.find((m) => m.id === 't-7-02a')?.to, '8.1a');
  assert.deepEqual(changed, [P]);
  // L'ancien numéro reste au journal.
  const h = s.history(P, 't-9-01').find((e) => e.field === 'num');
  assert.deepEqual([h?.before, h?.after, h?.origin], ['9.1', '11.1', 'restructure']);
});

test('aperçu (dryRun) : rien n’est écrit', () => {
  const { s, changed } = fresh();
  const before = view(s);
  const r = s.restructure(P, SPLIT, { dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.changed, 9, 'les tâches restées en 7 changent de titre de phase');
  assert.deepEqual(view(s), before);
  assert.deepEqual(changed, []);
});

test('ordre : seules les tâches déplacées changent d’ordre', () => {
  const { s } = fresh();
  s.restructure(P, SPLIT);
  const order = Object.fromEntries(s.tasks(P, { archived: true }).map((t) => [t.id, t.order]));
  assert.deepEqual([order['t-7-01'], order['t-7-03'], order['t-8-01'], order['t-9-01']], [1, 3, 6, 8]);
  const seq = s.tasks(P, { archived: true }).map((t) => t.order);
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
});

test('compact : phases touchées renumérotées de 1 à N', () => {
  const { s } = fresh();
  s.restructure(P, { ...SPLIT, compact: true });
  assert.deepEqual(view(s).slice(0, 3), ['t-7-01:7.1', 't-7-03:7.2', 't-7-05:7.3']);
});

test('fusion de deux phases : les numéros en collision sont renumérotés à la suite', () => {
  const { s } = fresh();
  s.restructure(P, { phases: [{ from: 8, to: 9 }] });
  assert.deepEqual(view(s).slice(-3), ['t-8-01:9.1', 't-8-02:9.2', 't-9-01:9.3']);
});

test('nouvelle tâche après restructuration : numéro suivant de la phase, id sans collision', () => {
  const { s } = fresh();
  s.restructure(P, SPLIT);
  const t = s.upsertTask(P, { title: 'Écran profil', phase: 8 });
  assert.equal(t.num, '8.2');
  assert.equal(t.phaseTitle, 'Mobile');
  assert.notEqual(t.id, 't-8-02');
});

test('refus : sous-tâche déplacée seule, tâche inconnue, phase sans titre', () => {
  const { s } = fresh();
  assert.throws(() => s.restructure(P, { moves: [{ taskId: 't-7-02a', phase: 8 }] }), /sous-tâche|subtask/);
  assert.throws(() => s.restructure(P, { moves: [{ taskId: 'nope', phase: 8 }] }), /inconnue|Unknown/);
  assert.throws(() => s.restructure(P, { moves: [{ taskId: 't-7-03', phase: 12 }] }), /titre|title/);
  assert.throws(() => s.restructure(P, { phases: [{ from: 8, to: 10 }, { from: 8, to: 11 }] }), /deux fois|twice/);
  assert.deepEqual(view(s)[1], 't-7-02:7.2', 'rien n’a été écrit');
});

test('keepIncreasing : garde la plus longue suite croissante', () => {
  assert.deepEqual(keepIncreasing([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(keepIncreasing([1, 3, 2, 4]), [1, 1.5, 2, 4]);
  assert.deepEqual(keepIncreasing([1, 3, 2, 4], [true, true, false, true]), [1, 3, 3.5, 4]);
  const out = keepIncreasing([1, 3, 5, 2, 4, 6, 7]);
  assert.deepEqual(out.filter((v, i) => v === [1, 3, 5, 2, 4, 6, 7][i]).length, 5);
  assert.deepEqual(out, [...out].sort((a, b) => a - b));
  assert.deepEqual(keepIncreasing([5, 1]), [0, 1]);
  assert.deepEqual(keepIncreasing([]), []);
});
