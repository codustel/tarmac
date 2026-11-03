import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RepoEventsCache, mergeTimeline, parseGitLog, parsePushReflog, repoSignature, gitDirs, type TimelineEvent } from './timeline.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const Z = '0'.repeat(40);

test('reflog distant : seulement les « update by push », pas les fetch ni les pull', () => {
  const log = [
    `${Z} ${A} Ada <ada@example.com> 1793600000 +0100\tupdate by push`,
    `${A} ${B} Ada <ada@example.com> 1793610000 +0100\tfetch: fast-forward`,
    `${B} ${C} Ada <ada@example.com> 1793620000 +0100\tpull: fast-forward`,
    `${B} ${C} Ada <ada@example.com> 1793630000 -0500\tupdate by push`,
    'ligne cassée',
  ].join('\n');
  assert.deepEqual(parsePushReflog(log), [
    { old: Z, new: A, at: new Date(1793600000 * 1000).toISOString() },
    { old: B, new: C, at: new Date(1793630000 * 1000).toISOString() },
  ]);
});

test('git log : champs, branche source, sujet avec séparateurs', () => {
  const out = `${A}\x1fa1b2c3d\x1frefs/heads/feat/cart\x1f2026-11-02T10:00:00+01:00\x1fAda\x1fAdd cart <b>drawer</b>\x1e\n${B}\x1fb1b2c3d\x1f\x1f2026-11-01T10:00:00Z\x1fBob\x1fInit\x1e\n`;
  assert.deepEqual(parseGitLog(out), [
    { hash: A, short: 'a1b2c3d', branch: 'feat/cart', at: '2026-11-02T09:00:00.000Z', author: 'Ada', subject: 'Add cart <b>drawer</b>' },
    { hash: B, short: 'b1b2c3d', branch: null, at: '2026-11-01T10:00:00.000Z', author: 'Bob', subject: 'Init' },
  ]);
  assert.deepEqual(parseGitLog(''), []);
});

test('fusion : fenêtre, doublons, tri du plus récent, limite', () => {
  const ev = (id: string, at: string, type: TimelineEvent['type'] = 'commit'): TimelineEvent => ({ id, type, at, projectId: 'p', projectName: 'P', text: id });
  const since = Date.parse('2026-11-01T00:00:00Z');
  const merged = mergeTimeline([
    [ev('c1', '2026-11-02T10:00:00.000Z'), ev('old', '2026-10-20T10:00:00.000Z')],
    [ev('c1', '2026-11-02T10:00:00.000Z'), ev('s1', '2026-11-03T08:00:00.000Z', 'session')],
    [ev('t1', '2026-11-02T12:00:00.000Z', 'task'), ev('bad', 'pas une date', 'task')],
  ], since);
  assert.deepEqual(merged.map((e) => e.id), ['s1', 't1', 'c1']);
  assert.deepEqual(mergeTimeline([[ev('a', '2026-11-02T10:00:00.000Z'), ev('b', '2026-11-02T11:00:00.000Z')]], since, 1).map((e) => e.id), ['b']);
});

test('dépôt réel : commits de toutes les branches locales, push avec nombre de commits, cache par signature', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-timeline-'));
  const now = Date.now();
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const git = (args: string[], hoursAgo?: number) => execFileSync('git', args, {
    cwd: dir, encoding: 'utf8',
    env: hoursAgo === undefined ? env : { ...env, GIT_AUTHOR_DATE: new Date(now - hoursAgo * 3_600_000).toISOString(), GIT_COMMITTER_DATE: new Date(now - hoursAgo * 3_600_000).toISOString() },
  }).trim();
  try {
    git(['init', '-q', '-b', 'main']);
    const commit = (msg: string, h: number) => { fs.appendFileSync(path.join(dir, 'f.txt'), msg + '\n'); git(['add', '.']); git(['commit', '-q', '-m', msg], h); return git(['rev-parse', 'HEAD']); };
    commit('Ancien commit', 24 * 30);
    const c1 = commit('Premier', 30);
    const c2 = commit('Deuxième', 20);
    git(['checkout', '-q', '-b', 'feat/x']);
    commit('Sur la branche', 5);
    git(['checkout', '-q', 'main']);
    git(['update-ref', '-m', 'update by push', 'refs/remotes/origin/main', c1], 29);
    git(['update-ref', '-m', 'update by push', 'refs/remotes/origin/main', c2], 19);
    git(['update-ref', '-m', 'fetch: fast-forward', 'refs/remotes/origin/feat/x', 'feat/x'], 4);

    const cache = new RepoEventsCache();
    const since = now - 7 * 86_400_000;
    const repo = { dir, projectId: 'p1', projectName: 'Shop' };
    const events = mergeTimeline([await cache.events(repo, since)], since);
    assert.deepEqual(events.map((e) => [e.type, e.text]), [
      ['commit', 'Sur la branche'],
      ['push', 'main'],
      ['commit', 'Deuxième'],
      ['push', 'main'],
      ['commit', 'Premier'],
    ]);
    const branchCommit = events.find((e) => e.text === 'Sur la branche')!;
    assert.equal(branchCommit.branch, 'feat/x');
    assert.equal(branchCommit.author, 'Ada');
    assert.equal(branchCommit.projectId, 'p1');
    const pushes = events.filter((e) => e.type === 'push');
    assert.deepEqual(pushes.map((p) => [p.remote, p.commits]), [['origin', 1], ['origin', null]], 'nouvelle branche distante : nombre inconnu');

    // Rien n'a changé : même résultat sans relancer git (signature identique), nom de projet à jour.
    const sig = repoSignature(gitDirs(dir)!);
    const again = await cache.events({ ...repo, projectName: 'Shop 2' }, since);
    assert.equal(repoSignature(gitDirs(dir)!), sig);
    assert.equal(again.length, 5);
    assert.ok(again.every((e) => e.projectName === 'Shop 2'));
    // Un commit change la signature : il apparaît.
    commit('Nouveau', 0);
    assert.notEqual(repoSignature(gitDirs(dir)!), sig);
    assert.ok((await cache.events(repo, since)).some((e) => e.text === 'Nouveau'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
