import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireTool, ToolMissingError, type GateDeps } from './gate.js';
import { invalidateToolStatus, type Exec } from './status.js';

const msg: GateDeps['msg'] = (key, p) => `${key}:${p.tool}`;
function gate(replies: Record<string, { stdout?: string; code?: number } | 'throw'>): GateDeps {
  const exec: Exec = async (file, args) => {
    const r = replies[[file, ...args].join(' ')];
    if (r === 'throw') throw new Error('boom');
    return r ? { stdout: r.stdout ?? '', code: r.code ?? 0 } : { stdout: '', code: 1 };
  };
  return { exec, env: {}, home: '/h', platform: 'darwin', msg };
}
const rejection = async (p: Promise<void>) => p.then(() => null, (e) => e as ToolMissingError);

test('codex absent : 424, state absent, moyen d\'installation', async () => {
  invalidateToolStatus();
  const e = await rejection(requireTool('codex', gate({ 'which -a brew': { stdout: '/opt/homebrew/bin/brew' } })));
  assert.ok(e instanceof ToolMissingError);
  assert.equal(e.statusCode, 424);
  assert.equal(e.tool, 'codex');
  assert.equal(e.state, 'absent');
  assert.equal(e.installMethod, 'brew');
  assert.equal(e.message, 'api.toolAbsent:Codex');
});

test('codex non connecté : 424, state logged-out', async () => {
  invalidateToolStatus();
  const e = await rejection(requireTool('codex', gate({
    'which -a codex': { stdout: '/usr/local/bin/codex' },
    'codex login status': { stdout: 'Not logged in', code: 1 },
  })));
  assert.equal(e?.statusCode, 424);
  assert.equal(e?.state, 'logged-out');
  assert.equal(e?.message, 'api.toolLoggedOut:Codex');
});

test('codex prêt : résout', async () => {
  invalidateToolStatus();
  await requireTool('codex', gate({ 'which -a codex': { stdout: '/usr/local/bin/codex' }, 'codex login status': { code: 0 } }));
});

test('état inconnu : laisse passer', async () => {
  invalidateToolStatus();
  await requireTool('claude', gate({ 'which -a claude': { stdout: '/usr/local/bin/claude' }, 'claude auth status': 'throw' }));
});

test('git absent sans aucun moyen d\'installation (Windows sans winget) : 424, installMethod null, page officielle (T5, I7)', async () => {
  invalidateToolStatus();
  const deps = { ...gate({}), platform: 'win32' as const };
  const e = await rejection(requireTool('git', deps));
  assert.ok(e instanceof ToolMissingError);
  assert.equal(e.state, 'absent');
  assert.equal(e.installMethod, null);
  assert.deepEqual(e.body(), { error: 'api.toolAbsent:Git', tool: 'git', state: 'absent', installMethod: null, docUrl: 'https://git-scm.com/downloads' });
  invalidateToolStatus();
});
