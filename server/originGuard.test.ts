import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossOriginFetch, originAllowed } from './originGuard.js';

test('originAllowed : même adresse que Host, port compris', () => {
  assert.equal(originAllowed('http://tarmac.localhost', 'tarmac.localhost'), true);
  assert.equal(originAllowed('http://tarmac.localhost:7777', 'tarmac.localhost:7777'), true);
  assert.equal(originAllowed('http://localhost:7778', 'localhost:7778'), true); // Vite en dev (proxy)
  assert.equal(originAllowed('http://Tarmac.localhost', 'tarmac.localhost:80'), true);
});

test('originAllowed : autre app locale refusée', () => {
  assert.equal(originAllowed('http://localhost:5173', 'localhost:7777'), false);
  assert.equal(originAllowed('http://nebula-store.localhost', 'tarmac.localhost'), false);
  assert.equal(originAllowed('http://tarmac.localhost:6100', 'tarmac.localhost'), false);
  assert.equal(originAllowed('https://tarmac.localhost', 'tarmac.localhost'), false);
  assert.equal(originAllowed('https://evil.example', 'tarmac.localhost'), false);
});

test('originAllowed : origines invalides ou opaques refusées, absence acceptée', () => {
  assert.equal(originAllowed('null', 'tarmac.localhost'), false);
  assert.equal(originAllowed('file://', 'tarmac.localhost'), false);
  assert.equal(originAllowed('', 'tarmac.localhost'), false);
  assert.equal(originAllowed(undefined, 'tarmac.localhost'), true);
});

test('originAllowed : URL publique configurée', () => {
  const extra = ['https://mac.example.ts.net'];
  assert.equal(originAllowed('https://mac.example.ts.net', 'tarmac.localhost', extra), true);
  assert.equal(originAllowed('https://autre.example.ts.net', 'tarmac.localhost', extra), false);
});

test('crossOriginFetch', () => {
  assert.equal(crossOriginFetch('cross-site'), true);
  assert.equal(crossOriginFetch('same-site'), true);
  assert.equal(crossOriginFetch('same-origin'), false);
  assert.equal(crossOriginFetch('none'), false);
  assert.equal(crossOriginFetch(undefined), false);
});
