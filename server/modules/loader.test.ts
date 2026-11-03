import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { loadModules, parseModuleDirs, type LoadOptions } from './loader.js';

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

async function setup(dirs: string[], dataDir = tmp()) {
  const app = Fastify();
  const opts: LoadOptions = { dirs, dataDir, coreVersion: '9.9.9', projects: () => [{ id: 'p', name: 'P', dir: '/x', repoDir: null }] };
  const infos = await loadModules(app, opts);
  await app.ready();
  return { app, infos, dataDir };
}

test('parseModuleDirs : séparateur de la plateforme, chemins absolus, vides ignorés', () => {
  assert.deepEqual(parseModuleDirs(undefined), []);
  assert.deepEqual(parseModuleDirs(['/a', '', ' /b '].join(path.delimiter)), ['/a', '/b']);
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
