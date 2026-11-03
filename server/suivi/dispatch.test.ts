import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { SuiviService } from './service.js';
import { buildPrompt, cleanText, codexConsoleState, consoleState, isCodexFooterLine, pasteSequence, screenText, SuiviDispatcher, type ConsoleInfo } from './dispatch.js';
import { countTasks, sanitizeTask } from './types.js';

// Chemins absolus de la plateforme (C:\dev\… sous Windows), comme ceux que Tarmac scanne.
const ROOT = path.resolve('/dev/acme-shop');
const OTHER = path.resolve('/dev/other');
const T = (id: string, order: number, over: object = {}) => ({ id, order, phase: 4, phaseTitle: 'Phase 4', num: `4.${order}`, title: `Tâche ${id}`, who: 'claude', minutes: 30, ...over });

// Écrans de Claude Code (sortie brute, avec couleurs et effacements comme la TUI).
const NOW = Date.parse('2026-11-01T12:00:00Z');
const AGO = (ms: number) => new Date(NOW - ms).toISOString();
const ESC = '\x1b';
const IDLE = `${ESC}[2K${ESC}[1A${ESC}[2K${ESC}[G⏺ Done, the tests pass.\r\n\r\n${ESC}[2m────────────────────────${ESC}[22m\r\n> ${ESC}[7m ${ESC}[27m\r\n${ESC}[2m────────────────────────${ESC}[22m\r\n  ${ESC}[2m? for shortcuts${ESC}[22m\r\n`;
const BUSY = `${IDLE}${ESC}[5A${ESC}[2K${ESC}[38;5;209m✻${ESC}[39m Thinking… ${ESC}[2m(12s · ↑ 1.2k tokens · esc to interrupt)${ESC}[22m\r\n\r\n${'─'.repeat(100)}\r\n> \r\n${'─'.repeat(100)}\r\n`;
const PERMISSION = `${IDLE}${ESC}[6A${ESC}[2K╭────────────────────────╮\r\n│ Bash command           │\r\n│   rm -rf build         │\r\n│ Do you want to proceed?│\r\n│ ${ESC}[36m❯ 1. Yes${ESC}[39m              │\r\n│   2. Yes, and don't ask again │\r\n│   3. No, and tell Claude what to do differently (esc) │\r\n╰────────────────────────╯\r\n`;
const TYPING = `${IDLE}${ESC}[3A${ESC}[2K> fix the hea${ESC}[7m ${ESC}[27m\r\n────\r\n`;

type Screens = Record<string, { text: string; lastOutputAt: string | null }>;
const idleScreens = (consoles: ConsoleInfo[]): Screens => Object.fromEntries(consoles.map((c) => [c.id, { text: IDLE, lastOutputAt: AGO(10_000) }]));

function setup(consoles: ConsoleInfo[] = [], screens: Screens = idleScreens(consoles)) {
  const s = new SuiviService(openDb(':memory:'));
  s.registerProject({ projectId: 'acme/shop', name: 'shop', paths: [ROOT] });
  s.registerProject({ projectId: 'acme/other', name: 'other', paths: [OTHER] });
  s.importFile('acme/shop', { collection: 'tasks', exportedAt: '2026-10-10T00:00:00Z', tasks: [
    T('t-4-12', 12, { title: 'Ajouter\x1b[31m le\nbouton\u202e « Claude »\x07' }), T('t-4-13', 13, { toTest: true }), T('t-4-14', 14, { done: true }), T('t-4-15', 15, { archived: true }),
  ] });
  const writes: [string, string][] = [];
  let onWrite: ((id: string, data: string) => void) | undefined;
  const opened: [string, string][] = [];
  const d = new SuiviDispatcher({
    service: s,
    appProjects: () => [{ id: 'shop-web', dir: path.join(ROOT, 'apps', 'web') }, { id: 'shop', dir: ROOT }, { id: 'other', dir: OTHER }, { id: 'near', dir: `${ROOT}-2` }],
    consoles: () => consoles,
    sessionTitle: (id) => (id === 'cs-1' ? 'Refonte du panier' : null),
    write: (id, data) => { writes.push([id, data]); onWrite?.(id, data); },
    screen: (id) => screens[id] ?? null,
    now: () => NOW,
    openSession: async (appProjectId, prompt) => { opened.push([appProjectId, prompt]); return { id: 'new-term', label: 'Claude · shop' }; },
    lang: () => 'fr',
    delay: async () => {},
  });
  return { s, d, writes, opened, screens, setOnWrite: (f: typeof onWrite) => { onWrite = f; } };
}
const C = (id: string, projectId: string, over: Partial<ConsoleInfo> = {}): ConsoleInfo => ({
  id, projectId, kind: 'claude', status: 'running', label: `Claude · ${projectId}`, claudeSessionId: null, startedAt: '2026-11-01T10:00:00Z', lastActivityAt: null, ...over,
});

