import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeGraph, parseLog, parseStatus, scmAction, scmLog, scmShow, scmStatus } from './scm.js';

const rec = (...r: string[]) => r.join('\0') + '\0';

test('parseStatus : branche, avance / retard, groupes', () => {
  const out = rec(
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +8 -2',
    '1 M. N... 100644 100644 100644 aaa bbb src/a.ts',
    '1 .M N... 100644 100644 100644 aaa bbb src/b c.ts',
    '1 MM N... 100644 100644 100644 aaa bbb src/both.ts',
    '1 A. N... 000000 100644 100644 000 bbb new.ts',
    '1 .D N... 100644 100644 000000 aaa aaa gone.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R100 dst.ts', 'src.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
    '? untracked.md',
  );
  const s = parseStatus(out, '');
  assert.equal(s.branch, 'main');
  assert.equal(s.upstream, 'origin/main');
  assert.equal(s.ahead, 8);
  assert.equal(s.behind, 2);
  assert.deepEqual(s.staged.map((c) => `${c.code} ${c.path}`), ['M src/a.ts', 'M src/both.ts', 'A new.ts', 'R dst.ts']);
  assert.equal(s.staged[3].orig, 'src.ts');
  assert.deepEqual(s.changes.map((c) => `${c.code} ${c.path}`), ['M src/b c.ts', 'M src/both.ts', 'D gone.ts', 'U untracked.md']);
  assert.deepEqual(s.conflicts.map((c) => c.path), ['conflict.ts']);
});

test('parseStatus : chemins relatifs au sous-dossier du projet', () => {
  const s = parseStatus(rec('# branch.head (detached)', '1 .M N... 1 1 1 a b apps/web/x.ts', '? apps/web/y.ts', '? other/z.ts'), 'apps/web/');
  assert.equal(s.branch, null);
  assert.deepEqual(s.changes.map((c) => c.path), ['x.ts', 'y.ts']);
});

test('computeGraph : historique linéaire', () => {
  const rows = computeGraph([{ hash: 'c', parents: ['b'] }, { hash: 'b', parents: ['a'] }, { hash: 'a', parents: [] }]);
  assert.deepEqual(rows.map((r) => r.col), [0, 0, 0]);
  assert.deepEqual(rows[0], { col: 0, top: [], bottom: [[0, 0]] });
  assert.deepEqual(rows[1], { col: 0, top: [[0, 0]], bottom: [[0, 0]] });
  assert.deepEqual(rows[2], { col: 0, top: [[0, 0]], bottom: [] });
});

test('computeGraph : fusion puis branches qui se rejoignent', () => {
  // m = merge(b, x) ; b → a ; x → a
  const rows = computeGraph([
    { hash: 'm', parents: ['b', 'x'] },
    { hash: 'b', parents: ['a'] },
    { hash: 'x', parents: ['a'] },
    { hash: 'a', parents: [] },
  ]);
  assert.deepEqual(rows[0].bottom, [[0, 0], [0, 1]]);
  assert.equal(rows[1].col, 0);
  assert.deepEqual(rows[1].bottom, [[0, 0], [1, 1]]);
  assert.equal(rows[2].col, 1);
  assert.deepEqual(rows[2].bottom, [[1, 0], [0, 0]]);
  assert.equal(rows[3].col, 0);
  assert.deepEqual(rows[3].top, [[0, 0]]);
});

test('parseLog : champs et refs', () => {
  const c = parseLog('h1\x1fp1 p2\x1fIsma\x1f1700000000\x1fHEAD -> main, origin/main, origin/HEAD\x1fmsg\0')[0];
  assert.deepEqual(c, { hash: 'h1', parents: ['p1', 'p2'], author: 'Isma', date: 1700000000, refs: ['HEAD -> main', 'origin/main'], subject: 'msg' });
});

test('dépôt réel : statut, diff, indexation, smart commit, log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('config', 'core.autocrlf', 'false'); // Git for Windows : pas de conversion CRLF dans le dépôt de test
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v1\n');
  fs.writeFileSync(path.join(dir, '[id].tsx'), 'x\n');
  await scmAction(dir, 'commit', { message: 'init' }); // smart commit : tout indexé
  assert.equal((await scmStatus(dir)).counts.changes, 0);

  fs.writeFileSync(path.join(dir, 'a.txt'), 'v2\n');
  fs.writeFileSync(path.join(dir, '[id].tsx'), 'y\n');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'n\n');
  let s = await scmStatus(dir);
  assert.deepEqual(s.changes.map((c) => `${c.code} ${c.path}`).sort(), ['M [id].tsx', 'M a.txt', 'U new.txt']);
  assert.deepEqual(await scmShow(dir, 'a.txt', 'HEAD'), { kind: 'text', content: 'v1\n' });

  await scmAction(dir, 'stage', { paths: ['[id].tsx'] });
  s = await scmStatus(dir);
  assert.deepEqual(s.staged.map((c) => c.path), ['[id].tsx']);
  assert.deepEqual(await scmShow(dir, '[id].tsx', 'INDEX'), { kind: 'text', content: 'y\n' });

  await scmAction(dir, 'unstage', { paths: ['[id].tsx'] });
  await scmAction(dir, 'discard', { paths: ['a.txt', 'new.txt'] });
  s = await scmStatus(dir);
  assert.deepEqual(s.changes.map((c) => c.path), ['[id].tsx']);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1\n');
  assert.equal(fs.existsSync(path.join(dir, 'new.txt')), false);

  await assert.rejects(scmAction(dir, 'stage', { paths: ['../x'] }), /outside the project/);
  await scmAction(dir, 'commit', { message: 'deux' });
  const log = await scmLog(dir);
  assert.deepEqual(log.commits.map((c) => c.subject), ['deux', 'init']);
  fs.rmSync(dir, { recursive: true, force: true });
});
