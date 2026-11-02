import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('allocatePort : deux démarrages simultanés reçoivent des ports différents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-ports-'));
  process.env.DATA_DIR = dir;
  process.env.PORT_RANGE = '6950-6960';
  try {
    const { allocatePort } = await import('./ports.js');
    const ports = await Promise.all(['a', 'b', 'c'].map((id) => allocatePort(id, new Set())));
    assert.equal(new Set(ports).size, 3, `ports attribués : ${ports.join(', ')}`);
    assert.equal(await allocatePort('a', new Set()), ports[0], 'port collant conservé');
    (await import('./store.js')).flushSync(); // pas d'écriture différée après la suppression du dossier
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