test('consigne : nettoyage du titre (contrôles, ESC, sauts de ligne, bidi) et langue', () => {
  assert.equal(cleanText('a\x1b[200~b\r\nc\u202ed\x00  e'), 'ab c d e');
  assert.equal(cleanText('x'.repeat(300)).length, 200);
  const fr = buildPrompt({ id: 't-4-12', num: '4.12', title: 'Titre\x1b[201~\rmalin' }, 'acme/shop', 'fr');
  assert.equal(fr, 'Traite la tâche 4.12 « Titre malin » (id t-4-12) du suivi acme/shop : lis-la avec suivi_get, fais-la, puis passe-la à tester (règles du suivi).');
  assert.doesNotMatch(fr, /[\u0000-\u001f\u007f-\u009f]/);
  const en = buildPrompt({ id: 't-4-12', num: '4.12', title: 'Add the button' }, 'acme/shop', 'en');
  assert.equal(en, 'Handle task 4.12 “Add the button” (id t-4-12) from the acme/shop tracker: read it with suivi_get, do it, then mark it to test (tracker rules).');
  // Collage entre crochets : la consigne ne peut pas en sortir (aucun ESC).
  assert.equal(pasteSequence(fr).split('\x1b').length, 3);
});

test('sessions : seulement les sessions Claude en cours des dossiers du projet', () => {
  const { d } = setup([
    C('a', 'shop', { lastActivityAt: '2026-11-01T10:05:00Z', claudeSessionId: 'cs-1' }),
    C('b', 'shop-web', { lastActivityAt: '2026-11-01T10:09:00Z' }),
    C('c', 'shop', { status: 'exited' }),
    C('d', 'shop', { kind: 'shell' }),
    C('e', 'other'),
    C('f', 'near'),
  ]);
  const list = d.sessions('acme/shop');
  assert.deepEqual(list.map((x) => x.terminalId), ['b', 'a'], 'plus récemment active d’abord ; ni shell, ni terminée, ni autre projet, ni dossier voisin');
  assert.equal(list[1].title, 'Refonte du panier');
  assert.throws(() => d.sessions('acme/nope'), /inconnu|Unknown/);
});

test('envoi vers une session en cours : collage entre crochets, Entrée, tâche demandée', async () => {
  const { s, d, writes } = setup([C('a', 'shop'), C('e', 'other')]);
  const r = await d.dispatch('acme/shop', 't-4-12', 'a');
  assert.equal(r.target, 'session');
  assert.deepEqual(writes.map(([id]) => id), ['a', 'a']);
  assert.equal(writes[0][1], `\x1b[200~${r.prompt}\x1b[201~`);
  assert.equal(writes[1][1], '\r');
  assert.match(r.prompt, /^Traite la tâche 4\.12 « Ajouter le bouton « Claude » » \(id t-4-12\) du suivi acme\/shop/);
  const t = s.task('acme/shop', 't-4-12')!;
  assert.ok(t.requestedAt);
  assert.equal(t.requestedTo, 'Claude · shop');
  assert.equal(t.updatedBy, 'tarmac');
  assert.equal(countTasks(s.tasks('acme/shop')).requested, 1);
});

