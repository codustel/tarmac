import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeTurnState } from './claude.js';

test('tour de parole d’une session d’après la fin de son transcript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-turn-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const proj = path.join(dir, 'projects', '-dev-shop');
    fs.mkdirSync(proj, { recursive: true });
    const write = (id: string, lines: object[]) => fs.writeFileSync(path.join(proj, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const user = (content: unknown) => ({ type: 'user', message: { role: 'user', content } });
    const asst = (content: unknown) => ({ type: 'assistant', message: { role: 'assistant', content } });
    write('aaaaaaaa-0001', [user('Fais X'), asst([{ type: 'text', text: 'Fait.' }])]);
    write('aaaaaaaa-0002', [user('Fais X'), asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])]);
    write('aaaaaaaa-0003', [user('Fais X'), asst([{ type: 'tool_use', id: 't1' }]), user([{ type: 'tool_result', tool_use_id: 't1' }])]);
    write('aaaaaaaa-0004', [user('Fais X')]);
    write('aaaaaaaa-0005', [user('Fais X'), user([{ type: 'text', text: '[Request interrupted by user]' }])]);
    write('aaaaaaaa-0006', [{ type: 'summary', summary: 's' }, asst('Fait.'), { ...user('sous-agent'), isSidechain: true }]);
    assert.equal(claudeTurnState('aaaaaaaa-0001'), 'idle');
    assert.equal(claudeTurnState('aaaaaaaa-0002'), 'working', 'outil en cours ou permission demandée');
    assert.equal(claudeTurnState('aaaaaaaa-0003'), 'working');
    assert.equal(claudeTurnState('aaaaaaaa-0004'), 'working');
    assert.equal(claudeTurnState('aaaaaaaa-0005'), 'idle');
    assert.equal(claudeTurnState('aaaaaaaa-0006'), 'idle', 'sous-agent ignoré');
    assert.equal(claudeTurnState('aaaaaaaa-9999'), 'none');
    assert.equal(claudeTurnState('../../etc'), 'none');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
