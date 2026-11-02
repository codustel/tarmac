import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paramsOf, resolveLang, translate, type Entry } from './core';
import { fr } from './fr';
import { en } from './en';

test('langue : auto suit le navigateur (fr* → fr, sinon en)', () => {
  assert.equal(resolveLang('auto', ['fr-FR', 'en-US']), 'fr');
  assert.equal(resolveLang('auto', ['fr']), 'fr');
  assert.equal(resolveLang('auto', ['fr_CA']), 'fr');
  assert.equal(resolveLang('auto', ['en-US', 'fr-FR']), 'en');
  assert.equal(resolveLang('auto', ['de-DE', 'fr-FR']), 'fr');
  assert.equal(resolveLang('auto', ['de-DE', 'es']), 'en');
  assert.equal(resolveLang('auto', []), 'en');
  assert.equal(resolveLang(undefined, ['fr-BE']), 'fr');
});

test('langue : un réglage forcé l’emporte sur le navigateur', () => {
  assert.equal(resolveLang('en', ['fr-FR']), 'en');
  assert.equal(resolveLang('fr', ['en-US']), 'fr');
  assert.equal(resolveLang('fr', []), 'fr');
});

test('dictionnaires : mêmes clés, même forme et mêmes paramètres en fr et en', () => {
  const fk = Object.keys(fr).sort();
  const ek = Object.keys(en).sort();
  assert.deepEqual(ek, fk);
  const d1 = fr as Record<string, Entry>;
  const d2 = en as Record<string, Entry>;
  for (const k of fk) {
    assert.equal(typeof d2[k], typeof d1[k], `forme différente : ${k}`);
    assert.deepEqual(paramsOf(d2[k]), paramsOf(d1[k]), `paramètres différents : ${k}`);
    if (typeof d1[k] === 'string') assert.ok((d2[k] as string).trim(), `traduction vide : ${k}`);
  }
});

test('traduction : interpolation, pluriel et repli sur la clé', () => {
  const d: Record<string, Entry> = { hi: 'Hello {name}', n: { zero: 'none', one: '{count} item', other: '{count} items' }, m: { one: '{count} projet', other: '{count} projets' } };
  assert.equal(translate(d, 'en', 'hi', { name: 'Ada' }), 'Hello Ada');
  assert.equal(translate(d, 'en', 'n', { count: 0 }), 'none');
  assert.equal(translate(d, 'en', 'n', { count: 1 }), '1 item');
  assert.equal(translate(d, 'en', 'n', { count: 3 }), '3 items');
  assert.equal(translate(d, 'fr', 'm', { count: 0 }), '0 projet');
  assert.equal(translate(d, 'fr', 'm', { count: 1 }), '1 projet');
  assert.equal(translate(d, 'fr', 'm', { count: 2 }), '2 projets');
  assert.equal(translate(d, 'en', 'absent'), 'absent');
});