test('envoi : console hors projet, console non Claude ou inconnue refusées, rien n’est écrit', async () => {
  const { d, writes } = setup([C('e', 'other'), C('sh', 'shop', { kind: 'shell' }), C('x', 'shop', { status: 'exited' })]);
  for (const target of ['e', 'sh', 'x', 'zzz']) await assert.rejects(d.dispatch('acme/shop', 't-4-12', target), (e: any) => e.statusCode === 404);
  await assert.rejects(d.dispatch('acme/shop', 't-4-12', 'a;rm -rf'), (e: any) => e.statusCode === 400);
  await assert.rejects(d.dispatch('acme/shop', '../x', 'new'), (e: any) => e.statusCode === 400);
  await assert.rejects(d.dispatch('acme/shop', 't-9-99', 'new'), (e: any) => e.statusCode === 404);
  await assert.rejects(d.dispatch('acme/nope', 't-4-12', 'new'), (e: any) => e.statusCode === 404);
  assert.equal(writes.length, 0);
});

test('envoi : tâche déjà traitée (à tester, faite, archivée) refusée', async () => {
  const { d, writes, opened } = setup([C('a', 'shop')]);
  for (const id of ['t-4-13', 't-4-14', 't-4-15']) await assert.rejects(d.dispatch('acme/shop', id, 'a'), (e: any) => e.statusCode === 409);
  assert.equal(writes.length + opened.length, 0);
});

test('envoi vers une nouvelle session : ouverte à la racine du projet avec la consigne', async () => {
  const { s, d, opened } = setup();
  const r = await d.dispatch('acme/shop', 't-4-12', 'new');
  assert.deepEqual(opened, [['shop', r.prompt]], 'projet racine (dossier du suivi) plutôt que le sous-projet');
  assert.equal(r.terminalId, 'new-term');
  assert.equal(s.task('acme/shop', 't-4-12')!.requestedTo, 'new');
});

test('demandée à Claude : effacé au passage à tester ou faite (Tarmac, Claude, artefact)', async () => {
  const { s, d } = setup([C('a', 'shop')]);
  await d.dispatch('acme/shop', 't-4-12', 'a');
  // Claude (canal B) la passe à tester.
  const t1 = s.upsertTask('acme/shop', { id: 't-4-12', toTest: true });
  assert.equal(t1.requestedAt, null);
  assert.equal(t1.requestedTo, '');
  // Remise à faire, redemandée, puis cochée depuis Tarmac.
  const back = s.patchTask('acme/shop', 't-4-12', t1.rev, { toTest: false }, 'tarmac');
  await d.dispatch('acme/shop', 't-4-12', 'new');
  const asked = s.task('acme/shop', 't-4-12')!;
  assert.ok(asked.requestedAt && back.rev < asked.rev);
  const done = s.patchTask('acme/shop', 't-4-12', asked.rev, { done: true }, 'tarmac');
  assert.equal(done.requestedAt, null);
  const fields = s.history('acme/shop', 't-4-12').filter((e) => e.rev === done.rev).map((e) => e.field).sort();
  assert.deepEqual(fields, ['done', 'doneAt', 'requestedAt', 'requestedTo'], 'effacement journalisé');
  // Artefact (canal A) : une copie plus récente « à tester » qui porte encore la demande → effacée.
  const later = new Date(Date.now() + 5000).toISOString();
  s.pushTasks('acme/shop', [{ ...s.task('acme/shop', 't-4-13')!, requestedAt: later, requestedTo: 'copy', updatedAt: later, rev: 9 }], 'A', { uiOnly: true });
  assert.equal(s.task('acme/shop', 't-4-13')!.requestedAt, null);
});

test('demandée à Claude : marquée depuis l’artefact sans pont, reprise par Tarmac (canal A)', () => {
  const { s } = setup();
  const later = new Date(Date.now() + 5000).toISOString();
  const local = s.task('acme/shop', 't-4-12')!;
  s.pushTasks('acme/shop', [{ ...local, requestedAt: later, requestedTo: 'copy\x1b[2J', updatedAt: later, rev: local.rev + 1 }], 'A', { uiOnly: true });
  const t = s.task('acme/shop', 't-4-12')!;
  assert.equal(t.requestedAt, later);
  assert.equal(t.requestedTo, 'copy [2J', 'texte nettoyé');
});

