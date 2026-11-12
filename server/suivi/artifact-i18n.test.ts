import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArtifact } from './artifact.js';
import { buildTheme } from './theme.js';
import type { SuiviProject } from './types.js';

const project: SuiviProject = {
  projectId: 'acme/shop', name: 'shop', brand: 'ACME', title: 'Suivi', subtitle: '', artifactUrl: null,
  theme: buildTheme(null, 'ACME'), paths: [], copyFile: 'suivi.json', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};
const html = renderArtifact(project, { bridgeIntervalSec: 30 });
const dict = JSON.parse(html.match(/<script type="application\/json" id="suivi-i18n">([\s\S]*?)<\/script>/)![1]) as Record<string, Record<string, string>>;
const script = html.slice(html.lastIndexOf('<script>'));
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('artefact : dictionnaire fr et en avec les mêmes clés et les mêmes paramètres', () => {
  assert.deepEqual(Object.keys(dict).sort(), ['en', 'fr']);
  assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict.fr).sort());
  for (const k of Object.keys(dict.fr)) {
    assert.ok(dict.fr[k] && dict.en[k], `texte vide : ${k}`);
    assert.deepEqual(params(dict.en[k]), params(dict.fr[k]), `paramètres différents : ${k}`);
  }
});

test('artefact : chaque clé utilisée par la page existe', () => {
  const used = new Set<string>();
  for (const m of script.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  // tp('clé', n) : formes au pluriel `clé_one` et `clé_other`.
  for (const m of script.matchAll(/\btp\('([\w.]+)'/g)) { used.add(m[1] + '_one'); used.add(m[1] + '_other'); }
  for (const m of html.matchAll(/data-i18n(?:-title|-aria)?="([\w.]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 30, `peu de clés trouvées (${used.size})`);
  const missing = [...used].filter((k) => !(k in dict.fr));
  assert.deepEqual(missing, []);
  const unused = Object.keys(dict.fr).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], 'clés du dictionnaire jamais utilisées');
});

test('artefact : titre par défaut « Todolist <Nom> » inchangé', () => {
  assert.match(html, /<title>Todolist Shop<\/title>/);
});

test('artefact : badge « auto » en lecture seule, aucune bascule ni écriture du champ', () => {
  assert.match(script, /class=\\?"badge-auto\\?"/);
  assert.ok(!/data-auto|auto-btn/.test(html), 'pas de bouton');
  assert.ok(!/edit\([^)]*\{auto:/.test(script), 'l\'artefact n\'écrit jamais auto');
});
