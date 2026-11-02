import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demo, demoAndroid, demoBinDir, demoDate, demoDir, demoEditors, demoGithubRepos, demoSupabase, isDemo, type DemoFixtures } from './index.js';

const fixtures: DemoFixtures = {
  machine: 'MacBook Pro',
  hostname: 'macbook-pro',
  ips: [{ iface: 'en0', address: '192.168.1.24' }],
  github: {
    login: 'orbit-dev',
    repos: [
      { name: 'storefront', owner: 'orbit-labs', language: 'TypeScript', pushedAt: '-2h' },
      { name: 'old-site', owner: 'orbit-labs', archived: true, pushedAt: '2025-01-10T10:00:00.000Z' },
    ],
  },
  ghCli: { installed: true, loggedIn: true, user: 'orbit-dev' },
  supabase: {
    instances: [
      {
        projectId: 'mission-control',
        status: 'running',
        ports: { api: 54321, db: 54322, studio: 54323, mail: 54324 },
        services: [
          { name: 'studio', state: 'running', status: 'Up 2 hours', image: 'supabase/studio' },
          { name: 'db', state: 'running', status: 'Up 2 hours (healthy)', image: 'supabase/postgres' },
        ],
      },
      { projectId: 'orbit-insights', status: 'stopped', ports: { api: 55321, db: 55322, studio: 55323, mail: 55324 }, services: [{ name: 'db', state: 'exited', status: 'Exited (0) 3 days ago', image: 'supabase/postgres' }] },
    ],
  },
  android: { sdk: '~/Library/Android/sdk', checks: [{ id: 'jdk', label: 'JDK 17', ok: true, detail: 'Temurin 17' }], avds: [{ name: 'Pixel_8_API_35', device: 'pixel_8', api: '35', image: 'Google Play', state: 'ready', serial: 'emulator-5554' }] },
  editors: [{ editor: 'vscode', editorLabel: 'VS Code', path: '~/Developer/nebula-store' }],
  claudeActiveCwds: ['~/Developer/nebula-store'],
  claudeCommand: 'bin/claude',
};

function withFixtures(fn: (dir: string, env: NodeJS.ProcessEnv) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-demo-'));
  fs.writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify(fixtures));
  try { fn(dir, { TARMAC_DEMO_FIXTURES: dir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('hors mode démo : aucune fixture, aucun changement', () => {
  assert.equal(demoDir({}), null);
  assert.equal(isDemo({}), false);
  assert.equal(demo({}), null);
  assert.equal(demo({ TARMAC_DEMO_FIXTURES: '  ' }), null);
});

test('mode démo demandé sans fichier : erreur explicite (jamais de repli sur les données réelles)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-demo-empty-'));
  try { assert.throws(() => demo({ TARMAC_DEMO_FIXTURES: dir })); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mode démo : fixtures lues depuis TARMAC_DEMO_FIXTURES', () => withFixtures((dir, env) => {
  assert.equal(demoDir(env), dir);
  assert.equal(isDemo(env), true);
  assert.equal(demo(env)?.machine, 'MacBook Pro');
}));

test('dates relatives', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');
  assert.equal(demoDate('-2h', now), '2026-01-10T10:00:00.000Z');
  assert.equal(demoDate('-1d', now), '2026-01-09T12:00:00.000Z');
  assert.equal(demoDate('-30m', now), '2026-01-10T11:30:00.000Z');
  assert.equal(demoDate('2025-01-10T10:00:00.000Z', now), '2025-01-10T10:00:00.000Z');
});

test('GitHub : dépôts au format de listGithubRepos, triés par dernier push', () => {
  const repos = demoGithubRepos(fixtures);
  assert.deepEqual(repos.map((r) => r.fullName), ['orbit-labs/storefront', 'orbit-labs/old-site']);
  assert.equal(repos[0].key, 'github.com/orbit-labs/storefront');
  assert.equal(repos[0].sshUrl, 'git@github.com:orbit-labs/storefront.git');
  assert.equal(repos[0].defaultBranch, 'main');
  assert.equal(repos[1].archived, true);
});

test('Supabase : instances au format de listSupabase', () => {
  const sb = demoSupabase(fixtures);
  assert.equal(sb.docker, 'ok');
  const [up, down] = sb.instances;
  assert.equal(up.running, 2);
  assert.equal(up.urls.studio, 'http://127.0.0.1:54323');
  assert.equal(up.dbUrl, 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  assert.deepEqual(up.services.map((s) => s.name), ['db', 'studio']);
  assert.deepEqual(down.urls, {});
  assert.equal(down.dbUrl, undefined);
});

test('Android, éditeurs : SDK affiché en ~, dossiers ouverts développés, aucun bouton d’installation', () => {
  const a = demoAndroid(fixtures);
  assert.equal(a.sdk, '~/Library/Android/sdk', 'affiché tel quel, sans chemin absolu');
  assert.equal(a.checks[0].install, null);
  assert.equal(a.avds[0].pid, 4242);
  assert.equal(demoEditors(fixtures)[0].path, path.join(os.homedir(), 'Developer/nebula-store'));
});

test('faux claude et faux gh exigés (jamais les vrais outils)', () => withFixtures((dir) => {
  const prev = process.env.TARMAC_DEMO_FIXTURES;
  process.env.TARMAC_DEMO_FIXTURES = dir;
  try {
    assert.throws(() => demoBinDir(fixtures, 'claude'), 'faux claude absent : erreur');
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin/claude'), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(demoBinDir(fixtures, 'claude'), path.join(dir, 'bin'));
    assert.throws(() => demoBinDir(fixtures, 'gh'), 'faux gh absent : erreur');
    fs.writeFileSync(path.join(dir, 'bin/gh'), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(demoBinDir(fixtures, 'gh'), path.join(dir, 'bin'));
    assert.throws(() => demoBinDir({ ...fixtures, claudeCommand: 'bin/claude-demo' }, 'claude'), 'nommé claude');
  } finally {
    if (prev === undefined) delete process.env.TARMAC_DEMO_FIXTURES; else process.env.TARMAC_DEMO_FIXTURES = prev;
  }
}));

test('intégration : GitHub, Supabase et éditeurs servis par les fixtures en mode démo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-demo-int-'));
  fs.writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify(fixtures));
  const prev = { DATA_DIR: process.env.DATA_DIR, TARMAC_DEMO_FIXTURES: process.env.TARMAC_DEMO_FIXTURES };
  process.env.DATA_DIR = path.join(dir, 'data');
  process.env.TARMAC_DEMO_FIXTURES = dir;
  try {
    const { listGithubRepos } = await import('../github.js');
    const { listSupabase } = await import('../supabase.js');
    const { openEditorFolders } = await import('../editors.js');
    const gh = await listGithubRepos(true);
    assert.equal(gh.login, 'orbit-dev');
    assert.deepEqual(gh.repos.map((r) => r.fullName), ['orbit-labs/storefront', 'orbit-labs/old-site']);
    assert.deepEqual((await listSupabase()).instances.map((i) => i.projectId), ['mission-control', 'orbit-insights']);
    assert.equal((await openEditorFolders(true))[0].editorLabel, 'VS Code');
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
