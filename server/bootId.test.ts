import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOT_ID, sessionMarkerEnv } from './bootId.js';

test('sessionMarkerEnv adds the agent for codex', () => {
  assert.deepEqual(sessionMarkerEnv('ab12cd34', 't7', 'codex'), { TARMAC_SESSION_ID: 'ab12cd34:t7', TARMAC_AGENT: 'codex' });
});

test('sessionMarkerEnv has no agent for a shell', () => {
  assert.deepEqual(sessionMarkerEnv('ab12cd34', 't7', 'shell'), { TARMAC_SESSION_ID: 'ab12cd34:t7' });
});

test('BOOT_ID is 8 hex characters', () => {
  assert.match(BOOT_ID, /^[0-9a-f]{8}$/);
});
