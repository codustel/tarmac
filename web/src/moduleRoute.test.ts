import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleRouteId, standaloneModuleClass, moduleFillClass } from './moduleRoute';

test('moduleRouteId : #module/<id> → id', () => {
  assert.equal(moduleRouteId('#module/taskmanager'), 'taskmanager');
  assert.equal(moduleRouteId('#module/leftovers-2'), 'leftovers-2');
});

test('moduleRouteId : adresse invalide ou autre route → null', () => {
  assert.equal(moduleRouteId('#module/../x'), null);
  assert.equal(moduleRouteId('#module/'), null);
  assert.equal(moduleRouteId('#module/a/b'), null);
  assert.equal(moduleRouteId('#module/Abc'), null);
  assert.equal(moduleRouteId('#claude'), null);
  assert.equal(moduleRouteId(''), null);
});

test('route seule : conteneur sans défilement de page, montage qui remplit', () => {
  assert.match(standaloneModuleClass, /\bh-screen\b/);
  assert.match(standaloneModuleClass, /\boverflow-hidden\b/);
  assert.doesNotMatch(standaloneModuleClass, /overflow-auto/);
  assert.match(standaloneModuleClass, /\bflex-col\b/);
  assert.match(moduleFillClass, /\bflex-1\b/);
  assert.match(moduleFillClass, /\bmin-h-0\b/);
  assert.match(moduleFillClass, /\bh-full\b/);
});
