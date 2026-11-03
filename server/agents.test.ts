import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  agentProcsFrom, appOfComm, attachSessions, isClaudeProcess, isCodexProcess, parseEtime, parseLsofCwd, parsePidFile, parsePs, scanAgentProcs, sessionFromArgs,
  type AgentProc, type PidFile,
} from './agentProcs.js';
import { backgroundAgents, buildRunningAgents } from './agents.js';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-11-03T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

test('ps : durée, exécutable avec espaces, arguments', () => {
  assert.equal(parseEtime('05:07'), 307);
  assert.equal(parseEtime('02:05:07'), 7507);
  assert.equal(parseEtime('3-02:05:07'), 3 * 86400 + 7507);
  assert.equal(parseEtime('n/a'), 0);
  const rows = parsePs(
    '  1     0 10-00:00:00 /sbin/launchd\n 500     1   01:00:00 /Applications/Claude.app/Contents/Helpers/disclaimer\n 501   500   12:00 /home/x/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude\n',
    '  1 /sbin/launchd\n 500 /Applications/Claude.app/Contents/Helpers/disclaimer\n 501 /home/x/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude --output-format stream-json\n',
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[2].comm, '/home/x/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude');
  assert.equal(rows[2].etimeSec, 720);
  assert.match(rows[2].args, /stream-json$/);
});

test('process claude : exécutable, script lancé par node, sous-commandes écartées', () => {
  assert.ok(isClaudeProcess('/opt/homebrew/bin/claude', 'claude --resume abc'));
  assert.ok(isClaudeProcess('node', 'node /home/x/bin/claude --session-id x --remote-control Shop'));
  assert.ok(isClaudeProcess('claude', 'claude --remote-control Shop "update the readme"'), 'un prompt contenant « update » reste une session');
  assert.ok(!isClaudeProcess('/Applications/Claude.app/Contents/MacOS/Claude', '/Applications/Claude.app/Contents/MacOS/Claude'));
  assert.ok(!isClaudeProcess('claude', 'claude mcp serve'));
  assert.ok(!isClaudeProcess('claude', 'claude --version'));
  assert.ok(!isClaudeProcess('claude', 'claude update'));
  assert.ok(!isClaudeProcess('node', 'node /x/claude-helper.js'));
  assert.equal(sessionFromArgs(`claude --resume ${S1} --remote-control`), S1);
  assert.equal(sessionFromArgs(`claude --session-id ${S2} --remote-control 'Shop'`), S2);
  assert.equal(sessionFromArgs(`claude -r '${S3}'`), S3);
  assert.equal(sessionFromArgs('claude --remote-control Shop'), null);
  assert.equal(appOfComm('/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'), 'Terminal');
  assert.equal(appOfComm('/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper'), 'VS Code');
  assert.equal(appOfComm('/bin/zsh'), null);
  assert.deepEqual([...parseLsofCwd('p501\nfcwd\nn/home/x/dev/shop\np502\nfcwd\nn/tmp\n')], [[501, '/home/x/dev/shop'], [502, '/tmp']]);
});

test('fichier de session de Claude Code (sessions/<pid>.json)', () => {
  const p = parsePidFile(JSON.stringify({ pid: 501, sessionId: S1, cwd: '/dev/shop', startedAt: NOW - 60_000, entrypoint: 'cli', status: 'busy', statusUpdatedAt: NOW, name: 'shop' }));
  assert.deepEqual(p, { pid: 501, sessionId: S1, cwd: '/dev/shop', startedAt: ago(1), entrypoint: 'cli', status: 'busy', updatedAt: ago(0), name: 'shop' });
  assert.equal(parsePidFile('{"pid":"x"}'), null);
  assert.equal(parsePidFile('{'), null);
  assert.equal(parsePidFile(JSON.stringify({ pid: 1, sessionId: '../etc', status: 'weird' }))?.sessionId, null);
});

