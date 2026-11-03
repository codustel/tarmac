import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, mergeNotes, mergeTask } from './merge.js';
import { sanitizeTask, type Task } from './types.js';

const base = (over: Partial<Task> = {}): Task =>
  sanitizeTask({ id: 't-1-01', order: 1, phase: 1, phaseTitle: 'P', num: '1.1', title: 'Tâche', who: 'toi', rev: 1, updatedAt: '2026-10-01T10:00:00Z', ...over });

test('création : tâche absente localement', () => {
  const r = mergeTask(undefined, base(), 'artifact');
  assert.equal(r.created, true);
  assert.equal(r.task.rev, 1);
  assert.equal(r.task.updatedBy, 'artifact');
});

test('identiques : rien ne change', () => {
  const r = mergeTask(base(), base({ rev: 5 }), 'artifact');
  assert.equal(r.changes.length, 0);
  assert.equal(r.lost.length, 0);
});

test('la plus récente gagne (updatedAt), la perdante va dans lost', () => {
  const local = base({ done: false });
  const incoming = base({ done: true, doneAt: '2026-10-02T09:00:00Z', updatedAt: '2026-10-02T09:00:00Z', updatedBy: 'artifact' });
  const r = mergeTask(local, incoming, 'artifact');
  assert.equal(r.task.done, true);
  assert.equal(r.task.rev, 2);
  assert.equal(r.task.updatedBy, 'artifact');
  assert.deepEqual(r.changes.map((c) => c.field).sort(), ['done', 'doneAt']);
  assert.equal(r.lost.length, 0);

  const older = base({ title: 'Ancien titre', updatedAt: '2026-09-01T00:00:00Z' });
  const r2 = mergeTask(local, older, 'artifact');
  assert.equal(r2.task.title, 'Tâche');
  assert.equal(r2.changes.length, 0);
  assert.deepEqual(r2.lost.map((c) => [c.field, c.before]), [['title', 'Ancien titre']]);
});

test('à date égale, le rev départage', () => {
  const d = '2026-10-01T10:00:00Z';
  assert.ok(compareVersions({ updatedAt: d, rev: 3 } as any, { updatedAt: d, rev: 2 } as any) > 0);
  assert.ok(compareVersions({ updatedAt: 'pas une date', rev: 9 } as any, { updatedAt: d, rev: 1 } as any) < 0);
  const r = mergeTask(base({ rev: 2 }), base({ rev: 3, title: 'Nouveau' }), 'claude');
  assert.equal(r.task.title, 'Nouveau');
  assert.equal(r.task.rev, 4);
});

test('une date absente compte comme la plus ancienne', () => {
  const r = mergeTask(base(), base({ updatedAt: null, title: 'Sans date' }), 'artifact');
  assert.equal(r.task.title, 'Tâche');
});

test('notes : les deux textes sont gardés quand ils divergent', () => {
  const local = base({ note: 'Note du Mac' });
  const incoming = base({ note: 'Note du téléphone', updatedAt: '2026-10-03T08:00:00Z' });
  const r = mergeTask(local, incoming, 'artifact');
  assert.match(r.task.note, /^Note du téléphone\n⟂ \((autre appareil|other device), .+\) Note du Mac$/);
  assert.equal(r.lost.length, 0);
});

test('notes : un ajout à la fin remplace sans dupliquer', () => {
  assert.equal(mergeNotes('A puis B', 'A', null), 'A puis B');
  assert.equal(mergeNotes('A', 'A puis B', null), 'A puis B');
  assert.equal(mergeNotes('A', '', null), 'A');
});

test('archived se propage comme un champ ordinaire, rien n’est supprimé', () => {
  const r = mergeTask(base(), base({ archived: true, updatedAt: '2026-10-05T00:00:00Z' }), 'claude');
  assert.equal(r.task.archived, true);
  assert.equal(r.task.id, 't-1-01');
});

