import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assignSessions, worktreeMain } from './claude.js';

/** Dépôt git minimal + worktrees liés (fichier `.git` → `.git/worktrees/<nom>`, `commondir`), sans lancer git. */
function layout() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-wt-')));
  const main = path.join(root, 'site');
  fs.mkdirSync(path.join(main, '.git/worktrees/seo'), { recursive: true });
  fs.writeFileSync(path.join(main, '.git/worktrees/seo/commondir'), '../..\n');
  const sibling = path.join(root, 'site-fix-seo');
  fs.mkdirSync(path.join(sibling, 'apps/web'), { recursive: true });
  fs.writeFileSync(path.join(sibling, '.git'), `gitdir: ${path.join(main, '.git/worktrees/seo')}\n`);
  return { root, main, sibling };
}

test('worktree voisin : rattaché au projet du dépôt principal', () => {
  const { main, sibling } = layout();
  assert.equal(worktreeMain(sibling), main);
  assert.equal(worktreeMain(path.join(sibling, 'apps/web')), main);
  const m = assignSessions([{ cwd: sibling }, { cwd: path.join(sibling, 'apps/web') }], [main]);
  assert.equal(m.get(main)?.length, 2);
});

test('hors dépôt, dépôt principal ou .git illisible : aucun rattachement', () => {
  const { root, main } = layout();
  const other = path.join(root, 'autre');
  fs.mkdirSync(other);
  assert.equal(worktreeMain(other), null);
  assert.equal(worktreeMain(main), null);
  const bad = path.join(root, 'bad');
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, '.git'), 'gitdir: /nulle/part/.git/worktrees/x\n');
  assert.equal(worktreeMain(bad), null);
  assert.equal(assignSessions([{ cwd: other }, { cwd: bad }], [main]).size, 0);
});

test('le chemin direct prime et le projet le plus profond reste choisi', () => {
  const { main, sibling } = layout();
  const inner = path.join(main, 'apps/web');
  const m = assignSessions([{ cwd: path.join(inner, 'x') }, { cwd: sibling }], [main, inner]);
  assert.equal(m.get(inner)?.length, 1);
  assert.equal(m.get(main)?.length, 1);
});
