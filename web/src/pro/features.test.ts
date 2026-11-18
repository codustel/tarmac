import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRO_FEATURES, autoButtonMode, proButtonMode, lockedProFeatures, pricingUrl } from './features';

const mod = (id: string, status = 'loaded') => ({ id, status });
const ids = (l: { id: string }[]) => l.map((f) => f.id);

test('rien de chargé : les 7 fonctionnalités', () => {
  assert.deepEqual(ids(lockedProFeatures(PRO_FEATURES, [], { isDesktop: false, hidden: false })).sort(),
    ['autopilot', 'context', 'costs', 'desktop', 'leftovers', 'notifications', 'setup']);
});

test('module costs présent, même en erreur : ni coûts ni contexte', () => {
  const r = ids(lockedProFeatures(PRO_FEATURES, [mod('costs', 'error')], { isDesktop: false, hidden: false }));
  assert.ok(!r.includes('costs') && !r.includes('context'));
  assert.equal(r.length, 5);
});

test('isDesktop : pas de Desktop', () => {
  const r = ids(lockedProFeatures(PRO_FEATURES, [], { isDesktop: true, hidden: false }));
  assert.ok(!r.includes('desktop'));
  assert.equal(r.length, 6);
});

test('hidden : liste vide', () => {
  assert.deepEqual(lockedProFeatures(PRO_FEATURES, [], { isDesktop: false, hidden: true }), []);
});

test('modules inconnus sans effet', () => {
  assert.equal(lockedProFeatures(PRO_FEATURES, [mod('autre')], { isDesktop: false, hidden: false }).length, 7);
});

test('pricingUrl par langue', () => {
  assert.equal(pricingUrl('en'), 'https://runtarmac.com/pricing/');
  assert.equal(pricingUrl('fr'), 'https://runtarmac.com/fr/tarifs/');
});

test('chaque entrée : ids uniques, FR et EN non vides, pas de prix', () => {
  assert.equal(new Set(ids(PRO_FEATURES)).size, PRO_FEATURES.length);
  for (const f of PRO_FEATURES) {
    for (const l of ['fr', 'en'] as const) {
      assert.ok(f.name[l].trim() && f.pitch[l].trim(), `${f.id} ${l}`);
      assert.ok(!/[€$]|\d\s?(€|\$|eur|usd)/i.test(f.pitch[l]), `prix en dur ${f.id}`);
    }
  }
});

test('bouton « Auto » de la Todolist : bascule avec le module autopilot (tout statut), Pro sans lui, masqué si les propositions sont coupées', () => {
  assert.equal(autoButtonMode([mod('autopilot')], false), 'toggle');
  assert.equal(autoButtonMode([mod('autopilot', 'error')], false), 'toggle');
  assert.equal(autoButtonMode([mod('costs')], false), 'pro');
  assert.equal(autoButtonMode([], false), 'pro');
  assert.equal(autoButtonMode([], true), 'none');
  assert.equal(autoButtonMode([mod('autopilot')], true), 'toggle');
});

test('bouton Pro générique : module chargé → toggle, absent → pastille Pro, masqué si coupé', () => {
  assert.equal(proButtonMode([mod('leftovers')], 'leftovers', false), 'toggle');
  assert.equal(proButtonMode([], 'leftovers', false), 'pro');
  assert.equal(proButtonMode([], 'leftovers', true), 'none');
  assert.equal(proButtonMode([mod('autopilot')], 'leftovers', false), 'pro');
});
