import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { loadModules, parseModuleDirs, type LoadOptions } from './loader.js';
import { NO_EXTENSIONS } from './extensions.js';
import { CoreEvents } from './events.js';
import { SessionBadges } from './badges.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-modules-'));

/** Écrit un module de test : `package.json` (champ `tarmac`) et ses fichiers. */
function makeModule(root: string, name: string, tarmac: object, files: Record<string, string> = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.2.3', type: 'module', tarmac }));
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

const SERVER = `
export async function register(ctx) {
  const db = ctx.openDb(['CREATE TABLE hits (n INTEGER)', 'ALTER TABLE hits ADD COLUMN at TEXT']);
  ctx.app.get('/hello', async () => {
    db.prepare('INSERT INTO hits (n, at) VALUES (1, ?)').run('now');
    const settings = ctx.settings.set({ count: (ctx.settings.get().count ?? 0) + 1 });
    return { id: ctx.id, version: ctx.core.version, projects: ctx.core.projects().length, hits: db.prepare('SELECT COUNT(*) AS c FROM hits').get().c, settings };
  });
}`;

async function setup(dirs: string[], dataDir = tmp(), extra: Partial<LoadOptions> = {}) {
  const app = Fastify();
  const opts: LoadOptions = { dirs, dataDir, coreVersion: '9.9.9', projects: () => [{ id: 'p', name: 'P', dir: '/x', repoDir: null }], ...extra };
  const infos = await loadModules(app, opts);
  await app.ready();
  return { app, infos, dataDir };
}

test('parseModuleDirs : séparateur de la plateforme, chemins absolus, vides ignorés', () => {
  assert.deepEqual(parseModuleDirs(undefined), []);
  assert.deepEqual(parseModuleDirs(['/a', '', ' /b '].join(path.delimiter)), [path.resolve('/a'), path.resolve('/b')]);
  assert.equal(path.isAbsolute(parseModuleDirs('rel')[0]), true);
});

test('module chargé : routes préfixées, base migrée, réglages, projets du cœur, vue web servie', async () => {
  const root = tmp();
  const dir = makeModule(root, 'hello', { apiVersion: 1, id: 'hello', name: { en: 'Hello', fr: 'Bonjour' }, icon: '<svg/>', server: 'server.js', web: 'web/index.js' }, {
    'server.js': SERVER,
    'web/index.js': 'export function mount(el) { el.textContent = "hi"; }',
  });
  const { app, infos, dataDir } = await setup([dir]);
  assert.equal(infos[0].status, 'loaded', infos[0].error ?? '');

  const r1 = await app.inject('/api/modules/hello/hello');
  assert.deepEqual(r1.json(), { id: 'hello', version: '9.9.9', projects: 1, hits: 1, settings: { count: 1 } });
  const r2 = await app.inject('/api/modules/hello/hello');
  assert.equal(r2.json().settings.count, 2);
  assert.equal(fs.existsSync(path.join(dataDir, 'modules/hello/data.db')), true);

  const list = (await app.inject('/api/modules')).json();
  assert.deepEqual(list.map((m: any) => [m.id, m.version, m.status, m.webUrl, m.icon]), [['hello', '1.2.3', 'loaded', '/modules/hello/index.js', '<svg/>']]);
  const web = await app.inject('/modules/hello/index.js');
  assert.equal(web.statusCode, 200);
  assert.match(web.body, /export function mount/);
  // Seul le dossier de la vue web est servi, pas le reste du module.
  assert.equal((await app.inject('/modules/hello/../server.js')).statusCode, 404);
  await app.close();
});

test('apiVersion inconnue : module ignoré, le cœur démarre', async () => {
  const dir = makeModule(tmp(), 'future', { apiVersion: 2, id: 'future', name: 'Future', server: 'server.js' }, { 'server.js': SERVER });
  const { app, infos } = await setup([dir]);
  assert.equal(infos[0].status, 'ignored');
  assert.match(infos[0].error!, /apiVersion 2/);
  assert.equal((await app.inject('/api/modules/future/hello')).statusCode, 404);
  await app.close();
});

test('register en erreur : statut error, routes déjà déclarées en 503', async () => {
  const dir = makeModule(tmp(), 'broken', { apiVersion: 1, id: 'broken', name: 'Broken', server: 'server.js' }, {
    'server.js': `export function register(ctx) { ctx.app.get('/x', async () => 'ok'); throw new Error('boom'); }`,
  });
  const { app, infos } = await setup([dir]);
  assert.equal(infos[0].status, 'error');
  assert.equal(infos[0].error, 'boom');
  assert.equal((await app.inject('/api/modules/broken/x')).statusCode, 503);
  await app.close();
});

test('manifeste invalide : chemin hors du module, id invalide, id en double, dossier sans package.json', async () => {
  const root = tmp();
  const escape = makeModule(root, 'escape', { apiVersion: 1, id: 'escape', name: 'E', server: '../other/server.js' });
  const badId = makeModule(root, 'bad', { apiVersion: 1, id: 'Bad_Id', name: 'B' });
  const first = makeModule(root, 'one', { apiVersion: 1, id: 'same', name: 'One' });
  const second = makeModule(root, 'two', { apiVersion: 1, id: 'same', name: 'Two' });
  const { app, infos } = await setup([escape, badId, first, second, path.join(root, 'missing')]);
  assert.deepEqual(infos.map((i) => i.status), ['error', 'error', 'loaded', 'error', 'error']);
  assert.match(infos[0].error!, /inside the module folder/);
  assert.match(infos[1].error!, /invalid id/);
  assert.match(infos[3].error!, /duplicate id/);
  assert.match(infos[4].error!, /ENOENT/);
  await app.close();
});

test('module d’exemple (examples/hello-module) : chargé, routes et réglages', async () => {
  const dir = path.resolve(import.meta.dirname, '../../examples/hello-module');
  const { app, infos } = await setup([dir]);
  assert.equal(infos[0].status, 'loaded', infos[0].error ?? '');
  assert.equal(infos[0].webUrl, '/modules/hello/index.js');
  const s = (await app.inject('/api/modules/hello/summary')).json();
  assert.deepEqual(s, { visits: 1, projects: 1, coreVersion: '9.9.9', greeting: null });
  const g = await app.inject({ method: 'POST', url: '/api/modules/hello/greeting', payload: { greeting: 'Salut' } });
  assert.deepEqual(g.json(), { greeting: 'Salut' });
  assert.equal((await app.inject('/api/modules/hello/summary')).json().greeting, 'Salut');
  await app.close();
});

test('core.on et core.lang : événements relayés, erreur d’un abonné attribuée au module, abonnements retirés si register échoue', async () => {
  const root = tmp();
  const listener = makeModule(root, 'listener', { apiVersion: 1, id: 'listener', name: 'L', server: 'server.js' }, {
    'server.js': `
      const seen = [];
      export function register(ctx) {
        const off = ctx.core.on('agent:turn', (e) => seen.push(e.state));
        ctx.core.on('process:status', () => { throw new Error('listener boom'); });
        ctx.app.get('/seen', async () => ({ seen, lang: ctx.core.lang() }));
        ctx.app.post('/off', async () => { off(); return { ok: true }; });
        let unknown = null;
        try { ctx.core.on('nope', () => {}); } catch (e) { unknown = e.message; }
        ctx.app.get('/unknown', async () => ({ unknown }));
      }`,
  });
  const failing = makeModule(root, 'failing', { apiVersion: 1, id: 'failing', name: 'F', server: 'server.js' }, {
    'server.js': `export function register(ctx) { ctx.core.on('agent:turn', () => { throw new Error('never'); }); throw new Error('register failed'); }`,
  });
  const events = new CoreEvents();
  const { app, infos } = await setup([listener, failing], tmp(), { events, lang: () => 'fr' });
  assert.deepEqual(infos.map((i) => i.status), ['loaded', 'error']);
  assert.equal(events.count('agent:turn'), 1); // celui du module en erreur est retiré

  const turn = { agent: 'claude', key: 'claude:1', sessionId: null, terminalId: null, projectId: null, projectName: null, title: null, previous: null, previousMs: null, at: '' } as const;
  events.emit('agent:turn', { ...turn, state: 'working' });
  events.emit('process:status', { projectId: 'p', projectName: null, status: 'crashed', previous: 'running', exitCode: 1, at: '' });
  events.emit('agent:turn', { ...turn, state: 'idle' });
  assert.deepEqual((await app.inject('/api/modules/listener/seen')).json(), { seen: ['working', 'idle'], lang: 'fr' });
  assert.match((await app.inject('/api/modules/listener/unknown')).json().unknown, /unknown event/);

  await app.inject({ method: 'POST', url: '/api/modules/listener/off' });
  assert.equal(events.count('agent:turn'), 0);
  events.emit('agent:turn', { ...turn, state: 'permission' });
  assert.deepEqual((await app.inject('/api/modules/listener/seen')).json().seen, ['working', 'idle']);
  await app.close();
});

test('ctx.core.launchConsole : transmis à l\'option du cœur ; refus sans option', async () => {
  const root = tmp();
  const dir = makeModule(root, 'con', { apiVersion: 1, id: 'con', name: 'Con', server: 'server.js' }, {
    'server.js': `export function register(ctx) {
      ctx.app.get('/go', async () => ({ s: await ctx.core.launchConsole({ command: 'x', label: 'L', env: { A: '1' } }) }));
    }`,
  });
  const calls: any[] = [];
  const { app } = await setup([dir], tmp(), { launchConsole: async (spec) => { calls.push(spec); return { id: 's1', label: 'L', status: 'running', exitCode: null }; } });
  assert.equal((await app.inject('/api/modules/con/go')).json().s.id, 's1');
  assert.deepEqual(calls[0].env, { A: '1' });
  const bare = await setup([dir]);
  assert.equal((await bare.app.inject('/api/modules/con/go')).statusCode, 500);
});

test('core.suivi, dispatch, usage, terminals : fournis par le cœur ; valeurs inertes par défaut', async () => {
  const root = tmp();
  const m = makeModule(root, 'ext', { apiVersion: 1, id: 'ext', name: 'E', server: 'server.js' }, {
    'server.js': `
      export function register(ctx) {
        ctx.app.get('/x', async () => {
          let refused = null;
          try { await ctx.core.dispatch('p', 't'); } catch (e) { refused = e.message; }
          return { projects: ctx.core.suivi.projects(), tasks: ctx.core.suivi.tasks('p'), usage: await ctx.core.usage(), terminals: ctx.core.terminals(), refused };
        });
      }`,
  });
  const inert = await setup([m]);
  const a = (await inert.app.inject('/api/modules/ext/x')).json();
  assert.deepEqual([a.projects, a.tasks, a.terminals], [[], [], []]);
  assert.equal(a.usage.claude.status, 'error');
  assert.match(a.refused, /not available/);
  await inert.app.close();

  const { ownedPids, agents, sessionTitle, isDemo } = NO_EXTENSIONS;
  const NO_EXTENSIONS_REST = { ownedPids, agents, sessionTitle, isDemo };
  const extensions = {
    suivi: { projects: () => [{ suiviProjectId: 'p', name: 'P', appProjectId: 'ap' }], tasks: () => [] },
    dispatch: async () => ({ terminalId: 'term', sessionId: null }),
    usage: async () => ({ claude: { status: 'ok' as const, session: { utilization: 7, resetsAt: null } }, codex: null }),
    terminals: () => [{ id: 'term', projectId: 'ap', status: 'running' as const, exitCode: null }],
    ...NO_EXTENSIONS_REST,
  };
  const real = await setup([m], tmp(), { extensions });
  const b = (await real.app.inject('/api/modules/ext/x')).json();
  assert.equal(b.projects[0].appProjectId, 'ap');
  assert.equal(b.usage.claude.session.utilization, 7);
  assert.equal(b.terminals[0].id, 'term');
  assert.equal(b.refused, null);
  await real.app.close();
});

test('core.sessionBadges : fournisseur du module relayé, retiré si register échoue ou après désabonnement', async () => {
  const root = tmp();
  const good = makeModule(root, 'good', { apiVersion: 1, id: 'good', name: 'G', server: 'server.js' }, {
    'server.js': `export function register(ctx) {
      const off = ctx.core.sessionBadges((sessions) => ({ [sessions[0].id]: [{ label: ctx.core.lang() }] }));
      ctx.app.post('/off', async () => { off(); return { ok: true }; });
    }`,
  });
  const failing = makeModule(root, 'failing', { apiVersion: 1, id: 'failing', name: 'F', server: 'server.js' }, {
    'server.js': `export function register(ctx) { ctx.core.sessionBadges(() => ({ s1: [{ label: 'never' }] })); throw new Error('register failed'); }`,
  });
  const badges = new SessionBadges({ warn: () => {} });
  const { app } = await setup([good, failing], tmp(), { badges, lang: () => 'fr' });
  assert.equal(badges.size, 1);
  assert.deepEqual(await badges.collect([{ id: 's1' }]), { s1: [{ label: 'fr' }] });
  await app.inject({ method: 'POST', url: '/api/modules/good/off' });
  assert.equal(badges.size, 0);
  await app.close();
});
