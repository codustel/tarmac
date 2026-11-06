import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCtx, type Out, type Runner } from './context.js';
import { executePlan } from './plan.js';
import { planSetup, type SetupOptions } from './setup.js';
import { main } from './tarmac.js';
import { managedStatuses, planToolsInstall, toolsWanted, writeAgents } from './tools.js';
import type { ToolStatus } from '../server/tools/status.js';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-tools-'));
  const home = path.join(root, 'home');
  const appDir = path.join(root, 'pkg');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(appDir, 'dist/server'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: '@codustel/tarmac', version: '9.9.9' }));
  fs.writeFileSync(path.join(appDir, 'dist/server/index.js'), '');
  fs.mkdirSync(path.join(root, 'etc'));
  fs.writeFileSync(path.join(root, 'etc/hosts'), '127.0.0.1\tlocalhost\n');
  // Dossiers d'outils limités au bac à sable : jamais les outils réels de l'hôte (/opt/homebrew/bin, bin de node).
  const toolDirs = [path.join(home, '.tarmac/tools/bin'), path.join(home, '.local/bin')];
  const ctx = makeCtx({ home, appDir, env: { PATH: '' }, uid: 501, nodeVersion: '22.13.0', platform: 'darwin', sysRoot: root, toolDirs });
  return { root, home, ctx };
}

/** Faux runner : `responses` = sorties de `capture` ; `onRun` = effet d'une commande lancée. */
function fakeRunner(responses: Record<string, string> = {}, onRun: (argv: string[]) => void = () => {}) {
  const runs: string[][] = [];
  const runner: Runner = {
    run: (argv) => { runs.push(argv); onRun(argv); return 0; },
    capture: (argv) => responses[argv.join(' ')] ?? null,
  };
  return { runner, runs };
}
const BREW = { 'which -a brew': '/opt/homebrew/bin/brew\n' };

function capture(): Out & { text: () => string } {
  const lines: string[] = [];
  return { log: (s = '') => lines.push(s), error: (s) => lines.push(s), text: () => lines.join('\n') };
}

const absent = (id: ToolStatus['id'], installMethod: ToolStatus['installMethod']): ToolStatus => ({
  id, state: 'absent', version: null, path: null, method: null, installMethod, latest: null, updatable: false, managed: true, loginable: false, docUrl: '',
});
const opts = (o: Partial<SetupOptions> = {}): SetupOptions => ({ domain: 'tarmac.localhost', sudo: false, claude: false, claudeDesktop: false, open: false, ...o });

test('statuts : codex absent, brew présent → moyen brew', async () => {
  const { ctx } = sandbox();
  const st = await managedStatuses(ctx, fakeRunner(BREW).runner);
  assert.deepEqual(st.map((s) => s.id), ['git', 'gh', 'claude', 'codex']);
  assert.ok(st.every((s) => s.state === 'absent'));
  assert.equal(st.find((s) => s.id === 'codex')!.installMethod, 'brew');
});

test('dry-run --yes : la commande d’installation de codex s’affiche, avant l’étape Codex', async () => {
  const { ctx } = sandbox();
  const out = capture();
  assert.equal(await main(['setup', '--dry-run', '--yes'], ctx, fakeRunner(BREW).runner, out), 0);
  const text = out.text();
  assert.match(text, /brew install --cask codex/);
  assert.match(text, /brew install --cask claude-code/);
  assert.ok(text.indexOf('brew install --cask codex') < text.indexOf('Set up the Codex integration'), 'outils avant intégration Codex');
  assert.ok(text.indexOf('brew install --cask claude-code') < text.indexOf('Set up the Claude Code integration'), 'outils avant intégration Claude');
});

test('toolsWanted : --yes sans terminal = tous les absents ; un outil présent est ignoré', async () => {
  const st = [absent('git', 'xcode'), { ...absent('gh', 'brew'), state: 'ready' as const }, absent('codex', 'brew')];
  const out = capture();
  assert.deepEqual(await toolsWanted({ yes: true }, false, async () => { throw new Error('pas de question'); }, st, out), ['git', 'codex']);
});

test('toolsWanted : sans terminal ni --yes = aucun, avec le message', async () => {
  const out = capture();
  assert.deepEqual(await toolsWanted({ yes: false }, false, async () => true, [absent('codex', 'brew')], out), []);
  assert.match(out.text(), /Tools not installed: tarmac setup --yes, or Settings → Tools/);
  const none = capture();
  await toolsWanted({ yes: false }, false, async () => true, [], none);
  assert.equal(none.text(), '', 'rien d’absent : aucun message');
});

test('toolsWanted : interactif = recommandation puis une question par outil absent', async () => {
  const qs: string[] = [];
  const out = capture();
  const chosen = await toolsWanted({ yes: false }, true, async (q) => { qs.push(q); return !q.includes('GitHub CLI'); }, [absent('gh', 'brew'), absent('codex', 'npm')], out);
  assert.deepEqual(chosen, ['codex']);
  assert.match(out.text(), /Recommended: install everything/);
  assert.deepEqual(qs, ['Install GitHub CLI with brew?', 'Install Codex with npm?']);
});

