import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Réglages lus et écrits dans un dossier de données de test (DATA_DIR), dans un process à part : jamais
 * `~/.tarmac`. `script` reçoit `settings` et `updateSettings`, et renvoie une valeur JSON.
 */
function inDataDir(script: string, initial?: object): any {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-settings-'));
  try {
    if (initial) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(initial));
    const code = `const { settings, updateSettings } = await import(${JSON.stringify(path.join(HERE, 'settings.ts'))});\n`
      + `const out = await (async () => { ${script} })();\nprocess.stdout.write(JSON.stringify(out));`;
    const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
      env: { ...process.env, DATA_DIR: dir, HOME: dir, DEV_ROOTS: dir },
      encoding: 'utf8',
    });
    return JSON.parse(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('réglage Agents : Claude seul par défaut (comportement d’avant Codex), usage Codex affiché si Codex est coché', () => {
  const s = inDataDir('return { agents: settings.agents, showCodexUsage: settings.showCodexUsage, showClaudeUsage: settings.showClaudeUsage };');
  assert.deepEqual(s, { agents: { claude: true, codex: false }, showCodexUsage: true, showClaudeUsage: true });
  // Réglages d'avant Codex (sans `agents`) : Claude seul.
  assert.deepEqual(inDataDir('return settings.agents;', { language: 'fr' }), { claude: true, codex: false });
  // Fichier abîmé (aucun agent) : retour au défaut plutôt qu'une app sans agent.
  assert.deepEqual(inDataDir('return settings.agents;', { agents: { claude: false, codex: false } }), { claude: true, codex: false });
});

test('réglage Agents : cocher Codex, garder au moins un agent', () => {
  const r = inDataDir(`
    const a = updateSettings({ agents: { codex: true } });
    const both = { ...settings.agents };
    const b = updateSettings({ agents: { claude: false } });
    const codexOnly = { ...settings.agents };
    const c = updateSettings({ agents: { codex: false } });
    return { a: a.errors, both, b: b.errors, codexOnly, c: c.errors, after: settings.agents };
  `);
  assert.deepEqual(r.a, []);
  assert.deepEqual(r.both, { claude: true, codex: true });
  assert.deepEqual(r.b, []);
  assert.deepEqual(r.codexOnly, { claude: false, codex: true });
  assert.equal(r.c.length, 1, 'aucun agent : refusé');
  assert.deepEqual(r.after, { claude: false, codex: true }, 'rien n’est changé après un refus');
});
