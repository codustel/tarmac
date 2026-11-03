#!/usr/bin/env node
// Faux Codex (ChatGPT) du mode démo et des essais : affiche un écran crédible (bannière, derniers échanges du
// transcript) sans rien lancer ni contacter. Comme la vraie TUI : boîte de saisie « › » avec le texte d'attente
// « Ask Codex to do anything » quand elle est vide, pied de page « ? for shortcuts », indicateur
// « Working (… • esc to interrupt) » pendant un tour. Il écrit son transcript « rollout » dans
// $CODEX_HOME/sessions (session_meta, task_started, user_message, agent_message, task_complete), ce qui permet à
// Tarmac de le rattacher à sa session et de lire son tour de parole. Jamais le vrai `codex`.
// Arguments compatibles avec la commande de Tarmac :   codex [prompt]   |   codex resume <id>
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const resume = args[0] === 'resume' ? args[1] : null;
const prompt = !resume && args[0] && !args[0].startsWith('-') ? args[0] : null;
const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const c = { dim: '\x1b[2m', bold: '\x1b[1m', teal: '\x1b[38;5;43m', gray: '\x1b[38;5;245m', reset: '\x1b[0m' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s = '') => process.stdout.write(s + '\r\n');
const cwd = process.cwd().replace(os.homedir(), '~');

/** Transcript de la session reprise, ou nouveau transcript (UUID v7 factice). */
function rolloutFile() {
  const base = path.join(home, 'sessions');
  if (resume) {
    const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
    const f = walk(base).find((x) => x.endsWith(`${resume}.jsonl`));
    if (f) return { file: f, id: resume };
  }
  const now = new Date();
  const u = crypto.randomUUID();
  const id = `${u.slice(0, 14)}7${u.slice(15)}`;
  const dir = path.join(base, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  const file = path.join(dir, `rollout-${now.toISOString().slice(0, 19).replace(/:/g, '-')}-${id}.jsonl`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ timestamp: now.toISOString(), type: 'session_meta', payload: { id, session_id: id, timestamp: now.toISOString(), cwd: process.cwd(), originator: 'codex_cli_rs', cli_version: '0.98.0', source: 'cli' } }) + '\n');
  return { file, id };
}
const { file } = rolloutFile();
const event = (payload) => fs.appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload }) + '\n');

function history() {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((l) => l.type === 'event_msg' && (l.payload?.type === 'user_message' || l.payload?.type === 'agent_message'))
      .map((l) => [l.payload.type === 'user_message' ? 'user' : 'assistant', String(l.payload.message ?? '')]);
  } catch { return []; }
}

const cols = () => Math.max(40, (process.stdout.columns || 100) - 2);
async function type(text, prefix) {
  process.stdout.write(prefix);
  let col = 2;
  for (const w of text.split(' ')) {
    if (col + w.length >= cols()) { process.stdout.write('\r\n  '); col = 2; }
    process.stdout.write(w + ' ');
    col += w.length + 1;
    await sleep(14);
  }
  process.stdout.write('\r\n\r\n');
}

const W = 58;
const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
const line = (s = '') => out(`${c.gray}│${c.reset} ${s}${' '.repeat(Math.max(0, W - 2 - visible(s)))}${c.gray}│${c.reset}`);
out(`${c.gray}╭${'─'.repeat(W - 1)}╮${c.reset}`);
line(`${c.bold}>_ OpenAI Codex${c.reset} ${c.gray}(demo, v0.98.0)${c.reset}`);
line();
line(`${c.gray}model:${c.reset}     gpt-5-codex`);
line(`${c.gray}directory:${c.reset} ${cwd.length > 40 ? '…' + cwd.slice(-39) : cwd}`);
out(`${c.gray}╰${'─'.repeat(W - 1)}╯${c.reset}`);
out();

for (const [role, text] of history().slice(-4)) await type(text, role === 'user' ? `${c.gray}›${c.reset} ` : `${c.teal}•${c.reset} `);

/** Un tour : indicateur de travail, réponse, fin du tour (transcript compris). */
async function turn(msg) {
  event({ type: 'task_started' });
  event({ type: 'user_message', message: msg });
  await type(msg, `${c.gray}›${c.reset} `);
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) { process.stdout.write(`\r\x1b[2K${c.teal}•${c.reset} Working ${c.dim}(${Math.round((Date.now() - t0) / 1000)}s • esc to interrupt)${c.reset}`); await sleep(700); }
  process.stdout.write('\r\x1b[2K');
  const reply = `(demo) Message received, ${msg.length} characters. Nothing is run here.`;
  await type(reply, `${c.teal}•${c.reset} `);
  event({ type: 'agent_message', message: reply });
  event({ type: 'task_complete' });
}

// Boîte de saisie : texte d'attente quand elle est vide, pied de page.
const box = (text = '') => {
  out(`${c.bold}›${c.reset} ${text ? text : `${c.dim}Ask Codex to do anything${c.reset}`}`);
  out();
  out(`  ${c.dim}? for shortcuts${c.reset}${' '.repeat(Math.max(2, cols() - 36))}${c.dim}100% context left${c.reset}`);
};
if (prompt) await turn(prompt);
box();
process.stdout.write('\x1b[?2004h'); // collage entre crochets, comme la vraie TUI
let input = '';
let pasting = false;
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (d) => {
  let rest = d;
  while (rest.length) {
    if (rest.startsWith('\x1b[200~')) { pasting = true; rest = rest.slice(6); continue; }
    if (rest.startsWith('\x1b[201~')) { pasting = false; rest = rest.slice(6); continue; }
    const ch = rest[0];
    rest = rest.slice(1);
    if (ch === '\x03') process.exit(0);
    if ((ch === '\r' || ch === '\n') && !pasting) {
      const msg = input.trim();
      input = '';
      if (!msg) continue;
      out();
      await turn(msg);
      box();
      continue;
    }
    if (ch === '\x7f') input = input.slice(0, -1);
    else input += ch;
    // Saisie en cours affichée dans la boîte : le texte d'attente disparaît (Tarmac ne colle rien par-dessus).
    if (!pasting) process.stdout.write(`\r\x1b[2K${c.bold}›${c.reset} ${input}`);
  }
});
process.stdin.resume();
