import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionBadges } from './badges.js';
import type { ModuleSessionRef } from './api.js';

const S: ModuleSessionRef[] = [
  { id: 'a', cwd: '/x', file: '/x/a.jsonl', sizeBytes: 10, updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'b', cwd: '/x', file: null, sizeBytes: 20, updatedAt: '2026-01-02T00:00:00Z' },
];
const quiet = () => new SessionBadges({ warn: () => {} });

test('sans fournisseur : tableaux vides, aucun appel', async () => {
  const b = quiet();
  assert.equal(b.size, 0);
  assert.deepEqual(await b.collect(S), { a: [], b: [] });
});

test('fournisseur appelé avec des données figées ; ids inconnus ignorés', async () => {
  const b = quiet();
  let seen: readonly ModuleSessionRef[] = [];
  b.add('m', (sessions) => {
    seen = sessions;
    return { a: [{ label: 'x', title: 't' }], zzz: [{ label: 'ignoré' }] };
  });
  const out = await b.collect(S);
  assert.deepEqual(out, { a: [{ label: 'x', title: 't' }], b: [] });
  assert.equal(Object.isFrozen(seen), true);
  assert.equal(Object.isFrozen(seen[0]), true);
});

test('nettoyage : 4 pastilles max par module, label 24, title 200, chaînes seulement', async () => {
  const b = quiet();
  b.add('m', () => ({
    a: [
      { label: 'x'.repeat(40), title: 'y'.repeat(300) },
      { label: 2 as any },
      { label: 'ok', title: 5 as any },
      null as any,
      { label: '3' }, { label: '4' }, { label: '5' },
    ],
  }));
  const out = await b.collect(S);
  assert.equal(out.a.length, 4);
  assert.equal(out.a[0].label.length, 24);
  assert.equal(out.a[0].title!.length, 200);
  assert.deepEqual(out.a[1], { label: 'ok' });
  assert.deepEqual(out.a.map((x) => x.label).slice(2), ['3', '4']);
});

test('ordre stable : ordre d\'enregistrement ; 4 par module, pas 4 au total', async () => {
  const b = quiet();
  b.add('m1', () => ({ a: [{ label: '1a' }, { label: '1b' }, { label: '1c' }, { label: '1d' }, { label: '1e' }] }));
  b.add('m2', () => ({ a: [{ label: '2a' }] }));
  const out = await b.collect(S);
  assert.deepEqual(out.a.map((x) => x.label), ['1a', '1b', '1c', '1d', '2a']);
});

test('erreur : journalisée, les autres fournisseurs répondent quand même', async () => {
  const warns: string[] = [];
  const b = new SessionBadges({ warn: (m) => warns.push(m) });
  b.add('bad', () => { throw new Error('boum'); });
  b.add('rej', async () => { throw new Error('rejet'); });
  b.add('good', () => ({ a: [{ label: 'g' }] }));
  const out = await b.collect(S);
  assert.deepEqual(out.a, [{ label: 'g' }]);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /bad/);
});

test('délai dépassé : le fournisseur lent ne donne rien, la liste part', async () => {
  const warns: string[] = [];
  const b = new SessionBadges({ warn: (m) => warns.push(m), timeoutMs: 30 });
  b.add('slow', () => new Promise((r) => setTimeout(() => r({ a: [{ label: 'tard' }] }), 300)));
  b.add('fast', () => ({ a: [{ label: 'vite' }] }));
  const t0 = Date.now();
  const out = await b.collect(S);
  assert.ok(Date.now() - t0 < 250);
  assert.deepEqual(out.a, [{ label: 'vite' }]);
  assert.match(warns[0], /slow.*timed out/);
});

test('désabonnement ; retour non objet ignoré', async () => {
  const b = quiet();
  const off = b.add('m', () => ({ a: [{ label: 'x' }] }));
  b.add('n', () => 'oops' as any);
  assert.equal(b.size, 2);
  off();
  assert.equal(b.size, 1);
  assert.deepEqual(await b.collect(S), { a: [], b: [] });
});

test('fournisseur désactivé (isActive faux) : ignoré', async () => {
  const b = quiet();
  let active = true;
  b.add('m', () => ({ a: [{ label: 'x' }] }), () => active);
  assert.equal((await b.collect(S)).a.length, 1);
  active = false;
  assert.equal((await b.collect(S)).a.length, 0);
});

import { withBadges } from './badges.js';
const FULL = [
  { id: 'a', cwd: '/x', sizeBytes: 10, updatedAt: 'u1', title: 'A' },
  { id: 'b', cwd: '/y', sizeBytes: 20, updatedAt: 'u2', title: 'B' },
];

test('withBadges : sans fournisseur, badges vides et aucune recherche de fichier', async () => {
  let calls = 0;
  const out = await withBadges(FULL, quiet(), () => { calls++; return null; });
  assert.deepEqual(out.map((s) => s.badges), [[], []]);
  assert.equal(calls, 0);
  assert.equal(out[0].title, 'A');
});

test('withBadges : fournisseur reçoit file, la réponse garde la forme de la session', async () => {
  const b = quiet();
  let refs: readonly ModuleSessionRef[] = [];
  b.add('m', (s) => { refs = s; return { b: [{ label: 'x' }] }; });
  const out = await withBadges(FULL, b, (id) => `/t/${id}.jsonl`);
  assert.deepEqual(refs.map((r) => r.file), ['/t/a.jsonl', '/t/b.jsonl']);
  assert.deepEqual(out.map((s) => s.badges), [[], [{ label: 'x' }]]);
  assert.equal('file' in out[0], false);
});
