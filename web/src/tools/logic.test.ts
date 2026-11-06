import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navAlerts, isXcodeInstall, xcodeWait, installQueue, nextStep, sessionOutcome, shouldShowWelcome, canInstall, installCheckbox, showOfficialLink, gateAction } from './logic';
import type { ToolStatus } from '../api';

const MANAGED = ['git', 'gh', 'claude', 'codex'];
const tool = (id: string, state: ToolStatus['state'] = 'ready'): ToolStatus => ({
  id: id as ToolStatus['id'], state, version: null, path: null, method: null, installMethod: 'brew',
  latest: null, updatable: false, managed: MANAGED.includes(id), loginable: false, docUrl: 'https://x',
});
const all = (over: Record<string, ToolStatus['state']> = {}) =>
  ['git', 'gh', 'claude', 'codex', 'docker', 'supabase'].map((id) => tool(id, over[id] ?? 'ready'));

test('shouldShowWelcome : vrai si codex absent et pas vu', () => {
  assert.equal(shouldShowWelcome(all({ codex: 'absent' }), false), true);
});
test('shouldShowWelcome : faux si tout géré est prêt, même Docker absent', () => {
  assert.equal(shouldShowWelcome(all({ docker: 'absent' }), false), false);
});
test('shouldShowWelcome : faux si déjà vu', () => {
  assert.equal(shouldShowWelcome(all({ codex: 'absent' }), true), false);
});
test('installQueue : ordre git, gh, claude, codex ; ignore décochés et prêts', () => {
  const tools = all({ codex: 'absent', git: 'absent', claude: 'absent', gh: 'ready' });
  const q = installQueue(tools, new Set(['codex', 'claude', 'git', 'gh'] as const));
  assert.deepEqual(q, ['git', 'claude', 'codex']);
  assert.deepEqual(installQueue(tools, new Set(['codex'] as const)), ['codex']);
});

test('nextStep : succès, passe au suivant', () => {
  assert.deepEqual(nextStep(['gh', 'codex'], 0), { failed: false, next: 'gh', rest: ['codex'] });
});
test('nextStep : échec marqué mais la file continue', () => {
  assert.deepEqual(nextStep(['claude', 'codex'], 1), { failed: true, next: 'claude', rest: ['codex'] });
  assert.deepEqual(nextStep([], null), { failed: true, next: null, rest: [] });
});

test('sessionOutcome : en cours, terminée, disparue', () => {
  const l = [{ id: 'a', status: 'running', exitCode: null }, { id: 'b', status: 'exited', exitCode: 2 }];
  assert.deepEqual(sessionOutcome(l, 'a'), { done: false });
  assert.deepEqual(sessionOutcome(l, 'b'), { done: true, exitCode: 2 });
  assert.deepEqual(sessionOutcome(l, 'zz'), { done: true, exitCode: null });
});

test('isXcodeInstall : git, install, méthode xcode seulement', () => {
  assert.equal(isXcodeInstall('git', 'install', 'xcode'), true);
  assert.equal(isXcodeInstall('git', 'login', 'xcode'), false);
  assert.equal(isXcodeInstall('git', 'install', 'brew'), false);
  assert.equal(isXcodeInstall('claude', 'install', 'xcode'), false);
});

test('xcodeWait : prêt, attente, délai dépassé', () => {
  assert.equal(xcodeWait('ready', 100, 50), 'ready');
  assert.equal(xcodeWait('absent', 10, 50), 'wait');
  assert.equal(xcodeWait(undefined, 10, 50), 'wait');
  assert.equal(xcodeWait('absent', 50, 50), 'timeout');
});

test('navAlerts : tout prêt, aucune alerte', () => {
  assert.deepEqual(navAlerts(all()), {});
});
test('navAlerts : docker absent ou arrêté, pas inconnu', () => {
  assert.equal(navAlerts(all({ docker: 'absent' })).docker, true);
  assert.equal(navAlerts(all({ docker: 'stopped' })).docker, true);
  assert.deepEqual(navAlerts(all({ docker: 'unknown' })), {});
});
test('navAlerts : supabase absent seulement', () => {
  assert.equal(navAlerts(all({ supabase: 'absent' })).supabase, true);
  assert.deepEqual(navAlerts(all({ supabase: 'unknown' })), {});
});
test('navAlerts : claude et codex absents ou déconnectés', () => {
  assert.equal(navAlerts(all({ claude: 'absent' })).claude, true);
  assert.equal(navAlerts(all({ codex: 'logged-out' })).codex, true);
  assert.deepEqual(navAlerts(all({ claude: 'unknown' })), {});
});
test('navAlerts : github selon gh', () => {
  assert.equal(navAlerts(all({ gh: 'absent' })).github, true);
  assert.equal(navAlerts(all({ gh: 'logged-out' })).github, true);
  assert.deepEqual(navAlerts(all({ git: 'absent' })), {});
});

test('installMethod null : pas installable, lien officiel à la place d’Installer, hors file (I7)', () => {
  const noWay = { ...tool('git', 'absent'), installMethod: null };
  assert.equal(canInstall(noWay), false);
  assert.equal(showOfficialLink(noWay), true);
  assert.equal(installCheckbox(noWay, 'settings'), 'none');
  assert.equal(installCheckbox(noWay, 'welcome'), 'locked');
  assert.deepEqual(installQueue([noWay, tool('codex', 'absent')], new Set(['git', 'codex'] as const)), ['codex']);
  assert.equal(canInstall(tool('codex', 'absent')), true);
  assert.equal(showOfficialLink(tool('codex', 'absent')), false);
  assert.equal(showOfficialLink(tool('docker', 'absent')), true, 'outil non géré : toujours le lien');
});

test('installCheckbox : en Réglages, aucune case pour un outil déjà prêt ; à l’accueil, case figée', () => {
  assert.equal(installCheckbox(tool('gh', 'ready'), 'settings'), 'none');
  assert.equal(installCheckbox(tool('gh', 'logged-out'), 'settings'), 'none');
  assert.equal(installCheckbox(tool('gh', 'absent'), 'settings'), 'active');
  assert.equal(installCheckbox(tool('gh', 'ready'), 'welcome'), 'locked');
  assert.equal(installCheckbox(tool('docker', 'absent'), 'settings'), 'none');
});

test('gateAction : connexion, installation, ou page officielle sans moyen d’installation (I7)', () => {
  assert.equal(gateAction({ tool: 'gh', state: 'logged-out', installMethod: null, docUrl: 'https://d' }), 'login');
  assert.equal(gateAction({ tool: 'git', state: 'absent', installMethod: 'brew', docUrl: 'https://d' }), 'install');
  assert.equal(gateAction({ tool: 'git', state: 'absent', installMethod: null, docUrl: 'https://d' }), 'doc');
  assert.equal(gateAction({ tool: 'git', state: 'absent', installMethod: null }), 'install', 'sans page connue : Installer (le serveur répondra)');
});