test('process → app parente, outils internes de claude écartés', () => {
  const rows = parsePs(
    [
      '400 1 01:00:00 /Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
      '401 400 01:00:00 /bin/zsh',
      '402 401 10:00 /opt/homebrew/bin/claude',
      '403 402 05:00 /opt/homebrew/bin/claude', // sous-process de claude (outil) : ignoré
      '600 1 01:00:00 /Applications/Claude.app/Contents/Helpers/disclaimer',
      '601 600 02:00 /home/x/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude',
    ].join('\n'),
    '402 claude --resume ' + S1 + '\n403 claude -p sub\n601 /home/x/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude --output-format stream-json\n',
  );
  const pf: PidFile = { pid: 601, sessionId: S2, cwd: '/dev/api', startedAt: ago(2), entrypoint: 'claude-desktop', status: 'idle', updatedAt: ago(1), name: null };
  const procs = agentProcsFrom(rows, new Map([[402, '/dev/shop']]), new Map([[601, pf]]), { now: NOW });
  assert.deepEqual(procs.map((p) => [p.pid, p.app, p.cwd]), [[402, 'Terminal', '/dev/shop'], [601, 'Claude', '/dev/api']]);
  assert.equal(procs[0].startedAt, ago(10));
  assert.deepEqual(procs[0].ancestors, [401, 400]);
});

const proc = (pid: number, cwd: string, startedMin: number, extra: Partial<AgentProc> = {}): AgentProc =>
  ({ agent: 'claude', pid, ppid: 1, cwd, args: 'claude', startedAt: ago(startedMin), ancestors: [], app: null, pidFile: null, ...extra });

test('rattachement process → session : fichier de session, arguments, puis transcript récent du dossier', () => {
  const transcripts = [
    { id: S1, cwd: '/dev/shop', updatedAt: ago(2) },
    { id: S2, cwd: '/dev/shop', updatedAt: ago(30) },
    { id: S3, cwd: '/dev/api', updatedAt: ago(500) },
  ];
  const a = attachSessions([
    proc(1, '/dev/shop', 60), // S2 écrit depuis son début (S1 est prise par le fichier de session)
    proc(2, '/dev/shop', 10), // S2 écrite avant son début : pas pour lui
    proc(3, '/dev/api', 60, { args: `claude --resume ${S3}` }), // arguments : S3 même si ancien
    proc(4, '/dev/api', 5), // rien d'écrit depuis son début : session inconnue
    proc(5, '/dev/web', 5, { pidFile: { pid: 5, sessionId: S1, cwd: '/dev/web', startedAt: null, entrypoint: 'cli', status: 'busy', updatedAt: null, name: null } }),
  ], transcripts);
  assert.deepEqual(a.get(5), { sessionId: S1, match: 'pidfile' });
  assert.deepEqual(a.get(3), { sessionId: S3, match: 'arg' });
  assert.deepEqual(a.get(2), { sessionId: null, match: 'none' }, 'S1 prise par le fichier de session, S2 écrite avant son début');
  assert.deepEqual(a.get(1), { sessionId: S2, match: 'recent' });
  assert.deepEqual(a.get(4), { sessionId: null, match: 'none' });
});

/** Dossier Claude factice : transcript + sous-agents (en cours, terminé, silencieux depuis longtemps). */
function fakeClaudeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-agents-'));
  const proj = path.join(dir, 'projects', '-dev-shop');
  const sub = path.join(proj, S1, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(proj, `${S1}.jsonl`), JSON.stringify({ type: 'user', message: { role: 'user', content: 'Go' }, cwd: '/dev/shop', sessionId: S1 }) + '\n');
  const agent = (id: string, meta: object, minutesAgo: number) => {
    fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify(meta));
    const f = path.join(sub, `agent-${id}.jsonl`);
    fs.writeFileSync(f, '{}\n');
    const t = new Date(NOW - minutesAgo * 60_000);
    fs.utimesSync(f, t, t);
  };
  agent('aaa', { agentType: 'Explore', description: 'Scan the repo' }, 1);
  agent('bbb', { agentType: 'general-purpose', description: 'Done already', finished: true }, 1);
  agent('ccc', { agentType: 'general-purpose', description: 'Stale' }, 45);
  fs.writeFileSync(path.join(sub, 'agent-ddd.meta.json'), '{broken');
  return { dir, transcript: path.join(proj, `${S1}.jsonl`) };
}