test('planToolsInstall : une action exec par outil (erreurs ignorées) ; git xcode : message puis xcode-select sans attente', () => {
  const { ctx } = sandbox();
  const step = planToolsInstall(ctx, ['codex', 'git'], [absent('codex', 'brew'), absent('git', 'xcode')]);
  const execs = step.actions.filter((a) => a.kind === 'exec');
  assert.deepEqual(execs.map((a) => a.kind === 'exec' && a.argv), [['brew', 'install', '--cask', 'codex'], ['xcode-select', '--install']]);
  assert.ok(execs.every((a) => a.kind === 'exec' && a.allowFail));
  const tasks = step.actions.filter((a) => a.kind === 'task');
  assert.ok(tasks.some((a) => a.kind === 'task' && /Xcode/.test(a.label)), 'message Xcode');
});

test('planSetup : étape outils avant les intégrations Claude et Codex', () => {
  const { ctx } = sandbox();
  const ids = planSetup(ctx, opts({ claude: true, codex: true, tools: { chosen: ['codex'], statuses: [absent('codex', 'brew')], welcome: false } }), fakeRunner().runner).map((s) => s.id);
  assert.deepEqual(ids.slice(-2), ['claude', 'codex']);
  assert.ok(ids.indexOf('tools') < ids.indexOf('claude'), 'outils avant intégration Claude');
});

test('planSetup : étape outils avant le (re)démarrage du service et l’ouverture du navigateur (I1)', () => {
  const { ctx } = sandbox();
  const ids = planSetup(ctx, opts({ open: true, tools: { chosen: ['codex'], statuses: [absent('codex', 'brew')], welcome: true } }), fakeRunner().runner).map((s) => s.id);
  assert.ok(ids.indexOf('tools') >= 0, 'étape outils présente');
  assert.ok(ids.indexOf('tools') < ids.indexOf('launch-agent'), `outils avant le service : ${ids.join(',')}`);
  assert.ok(ids.indexOf('tools') < ids.indexOf('start'), 'outils avant l’ouverture du navigateur');
  assert.ok(ids.indexOf('env') < ids.indexOf('tools'), 'après la configuration (étapes 0-1)');
});

test('dry-run --yes : installation des outils affichée avant le service', async () => {
  const { ctx } = sandbox();
  const out = capture();
  assert.equal(await main(['setup', '--dry-run', '--yes'], ctx, fakeRunner(BREW).runner, out), 0);
  const text = out.text();
  assert.ok(text.indexOf('brew install --cask codex') < text.indexOf('Install the login service'), 'outils avant le service');
});

// La CLI ne tourne que sous macOS (cli/tarmac.ts) : `which` et le PATH sont posix, hôte Unix seulement.
const UNIX_HOST = { skip: process.platform === 'win32' && 'CLI macOS seulement : PATH et which posix' };

test('exécution : codex installé → agent coché dans settings.json, --yes met toolsWelcomeSeen', UNIX_HOST, async () => {
  const { ctx, home } = sandbox();
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.dataDir, 'settings.json'), JSON.stringify({ theme: 'dark', agents: { claude: true, codex: false } }));
  const { runner, runs } = fakeRunner({}, (argv) => {
    if (argv.join(' ') === 'brew install --cask codex') {
      fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
      fs.writeFileSync(path.join(home, '.local/bin/codex'), '#!/bin/sh\n', { mode: 0o755 });
    }
  });
  const step = planSetup(ctx, opts({ tools: { chosen: ['codex'], statuses: [absent('codex', 'brew')], welcome: true } }), runner).find((s) => s.id === 'tools')!;
  await executePlan({ ctx, runner, out: capture() }, [step]);
  assert.deepEqual(runs, [['brew', 'install', '--cask', 'codex']]);
  const s = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8'));
  assert.deepEqual(s.agents, { claude: true, codex: true });
  assert.equal(s.toolsWelcomeSeen, true);
  assert.equal(s.theme, 'dark', 'autres réglages gardés');
});

test('exécution : installation sans effet (outil toujours absent) → agent non coché', async () => {
  const { ctx } = sandbox();
  const { runner } = fakeRunner();
  const step = planToolsInstall(ctx, ['codex'], [absent('codex', 'brew')]);
  await executePlan({ ctx, runner, out: capture() }, [step]);
  assert.ok(!fs.existsSync(path.join(ctx.dataDir, 'settings.json')));
});

test('writeAgents : settings.json corrompu ou non objet reste identique, avertissement', () => {
  for (const bad of ['{ "roots": [', '[1,2]', 'null', '']) {
    const { ctx } = sandbox();
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    const f = path.join(ctx.dataDir, 'settings.json');
    fs.writeFileSync(f, bad);
    const out = capture();
    assert.equal(writeAgents(ctx, { codex: true }, true, out), false);
    assert.equal(fs.readFileSync(f, 'utf8'), bad, 'octets identiques');
    assert.match(out.text(), /left untouched/);
    assert.deepEqual(fs.readdirSync(ctx.dataDir), ['settings.json'], 'pas de fichier temporaire');
  }
});

test('writeAgents : fichier valide garde ses clés et son mode, gagne agents et toolsWelcomeSeen', UNIX_HOST, () => {
  const { ctx } = sandbox();
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  const f = path.join(ctx.dataDir, 'settings.json');
  fs.writeFileSync(f, JSON.stringify({ roots: ['/a'], favorites: ['x'] }), { mode: 0o640 });
  fs.chmodSync(f, 0o640);
  assert.equal(writeAgents(ctx, { codex: true }, true, capture()), true);
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual([s.roots, s.favorites, s.agents, s.toolsWelcomeSeen], [['/a'], ['x'], { claude: true, codex: true }, true]);
  assert.equal(fs.statSync(f).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(ctx.dataDir), ['settings.json']);
});
