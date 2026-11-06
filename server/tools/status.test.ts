import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allToolStatus, invalidateToolStatus, methodFromPath, toolStatus, type Exec } from './status.js';

// Chemins inexistants (pas de liens à résoudre) : seul le préfixe compte, quel que soit le Mac qui lance les tests.
const ctx = { home: '/h', brewPrefix: '/nulle-part/homebrew', npmBin: '/h/.npm-global/bin', platform: 'darwin' as const };

test('methodFromPath : moyen d\'origine déduit du chemin', () => {
  assert.equal(methodFromPath('/nulle-part/homebrew/bin/claude', ctx), 'brew');
  assert.equal(methodFromPath('/h/.npm-global/bin/claude', ctx), 'npm');
  assert.equal(methodFromPath('/h/.local/bin/claude', ctx), 'official');
  assert.equal(methodFromPath('/h/.tarmac/tools/bin/codex', ctx), 'official');
  assert.equal(methodFromPath('/weird/claude', ctx), null);
  assert.equal(methodFromPath('/nulle-part/homebrew/bin/claude', { ...ctx, brewPrefix: null }), null);
});

test('methodFromPath win32 : chemins Windows quel que soit l\'hôte, casse ignorée', () => {
  const w = { home: 'C:\\Users\\u', brewPrefix: null, npmBin: 'C:\\Users\\u\\AppData\\Roaming\\npm', platform: 'win32' as const };
  assert.equal(methodFromPath('C:\\Users\\u\\.tarmac\\tools\\bin\\gh.exe', w), 'official');
  assert.equal(methodFromPath('C:\\Users\\u\\.local\\bin\\claude.exe', w), 'official');
  assert.equal(methodFromPath('c:\\users\\U\\.local\\bin\\claude.exe', w), 'official');
  assert.equal(methodFromPath('c:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd', w), 'npm');
  assert.equal(methodFromPath('C:\\Users\\u\\AppData\\Roaming\\npm-old\\codex.cmd', w), null);
  assert.equal(methodFromPath('C:\\Program Files\\Git\\cmd\\git.exe', w), null);
});

// Vrais liens symboliques et chemins réels posix (plateforme darwin) : hôte Unix seulement.
const UNIX_HOST = { skip: process.platform === 'win32' && 'liens symboliques et chemins réels posix' };

/** Binaire `bin` lien symbolique vers `target` (fichier créé) dans un dossier temporaire. */
function link(root: string, bin: string, target: string): string {
  const b = path.join(root, bin);
  const t = path.join(root, target);
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, '');
  fs.symlinkSync(t, b);
  return b;
}

