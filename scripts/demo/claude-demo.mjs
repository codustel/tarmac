#!/usr/bin/env node
// Faux Claude Code du mode démo : affiche un écran crédible (bannière, derniers échanges du transcript)
// sans rien lancer ni contacter. Arguments compatibles avec la commande de Tarmac :
//   --resume <id> --remote-control        |   --session-id <id> --remote-control <nom> [prompt]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const resume = opt('--resume');
const rcIndex = args.indexOf('--remote-control');
const name = !resume && rcIndex >= 0 ? args[rcIndex + 1] : null;
const prompt = !resume && rcIndex >= 0 ? args[rcIndex + 2] : null;

const c = { dim: '\x1b[2m', bold: '\x1b[1m', orange: '\x1b[38;5;209m', gray: '\x1b[38;5;245m', green: '\x1b[32m', reset: '\x1b[0m' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = os.homedir();
const cwd = process.cwd().replace(home, '~');

/** Échanges du transcript (`--resume`). */
function chat(id) {
  const base = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects');
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const f = path.join(base, d, `${id}.jsonl`);
    if (!fs.existsSync(f)) continue;
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((l) => l.type === 'user' || l.type === 'assistant')
      .map((l) => [l.type, typeof l.message.content === 'string' ? l.message.content : l.message.content.find((x) => x.type === 'text')?.text ?? '']);
  }
  return [];
}

const width = 58;
const line = (s = '') => `${c.orange}│${c.reset} ${s}${' '.repeat(Math.max(0, width - 2 - s.replace(/\x1b\[[0-9;]*m/g, '').length))}${c.orange}│${c.reset}`;
const out = (s = '') => process.stdout.write(s + '\r\n');

const cols = () => Math.max(40, (process.stdout.columns || 100) - 2);

async function type(text, prefix) {
  const words = text.split(' ');
  process.stdout.write(prefix);
  let col = 2;
  for (const w of words) {
    if (col + w.length >= cols()) { process.stdout.write('\r\n  '); col = 2; }
    process.stdout.write(w + ' ');
    col += w.length + 1;
    await sleep(18);
  }
  process.stdout.write('\r\n\r\n');
}

out(`${c.orange}╭${'─'.repeat(width - 1)}╮${c.reset}`);
out(line(`${c.orange}✻${c.reset} ${c.bold}Welcome to Claude Code!${c.reset}`));
out(line());
out(line(`${c.gray}/help for help, /status for your current setup${c.reset}`));
out(line());
out(line(`${c.gray}cwd: ${cwd}${c.reset}`));
out(`${c.orange}╰${'─'.repeat(width - 1)}╯${c.reset}`);
out();
out(`${c.green}●${c.reset} Remote Control active${name ? ` — ${c.bold}${name}${c.reset}` : ''} ${c.gray}(also available on claude.ai/code)${c.reset}`);
out();

const history = resume ? chat(resume).slice(-4) : prompt ? [['user', prompt]] : [];
for (const [role, text] of history) {
  if (role === 'user') await type(text, `${c.gray}>${c.reset} `);
  else await type(text, `${c.orange}⏺${c.reset} `);
}
if (prompt && !resume) await type("I'll take a look at the project structure first.", `${c.orange}⏺${c.reset} `);

out(`${c.gray}${'─'.repeat(cols())}${c.reset}`);
process.stdout.write(`${c.gray}>${c.reset} `);
process.stdin.on('data', (d) => process.stdout.write(d.toString().replace(/\r/g, '\r\n> ')));
process.stdin.resume();
