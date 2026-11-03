import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  codexCommand, codexTurnFromLines, readCodexUsage, readSessionIndex, rolloutFiles, summarizeRollout, usageFromLines,
} from './codex.js';
import { agentProcsFrom, attachSessions, codexSessionFromArgs, isClaudeProcess, isCodexProcess, type PsRow } from './agentProcs.js';
import { buildRunningAgents } from './agents.js';

// Transcripts Codex factices (format des fichiers « rollout » : codex-rs/rollout et codex-rs/protocol).
const X1 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const X2 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const NOW = Date.parse('2026-11-03T12:00:00Z');
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
const sec = (min: number) => Math.round((NOW + min * 60_000) / 1000);

const meta = (id: string, cwd: string, over: object = {}) => ({
  timestamp: at(30), type: 'session_meta',
  payload: { id, session_id: id, timestamp: at(30), cwd, originator: 'codex_cli_rs', cli_version: '0.98.0', source: 'cli', git: { branch: 'feat/cart' }, ...over },
});
const ev = (min: number, payload: object) => ({ timestamp: at(min), type: 'event_msg', payload });
const item = (min: number, payload: object) => ({ timestamp: at(min), type: 'response_item', payload });
const tokenCount = (min: number, rate_limits: object | null) => ev(min, { type: 'token_count', info: null, rate_limits });

