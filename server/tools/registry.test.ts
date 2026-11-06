import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  MANAGED, TOOLS, TOOLS_BIN_DIR, chooseMethod, installCommand, loginCommand, statusCommand, updateCommand, versionArgs,
  type ManagedId, type Method,
} from './registry.js';

test('MANAGED : ordre git, gh, claude, codex', () => {
  assert.deepEqual(MANAGED, ['git', 'gh', 'claude', 'codex']);
});

test('chooseMethod : premier moyen disponible, official/xcode toujours disponibles', () => {
  assert.equal(chooseMethod('codex', new Set(['brew', 'npm']), 'darwin'), 'brew');
  assert.equal(chooseMethod('codex', new Set(['npm']), 'darwin'), 'npm');
  assert.equal(chooseMethod('codex', new Set(), 'darwin'), 'official');
  assert.equal(chooseMethod('git', new Set(), 'darwin'), 'xcode');
  assert.equal(chooseMethod('git', new Set(['brew']), 'darwin'), 'brew');
  assert.equal(chooseMethod('git', new Set(), 'win32'), null);
  assert.equal(chooseMethod('git', new Set(['winget']), 'win32'), 'winget');
  assert.equal(chooseMethod('claude', new Set(['winget']), 'win32'), 'official');
  assert.equal(chooseMethod('claude', new Set(['npm']), 'win32'), 'npm');
  assert.equal(chooseMethod('gh', new Set(['brew']), 'linux'), null);
});

test('docker et supabase : non gérés, aucun moyen', () => {
  assert.equal(TOOLS.docker.managed, false);
  assert.equal(TOOLS.supabase.managed, false);
  assert.deepEqual(TOOLS.supabase.methods.darwin, []);
  assert.deepEqual(TOOLS.docker.methods.win32, []);
  assert.deepEqual(MANAGED.filter((id) => !TOOLS[id].managed), []);
});

test('table des moyens par outil', () => {
  assert.deepEqual(TOOLS.git.methods, { darwin: ['brew', 'xcode'], win32: ['winget'] });
  assert.deepEqual(TOOLS.gh.methods, { darwin: ['brew', 'official'], win32: ['winget', 'official'] });
  assert.deepEqual(TOOLS.claude.methods, { darwin: ['brew', 'npm', 'official'], win32: ['npm', 'official'] });
  assert.deepEqual(TOOLS.codex.methods, { darwin: ['brew', 'npm', 'official'], win32: ['npm', 'official'] });
  assert.equal(TOOLS.claude.agent, 'claude');
  assert.equal(TOOLS.codex.agent, 'codex');
  assert.deepEqual(MANAGED.filter((id) => TOOLS[id].loginable), ['gh', 'claude', 'codex']);
});

