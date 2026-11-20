import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIDEBAR_COMPACT_QUERY, foldKey, isFolded, peakUsage } from './sidebarFold';

test('sidebar compacte : requête de hauteur (petit écran = fenêtre basse)', () => {
  assert.equal(SIDEBAR_COMPACT_QUERY, '(max-height: 900px)');
});

test('repli : grand écran jamais replié, quel que soit le choix mémorisé', () => {
  assert.equal(isFolded(null, false), false);
  assert.equal(isFolded('1', false), false);
  assert.equal(isFolded('0', false), false);
});

test('repli : petit écran replié par défaut, puis choix mémorisé', () => {
  assert.equal(isFolded(null, true), true);
  assert.equal(isFolded('1', true), true);
  assert.equal(isFolded('0', true), false);
  assert.equal(isFolded('n importe quoi', true), true);
});

test('repli : une clé de stockage par groupe', () => {
  assert.equal(foldKey('claude-usage'), 'sidebar:fold:claude-usage');
  assert.equal(foldKey('roots'), 'sidebar:fold:roots');
});

test('ligne repliée : plus forte utilisation, arrondie vers le bas', () => {
  assert.equal(peakUsage([]), null);
  assert.equal(peakUsage([{ utilization: 12.9 }, { utilization: 74.6 }, { utilization: 30 }]), 74);
  assert.equal(peakUsage([{ utilization: 0 }]), 0);
});
