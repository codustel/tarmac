import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withTool, gate } from './gate';

const toolErr = (state = 'absent', tool = 'claude') => Object.assign(new Error('424'), { status: 424, tool, state, installMethod: 'npm', docUrl: 'https://doc' });
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => { while (gate.current()) gate.resolve(false); });

test('un appel réussi passe tel quel, sans demande', async () => {
  assert.equal(await withTool(async () => 7), 7);
  assert.equal(gate.current(), null);
});

test('une erreur sans tool est relancée sans demande', async () => {
  const err = new Error('boom');
  await assert.rejects(withTool(async () => { throw err; }), (e) => e === err);
  assert.equal(gate.current(), null);
});

test('erreur avec tool puis resolve(true) : relance une fois et renvoie le résultat', async () => {
  let n = 0;
  const p = withTool(async () => { if (n++ === 0) throw toolErr(); return 'ok'; });
  await tick();
  assert.deepEqual(gate.current(), { tool: 'claude', state: 'absent', installMethod: 'npm', docUrl: 'https://doc' });
  gate.resolve(true);
  assert.equal(await p, 'ok');
  assert.equal(n, 2);
  assert.equal(gate.current(), null);
});

test('resolve(false) rejette avec l’erreur d’origine', async () => {
  const err = toolErr();
  const p = withTool(async () => { throw err; });
  await tick();
  gate.resolve(false);
  await assert.rejects(p, (e) => e === err);
});

test('seconde 424 après la relance : rejette, sans boucle', async () => {
  let n = 0;
  const p = withTool(async () => { n++; throw toolErr(); });
  await tick();
  gate.resolve(true);
  await assert.rejects(p, (e: Error & { tool?: string }) => e.tool === 'claude');
  assert.equal(n, 2);
  assert.equal(gate.current(), null);
});

test('subscribe notifie à la demande et à la résolution', async () => {
  let calls = 0;
  const off = gate.subscribe(() => { calls++; });
  const p = withTool(async () => { throw toolErr(); });
  await tick();
  gate.resolve(false);
  await p.catch(() => null);
  off();
  assert.equal(calls, 2);
});

test('deux demandes pour le même outil : une seule question, les deux relancées après succès (T8)', async () => {
  let a = 0;
  let b = 0;
  const pa = withTool(async () => { if (a++ === 0) throw toolErr(); return 'a'; });
  const pb = withTool(async () => { if (b++ === 0) throw toolErr(); return 'b'; });
  await tick();
  assert.equal(gate.current()?.tool, 'claude');
  gate.resolve(true);
  assert.equal(gate.current(), null, 'pas de seconde question pour le même outil');
  assert.deepEqual(await Promise.all([pa, pb]), ['a', 'b']);
  assert.deepEqual([a, b], [2, 2]);
});

test('demandes d’outils différents : la seconde reste en file après la première', async () => {
  const pa = withTool(async () => { throw toolErr('absent', 'claude'); });
  const pb = withTool(async () => { throw toolErr('absent', 'codex'); });
  await tick();
  gate.resolve(false);
  assert.equal(gate.current()?.tool, 'codex');
  gate.resolve(false);
  await Promise.allSettled([pa, pb]);
  assert.equal(gate.current(), null);
});