test('demandée à Claude : jamais depuis une copie de dépôt ni une écriture de Claude', async () => {
  const { s, d } = setup([C('a', 'shop')]);
  const later = new Date(Date.now() + 5000).toISOString();
  // Copie fabriquée : nouvelle tâche et tâche existante « demandées », plus récentes que Tarmac.
  s.importFile('acme/shop', { collection: 'tasks', exportedAt: later, tasks: [
    T('t-4-20', 20, { requestedAt: later, requestedTo: 'new', updatedAt: later }),
    T('t-4-12', 12, { title: 'Ajouter le bouton', requestedAt: later, requestedTo: 'copy', updatedAt: later }),
  ] });
  assert.equal(s.task('acme/shop', 't-4-20')!.requestedAt, null);
  assert.equal(s.task('acme/shop', 't-4-12')!.requestedAt, null);
  assert.equal(s.task('acme/shop', 't-4-12')!.title, 'Ajouter le bouton', 'le reste de la copie est bien repris');
  // Claude (canal B) ne pose pas la marque…
  s.upsertTask('acme/shop', { id: 't-4-12', requestedAt: later, requestedTo: 'x' });
  assert.equal(s.task('acme/shop', 't-4-12')!.requestedAt, null);
  // … et une copie ne l'efface pas non plus après un vrai clic.
  await d.dispatch('acme/shop', 't-4-12', 'a');
  const asked = s.task('acme/shop', 't-4-12')!.requestedAt;
  const later2 = new Date(Date.now() + 10_000).toISOString();
  s.importFile('acme/shop', { collection: 'tasks', exportedAt: later2, tasks: [T('t-4-12', 12, { title: 'Ajouter le bouton', note: 'n', updatedAt: later2 })] });
  assert.equal(s.task('acme/shop', 't-4-12')!.requestedAt, asked);
});

test('migration : une tâche écrite avant le champ le reçoit vide', () => {
  const t = sanitizeTask({ id: 't-1-01', title: 'Ancienne' });
  assert.equal(t.requestedAt, null);
  assert.equal(t.requestedTo, '');
});

test('état d’une session Claude lu sur son écran', () => {
  assert.equal(consoleState(IDLE, 10_000), 'idle');
  assert.equal(consoleState(IDLE, 500), 'busy', 'sortie toute récente : au travail');
  assert.equal(consoleState(BUSY, 10_000), 'busy', '« esc to interrupt » après la dernière invite');
  assert.equal(consoleState(PERMISSION, 10_000), 'permission');
  assert.equal(consoleState(PERMISSION + BUSY, 10_000), 'busy');
  assert.equal(consoleState(PERMISSION + IDLE, 10_000), 'idle', 'permission répondue puis invite vide');
  assert.equal(consoleState(IDLE, 10_000, 'working'), 'busy', 'transcript : outil en cours ou réponse en route');
  assert.equal(consoleState(IDLE, 10_000, 'idle'), 'idle');
  assert.equal(consoleState(TYPING, 10_000), 'unknown', 'saisie en cours : pas d’invite vide');
  assert.equal(consoleState('', 10_000), 'unknown');
  assert.equal(consoleState('$ ls\r\nREADME.md\r\n', 10_000), 'unknown');
  assert.match(screenText(IDLE), /\? for shortcuts/);
});

test('sessions : état affiché, seules les sessions au repos sont disponibles', () => {
  const consoles = [C('a', 'shop'), C('b', 'shop'), C('p', 'shop'), C('u', 'shop'), C('n', 'shop')];
  const { d } = setup(consoles, {
    a: { text: IDLE, lastOutputAt: AGO(10_000) },
    b: { text: BUSY, lastOutputAt: AGO(300) },
    p: { text: PERMISSION, lastOutputAt: AGO(60_000) },
    u: { text: TYPING, lastOutputAt: AGO(60_000) },
  });
  const byId = Object.fromEntries(d.sessions('acme/shop').map((x) => [x.terminalId, [x.state, x.available]]));
  assert.deepEqual(byId, { a: ['idle', true], b: ['busy', false], p: ['permission', false], u: ['unknown', false], n: ['unknown', false] });
});

