import test from 'node:test';
import assert from 'node:assert/strict';
import { isSaveShortcut, normalizeSaveAsPath } from './saveAs';

const ev = (o: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>) =>
  ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, ...o });

test('Ctrl+S et Cmd+S sont des raccourcis d’enregistrement', () => {
  assert.equal(isSaveShortcut(ev({ key: 's', ctrlKey: true })), true);
  assert.equal(isSaveShortcut(ev({ key: 's', metaKey: true })), true);
});

test('Majuscule (verrouillage) et disposition de clavier : code KeyS accepté', () => {
  assert.equal(isSaveShortcut(ev({ key: 'S', ctrlKey: true })), true);
  assert.equal(isSaveShortcut(ev({ key: 'ß', code: 'KeyS', metaKey: true })), true);
});

test('sans Ctrl/Cmd ou avec Alt : pas un raccourci', () => {
  assert.equal(isSaveShortcut(ev({ key: 's' })), false);
  assert.equal(isSaveShortcut(ev({ key: 's', ctrlKey: true, altKey: true })), false);
  assert.equal(isSaveShortcut(ev({ key: 'a', ctrlKey: true })), false);
});

test('normalizeSaveAsPath : chemin relatif propre', () => {
  assert.equal(normalizeSaveAsPath('  src/a.ts '), 'src/a.ts');
  assert.equal(normalizeSaveAsPath('./src//a.ts'), 'src/a.ts');
  assert.equal(normalizeSaveAsPath('src\\a.ts'), 'src/a.ts');
});

test('normalizeSaveAsPath : refuse vide, dossier, sortie du projet', () => {
  assert.equal(normalizeSaveAsPath(''), null);
  assert.equal(normalizeSaveAsPath('   '), null);
  assert.equal(normalizeSaveAsPath('src/'), null);
  assert.equal(normalizeSaveAsPath('../x.ts'), null);
  assert.equal(normalizeSaveAsPath('a/../../x.ts'), null);
  assert.equal(normalizeSaveAsPath('/etc/passwd'), null);
  assert.equal(normalizeSaveAsPath('C:\\x.ts'), null);
});

test('normalizeSaveAsPath : .. interne résolu mais resté dans le projet', () => {
  assert.equal(normalizeSaveAsPath('a/b/../c.ts'), 'a/c.ts');
});
