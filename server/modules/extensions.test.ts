import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoreExtensions, type ExtensionDeps } from './extensions.js';
import { sanitizeTask, type SuiviProject } from '../suivi/types.js';
import type { ClaudeUsage } from '../claudeUsage.js';
import type { CodexUsage } from '../codex.js';

const project = (id: string): SuiviProject => ({ projectId: id, name: id.split('/')[1], brand: '', title: '', subtitle: '', artifactUrl: null, theme: {} as any, paths: [], copyFile: 'suivi.json', createdAt: '', updatedAt: '' });
const T = (id: string, order: number, over: object = {}) => sanitizeTask({ id, order, num: `1.${order}`, title: `T${id}`, ...over });
const okUsage = (limits: ClaudeUsage['limits'] = [{ id: 'session', kind: 'session', label: null, utilization: 42, resetsAt: '2026-11-12T20:00:00.000Z' }]): ClaudeUsage => ({ status: 'ok', plan: 'Max 5x', limits, fetchedAt: '2026-11-12T10:00:00Z' });

function deps(over: Partial<ExtensionDeps> = {}) {
  const calls: unknown[][] = [];
  const d: ExtensionDeps = {
    projects: () => [project('acme/shop'), project('acme/blog')],
    tasks: () => [T('b', 2, { toTest: true, auto: true }), T('a', 1, { auto: true }), T('c', 3, { done: true, archived: true })],
    appProjectId: (p) => (p.projectId === 'acme/shop' ? 'shop-app' : null),
    dispatch: async (...a) => { calls.push(a); return { ok: true, target: 'new', terminalId: 'term-1', session: 'x', prompt: 'p', task: T('a', 1) } as any; },
    sessionIdOf: (id) => (id === 'term-1' ? 'sess-9' : null),
    claudeUsage: async () => okUsage(),
    codexUsage: () => null,
    terminals: () => [],
    ...over,
  };
  return { core: buildCoreExtensions(d), calls };
}

test('suivi.projects : projet rattaché ou null', () => {
  const { core } = deps();
  assert.deepEqual(core.suivi.projects(), [
    { suiviProjectId: 'acme/shop', name: 'shop', appProjectId: 'shop-app' },
    { suiviProjectId: 'acme/blog', name: 'blog', appProjectId: null },
  ]);
});

test('suivi.tasks : statut, auto, archivée, trié par ordre', () => {
  const { core } = deps();
  assert.deepEqual(core.suivi.tasks('acme/shop'), [
    { id: 'a', num: '1.1', title: 'Ta', order: 1, status: 'todo', auto: true, archived: false },
    { id: 'b', num: '1.2', title: 'Tb', order: 2, status: 'toTest', auto: true, archived: false },
    { id: 'c', num: '1.3', title: 'Tc', order: 3, status: 'done', auto: false, archived: true },
  ]);
});

test('dispatch : nouvelle session, suffixe autopilote, agent claude par défaut, sessionId relu', async () => {
  const { core, calls } = deps();
  assert.deepEqual(await core.dispatch('acme/shop', 'a'), { terminalId: 'term-1', sessionId: 'sess-9' });
  assert.deepEqual(calls[0], ['acme/shop', 'a', 'new', 'claude', { autopilot: true }]);
  await core.dispatch('acme/shop', 'a', { agent: 'codex' });
  assert.equal(calls[1][3], 'codex');
  await core.dispatch('acme/shop', 'a', { agent: 'nimporte' as any });
  assert.equal(calls[2][3], 'claude');
});

test('dispatch : l\'erreur du cœur remonte, sessionId null si inconnu', async () => {
  const { core } = deps({ dispatch: async () => { throw new Error('Cette tâche est déjà traitée'); } });
  await assert.rejects(core.dispatch('acme/shop', 'b'), /déjà traitée/);
  const r = deps({ sessionIdOf: () => null });
  assert.equal((await r.core.dispatch('acme/shop', 'a')).sessionId, null);
});

test('usage : fenêtre de 5 h Claude et Codex, plan sans fenêtre, usage illisible', async () => {
  const codex: CodexUsage = { status: 'ok', plan: 'Plus', fetchedAt: '', limits: [{ id: 'primary', kind: 'session', label: null, utilization: 12, resetsAt: '2026-11-12T19:00:00.000Z' }, { id: 'secondary', kind: 'week', label: null, utilization: 80, resetsAt: null }] };
  assert.deepEqual(await deps({ codexUsage: () => codex }).core.usage(), {
    claude: { status: 'ok', session: { utilization: 42, resetsAt: '2026-11-12T20:00:00.000Z' } },
    codex: { status: 'ok', session: { utilization: 12, resetsAt: '2026-11-12T19:00:00.000Z' } },
  });
  assert.deepEqual((await deps({ claudeUsage: async () => okUsage([{ id: 'week', kind: 'week', label: null, utilization: 5, resetsAt: null }]) }).core.usage()).claude, { status: 'ok', session: null });
  assert.deepEqual((await deps({ claudeUsage: async () => ({ ...okUsage(), status: 'expired' }) }).core.usage()).claude, { status: 'expired', session: null });
  assert.equal((await deps({ codexUsage: () => ({ status: 'disabled', plan: null, limits: [], fetchedAt: null }) }).core.usage()).codex, null);
  assert.deepEqual((await deps({ codexUsage: () => ({ status: 'none', plan: null, limits: [], fetchedAt: null }) }).core.usage()).codex, { status: 'none', session: null });
});

test('usage : aucun jeton, en-tête ni champ inconnu dans le retour, même si la source en porte', async () => {
  const leaky = { ...okUsage(), accessToken: 'sk-ant-oat01-SECRET', headers: { authorization: 'Bearer SECRET' }, limits: [{ id: 'session', kind: 'session', label: null, utilization: 1, resetsAt: null, token: 'SECRET' }] } as any;
  const out = JSON.stringify(await deps({ claudeUsage: async () => leaky, codexUsage: () => ({ ...leaky, status: 'ok' }) }).core.usage());
  assert.ok(!/SECRET|sk-ant|authorization|Bearer/i.test(out), out);
});

test('terminals : seulement id, projet, statut, code de sortie', () => {
  const { core } = deps({ terminals: () => [{ id: 't1', projectId: 'p', status: 'exited', exitCode: 3, command: 'secret --token x', pid: 1 } as any] });
  assert.deepEqual(core.terminals(), [{ id: 't1', projectId: 'p', status: 'exited', exitCode: 3 }]);
});