test('envoi refusé (rien n’est écrit) : session au travail, en attente de permission, état inconnu', async () => {
  const consoles = [C('b', 'shop'), C('p', 'shop'), C('u', 'shop'), C('q', 'shop')];
  const { s, d, writes } = setup(consoles, {
    b: { text: BUSY, lastOutputAt: AGO(10_000) },
    p: { text: PERMISSION, lastOutputAt: AGO(10_000) },
    u: { text: TYPING, lastOutputAt: AGO(10_000) },
    q: { text: IDLE, lastOutputAt: AGO(200) },
  });
  for (const [id, state, re] of [['b', 'busy', /occupée|busy/], ['p', 'permission', /permission/], ['u', 'unknown', /inconnu|unknown/], ['q', 'busy', /occupée|busy/]] as const) {
    await assert.rejects(d.dispatch('acme/shop', 't-4-12', id), (e: any) => e.statusCode === 409 && e.data?.state === state && re.test(e.message) && /Nouvelle session|New session/.test(e.message) && /rien n’a été envoyé|nothing was sent/.test(e.message));
  }
  assert.equal(writes.length, 0);
  assert.equal(s.task('acme/shop', 't-4-12')!.requestedAt, null, 'pas marquée demandée');
});

test('envoi : une permission apparue pendant le collage bloque la touche Entrée', async () => {
  const { s, d, writes, screens, setOnWrite } = setup([C('a', 'shop')]);
  setOnWrite(() => { screens.a = { text: PERMISSION, lastOutputAt: AGO(0) }; });
  await assert.rejects(d.dispatch('acme/shop', 't-4-12', 'a'), (e: any) => e.statusCode === 409 && e.data?.state === 'permission');
  assert.deepEqual(writes.map(([, data]) => data.startsWith('\x1b[200~')), [true], 'collage seul, jamais de \\r');
  assert.equal(s.task('acme/shop', 't-4-12')!.requestedAt, null);
});

// ─── Codex : écrans de sa TUI (ratatui : positionnement du curseur entre les zones redessinées) ───
const AT = (row: number, col = 1) => `${ESC}[${row};${col}H`;
const CX_IDLE = `${AT(1)}• Done: the cart drawer is in place.${AT(20)}${ESC}[1m›${ESC}[22m${AT(20, 3)}${ESC}[2mAsk Codex to do anything${ESC}[22m${AT(22, 3)}${ESC}[2m? for shortcuts${ESC}[22m${AT(22, 60)}${ESC}[2m94% context left${ESC}[22m`;
const CX_BUSY = `${CX_IDLE}${AT(18)}${ESC}[2K• Working ${ESC}[2m(12s • esc to interrupt)${ESC}[22m${AT(20, 3)}${ESC}[2mAsk Codex to do anything${ESC}[22m`;
const CX_APPROVAL = `${CX_IDLE}${AT(12)}Would you like to run the following command?${AT(14)}  $ rm -rf build${AT(16)}› 1. Yes, proceed (y)${AT(17)}  2. Yes, and don't ask again for commands that start with \`rm\` (p)${AT(18)}  3. No, and tell Codex what to do differently (esc)`;
const CX_TYPING = `${CX_IDLE}${AT(20, 3)}fix the hea${ESC}[K`;

