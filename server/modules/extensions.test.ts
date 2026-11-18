import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allAgentProcs, buildCoreExtensions, NO_EXTENSIONS, type ExtensionDeps } from './extensions.js';
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
    tarmacPid: 100,
    bootId: 'ab12cd34',
    projectPids: () => [],
    projectDirOf: () => null,
    agents: async () => [],
    sessionTitle: async () => null,
    isDemo: () => false,
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

test('ownedPids : pid de Tarmac, bootId, pids des projets et consoles mappées', () => {
  const { core } = deps({
    projectPids: () => [11, 12],
    projectDirOf: (id) => (id === 'p1' ? '/work/p1' : null),
    terminals: () => [
      { id: 't1', projectId: 'p1', status: 'running', exitCode: null, kind: 'claude', pid: 50, claudeSessionId: 'cs1', codexSessionId: null },
      { id: 't2', projectId: 'p1', status: 'exited', exitCode: 0, kind: 'codex', pid: null, claudeSessionId: null, codexSessionId: 'xs1' },
      { id: 't3', projectId: '__system__', status: 'running', exitCode: null, kind: 'shell', pid: 51, claudeSessionId: null, codexSessionId: null },
    ],
  });
  assert.deepEqual(core.ownedPids(), {
    tarmacPid: 100, bootId: 'ab12cd34', projectPids: [11, 12],
    terminals: [
      { id: 't1', shellPid: 50, status: 'running', agent: 'claude', sessionId: 'cs1', projectDir: '/work/p1' },
      { id: 't2', shellPid: null, status: 'exited', agent: 'codex', sessionId: 'xs1', projectDir: '/work/p1' },
      { id: 't3', shellPid: 51, status: 'running', agent: null, sessionId: null, projectDir: '' },
    ],
  });
});

test('agents : statut busy→working, idle→idle, statusSince = updatedAt du fichier pid', async () => {
  const { core } = deps({
    agents: async () => [
      { agent: 'claude', pid: 7, startedAt: 's', cwd: '/a', pidFile: { sessionId: 'sx', status: 'busy', updatedAt: 'u' } },
      { agent: 'codex', pid: 8, startedAt: 's2', cwd: null, pidFile: null },
    ],
  });
  assert.deepEqual(await core.agents(), [
    { agent: 'claude', pid: 7, startedAt: 's', cwd: '/a', sessionId: 'sx', status: 'working', statusSince: 'u' },
    { agent: 'codex', pid: 8, startedAt: 's2', cwd: null, sessionId: null, status: null, statusSince: null },
  ]);
});

test('agents : sessionId rattaché d\'un agent Codex (sans fichier pid) est repris', async () => {
  const { core } = deps({
    agents: async () => [{ agent: 'codex', pid: 8, startedAt: 's2', cwd: '/c', sessionId: 'T1', pidFile: null }],
  });
  assert.equal((await core.agents())[0].sessionId, 'T1');
});

test('NO_EXTENSIONS : valeurs vides', async () => {
  assert.deepEqual(NO_EXTENSIONS.ownedPids().projectPids, []);
  assert.equal(await NO_EXTENSIONS.sessionTitle('claude', 'x'), null);
  assert.deepEqual(await NO_EXTENSIONS.agents(), []);
  assert.equal(NO_EXTENSIONS.isDemo(), false);
});

test('allAgentProcs : Claude et Codex toujours lus, quels que soient les réglages', async () => {
  assert.deepEqual(await allAgentProcs(async () => [{ pid: 1 }], async () => [{ pid: 2 }]), [{ pid: 1 }, { pid: 2 }]);
});

test('allAgentProcs : rejette si un des deux scans échoue', async () => {
  await assert.rejects(allAgentProcs(async () => { throw new Error('ps timeout'); }, async () => [{ pid: 2 }]), /ps timeout/);
  await assert.rejects(allAgentProcs(async () => [{ pid: 1 }], async () => { throw new Error('ps timeout'); }), /ps timeout/);
});