test('methodFromPath : chemin réel d\'abord, paquet npm global sous le préfixe brew = npm (I5)', UNIX_HOST, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-method-')));
  try {
    const brewPrefix = path.join(root, 'opt/homebrew');
    const c = { home: path.join(root, 'h'), brewPrefix, npmBin: path.join(brewPrefix, 'bin'), platform: 'darwin' as const };
    const npmClaude = link(root, 'opt/homebrew/bin/claude', 'opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js');
    assert.equal(methodFromPath(npmClaude, c), 'npm');
    const cask = link(root, 'opt/homebrew/bin/codex', 'opt/homebrew/Caskroom/codex/0.50.0/codex-aarch64-apple-darwin');
    assert.equal(methodFromPath(cask, c), 'brew');
    const formula = link(root, 'opt/homebrew/bin/gh', 'opt/homebrew/Cellar/gh/2.60.0/bin/gh');
    assert.equal(methodFromPath(formula, c), 'brew');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('methodFromPath : préfixe Intel /usr/local partagé, brew seulement si le chemin réel est dans Cellar/Caskroom (T3)', UNIX_HOST, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-method-')));
  try {
    const brewPrefix = path.join(root, 'usr/local');
    const c = { home: path.join(root, 'h'), brewPrefix, npmBin: null, platform: 'darwin' as const };
    assert.equal(methodFromPath(link(root, 'usr/local/bin/gh', 'usr/local/Cellar/gh/2.60.0/bin/gh'), c), 'brew');
    assert.equal(methodFromPath(link(root, 'usr/local/bin/claude', 'usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'), c), 'npm');
    const plain = path.join(root, 'usr/local/bin/codex');
    fs.writeFileSync(plain, '');
    assert.equal(methodFromPath(plain, c), null, 'binaire posé à la main sous /usr/local : pas brew');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

interface Reply { stdout?: string; code?: number; throws?: unknown }
function fake(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    const key = [file, ...args].join(' ');
    calls.push(key);
    const r = replies[key];
    if (!r) return { stdout: '', code: 1 };
    if (r.throws) throw r.throws;
    return { stdout: r.stdout ?? '', code: r.code ?? 0 };
  };
  return { exec, calls };
}
const deps = (exec: Exec) => ({ exec, env: {}, home: '/h', platform: 'darwin' as const });

test('codex absent : installMethod brew si brew présent', async () => {
  const { exec } = fake({ 'which -a brew': { stdout: '/opt/homebrew/bin/brew\n' } });
  const s = await toolStatus('codex', deps(exec));
  assert.equal(s.state, 'absent');
  assert.equal(s.installMethod, 'brew');
  assert.equal(s.version, null);
  assert.equal(s.path, null);
  assert.equal(s.managed, true);
});

test('codex absent sans brew ni npm : installMethod official', async () => {
  const s = await toolStatus('codex', deps(fake({}).exec));
  assert.equal(s.installMethod, 'official');
});

const codexOk = {
  'which -a codex': { stdout: '/opt/homebrew/bin/codex\n' },
  'which -a brew': { stdout: '/opt/homebrew/bin/brew\n' },
  '/opt/homebrew/bin/codex --version': { stdout: 'codex-cli 0.46.0\n' },
};

test('codex connecté : ready, version et moyen d\'origine', async () => {
  const { exec } = fake({ ...codexOk, 'codex login status': { stdout: 'Logged in using ChatGPT\n', code: 0 } });
  const s = await toolStatus('codex', deps(exec));
  assert.equal(s.state, 'ready');
  assert.equal(s.version, '0.46.0');
  assert.equal(s.path, '/opt/homebrew/bin/codex');
  assert.equal(s.method, 'brew');
});

test('codex code 1 : logged-out ; texte "Not logged in" aussi', async () => {
  const a = await toolStatus('codex', deps(fake({ ...codexOk, 'codex login status': { code: 1 } }).exec));
  assert.equal(a.state, 'logged-out');
  const b = await toolStatus('codex', deps(fake({ ...codexOk, 'codex login status': { stdout: 'Not logged in', code: 2 } }).exec));
  assert.equal(b.state, 'logged-out');
  const c = await toolStatus('codex', deps(fake({ ...codexOk, 'codex login status': { stdout: 'Logged in', code: 3 } }).exec));
  assert.equal(c.state, 'ready');
  const d = await toolStatus('codex', deps(fake({ ...codexOk, 'codex login status': { stdout: 'boom', code: 3 } }).exec));
  assert.equal(d.state, 'unknown');
});

test('claude et gh : code 0 ready, sinon logged-out', async () => {
  const base = { 'which -a claude': { stdout: '/h/.local/bin/claude\n' }, '/h/.local/bin/claude --version': { stdout: '2.1.4 (Claude Code)\n' } };
  const ok = await toolStatus('claude', deps(fake({ ...base, 'claude auth status': { code: 0 } }).exec));
  assert.equal(ok.state, 'ready');
  assert.equal(ok.version, '2.1.4');
  assert.equal(ok.method, 'official');
  const out = await toolStatus('claude', deps(fake({ ...base, 'claude auth status': { code: 1 } }).exec));
  assert.equal(out.state, 'logged-out');
  const gh = await toolStatus('gh', deps(fake({ 'which -a gh': { stdout: '/weird/gh' }, 'gh auth status': { code: 1 } }).exec));
  assert.equal(gh.state, 'logged-out');
  assert.equal(gh.method, null);
});

test('statut qui dépasse le délai ou échoue : unknown', async () => {
  const timeout = Object.assign(new Error('timeout'), { killed: true });
  const s = await toolStatus('codex', deps(fake({ ...codexOk, 'codex login status': { throws: timeout } }).exec));
  assert.equal(s.state, 'unknown');
});

test('aucun appel ne lit auth.json ni n\'appelle security', async () => {
  const { exec, calls } = fake({ ...codexOk, 'codex login status': { code: 0 } });
  await toolStatus('codex', deps(exec));
  assert.ok(calls.length > 0);
  assert.ok(!calls.some((c) => /auth\.json|^security\b|cat |find-generic/.test(c)), calls.join('\n'));
});

test('git darwin : absent sans xcode-select ni git hors /usr/bin', async () => {
  const stub = { 'which -a git': { stdout: '/usr/bin/git\n' }, 'xcode-select -p': { code: 2 } };
  assert.equal((await toolStatus('git', deps(fake(stub).exec))).state, 'absent');
  const ok = await toolStatus('git', deps(fake({ ...stub, 'xcode-select -p': { stdout: '/Library/Developer/CommandLineTools' }, '/usr/bin/git --version': { stdout: 'git version 2.50.1 (Apple Git-155)' } }).exec));
  assert.equal(ok.state, 'ready');
  assert.equal(ok.version, '2.50.1');
  const brew = await toolStatus('git', deps(fake({ ...stub, 'which -a git': { stdout: '/opt/homebrew/bin/git\n/usr/bin/git\n' }, 'which -a brew': { stdout: '/opt/homebrew/bin/brew' } }).exec));
  assert.equal(brew.state, 'ready');
  assert.equal(brew.path, '/opt/homebrew/bin/git');
  assert.equal(brew.method, 'brew');
});

test('docker : état du moteur injecté ; supabase : présence seulement', async () => {
  const mk = (status: 'ok' | 'absent' | 'stopped' | 'error') => ({ ...deps(fake({}).exec), dockerEngine: async () => ({ status }) });
  assert.equal((await toolStatus('docker', mk('ok'))).state, 'ready');
  assert.equal((await toolStatus('docker', mk('stopped'))).state, 'stopped');
  assert.equal((await toolStatus('docker', mk('absent'))).state, 'absent');
  assert.equal((await toolStatus('docker', mk('error'))).state, 'unknown');
  const sb = await toolStatus('supabase', deps(fake({ 'which -a supabase': { stdout: '/opt/homebrew/bin/supabase' }, '/opt/homebrew/bin/supabase --version': { stdout: '2.1.0' } }).exec));
  assert.equal(sb.state, 'ready');
  assert.equal(sb.managed, false);
  assert.equal((await toolStatus('supabase', deps(fake({}).exec))).state, 'absent');
});

test('allToolStatus : ordre, cache 30 s, invalidation', async () => {
  invalidateToolStatus();
  const { exec, calls } = fake({});
  const d = { ...deps(exec), dockerEngine: async () => ({ status: 'absent' as const }) };
  const list = await allToolStatus(d);
  assert.deepEqual(list.map((s) => s.id), ['git', 'gh', 'claude', 'codex', 'docker', 'supabase']);
  const n = calls.length;
  await allToolStatus(d);
  assert.equal(calls.length, n);
  invalidateToolStatus('gh');
  await allToolStatus(d);
  assert.ok(calls.length > n);
  invalidateToolStatus();
});

test('version lue par le binaire localisé, jamais par le nom nu (/usr/bin/git)', async () => {
  const { exec, calls } = fake({ 'which -a git': { stdout: '/opt/homebrew/bin/git\n/usr/bin/git\n' }, '/opt/homebrew/bin/git --version': { stdout: 'git version 2.51.0' } });
  const s = await toolStatus('git', deps(exec));
  assert.equal(s.version, '2.51.0');
  assert.ok(!calls.includes('git --version'), calls.join('\n'));
});

test('docker sans moteur injecté : unknown, sans lancer docker', async () => {
  const { exec, calls } = fake({ 'which -a docker': { stdout: '/usr/local/bin/docker' }, 'docker --version': { stdout: 'Docker version 27.0.1' } });
  const s = await toolStatus('docker', deps(exec));
  assert.equal(s.state, 'unknown');
  assert.ok(!calls.some((c) => c.startsWith('docker ')), calls.join('\n'));
});