test('validation : champs bornés et valeurs inconnues neutralisées', () => {
  const t = sanitizeTask({ id: 't-9', who: 'pirate', title: 'x'.repeat(1000), minutes: -5, steps: 'pas un tableau', done: 'oui', sources: [{ kind: 'session', ref: 'abc' }, { kind: 'autre', ref: 'x' }] });
  assert.equal(t.who, 'claude');
  assert.equal(t.title.length, 300);
  assert.equal(t.minutes, 0);
  assert.deepEqual(t.steps, []);
  assert.equal(t.done, false);
  assert.equal(t.sources.length, 1);
  assert.throws(() => sanitizeTask({ id: '../etc' }));
});

test('notes : une écriture de Claude remplace sa note précédente sans conflit', () => {
  const local = base({ note: 'Première version', rev: 3, updatedBy: 'claude' });
  const incoming = base({ note: 'Note réécrite', rev: 4, updatedAt: '2026-10-02T09:00:00Z', updatedBy: 'claude' });
  const r = mergeTask(local, incoming, 'claude');
  assert.equal(r.task.note, 'Note réécrite');
  assert.deepEqual(r.changes.map((c) => [c.field, c.before]), [['note', 'Première version']], 'l’ancienne note reste au journal');
});

test('notes : une réécriture de la même note nettoie les blocs ⟂', () => {
  const local = base({ note: 'Note\n⟂ (autre appareil, 01/11/2026 10:00) Vieille note', rev: 4 });
  const r = mergeTask(local, base({ note: 'Note', rev: 5, updatedAt: '2026-10-02T09:00:00Z', updatedBy: 'claude' }), 'claude');
  assert.equal(r.task.note, 'Note');
});

test('notes : une copie antérieure à la dernière écriture n’est pas réajoutée', () => {
  // L’artefact renvoie la version qu’il avait avant l’écriture de Claude (rev et date plus anciennes).
  const local = base({ note: 'Note réécrite', rev: 4, updatedAt: '2026-10-02T09:00:00Z', updatedBy: 'claude' });
  const stale = base({ note: 'Première version', rev: 3, updatedBy: 'artifact' });
  const r = mergeTask(local, stale, 'artifact');
  assert.equal(r.task.note, 'Note réécrite');
  assert.equal(r.changes.length, 0);
  assert.deepEqual(r.lost.map((c) => c.field), ['note'], 'la note écartée est journalisée');
});

test('notes : modifications concurrentes (même rev de départ) toujours gardées', () => {
  const local = base({ note: 'Note du Mac', rev: 2, updatedAt: '2026-10-02T09:00:00Z' });
  const incoming = base({ note: 'Note du téléphone', rev: 2, updatedAt: '2026-10-02T10:00:00Z', updatedBy: 'artifact' });
  assert.match(mergeTask(local, incoming, 'artifact').task.note, /^Note du téléphone\n⟂ .+\) Note du Mac$/);
});

test('notes : un bloc ⟂ ne s’empile jamais avec un texte identique ou quasi identique', () => {
  const a = 'Note\n⟂ (autre appareil, 01/11/2026 10:00) Vieille note';
  const b = 'Note\n⟂ (other device, 11/2/26, 9:00 AM) Vieille note';
  assert.equal(mergeNotes(a, b, null), a, 'mêmes textes, en-têtes différents');
  assert.equal(mergeNotes('Bug de fusion corrigé.', 'bug de  fusion corrigé', null), 'Bug de fusion corrigé.');
  assert.match(mergeNotes('Nouvelle', 'Ancienne\n⟂ (autre appareil, 01/11/2026 10:00) Nouvelle', null), /^Nouvelle\n⟂ \([^)]+\) Ancienne$/, 'pas de bloc imbriqué');
  const merged = mergeNotes('C', 'B\n⟂ (autre appareil, 01/11/2026 10:00) A', '2026-11-02T10:00:00Z');
  assert.equal(merged.split('\n⟂ ').length, 3);
  assert.match(merged, /^C\n⟂ \(.+\) B\n⟂ \(autre appareil, 01\/11\/2026 10:00\) A$/);
  assert.equal(mergeNotes(merged, 'B', null), merged);
  assert.equal(mergeNotes(merged, 'A\n⟂ (autre appareil, 03/11/2026 08:00) C', null), merged);
});
