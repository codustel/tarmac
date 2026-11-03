import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSupabaseCommand, pathStaysInside } from './supabaseCommands.js';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-supa-'));
  const proj = path.join(root, 'proj');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'cible.ts'), '');
  fs.symlinkSync(outside, path.join(proj, 'lien-dossier'));
  fs.symlinkSync(path.join(outside, 'cible.ts'), path.join(proj, 'src', 'lien.ts'));
  return { root, proj };
}

test('pathStaysInside : chemins du projet acceptés, liens vers l’extérieur refusés', () => {
  const { root, proj } = sandbox();
  try {
    assert.equal(pathStaysInside(proj, 'src/types.ts'), true);
    assert.equal(pathStaysInside(proj, 'nouveau/dossier/types.ts'), true);
    assert.equal(pathStaysInside(proj, 'lien-dossier/types.ts'), false);
    assert.equal(pathStaysInside(proj, 'src/lien.ts'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildSupabaseCommand : chemin vers un lien refusé quand le dossier est connu', () => {
  const { root, proj } = sandbox();
  try {
    assert.match(buildSupabaseCommand('types-local-file', 'src/types.ts', proj).shell, /> 'src\/types\.ts'$/);
    assert.throws(() => buildSupabaseCommand('types-local-file', 'lien-dossier/types.ts', proj));
    assert.throws(() => buildSupabaseCommand('types-local-file', '../x.ts', proj));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
