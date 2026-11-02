import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asideName, envVar, lastActivity, migrateDataDir, migrateEnvText, replaceStaleDataDir, staleDataDir, staleDataWarning } from './dataDir.js';

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

test('deux dossiers : ~/.app-manager plus récent détecté (suivi.db*, state.json), ~/.tarmac mis de côté puis recopié', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-home-'));
  const legacy = path.join(home, '.app-manager');
  const target = path.join(home, '.tarmac');
  fs.mkdirSync(legacy);
  fs.mkdirSync(target);
  assert.equal(lastActivity(target), 0);
  assert.equal(staleDataDir(target, legacy), null, 'aucune donnée nulle part');
  fs.writeFileSync(path.join(target, 'state.json'), '{"v":"ancien"}');
  fs.writeFileSync(path.join(legacy, 'suivi.db-wal'), 'wal');
  fs.writeFileSync(path.join(legacy, 'state.json'), '{"v":"récent"}');
  const past = new Date(Date.now() - 3600_000);
  fs.utimesSync(path.join(target, 'state.json'), past, past);
  // Un fichier hors liste (sauvegarde, réglages) ne compte pas.
  fs.writeFileSync(path.join(target, 'suivi.db.bak-1'), 'x');

  const s = staleDataDir(target, legacy);
  assert.ok(s && s.legacy > s.target);
  assert.match(staleDataWarning(target, legacy)!, /has newer data .* run: tarmac setup/);

  const aside = asideName(target, new Date(2026, 10, 3, 9, 5, 7));
  assert.equal(aside, `${target}.old-20261103-090507`);
  assert.equal(replaceStaleDataDir(target, legacy, aside), aside);
  assert.equal(fs.readFileSync(path.join(aside, 'state.json'), 'utf8'), '{"v":"ancien"}', 'rien de supprimé');
  assert.equal(fs.readFileSync(path.join(target, 'state.json'), 'utf8'), '{"v":"récent"}');
  assert.equal(staleDataDir(target, legacy), null, 'dates conservées par la copie : plus rien à signaler');
  assert.equal(staleDataWarning(target, legacy), null);
  // Nom déjà pris (même seconde) : suffixe.
  fs.mkdirSync(`${target}.old-20261103-090508`);
  assert.equal(asideName(target, new Date(2026, 10, 3, 9, 5, 8)), `${target}.old-20261103-090508-2`);
});

test('deux dossiers : ~/.tarmac plus récent ou seul → aucun avertissement', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-home-'));
  const legacy = path.join(home, '.app-manager');
  const target = path.join(home, '.tarmac');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'suivi.db'), 'x');
  assert.equal(staleDataWarning(target, legacy), null);
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'suivi.db'), 'y');
  const past = new Date(Date.now() - 3600_000);
  fs.utimesSync(path.join(legacy, 'suivi.db'), past, past);
  assert.equal(staleDataDir(target, legacy), null);
});
