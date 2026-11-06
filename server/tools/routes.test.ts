import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerToolRoutes, type ToolRoutesDeps } from './routes.js';
import { invalidateToolStatus, type Exec } from './status.js';

function build(over: Partial<ToolRoutesDeps> = {}, replies: Record<string, string> = {}) {
  const launched: any[] = [];
  const afterCalls: string[] = [];
  const execCalls: string[] = [];
  const exitListeners: ((sid: string) => void)[] = [];
  const exec: Exec = async (file, args) => {
    const key = [file, ...args].join(' ');
    execCalls.push(key);
    return key in replies ? { stdout: replies[key], code: 0 } : { stdout: '', code: 1 };
  };
  const app = Fastify();
  registerToolRoutes(app, {
    status: { exec, env: {}, home: '/h', platform: 'darwin', dockerEngine: async () => ({ status: 'absent' }) },
    platform: 'darwin',
    isDemo: () => false,
    launch: async (spec) => { launched.push(spec); return { id: `t${launched.length}`, label: spec.label }; },
    onSessionExit: (fn) => { exitListeners.push(fn); },
    after: { runScript: async () => '', codexPlan: async () => '', setAgents: () => {}, invalidateGithub: () => { afterCalls.push('gh'); } },
    msg: (k) => k,
    ...over,
  });
  const exit = (sid: string) => exitListeners.forEach((fn) => fn(sid));
  return { app, launched, afterCalls, execCalls, exit };
}

test('GET /api/tools : six outils dans l\'ordre', async () => {
  invalidateToolStatus();
  const { app } = build();
  const r = await app.inject({ url: '/api/tools' });
  assert.deepEqual(r.json().map((s: any) => s.id), ['git', 'gh', 'claude', 'codex', 'docker', 'supabase']);
  invalidateToolStatus();
});

test('install : console système avec la commande ; 400 sans action ; 400 en démo', async () => {
  invalidateToolStatus();
  const { app, launched } = build();
  const ok = await app.inject({ method: 'POST', url: '/api/tools/codex/install', payload: { cols: 90, rows: 20 } });
  assert.equal(ok.statusCode, 200);
  assert.equal(launched[0].command, 'curl -fsSL https://chatgpt.com/codex/install.sh | sh');
  assert.equal(launched[0].cols, 90);
  assert.equal((await app.inject({ method: 'POST', url: '/api/tools/docker/install', payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/tools/nope/install', payload: {} })).statusCode, 400);
  const demo = build({ isDemo: () => true });
  const d = await demo.app.inject({ method: 'POST', url: '/api/tools/codex/install', payload: {} });
  assert.equal(d.statusCode, 400);
  assert.equal(d.json().error, 'api.demoMode');
  invalidateToolStatus();
});

test('/api/github/cli/login est l\'alias de /api/tools/gh/login', async () => {
  invalidateToolStatus();
  const { app, launched } = build({}, { 'which -a gh': '/opt/homebrew/bin/gh\n', '/opt/homebrew/bin/gh --version': 'gh version 2.60.0' });
  const r = await app.inject({ method: 'POST', url: '/api/github/cli/login', payload: {} });
  assert.equal(r.statusCode, 200);
  assert.equal(launched[0].command, 'gh auth login --hostname github.com --git-protocol https --web');
  invalidateToolStatus();
});

test('after-install : gh invalide le cache GitHub ; outil non géré refusé', async () => {
  const { app, afterCalls } = build();
  const gh = await app.inject({ method: 'POST', url: '/api/tools/gh/after-install' });
  assert.equal(gh.statusCode, 200);
  assert.deepEqual(gh.json(), { ok: true, integration: null });
  assert.deepEqual(afterCalls, ['gh']);
  assert.equal((await app.inject({ method: 'POST', url: '/api/tools/docker/after-install' })).statusCode, 400);
});

test('fin d\'une console lancée par /api/tools : statut de l\'outil relu (I4)', async () => {
  invalidateToolStatus();
  const replies: Record<string, string> = { 'which -a gh': '/opt/homebrew/bin/gh\n', '/opt/homebrew/bin/gh --version': 'gh version 2.60.0' };
  const { app, exit } = build({}, replies);
  const ghState = async () => (await app.inject({ url: '/api/tools' })).json().find((x: any) => x.id === 'gh').state;
  const login = await app.inject({ method: 'POST', url: '/api/tools/gh/login', payload: {} });
  assert.equal(login.json().id, 't1');
  assert.equal(await ghState(), 'logged-out', 'relevé pendant la console : mis en cache');
  replies['gh auth status'] = 'Logged in to github.com account octo';
  assert.equal(await ghState(), 'logged-out', 'cache de 30 s');
  exit('t-autre');
  assert.equal(await ghState(), 'logged-out', 'console étrangère : cache gardé');
  exit('t1');
  assert.equal(await ghState(), 'ready', 'fin de la console : cache invalidé');
  invalidateToolStatus();
});

test('mode démo : GET /api/tools renvoie tout prêt sans lancer de commande (I6)', async () => {
  invalidateToolStatus();
  const { app, execCalls } = build({ isDemo: () => true });
  const list = (await app.inject({ url: '/api/tools' })).json();
  assert.deepEqual(list.map((s: any) => s.id), ['git', 'gh', 'claude', 'codex', 'docker', 'supabase']);
  assert.ok(list.every((s: any) => s.state === 'ready' && !s.updatable), JSON.stringify(list));
  assert.ok(list.filter((s: any) => s.managed).every((s: any) => s.method !== null), 'pas de « installé hors Tarmac » en démo');
  assert.deepEqual(execCalls, []);
  assert.equal((await app.inject({ url: '/api/tools?fresh=1' })).json().length, 6);
  assert.deepEqual(execCalls, []);
});

test('after-install claude : intégration annoncée avec la sortie des scripts (I2)', async () => {
  const { app } = build({ after: { runScript: async (s) => `${s} ok`, codexPlan: async () => '', setAgents: () => {}, invalidateGithub: () => {} } });
  const r = await app.inject({ method: 'POST', url: '/api/tools/claude/after-install' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true, integration: { ok: true, output: 'scripts/mcp-install.sh ok\nscripts/suivi-install.sh ok' } });
});

test('after-install codex en échec : erreur et sortie renvoyées, agent non coché (I2)', async () => {
  const agents: unknown[] = [];
  const { app } = build({ after: {
    runScript: async () => '',
    codexPlan: async () => { throw Object.assign(new Error('config.toml illisible'), { output: '▸ Set up the Codex integration' }); },
    setAgents: (a) => { agents.push(a); },
    invalidateGithub: () => {},
  } });
  const r = await app.inject({ method: 'POST', url: '/api/tools/codex/after-install' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: false, integration: { ok: false, output: '▸ Set up the Codex integration', error: 'config.toml illisible' } });
  assert.deepEqual(agents, []);
});
