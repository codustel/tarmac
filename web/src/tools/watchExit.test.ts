import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchExit } from './watchExit';

const make = () => {
  let cb: ((l: any[]) => void) | null = null;
  let unsub = 0;
  let current: any[] = [];
  return {
    deps: { subscribe: (c: any) => { cb = c; return () => { unsub++; }; }, list: async () => current, pollMs: 10 },
    emit: (l: any[]) => cb!(l),
    setList: (l: any[]) => { current = l; },
    unsubs: () => unsub,
  };
};

test('watchExit : évènement socket « exited » → onExit une fois, avec le code', () => {
  const m = make();
  const codes: (number | null)[] = [];
  watchExit('s1', (c) => codes.push(c), m.deps);
  m.emit([{ id: 's1', status: 'running', exitCode: null }]);
  assert.deepEqual(codes, []);
  m.emit([{ id: 's1', status: 'exited', exitCode: 3 }]);
  m.emit([{ id: 's1', status: 'exited', exitCode: 3 }]);
  assert.deepEqual(codes, [3]);
  assert.equal(m.unsubs(), 1);
});

test('watchExit : absente d\'un évènement socket → pas de conclusion ; absente du relevé → code null', async () => {
  const m = make();
  const codes: (number | null)[] = [];
  watchExit('s1', (c) => codes.push(c), m.deps);
  m.emit([]);
  assert.deepEqual(codes, []);
  m.setList([]);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(codes, [null]);
});

test('watchExit : le démontage coupe la surveillance', async () => {
  const m = make();
  const codes: (number | null)[] = [];
  const stop = watchExit('s1', (c) => codes.push(c), m.deps);
  stop();
  m.setList([{ id: 's1', status: 'exited', exitCode: 0 }]);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(codes, []);
});
