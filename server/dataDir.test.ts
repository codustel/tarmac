import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envVar, migrateDataDir, migrateEnvText } from './dataDir.js';

test('migration : ~/.app-manager copié (pas déplacé) vers ~/.tarmac, env renommé', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-home-'));
  const legacy = path.join(home, '.app-manager');
  const target = path.join(home, '.tarmac');
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'env'), '# Configuration App Manager\nMANAGER_PORT=7777\nMANAGER_URL=http://manager.localhost\nSUIVI_TOKEN=t\n');
  fs.writeFileSync(path.join(legacy, 'settings.json'), '{"theme":"dark"}');
  fs.writeFileSync(path.join(legacy, 'manager.log'), 'journal');

  assert.equal(migrateDataDir(target, legacy), true);
  assert.ok(fs.existsSync(path.join(legacy, 'settings.json')), 'original conservé');
  assert.equal(fs.readFileSync(path.join(target, 'settings.json'), 'utf8'), '{"theme":"dark"}');
  assert.equal(fs.existsSync(path.join(target, 'manager.log')), false, 'journal de l’ancien service non copié');
  const env = fs.readFileSync(path.join(target, 'env'), 'utf8');
  assert.match(env, /^TARMAC_PORT=7777$/m);
  assert.match(env, /^TARMAC_URL=http:\/\/tarmac\.localhost$/m);
  assert.match(env, /^SUIVI_TOKEN=t$/m);

  // Déjà migré : rien n'est recopié.
  fs.writeFileSync(path.join(legacy, 'settings.json'), '{"theme":"light"}');
  assert.equal(migrateDataDir(target, legacy), false);
  assert.equal(fs.readFileSync(path.join(target, 'settings.json'), 'utf8'), '{"theme":"dark"}');
});

test('migration : rien à faire sans ancienne installation', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-home-'));
  assert.equal(migrateDataDir(path.join(home, '.tarmac'), path.join(home, '.app-manager')), false);
  assert.equal(fs.existsSync(path.join(home, '.tarmac')), false);
});

test('variables : TARMAC_* d’abord, MANAGER_* en repli', () => {
  assert.equal(envVar('PORT', { MANAGER_PORT: '7000' }), '7000');
  assert.equal(envVar('PORT', { MANAGER_PORT: '7000', TARMAC_PORT: '7100' }), '7100');
  assert.equal(envVar('PORT', {}), undefined);
  assert.equal(migrateEnvText('export APP_MANAGER_URL=http://127.0.0.1:7790\n'), 'export TARMAC_API_URL=http://127.0.0.1:7790\n');
});
