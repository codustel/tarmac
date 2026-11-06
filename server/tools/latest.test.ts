import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, latestVersion, resetLatestCache, type LatestDeps } from './latest.js';
import { toolStatus, invalidateToolStatus, type Exec } from './status.js';

beforeEach(() => resetLatestCache());

function mk(routes: Record<string, unknown>, execOut: Record<string, string> = {}) {
  const urls: string[] = [];
  const cmds: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(url);
    if (!(url in routes)) throw new Error('réseau');
    return { ok: true, json: async () => routes[url] };
  }) as unknown as LatestDeps['fetch'];
  const exec: Exec = async (file, args) => {
    const key = [file, ...args].join(' ');
    cmds.push(key);
    return key in execOut ? { stdout: execOut[key], code: 0 } : { stdout: '', code: 1 };
  };
  return { deps: { fetch, exec, env: {} } as LatestDeps, urls, cmds };
}

test('compareVersions : semver simple, préfixe v ignoré', () => {
  assert.ok(compareVersions('0.40.0', '0.39.9') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('v2.1.3', '2.1.3'), 0);
  assert.equal(compareVersions('2.1', '2.1.0'), 0);
});

test('npm : registre /latest', async () => {
  const { deps, urls } = mk({ 'https://registry.npmjs.org/@openai/codex/latest': { version: '0.168.0' } });
  assert.equal(await latestVersion('codex', 'npm', deps), '0.168.0');
  assert.deepEqual(urls, ['https://registry.npmjs.org/@openai/codex/latest']);
});

test('official : API GitHub releases/latest (gh, codex rust-v)', async () => {
  const { deps } = mk({
    'https://api.github.com/repos/cli/cli/releases/latest': { tag_name: 'v2.103.3' },
    'https://api.github.com/repos/openai/codex/releases/latest': { tag_name: 'rust-v0.167.0' },
  });
  assert.equal(await latestVersion('gh', 'official', deps), '2.103.3');
  assert.equal(await latestVersion('codex', 'official', deps), '0.167.0');
});

test('official claude : rien, aucun appel', async () => {
  const { deps, urls, cmds } = mk({});
  assert.equal(await latestVersion('claude', 'official', deps), null);
  assert.equal(urls.length + cmds.length, 0);
});

test('brew : formule (gh, git) et cask (claude, codex)', async () => {
  const { deps, cmds } = mk({}, {
    'brew info --json=v2 gh': JSON.stringify({ formulae: [{ versions: { stable: '2.103.3' } }], casks: [] }),
    'brew info --json=v2 --cask claude-code': JSON.stringify({ formulae: [], casks: [{ version: '2.1.311' }] }),
  });
  assert.equal(await latestVersion('gh', 'brew', deps), '2.103.3');
  assert.equal(await latestVersion('claude', 'brew', deps), '2.1.311');
  assert.equal(await latestVersion('codex', 'brew', deps), null);
  assert.ok(cmds.includes('brew info --json=v2 --cask codex'));
});

test('winget / xcode : null sans appel', async () => {
  const { deps, urls, cmds } = mk({});
  assert.equal(await latestVersion('git', 'xcode', deps), null);
  assert.equal(await latestVersion('git', 'winget', deps), null);
  assert.equal(urls.length + cmds.length, 0);
});

test('réseau en échec : null, pas d\'exception, échec non mis en cache', async () => {
  const { deps, urls } = mk({});
  assert.equal(await latestVersion('codex', 'npm', deps), null);
  assert.equal(await latestVersion('codex', 'npm', deps), null);
  assert.equal(urls.length, 1);
});

test('cache 24 h : second appel sans nouveau fetch', async () => {
  const { deps, urls } = mk({ 'https://registry.npmjs.org/@openai/codex/latest': { version: '0.168.0' } });
  await latestVersion('codex', 'npm', deps);
  await latestVersion('codex', 'npm', deps);
  assert.equal(urls.length, 1);
});

test('toolStatus : latest et updatable pour un outil prêt d\'origine connue', async () => {
  invalidateToolStatus();
  const { deps: l } = mk({ 'https://registry.npmjs.org/@openai/codex/latest': { version: '0.168.0' } });
  const replies: Record<string, string> = {
    'which -a codex': '/h/.npm-global/bin/codex\n',
    '/h/.npm-global/bin/codex --version': 'codex-cli 0.167.0\n',
    'which -a brew': '',
    'which -a npm': '/usr/bin/npm\n',
    'npm prefix -g': '/h/.npm-global\n',
    'codex login status': 'Logged in',
  };
  const exec: Exec = async (f, a) => {
    const k = [f, ...a].join(' ');
    return k in replies ? { stdout: replies[k], code: 0 } : { stdout: '', code: 1 };
  };
  const s = await toolStatus('codex', { exec, env: {}, home: '/h', platform: 'darwin', fetch: l.fetch });
  assert.equal(s.method, 'npm');
  assert.equal(s.latest, '0.168.0');
  assert.equal(s.updatable, true);
  const s2 = await toolStatus('codex', { exec, env: {}, home: '/h', platform: 'darwin' });
  assert.equal(s2.latest, null);
  assert.equal(s2.updatable, false);
});

test('sans fetch (garde du premier appel) : aucune recherche, ni fetch ni brew info', async () => {
  invalidateToolStatus();
  const cmds: string[] = [];
  const replies: Record<string, string> = {
    'which -a gh': '/opt/homebrew/bin/gh\n', 'which -a brew': '/opt/homebrew/bin/brew\n', 'which -a npm': '',
    '/opt/homebrew/bin/gh --version': 'gh version 2.1.0\n', 'gh auth status': 'ok',
  };
  const exec: Exec = async (f, a) => {
    const k = [f, ...a].join(' ');
    cmds.push(k);
    return k in replies ? { stdout: replies[k], code: 0 } : { stdout: '', code: 1 };
  };
  const s = await toolStatus('gh', { exec, env: {}, home: '/h', platform: 'darwin' });
  assert.equal(s.method, 'brew');
  assert.equal(s.latest, null);
  assert.ok(!cmds.some((c) => c.startsWith('brew info')));
});

test('échec suivi d\'un second appel dans l\'heure : aucun nouveau fetch ; après 1 h, nouvel essai', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { deps, urls } = mk({});
  await latestVersion('gh', 'official', deps);
  await latestVersion('gh', 'official', deps);
  assert.equal(urls.length, 1);
  t.mock.timers.tick(3600 * 1000 + 1);
  await latestVersion('gh', 'official', deps);
  assert.equal(urls.length, 2);
});