test('installCommand : non vide, sans interpolation, URL officielles seulement', () => {
  for (const id of MANAGED) {
    for (const platform of ['darwin', 'win32'] as const) {
      for (const m of TOOLS[id].methods[platform] ?? []) {
        const cmd = installCommand(id, m, platform);
        assert.ok(cmd.length > 0, `${id}/${m}/${platform}`);
        assert.ok(!cmd.includes('${'), `${id}/${m}/${platform} : ${cmd}`);
        for (const url of cmd.match(/https?:\/\/[^\s"'|)]+/g) ?? []) {
          assert.match(url, /^https:\/\/(claude\.ai|chatgpt\.com|github\.com|api\.github\.com)\//, url);
        }
      }
    }
  }
});

test('installCommand : commandes figées', () => {
  assert.equal(installCommand('claude', 'brew', 'darwin'), 'brew install --cask claude-code');
  assert.equal(installCommand('codex', 'brew', 'darwin'), 'brew install --cask codex');
  assert.equal(installCommand('gh', 'brew', 'darwin'), 'brew install gh');
  assert.equal(installCommand('git', 'brew', 'darwin'), 'brew install git');
  assert.equal(installCommand('git', 'xcode', 'darwin'), 'xcode-select --install');
  assert.equal(installCommand('git', 'winget', 'win32'), 'winget install --id Git.Git -e --source winget');
  assert.equal(installCommand('gh', 'winget', 'win32'), 'winget install --id GitHub.cli -e --source winget');
  assert.equal(installCommand('claude', 'npm', 'darwin'), 'npm install -g @anthropic-ai/claude-code');
  assert.equal(installCommand('codex', 'npm', 'win32'), 'npm install -g @openai/codex');
  assert.equal(installCommand('claude', 'official', 'darwin'), 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(installCommand('codex', 'official', 'darwin'), 'curl -fsSL https://chatgpt.com/codex/install.sh | sh');
  assert.equal(installCommand('claude', 'official', 'win32'), 'irm https://claude.ai/install.ps1 | iex');
});

test('installCommand gh official : API releases/latest, zip macOS, binaire dans .tarmac/tools/bin', () => {
  const cmd = installCommand('gh', 'official', 'darwin');
  assert.match(cmd, /https:\/\/api\.github\.com\/repos\/cli\/cli\/releases\/latest/);
  assert.match(cmd, /https:\/\/github\.com\/cli\/cli\/releases\/download\//);
  assert.match(cmd, /macOS_\$a\.zip/);
  assert.match(cmd, /\.tarmac\/tools\/bin/);
  assert.match(cmd, /arm64/);
  assert.match(cmd, /amd64/);
});

test('installCommand : moyen absent de la table ou plateforme inconnue lève', () => {
  assert.throws(() => installCommand('git', 'npm', 'darwin'));
  assert.throws(() => installCommand('git', 'brew', 'linux'));
});

test('updateCommand', () => {
  assert.equal(updateCommand('claude', 'official', 'darwin'), 'claude update');
  assert.equal(updateCommand('claude', 'official', 'win32'), 'claude update');
  assert.equal(updateCommand('git', 'xcode', 'darwin'), null);
  assert.equal(updateCommand('claude', 'brew', 'darwin'), 'brew upgrade --cask claude-code');
  assert.equal(updateCommand('codex', 'brew', 'darwin'), 'brew upgrade --cask codex');
  assert.equal(updateCommand('gh', 'brew', 'darwin'), 'brew upgrade gh');
  assert.equal(updateCommand('codex', 'npm', 'darwin'), 'npm install -g @openai/codex@latest');
  assert.equal(updateCommand('claude', 'npm', 'darwin'), 'npm install -g @anthropic-ai/claude-code@latest');
  assert.equal(updateCommand('git', 'winget', 'win32'), 'winget upgrade --id Git.Git -e --source winget');
  assert.equal(updateCommand('gh', 'official', 'darwin'), installCommand('gh', 'official', 'darwin'));
  assert.equal(updateCommand('codex', 'official', 'darwin'), installCommand('codex', 'official', 'darwin'));
});

test('updateCommand : jamais vide ni interpolé', () => {
  for (const id of MANAGED as ManagedId[]) {
    for (const platform of ['darwin', 'win32'] as const) {
      for (const m of TOOLS[id].methods[platform] ?? ([] as Method[])) {
        const cmd = updateCommand(id, m, platform);
        if (cmd !== null) { assert.ok(cmd.length > 0); assert.ok(!cmd.includes('${')); }
      }
    }
  }
});

test('connexion, statut et version', () => {
  assert.equal(loginCommand('gh'), 'gh auth login');
  assert.equal(loginCommand('claude'), 'claude auth login');
  assert.equal(loginCommand('codex'), 'codex login');
  assert.deepEqual(statusCommand('gh'), ['gh', 'auth', 'status']);
  assert.deepEqual(statusCommand('claude'), ['claude', 'auth', 'status']);
  assert.deepEqual(statusCommand('codex'), ['codex', 'login', 'status']);
  for (const id of ['git', 'gh', 'claude', 'codex', 'docker', 'supabase'] as const) assert.deepEqual(versionArgs(id), ['--version']);
});

test('TOOLS_BIN_DIR : séparateurs de la plateforme demandée, quel que soit l\'hôte', () => {
  assert.equal(TOOLS_BIN_DIR('/h', 'darwin'), '/h/.tarmac/tools/bin');
  assert.equal(TOOLS_BIN_DIR('C:\\Users\\u', 'win32'), 'C:\\Users\\u\\.tarmac\\tools\\bin');
});

test('TOOLS_BIN_DIR', () => {
  assert.equal(TOOLS_BIN_DIR('/h'), path.join('/h', '.tarmac', 'tools', 'bin'));
});