test('état d’une session Codex lu sur l’écran de sa TUI', () => {
  assert.equal(codexConsoleState(CX_IDLE, 10_000), 'idle');
  assert.equal(codexConsoleState(CX_IDLE, 500), 'busy', 'sortie toute récente');
  assert.equal(codexConsoleState(CX_BUSY, 10_000), 'busy', '« esc to interrupt » : au travail, même si la boîte vide est redessinée après');
  assert.equal(codexConsoleState(CX_APPROVAL, 10_000), 'permission');
  assert.equal(codexConsoleState(CX_APPROVAL + CX_IDLE, 10_000), 'permission', 'options d’approbation encore dans la fin d’écran : jamais au repos');
  assert.equal(codexConsoleState(CX_APPROVAL + CX_IDLE + `${AT(1)}${'• output line\r\n'.repeat(200)}` + CX_IDLE, 10_000), 'idle', 'approbation loin derrière, boîte vide redessinée');
  // Revue de sécurité : une ligne qui contient seulement un mot du pied de page n'est pas un pied de page.
  const ctrlApproval = `${CX_IDLE}${AT(23)}Press ctrl+y to approve the command (y)`;
  assert.equal(codexConsoleState(ctrlApproval, 10_000), 'permission', 'approbation avec « ctrl » dans la ligne');
  const ctrlLine = `${CX_IDLE}${AT(23)}rm -rf build ⏎ ctrl for shortcuts 94% context left`;
  assert.equal(codexConsoleState(ctrlLine, 10_000), 'unknown', 'ligne inconnue après la boîte vide (mots du pied de page dedans)');
  assert.equal(codexConsoleState(`${CX_IDLE}${AT(23)}Allow network access to example.com?`, 10_000), 'permission');
  assert.equal(codexConsoleState(`${CX_IDLE}${AT(23)}  2. No, and tell Codex`, 10_000), 'permission');
  assert.equal(codexConsoleState(`${CX_IDLE}${AT(23)}ctrl+a for agents · ? for shortcuts${AT(23, 60)}93`, 10_000), 'idle', 'pied de page connu, chiffres redessinés');
  assert.equal(codexConsoleState(CX_TYPING, 10_000), 'unknown', 'saisie commencée : le texte d’attente est effacé');
  assert.equal(codexConsoleState(CX_IDLE, 10_000, 'working'), 'busy', 'transcript : tour en cours');
  assert.equal(codexConsoleState(CX_BUSY, 10_000, 'idle'), 'idle', 'transcript : tour terminé, l’ancien indicateur non effacé est périmé');
  assert.equal(codexConsoleState(IDLE, 10_000), 'unknown', 'écran de Claude Code : jamais pris pour Codex au repos');
  assert.equal(codexConsoleState('', 10_000), 'unknown');
});

test('état Codex : pied de page lu mot par mot, sans retour arrière catastrophique (écran non fiable)', () => {
  assert.ok(isCodexFooterLine('  ? for shortcuts            94% context left'));
  assert.ok(isCodexFooterLine('ctrl+a for agents · ? for shortcuts'));
  assert.ok(isCodexFooterLine('──────── 93'));
  assert.ok(!isCodexFooterLine('rm -rf build ⏎ ctrl for shortcuts'));
  assert.ok(!isCodexFooterLine('─'.repeat(400)), 'ligne trop longue');
  for (const line of ['─'.repeat(10_000) + 'x', '1 '.repeat(5_000) + 'x', '› '.repeat(5_000) + 'x']) {
    const t0 = performance.now();
    assert.equal(codexConsoleState(`${CX_IDLE}${AT(23)}${line}`, 10_000), 'unknown');
    assert.ok(performance.now() - t0 < 50, `réponse en moins de 50 ms (${Math.round(performance.now() - t0)} ms)`);
  }
});

function codexSetup(consoles: ConsoleInfo[], screens: Screens, agents: ('claude' | 'codex')[] = ['claude', 'codex']) {
  const s = new SuiviService(openDb(':memory:'));
  s.registerProject({ projectId: 'acme/shop', name: 'shop', paths: [ROOT] });
  s.importFile('acme/shop', { collection: 'tasks', exportedAt: '2026-10-10T00:00:00Z', tasks: [T('t-4-12', 12, { title: 'Ajouter le tiroir' })] });
  const writes: [string, string][] = [];
  const opened: [string, string, string][] = [];
  const turns: [string, string][] = [];
  const d = new SuiviDispatcher({
    service: s,
    appProjects: () => [{ id: 'shop', dir: ROOT }],
    consoles: () => consoles,
    sessionTitle: (id, agent) => (agent === 'codex' && id === 'cx-1' ? 'Tiroir du panier' : null),
    write: (id, data) => { writes.push([id, data]); },
    screen: (id) => screens[id] ?? null,
    turn: (id, agent) => { turns.push([id, agent]); return 'idle'; },
    agents: () => agents,
    now: () => NOW,
    openSession: async (appProjectId, prompt, agent) => { opened.push([appProjectId, prompt, agent]); return { id: 'new-term', label: `${agent === 'codex' ? 'Codex' : 'Claude'} · shop` }; },
    lang: () => 'fr',
    delay: async () => {},
  });
  return { s, d, writes, opened, turns };
}

