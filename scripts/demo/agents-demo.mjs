#!/usr/bin/env node
// Faux Claude Code « en cours hors Tarmac » du mode démo (copié en demo-fixtures/bin-agents/claude) : il ne fait
// que dormir. Comme le vrai, il écrit `$CLAUDE_CONFIG_DIR/sessions/<pid>.json` (session, dossier, point d'entrée,
// statut busy / idle) et, tant qu'il tourne, fait vivre les faux agents en arrière-plan de sa session (transcripts
// `subagents/agent-*.jsonl` sans `finished` touchés régulièrement). Rien n'est lancé ni contacté.
//   claude --resume <sessionId>      (DEMO_AGENT_ENTRY, DEMO_AGENT_STATUS : point d'entrée et statut)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const i = args.indexOf('--resume');
const sessionId = i >= 0 ? args[i + 1] : null;
const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const pidFile = path.join(cfg, 'sessions', `${process.pid}.json`);
const startedAt = Date.now();

function writePidFile() {
  const now = Date.now();
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify({
    pid: process.pid, sessionId, cwd: process.cwd(), startedAt, version: '2.1.12', kind: 'interactive',
    entrypoint: process.env.DEMO_AGENT_ENTRY || 'cli', status: process.env.DEMO_AGENT_STATUS || 'idle', updatedAt: now, statusUpdatedAt: now,
  }));
}

/** Transcripts des sous-agents non terminés de la session : touchés pour rester « actifs ». */
function touchSubagents() {
  if (!sessionId) return;
  const base = path.join(cfg, 'projects');
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const sub = path.join(base, d, sessionId, 'subagents');
    if (!fs.existsSync(sub)) continue;
    for (const f of fs.readdirSync(sub).filter((x) => x.endsWith('.meta.json'))) {
      try {
        if (JSON.parse(fs.readFileSync(path.join(sub, f), 'utf8')).finished) continue;
        const t = new Date();
        fs.utimesSync(path.join(sub, f.replace(/\.meta\.json$/, '.jsonl')), t, t);
      } catch { /* fichier absent */ }
    }
  }
}

const tick = () => { writePidFile(); touchSubagents(); };
tick();
const timer = setInterval(tick, 30_000);
const quit = () => { clearInterval(timer); try { fs.rmSync(pidFile, { force: true }); } catch { /* déjà supprimé */ } process.exit(0); };
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
process.on('SIGHUP', quit);
