import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToolDirs, toolDirs } from './path.js';

test('addToolDirs : ajoute en fin, sans doublon', () => {
  const env: Record<string, string | undefined> = { PATH: '/a:/opt/homebrew/bin' };
  addToolDirs(env, ['/x', '/opt/homebrew/bin'], 'darwin');
  assert.equal(env.PATH, '/a:/opt/homebrew/bin:/x');
});

test('addToolDirs : PATH absent', () => {
  const env: Record<string, string | undefined> = {};
  addToolDirs(env, ['/x', '/y'], 'darwin');
  assert.equal(env.PATH, '/x:/y');
});

test('addToolDirs : Windows garde la clé Path, séparateur ;', () => {
  const env: Record<string, string | undefined> = { Path: 'C:\\a;C:\\b' };
  addToolDirs(env, ['C:\\b', 'C:\\x'], 'win32');
  assert.equal(env.Path, 'C:\\a;C:\\b;C:\\x');
  assert.equal(env.PATH, undefined);
});

test('toolDirs darwin : outils, .local/bin, brew, /usr/local, bin de node', () => {
  const dirs = toolDirs('/h', 'darwin', '/n/bin/node');
  for (const d of ['/h/.tarmac/tools/bin', '/h/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '/n/bin']) assert.ok(dirs.includes(d), d);
});

test('toolDirs win32 : outils, npm global, .local\\bin', () => {
  const dirs = toolDirs('C:\\Users\\u', 'win32', 'C:\\n\\node.exe');
  assert.ok(dirs.some((d) => d.endsWith('npm')));
  assert.ok(dirs.some((d) => d.endsWith('.local\\bin')));
  assert.ok(dirs.some((d) => d.includes('.tarmac')));
});

test('toolDirs : chemins de la plateforme demandée, quel que soit l\'hôte', () => {
  assert.deepEqual(toolDirs('/h', 'darwin', '/n/bin/node'), ['/h/.tarmac/tools/bin', '/h/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '/n/bin']);
  const win = toolDirs('C:\\Users\\u', 'win32', 'C:\\n\\node.exe');
  assert.equal(win[0], 'C:\\Users\\u\\.tarmac\\tools\\bin');
  assert.equal(win[2], 'C:\\Users\\u\\.local\\bin');
});
