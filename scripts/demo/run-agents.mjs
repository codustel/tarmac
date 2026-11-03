#!/usr/bin/env node
// Lance les sessions « en cours hors Tarmac » de la démo (demo-fixtures/running-agents.json) : un faux `claude`
// (bin-agents/claude, en tête du PATH) par session, détaché, dans le dossier du projet de démo. Jamais le vrai
// Claude Code. Arrêtés par `run-demo.sh --stop` (process dont le dossier est dans le HOME de démo).
//   node run-agents.mjs --home <DEMO_HOME>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const home = path.resolve(argv[argv.indexOf('--home') + 1] ?? '');
const fx = path.join(home, 'demo-fixtures');
const bin = path.join(fx, 'bin-agents');
if (!fs.existsSync(path.join(bin, 'claude'))) { console.error(`✗ ${bin}/claude absent (create-demo.mjs)`); process.exit(1); }
const list = JSON.parse(fs.readFileSync(path.join(fx, 'running-agents.json'), 'utf8'));
const nodeDir = path.dirname(process.execPath);

for (const a of list) {
  if (!a.cwd.startsWith(home + path.sep)) throw new Error(`hors du HOME de démo : ${a.cwd}`);
  const child = spawn('claude', ['--resume', a.sessionId], {
    cwd: a.cwd,
    detached: true,
    stdio: 'ignore',
    env: {
      HOME: home, PATH: `${bin}:${nodeDir}:/usr/bin:/bin`, CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      DEMO_AGENT_ENTRY: a.entrypoint, DEMO_AGENT_STATUS: a.status,
    },
  });
  child.unref();
}
console.log(`\x1b[1;32m✓\x1b[0m ${list.length} faux agents en cours hors Tarmac`);
