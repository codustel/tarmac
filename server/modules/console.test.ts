import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { makeLaunchConsole } from './console.js';

test('launchConsole : lance dans la console système (HOME), avec env et unsetEnv', async () => {
  const calls: any[] = [];
  const create = async (target: any, spec: any) => { calls.push({ target, spec }); return { id: 'abc' }; };
  const launch = makeLaunchConsole({ isDemo: () => false, create: create as any, demoMessage: () => 'demo' });
  const res = await launch({ command: 'echo hi', label: 'Test', env: { FOO: 'bar' }, unsetEnv: ['X'], cols: 80, rows: 20 });
  assert.deepEqual(res, { id: 'abc' });
  assert.equal(calls[0].target.id, '__system__');
  assert.equal(calls[0].target.dir, os.homedir());
  assert.deepEqual(calls[0].target.env, { FOO: 'bar' });
  assert.deepEqual(calls[0].target.pathPrepend, []);
  assert.equal(calls[0].spec.command, 'echo hi');
  assert.equal(calls[0].spec.label, 'Test');
  assert.deepEqual(calls[0].spec.unsetEnv, ['X']);
  assert.equal(calls[0].spec.cols, 80);
});

test('launchConsole : env absent → env vide ; refusé en mode démo', async () => {
  let n = 0;
  const create = async (target: any) => { n++; assert.deepEqual(target.env, {}); return { id: 'x' }; };
  await makeLaunchConsole({ isDemo: () => false, create: create as any, demoMessage: () => 'd' })({ command: 'a', label: 'b' });
  await assert.rejects(makeLaunchConsole({ isDemo: () => true, create: create as any, demoMessage: () => 'Indisponible en mode démo' })({ command: 'a', label: 'b' }), /Indisponible en mode démo/);
  assert.equal(n, 1);
});

test('launchConsole : commande ou libellé vide refusés', async () => {
  const launch = makeLaunchConsole({ isDemo: () => false, create: (async () => ({ id: 'x' })) as any, demoMessage: () => 'd' });
  await assert.rejects(launch({ command: '', label: 'b' }), /command/);
  await assert.rejects(launch({ command: 'a', label: '' }), /label/);
});