function rollout(lines: object[]) {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function codexHome(files: Record<string, object[]>, index?: object[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-codex-'));
  for (const [rel, lines] of Object.entries(files)) {
    const f = path.join(dir, 'sessions', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, rollout(lines));
  }
  if (index) fs.writeFileSync(path.join(dir, 'session_index.jsonl'), rollout(index));
  return dir;
}

test('transcript Codex : id, dossier, branche, premier vrai message, nombre d’échanges', () => {
  const lines = [
    meta(X1, '/dev/shop'),
    item(29, { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/dev/shop</cwd>\n</environment_context>' }] }),
    item(29, { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /dev/shop' }] }),
    ev(29, { type: 'user_message', message: 'Add a cart   drawer\nwith totals' }),
    ev(28, { type: 'agent_message', message: 'Done.' }),
  ];
  const s = summarizeRollout(lines, { file: `/x/rollout-2026-11-03T11-30-00-${X1}.jsonl`, sizeBytes: 900, mtime: new Date(NOW), exact: true });
  assert.ok(s);
  assert.equal(s.agent, 'codex');
  assert.equal(s.id, X1);
  assert.equal(s.cwd, '/dev/shop');
  assert.equal(s.gitBranch, 'feat/cart');
  assert.equal(s.title, 'Add a cart drawer with totals');
  assert.equal(s.titleSource, 'prompt');
  assert.equal(s.messages, 2);
  assert.equal(s.createdAt, at(30));
  assert.equal(s.updatedAt, at(28));
  assert.equal(s.version, '0.98.0');
  // Sous-agent ou ligne de méta absente : pas une session listée.
  assert.equal(summarizeRollout([meta(X2, '/dev/shop', { source: { subagent: 'review' } })], { file: 'f', sizeBytes: 1, mtime: new Date(), exact: true }), null);
  assert.equal(summarizeRollout([ev(1, { type: 'user_message', message: 'hi' })], { file: 'f', sizeBytes: 1, mtime: new Date(), exact: true }), null);
});

test('dossier de sessions Codex : fichiers rollout, noms donnés par /rename (le dernier gagne)', () => {
  const dir = codexHome({
    [`2026/11/03/rollout-2026-11-03T11-30-00-${X1}.jsonl`]: [meta(X1, '/dev/shop')],
    [`2026/11/02/rollout-2026-11-02T09-00-00-${X2}.jsonl`]: [meta(X2, '/dev/api')],
    '2026/11/02/notes.txt': [],
  }, [
    { id: X1, thread_name: 'Old name', updated_at: at(20) },
    { id: X1, thread_name: 'Cart drawer', updated_at: at(10) },
    { id: 'bad' },
  ]);
  try {
    assert.equal(rolloutFiles(dir).length, 2);
    assert.equal(readSessionIndex(dir).get(X1), 'Cart drawer');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tour de parole Codex : task_started sans fin = au travail, task_complete / turn_aborted = au repos', () => {
  assert.equal(codexTurnFromLines([meta(X1, '/d')]), 'none');
  assert.equal(codexTurnFromLines([ev(3, { type: 'task_started' }), ev(2, { type: 'agent_message', message: '…' })]), 'working');
  assert.equal(codexTurnFromLines([ev(3, { type: 'task_started' }), ev(2, { type: 'task_complete' })]), 'idle');
  assert.equal(codexTurnFromLines([ev(3, { type: 'turn_started' }), ev(2, { type: 'turn_aborted', reason: 'interrupted' })]), 'idle');
  assert.equal(codexTurnFromLines([ev(3, { type: 'task_complete' }), ev(1, { type: 'task_started' })]), 'working');
});

test('commande Codex : nouvelle session (premier message), reprise, guillemets', () => {
  assert.equal(codexCommand({}), 'codex');
  assert.equal(codexCommand({ prompt: "Traite la tâche 4.12 « l'accueil »" }), "codex 'Traite la tâche 4.12 « l'\\''accueil »'");
  assert.equal(codexCommand({ prompt: '--yolo do it' }), "codex 'yolo do it'", 'un message ne devient jamais une option');
  assert.equal(codexCommand({ resume: X1 }), `codex resume '${X1}'`);
});

test('usage Codex : dernières limites lues (plan, 5 h, semaine, remise à zéro), fenêtres passées écartées', () => {
  const lines = [
    tokenCount(50, { primary: { used_percent: 10, window_minutes: 300, resets_at: sec(100) } }),
    tokenCount(5, null),
    tokenCount(4, { limit_id: 'codex', primary: { used_percent: 37.5, window_minutes: 300, resets_at: sec(132) }, secondary: { used_percent: 61, window_minutes: 10080, resets_at: sec(3 * 1440) }, plan_type: 'plus', credits: null }),
  ];
  const u = usageFromLines(lines, NOW);
  assert.deepEqual(u, {
    plan: 'Plus',
    fetchedAt: at(4),
    limits: [
      { id: 'primary', kind: 'session', label: null, utilization: 37.5, resetsAt: new Date(sec(132) * 1000).toISOString() },
      { id: 'secondary', kind: 'week', label: null, utilization: 61, resetsAt: new Date(sec(3 * 1440) * 1000).toISOString() },
    ],
  });
  // Fenêtre remise à zéro depuis la lecture : retirée (rien n'est deviné à sa place).
  const later = usageFromLines(lines, NOW + 200 * 60_000)!;
  assert.deepEqual(later.limits.map((l) => l.id), ['secondary']);
  // Autre durée de fenêtre : libellé de sa durée ; aucun token_count : rien.
  assert.equal(usageFromLines([tokenCount(1, { primary: { used_percent: 5, window_minutes: 1440 } })], NOW)!.limits[0].label, '1 d');
  assert.equal(usageFromLines([meta(X1, '/d')], NOW), null);
});

test('usage Codex lu dans le transcript le plus récent qui en porte, sans réseau ni jeton', () => {
  const dir = codexHome({
    [`2026/11/03/rollout-2026-11-03T11-30-00-${X1}.jsonl`]: [meta(X1, '/dev/shop'), tokenCount(3, { primary: { used_percent: 42, window_minutes: 300, resets_at: sec(60) }, plan_type: 'pro' })],
    [`2026/11/03/rollout-2026-11-03T11-50-00-${X2}.jsonl`]: [meta(X2, '/dev/api')],
  });
  try {
    const f2 = path.join(dir, 'sessions', `2026/11/03/rollout-2026-11-03T11-50-00-${X2}.jsonl`);
    fs.utimesSync(f2, new Date(), new Date(Date.now() + 1000)); // le plus récent n'a pas de limites
    const u = readCodexUsage(dir, NOW);
    assert.equal(u.status, 'ok');
    assert.equal(u.plan, 'Pro');
    assert.equal(u.limits[0].utilization, 42);
    assert.equal(readCodexUsage(path.join(dir, 'absent'), NOW).status, 'none');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('process codex : binaire natif, lanceur npm, sous-commandes écartées, reprise par les arguments', () => {
  assert.ok(isCodexProcess('/opt/homebrew/bin/codex', 'codex'));
  assert.ok(isCodexProcess('node', 'node /usr/local/lib/node_modules/@openai/codex/bin/codex.js resume abc'));
  assert.ok(isCodexProcess('codex', "codex 'Traite la tâche 4.12'"));
  assert.ok(isCodexProcess('codex', 'codex exec "fix the build"'));
  assert.ok(!isCodexProcess('codex', 'codex mcp-server'));
  assert.ok(!isCodexProcess('codex', 'codex app-server'));
  assert.ok(!isCodexProcess('codex', 'codex login'));
  assert.ok(!isCodexProcess('codex', 'codex --version'));
  assert.ok(!isCodexProcess('node', 'node /x/codex-helper.js'));
  assert.ok(!isClaudeProcess('codex', 'codex'));
  assert.equal(codexSessionFromArgs(`codex resume '${X1}'`), X1);
  assert.equal(codexSessionFromArgs(`node /x/codex.js resume ${X2} --yolo`), X2);
  assert.equal(codexSessionFromArgs('codex "resume the work"'), null);
});

test('agents en cours : Claude et Codex séparés (process, rattachement par agent, consoles de Tarmac)', () => {
  const rows: PsRow[] = [
    { pid: 100, ppid: 1, etimeSec: 3600, comm: '/bin/zsh', args: '-zsh' },
    { pid: 200, ppid: 100, etimeSec: 600, comm: 'node', args: `node /usr/local/lib/node_modules/@openai/codex/bin/codex.js resume ${X1}` },
    { pid: 201, ppid: 200, etimeSec: 600, comm: '/usr/local/lib/node_modules/@openai/codex/vendor/codex/codex', args: `/usr/local/lib/node_modules/@openai/codex/vendor/codex/codex resume ${X1}` },
    { pid: 300, ppid: 1, etimeSec: 120, comm: 'claude', args: 'claude' },
    { pid: 400, ppid: 1, etimeSec: 60, comm: '/opt/homebrew/bin/codex', args: 'codex' },
  ];
  const cwds = new Map([[200, '/dev/shop'], [201, '/dev/shop'], [300, '/dev/shop'], [400, '/dev/api']]);
  // Claude seul (défaut) : aucun process Codex.
  assert.deepEqual(agentProcsFrom(rows, cwds, new Map(), { now: NOW }).map((p) => [p.agent, p.pid]), [['claude', 300]]);
  const procs = agentProcsFrom(rows, cwds, new Map(), { now: NOW, kinds: ['claude', 'codex'] });
  assert.deepEqual(procs.map((p) => [p.agent, p.pid]), [['codex', 200], ['claude', 300], ['codex', 400]], 'le binaire natif sous le lanceur npm est écarté');

  // Un transcript Codex récent n'est jamais pris par un process Claude du même dossier (et inversement).
  const sessions = [
    { id: X2, cwd: '/dev/api', updatedAt: at(0), title: 'API', agent: 'codex' as const },
    { id: 'c1c1c1c1-0000-4000-8000-000000000001', cwd: '/dev/shop', updatedAt: at(0), title: 'Claude shop' },
  ];
  const att = attachSessions(procs, sessions);
  assert.deepEqual(att.get(200), { sessionId: X1, match: 'arg' });
  assert.deepEqual(att.get(400), { sessionId: X2, match: 'recent' });
  assert.deepEqual(att.get(300), { sessionId: 'c1c1c1c1-0000-4000-8000-000000000001', match: 'recent' });

  const list = buildRunningAgents({
    now: NOW,
    procs,
    sessions: [...sessions, { id: X1, cwd: '/dev/shop', updatedAt: at(1), title: 'Cart drawer', agent: 'codex' }],
    terminals: [
      { id: 't-shop', pid: 100, kind: 'codex', status: 'running', claudeSessionId: null, codexSessionId: null, startedAt: at(10), cwd: '/dev/shop' },
      { id: 't-web', pid: 999, kind: 'codex', status: 'running', claudeSessionId: null, codexSessionId: null, startedAt: at(1), cwd: '/dev/web' },
    ],
    turn: (id, agent) => (agent === 'codex' && id === X1 ? 'working' : 'idle'),
    transcriptOf: () => null,
    background: () => { throw new Error('pas de sous-agents pour Codex'); },
  });
  const byKey = Object.fromEntries(list.map((a) => [a.key, a]));
  assert.equal(byKey['codex:200'].where, 'tarmac');
  assert.equal(byKey['codex:200'].terminalId, 't-shop');
  assert.equal(byKey['codex:200'].title, 'Cart drawer');
  assert.equal(byKey['codex:200'].state, 'working');
  assert.equal(byKey['codex:400'].where, 'external');
  assert.equal(byKey['codex:400'].title, 'API');
  assert.equal(byKey['claude:300'].agent, 'claude');
  assert.equal(byKey['codex:999'].match, 'tarmac', 'console Codex de Tarmac sans process vu : connue quand même');
});
