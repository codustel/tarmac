import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentTurnTracker, CoreEvents, ProcessStatusTracker, TaskStatusTracker, type AgentSnapshot } from './events.js';

const agent = (key: string, state: AgentSnapshot['state']): AgentSnapshot => ({
  agent: 'claude', key, sessionId: 's-' + key, terminalId: null, projectId: 'p', projectName: 'P', title: 'Titre', state,
});

test('CoreEvents : abonnement, données figées, désabonnement, erreur d’un abonné isolée, événement inconnu refusé', () => {
  const warnings: string[] = [];
  const bus = new CoreEvents((m) => warnings.push(m));
  const got: string[] = [];
  bus.on('process:status', () => { throw new Error('boom'); });
  const off = bus.on('process:status', (e) => {
    got.push(e.status);
    assert.throws(() => { (e as any).status = 'x'; });
  });
  assert.equal(bus.count('process:status'), 2);
  bus.emit('process:status', { projectId: 'a', projectName: null, status: 'crashed', previous: 'running', exitCode: 1, at: '' });
  assert.deepEqual(got, ['crashed']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /boom/);
  off();
  bus.emit('process:status', { projectId: 'a', projectName: null, status: 'running', previous: 'crashed', exitCode: null, at: '' });
  assert.deepEqual(got, ['crashed']);
  assert.throws(() => bus.on('nope' as any, () => {}), /unknown event/);
});

test('AgentTurnTracker : première observation, transitions avec durée, état répété ignoré, session disparue oubliée', () => {
  const t = new AgentTurnTracker();
  const first = t.update([agent('a', 'working')], 1000);
  assert.deepEqual(first.map((e) => [e.key, e.state, e.previous, e.previousMs]), [['a', 'working', null, null]]);
  assert.deepEqual(t.update([agent('a', 'working')], 2000), []);
  const perm = t.update([agent('a', 'permission'), agent('b', 'idle')], 5000);
  assert.deepEqual(perm.map((e) => [e.key, e.state, e.previous, e.previousMs]), [['a', 'permission', 'working', 4000], ['b', 'idle', null, null]]);
  assert.equal(perm[0].at, new Date(5000).toISOString());
  // b disparaît puis revient : nouvelle première observation.
  t.update([agent('a', 'permission')], 6000);
  assert.deepEqual(t.update([agent('a', 'idle'), agent('b', 'idle')], 9000).map((e) => [e.key, e.previous, e.previousMs]), [['a', 'permission', 4000], ['b', null, null]]);
});

test('ProcessStatusTracker : seules les transitions sont émises', () => {
  const t = new ProcessStatusTracker();
  assert.equal(t.update('x', 'X', 'starting', null)?.previous, null);
  assert.equal(t.update('x', 'X', 'starting', null), null);
  assert.equal(t.update('x', 'X', 'running', null)?.previous, 'starting');
  const crash = t.update('x', 'X', 'crashed', 1);
  assert.deepEqual([crash?.status, crash?.previous, crash?.exitCode], ['crashed', 'running', 1]);
});

test('TaskStatusTracker : premier relevé = référence, puis transitions et créations', () => {
  const t = new TaskStatusTracker();
  const task = (id: string, s: { done?: boolean; toTest?: boolean } = {}) => ({ id, num: id, title: 'T' + id, done: !!s.done, toTest: !!s.toTest });
  assert.equal(t.has('p'), false);
  assert.deepEqual(t.update('p', 'P', [task('1'), task('2', { toTest: true })]), []);
  assert.equal(t.has('p'), true);
  const ev = t.update('p', 'P', [task('1', { toTest: true }), task('2', { toTest: true }), task('3')]);
  assert.deepEqual(ev.map((e) => [e.taskId, e.status, e.previous]), [['1', 'toTest', 'todo'], ['3', 'todo', null]]);
  assert.deepEqual(t.update('p', 'P', [task('1', { done: true, toTest: true })]).map((e) => [e.taskId, e.status]), [['1', 'done']]);
});

test('TaskStatusTracker : `auto` dans l\'événement ; une bascule de `auto` seule n\'émet rien', () => {
  const t = new TaskStatusTracker();
  const task = (id: string, auto: boolean, toTest = false) => ({ id, num: id, title: 'T' + id, done: false, toTest, auto });
  t.update('p', 'P', [task('1', false)]);
  assert.deepEqual(t.update('p', 'P', [task('1', true)]), []);
  const ev = t.update('p', 'P', [task('1', true, true), task('2', false)]);
  assert.deepEqual(ev.map((e) => [e.taskId, e.status, e.auto]), [['1', 'toTest', true], ['2', 'todo', false]]);
});