test('▶ vers Codex : sessions Claude et Codex listées, envoi à une session Codex au repos', async () => {
  const consoles = [
    C('cl', 'shop', { lastActivityAt: '2026-11-01T10:01:00Z' }),
    C('cx', 'shop', { kind: 'codex', label: 'Codex · shop', codexSessionId: 'cx-1', lastActivityAt: '2026-11-01T10:05:00Z' }),
    C('cb', 'shop', { kind: 'codex', label: 'Codex · shop (2)' }),
  ];
  const { s, d, writes, turns } = codexSetup(consoles, {
    cl: { text: IDLE, lastOutputAt: AGO(10_000) },
    cx: { text: CX_IDLE, lastOutputAt: AGO(10_000) },
    cb: { text: CX_BUSY, lastOutputAt: AGO(10_000) },
  });
  const list = d.sessions('acme/shop');
  assert.deepEqual(list.map((x) => [x.terminalId, x.agent, x.state]), [['cx', 'codex', 'idle'], ['cl', 'claude', 'idle'], ['cb', 'codex', 'busy']]);
  assert.equal(list[0].title, 'Tiroir du panier');
  assert.ok(turns.some(([id, agent]) => id === 'cx-1' && agent === 'codex'), 'tour de parole lu dans le transcript de Codex');
  // Un écran de Codex n'est jamais lu avec les règles de Claude (et inversement).
  await assert.rejects(d.dispatch('acme/shop', 't-4-12', 'cb'), (e: any) => e.statusCode === 409 && e.data?.state === 'busy');
  assert.equal(writes.length, 0);
  const r = await d.dispatch('acme/shop', 't-4-12', 'cx');
  assert.deepEqual(writes.map(([id, data]) => [id, data.startsWith('\x1b[200~') ? 'paste' : data]), [['cx', 'paste'], ['cx', '\r']]);
  assert.equal(s.task('acme/shop', 't-4-12')!.requestedTo, 'Codex · shop');
  assert.equal(r.session, 'Codex · shop');
});

test('▶ nouvelle session : agent choisi (Codex), agent désactivé ou inconnu refusé', async () => {
  const { d, opened } = codexSetup([], {});
  await d.dispatch('acme/shop', 't-4-12', 'new', 'codex');
  assert.equal(opened[0][2], 'codex');
  const off = codexSetup([], {}, ['claude']);
  await assert.rejects(off.d.dispatch('acme/shop', 't-4-12', 'new', 'codex'), (e: any) => e.statusCode === 400 && /désactivé|disabled/.test(e.message));
  await assert.rejects(off.d.dispatch('acme/shop', 't-4-12', 'new', 'gpt' as any), (e: any) => e.statusCode === 400);
  assert.equal(off.opened.length, 0);
  // Sans agent : le premier agent coché (Codex seul ici).
  const only = codexSetup([], {}, ['codex']);
  await only.d.dispatch('acme/shop', 't-4-12', 'new');
  assert.equal(only.opened[0][2], 'codex');
});

