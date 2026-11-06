import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { actionCommand, afterInstall, launchSpec } from './actions.js';
import { installCommand } from './registry.js';
import type { ToolStatus } from './status.js';
import { makeCtx } from '../../cli/context.js';
import { executePlan } from '../../cli/plan.js';
import { planCodexSetup } from '../../cli/codex.js';

const st = (o: Partial<ToolStatus>): ToolStatus => ({
  id: 'codex', state: 'absent', version: null, path: null, method: null, installMethod: 'npm', latest: null, updatable: false, managed: true, loginable: true, docUrl: '', ...o,
});

test('install : commande figée du registre ; null hors outils gérés ou déjà présents', () => {
  assert.equal(actionCommand('install', st({}), 'darwin'), installCommand('codex', 'npm', 'darwin'));
  assert.equal(actionCommand('install', st({ id: 'docker', managed: false, installMethod: null }), 'darwin'), null);
  assert.equal(actionCommand('install', st({ installMethod: null }), 'darwin'), null);
  assert.equal(actionCommand('install', st({ state: 'ready', path: '/x/codex', method: 'npm' }), 'darwin'), null);
});

test('update : selon le moyen d\'origine ; null si inconnu ou sans mise à jour', () => {
  const ready = st({ state: 'ready', path: '/opt/homebrew/bin/codex', method: 'brew' });
  assert.equal(actionCommand('update', ready, 'darwin'), 'brew upgrade --cask codex');
  assert.equal(actionCommand('update', { ...ready, method: null }, 'darwin'), null);
  assert.equal(actionCommand('update', st({ id: 'git', state: 'ready', method: 'xcode' }), 'darwin'), null);
  assert.equal(actionCommand('update', st({}), 'darwin'), null);
});

test('login : outils connectables présents seulement', () => {
  assert.equal(actionCommand('login', st({ state: 'logged-out' }), 'darwin'), 'codex login');
  assert.equal(actionCommand('login', st({ id: 'git', state: 'ready', loginable: false }), 'darwin'), null);
  assert.equal(actionCommand('login', st({ state: 'absent' }), 'darwin'), null);
});

test('launchSpec : gh login garde les options et vide les jetons de l\'environnement', () => {
  const s = launchSpec('login', st({ id: 'gh', state: 'logged-out' }), 'darwin');
  assert.equal(s?.command, 'gh auth login --hostname github.com --git-protocol https --web');
  assert.equal(s?.label, 'gh auth login');
  assert.deepEqual(s?.unsetEnv, ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN']);
  assert.equal(launchSpec('login', st({ id: 'git', loginable: false }), 'darwin'), null);
});

function deps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const agents: Record<string, boolean>[] = [];
  return {
    calls, agents,
    d: {
      runScript: async (script: string, args: string[]) => { calls.push(`${script} ${args.join(' ')}`.trim()); return `${script} fait`; },
      codexPlan: async () => '',
      setAgents: (a: { claude?: boolean; codex?: boolean }) => { agents.push(a as Record<string, boolean>); },
      invalidateGithub: () => { calls.push('github-cache'); },
      ...over,
    },
  };
}

test('afterInstall codex : plan réel sur un HOME de test, agent codex coché', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-after-'));
  try {
    const ctx = makeCtx({ home, env: { HOME: home, DATA_DIR: path.join(home, '.tarmac') } });
    const { d, agents } = deps({
      codexPlan: async () => {
        const lines: string[] = [];
        await executePlan({ ctx, runner: { run: () => 0, capture: () => null }, out: { log: (s = '') => lines.push(s), error: (s) => lines.push(s) } }, [planCodexSetup(ctx)]);
        return lines.join('\n');
      },
    });
    const r = await afterInstall('codex', d);
    assert.equal(r.integration?.ok, true);
    assert.match(r.integration?.output ?? '', /Codex/);
    const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(toml, /\[mcp_servers\.tarmac\]/);
    assert.deepEqual(agents, [{ codex: true }]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('afterInstall claude : scripts mcp-install --code puis suivi-install, agent claude coché', async () => {
  const { d, calls, agents } = deps();
  const r = await afterInstall('claude', d);
  assert.deepEqual(calls, ['scripts/mcp-install.sh --code', 'scripts/suivi-install.sh']);
  assert.deepEqual(agents, [{ claude: true }]);
  assert.deepEqual(r, { integration: { ok: true, output: 'scripts/mcp-install.sh fait\nscripts/suivi-install.sh fait' } });
});

test('afterInstall claude : script en échec → erreur et sortie partielle, agent non coché', async () => {
  const { d, agents } = deps({
    runScript: async (script: string) => {
      if (script.includes('suivi')) throw Object.assign(new Error('claude CLI not found'), { output: 'stderr…' });
      return 'MCP posé';
    },
  });
  const r = await afterInstall('claude', d);
  assert.deepEqual(r, { integration: { ok: false, output: 'MCP posé\nstderr…', error: 'claude CLI not found' } });
  assert.deepEqual(agents, []);
});

test('afterInstall gh : cache GitHub invalidé ; git : rien', async () => {
  const a = deps();
  assert.deepEqual(await afterInstall('gh', a.d), { integration: null });
  assert.deepEqual(a.calls, ['github-cache']);
  const b = deps();
  await afterInstall('git', b.d);
  assert.deepEqual(b.calls, []);
  assert.deepEqual(b.agents, []);
});
