import { test } from 'node:test';
import assert from 'node:assert/strict';
import { langFromAcceptLanguage, msg, requestLang, serverMessages } from './i18n.js';
import { settings } from './settings.js';
import { GIT_COMMANDS } from './gitCommands.js';
import { SUPABASE_COMMANDS } from './supabaseCommands.js';

const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('messages serveur : fr et en présents, mêmes paramètres', () => {
  for (const [k, v] of Object.entries(serverMessages)) {
    assert.ok(v.fr && v.en, k);
    assert.deepEqual(params(v.en), params(v.fr), k);
  }
});

test('catalogues git et Supabase : textes fr et en', () => {
  for (const c of [...GIT_COMMANDS, ...SUPABASE_COMMANDS]) {
    for (const x of [c.group, c.description, c.argLabel].filter(Boolean)) assert.ok(x!.fr && x!.en, c.id);
  }
});

test('langue d’une requête : en-tête de l’UI, puis réglage forcé, puis Accept-Language, puis en', () => {
  const saved = settings.language;
  try {
    settings.language = 'auto';
    assert.equal(requestLang({ 'x-tarmac-lang': 'fr', 'accept-language': 'en' }), 'fr');
    assert.equal(requestLang({ 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' }), 'fr');
    assert.equal(requestLang({ 'accept-language': '*' }), 'en');
    assert.equal(requestLang({}), 'en');
    settings.language = 'fr';
    assert.equal(requestLang({ 'accept-language': 'en-US' }), 'fr');
    assert.equal(requestLang({ 'x-tarmac-lang': 'en' }), 'en');
  } finally {
    settings.language = saved;
  }
  assert.equal(langFromAcceptLanguage('de-DE,en;q=0.5'), 'en');
  assert.equal(msg('api.alreadyExists', { path: '/x' }, 'en'), '/x already exists');
  assert.equal(msg('api.alreadyExists', { path: '/x' }, 'fr'), '/x existe déjà');
});