test('Claude seul (défaut) : les consoles Codex ne sont ni listées ni joignables', async () => {
  const consoles = [C('cl', 'shop'), C('cx', 'shop', { kind: 'codex' })];
  const { d, writes } = codexSetup(consoles, { cl: { text: IDLE, lastOutputAt: AGO(10_000) }, cx: { text: CX_IDLE, lastOutputAt: AGO(10_000) } }, ['claude']);
  assert.deepEqual(d.sessions('acme/shop').map((x) => x.terminalId), ['cl']);
  await assert.rejects(d.dispatch('acme/shop', 't-4-12', 'cx'), (e: any) => e.statusCode === 404);
  assert.equal(writes.length, 0);
  // Dispatcher sans réglage d'agents (comme avant Codex) : Claude seul.
  assert.deepEqual(setup(consoles).d.agents(), ['claude']);
});

// ─── Serveur MCP en mode artefact : les outils exposés et le relais vers l'API ───
const HERE = path.dirname(fileURLToPath(import.meta.url));

async function mcpSession(args: string[], api: http.RequestListener) {
  const srv = http.createServer(api);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as any).port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-mcp-test-'));
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(HERE, 'mcp.ts'), ...args], {
    env: { PATH: process.env.PATH, DATA_DIR: dataDir, TARMAC_API_URL: `http://127.0.0.1:${port}`, SUIVI_TOKEN: 'claude-tok', SUIVI_ARTIFACT_TOKEN: 'artifact-tok' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let buf = '';
  const waiting = new Map<number, (v: any) => void>();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); waiting.get(m.id)?.(m); } catch { /* ligne non JSON */ }
    }
  });
  let n = 0;
  const rpc = (method: string, params: object = {}) => new Promise<any>((ok) => {
    const id = ++n;
    waiting.set(id, ok);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return { rpc, close: () => { child.kill(); srv.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('MCP --artifact : ping, pull, push, sessions et dispatch seulement ; relais avec le jeton artefact', { timeout: 30000 }, async () => {
  const seen: { method: string; url: string; token: unknown; body: string }[] = [];
  const m = await mcpSession(['--artifact'], (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, token: req.headers['x-suivi-token'], body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(req.url!.endsWith('/sessions') ? '[{"terminalId":"a","name":"Claude · shop"}]' : '{"ok":true}');
    });
  });
  try {
    const tools = (await m.rpc('tools/list')).result.tools as { name: string; annotations?: any }[];
    assert.deepEqual(tools.map((t) => t.name).sort(), ['suivi_dispatch', 'suivi_ping', 'suivi_pull', 'suivi_push', 'suivi_sessions']);
    assert.equal(tools.find((t) => t.name === 'suivi_sessions')!.annotations?.readOnlyHint, true);
    assert.equal(tools.find((t) => t.name === 'suivi_dispatch')!.annotations?.readOnlyHint, false);
    const s = await m.rpc('tools/call', { name: 'suivi_sessions', arguments: { projectId: 'acme/shop' } });
    assert.deepEqual(s.result.structuredContent, { sessions: [{ terminalId: 'a', name: 'Claude · shop' }] });
    await m.rpc('tools/call', { name: 'suivi_dispatch', arguments: { projectId: 'acme/shop', taskId: 't-4-12', target: 'new' } });
    assert.deepEqual(seen.map((x) => [x.method, x.url, x.token]), [
      ['GET', '/api/suivi/projects/acme%2Fshop/sessions', 'artifact-tok'],
      ['POST', '/api/suivi/projects/acme%2Fshop/tasks/t-4-12/dispatch', 'artifact-tok'],
    ]);
    assert.deepEqual(JSON.parse(seen[1].body), { target: 'new' });
    const refused = await m.rpc('tools/call', { name: 'suivi_upsert_task', arguments: { projectId: 'acme/shop', title: 'x' } });
    assert.ok(refused.error || refused.result?.isError, 'outil hors mode artefact refusé');
  } finally { m.close(); }
});

test('MCP Claude Code : tous les outils, dont sessions et dispatch', { timeout: 30000 }, async () => {
  const m = await mcpSession([], (_req, res) => { res.writeHead(200); res.end('{}'); });
  try {
    const names = ((await m.rpc('tools/list')).result.tools as { name: string }[]).map((t) => t.name);
    for (const n of ['suivi_get', 'suivi_upsert_task', 'suivi_sessions', 'suivi_dispatch']) assert.ok(names.includes(n), n);
  } finally { m.close(); }
});