test('agents en arrière-plan : méta sans « finished » et transcript écrit récemment', () => {
  const { dir, transcript } = fakeClaudeDir();
  try {
    const bg = backgroundAgents(transcript, NOW);
    assert.deepEqual(bg.map((b) => [b.id, b.type, b.description]), [['aaa', 'Explore', 'Scan the repo']]);
    assert.deepEqual(backgroundAgents(path.join(dir, 'missing.jsonl'), NOW), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agents en cours : Tarmac ou ailleurs, état, LED, console sans process', () => {
  const { dir, transcript } = fakeClaudeDir();
  try {
    const list = buildRunningAgents({
      now: NOW,
      procs: [
        proc(10, '/dev/shop', 30, { app: 'Terminal', args: `claude --resume ${S1}` }),
        proc(20, '/dev/api', 30, { ancestors: [19], args: `claude --session-id ${S2}` }),
        proc(30, '/dev/web', 30, { app: 'VS Code', pidFile: { pid: 30, sessionId: S3, cwd: '/dev/web', startedAt: ago(30), entrypoint: 'claude-vscode', status: 'busy', updatedAt: ago(0), name: 'web' } }),
      ],
      sessions: [
        { id: S1, cwd: '/dev/shop', title: 'Cart drawer', updatedAt: ago(1) },
        { id: S2, cwd: '/dev/api', title: 'Pagination', updatedAt: ago(20) },
      ],
      terminals: [
        { id: 't-api', pid: 19, kind: 'claude', status: 'running', claudeSessionId: S2, startedAt: ago(30), cwd: '/dev/api' },
        { id: 't-new', pid: 99, kind: 'claude', status: 'running', claudeSessionId: 'deadbeef-0000', startedAt: ago(1), cwd: '/dev/docs' },
        { id: 't-shell', pid: 98, kind: 'shell', status: 'running', claudeSessionId: null, startedAt: ago(1), cwd: '/dev/docs' },
      ],
      // S1 : transcript « au travail » mais écrit il y a 1 min ; S2 : « au travail » mais silencieux depuis 20 min.
      turn: (id) => (id === S1 || id === S2 ? 'working' : 'idle'),
      transcriptOf: (id) => (id === S1 ? transcript : null),
    });
    const by = new Map(list.map((a) => [a.pid, a]));
    assert.equal(by.get(10)!.where, 'external');
    assert.equal(by.get(10)!.app, 'Terminal');
    assert.equal(by.get(10)!.state, 'working');
    assert.equal(by.get(10)!.title, 'Cart drawer');
    assert.deepEqual(by.get(10)!.background.map((b) => b.id), ['aaa']);
    assert.equal(by.get(20)!.where, 'tarmac', 'enfant de la console de Tarmac');
    assert.equal(by.get(20)!.terminalId, 't-api');
    assert.equal(by.get(20)!.state, 'idle', 'tour « en cours » trop ancien : au repos');
    assert.equal(by.get(20)!.working, false);
    assert.equal(by.get(30)!.state, 'working', 'statut busy du fichier de session');
    assert.equal(by.get(30)!.title, 'web');
    assert.equal(by.get(99)!.match, 'tarmac', 'console Claude de Tarmac sans process vu');
    assert.ok(!by.has(98), 'console shell sans claude : rien');
    assert.deepEqual(list.slice(0, 2).map((a) => a.working), [true, true], 'agents au travail en tête');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('détection réelle : un faux `claude` (script qui dort) en tête du PATH est vu avec son dossier et sa session', async (t) => {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return t.skip('ps/lsof indisponibles');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-fake-claude-')));
  const bin = path.join(root, 'bin');
  const cwd = path.join(root, 'shop');
  const cfg = path.join(root, 'claude-config');
  fs.mkdirSync(bin);
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(cfg, 'sessions'), { recursive: true });
  // Jamais le vrai Claude Code : un script nommé `claude` qui dort.
  fs.writeFileSync(path.join(bin, 'claude'), '#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n', { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root }; // sans NODE_OPTIONS ni contexte du lanceur de tests
  // Lancé en arrière-plan par un shell qui se termine : le faux claude est rattaché à launchd, comme un claude ouvert
  // dans un autre terminal (sinon il serait vu comme un outil interne du claude qui exécute ces tests, s'il y en a un).
  const pid = Number(execFileSync('/bin/sh', ['-c', `claude --resume ${S1} >/dev/null 2>&1 & echo $!`], { cwd, env }).toString().trim());
  try {
    fs.writeFileSync(path.join(cfg, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: S1, cwd, startedAt: Date.now(), entrypoint: 'cli', status: 'idle' }));
    let found: AgentProc | undefined;
    for (let i = 0; i < 20 && !found; i++) {
      await new Promise((r) => setTimeout(r, 150));
      found = (await scanAgentProcs({ claudeDir: cfg, onlyUnder: root, maxAgeMs: 0 })).find((p) => p.pid === pid);
    }
    assert.ok(found, 'process vu');
    assert.equal(found!.cwd, cwd);
    assert.equal(found!.pidFile?.sessionId, S1);
    assert.equal(sessionFromArgs(found!.args), S1);
  } finally {
    try { process.kill(pid); } catch { /* déjà arrêté */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('process d’agents sous Windows (lignes Get-CimInstance)', () => {
  const win = (comm: string, args: string) => ({ claude: isClaudeProcess(comm, args), codex: isCodexProcess(comm, args) });
  // Installateur natif de Claude Code.
  assert.deepEqual(win('claude.exe', '"C:\\Users\\Ana Lopez\\.local\\bin\\claude.exe" --resume 0f1e2d3c-aaaa'), { claude: true, codex: false });
  assert.deepEqual(win('Claude.EXE', 'C:\\Users\\a\\.local\\bin\\Claude.EXE --remote-control Shop'), { claude: false, codex: false }, 'casse : comme sous macOS, « Claude » n’est pas la CLI');
  // Lanceur npm : node.exe + cli.js (chemins avec espaces entre guillemets).
  assert.deepEqual(win('node.exe', '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js" --session-id x --remote-control Shop'), { claude: true, codex: false });
  assert.deepEqual(win('node.exe', '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js resume abc'), { claude: false, codex: true });
  assert.deepEqual(win('codex.exe', '"C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe" "corrige le test"'), { claude: false, codex: true });
  // Pas des sessions.
  assert.deepEqual(win('claude.exe', 'claude.exe --version'), { claude: false, codex: false });
  assert.deepEqual(win('node.exe', '"C:\\Program Files\\nodejs\\node.exe" "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js" mcp serve'), { claude: false, codex: false });
  assert.deepEqual(win('codex.exe', 'codex.exe login'), { claude: false, codex: false });
  assert.deepEqual(win('node.exe', '"C:\\Program Files\\nodejs\\node.exe" C:\\src\\app\\server.js'), { claude: false, codex: false });
});

test('macOS : guillemets ou « .exe » dans un prompt ne changent pas la décision', () => {
  assert.ok(isClaudeProcess('claude', 'claude --remote-control Shop "fix \\"x\\""'));
  assert.ok(isClaudeProcess('claude', 'claude update.exe'), 'prompt « update.exe » : pas la sous-commande update');
  assert.ok(!isClaudeProcess('claude', 'claude "a b" --version'));
  assert.ok(isCodexProcess('codex', 'codex "lance setup.exe"'));
  assert.ok(!isCodexProcess('codex', 'codex login'));
});
