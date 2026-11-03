#!/usr/bin/env node
// Génère l'espace de démo de Tarmac dans un HOME factice (idempotent) :
//   <home>/Developer/…          projets fictifs Orbit Labs (thème spatial) (git avec historique, dépendances installées)
//   <home>/.claude/projects/…   sessions Claude Code factices (CLAUDE_CONFIG_DIR)
//   <home>/.codex/sessions/…    sessions Codex factices (CODEX_HOME)
//   <home>/.tarmac/             données de Tarmac (DATA_DIR) : réglages de démo
//   <home>/demo-fixtures/       fixtures du mode démo (TARMAC_DEMO_FIXTURES) et faux Claude Code
//   <home>/.gitconfig, .zshrc   identité git et invite de console neutres, réseau git coupé
//
// Usage : node scripts/demo/create-demo.mjs [--home ~/tarmac-demo-home] [--reset] [--no-install]
// Un projet déjà présent est conservé (ses dépendances sont complétées) ; --reset recrée tout l'espace.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROJECTS } from './projects.mjs';
import { CODEX_RUNNING, CODEX_SESSIONS, RUNNING_AGENTS, SESSIONS, codexRollout, codexSessionIdOf, fixtures, sessionIdOf, todolistInsights, todolistPilot, todolistPlatform, todolistRocketApi, todolistStorefront, transcript } from './sessions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const value = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const realHome = os.homedir();
const HOME = path.resolve(value('--home', path.join(realHome, 'tarmac-demo-home')).replace(/^~(?=$|\/)/, realHome));
const DEV = path.join(HOME, 'Developer');
const NOW = Date.now();
const install = !flag('--no-install');

const say = (m) => console.log(`\x1b[1;34m▸\x1b[0m ${m}`);
const die = (m) => { console.error(`\x1b[1;31m✗\x1b[0m ${m}`); process.exit(1); };

if (HOME === realHome || realHome.startsWith(HOME + path.sep)) die(`Le HOME de démo doit être un dossier dédié (pas ${HOME})`);
if (flag('--reset') && fs.existsSync(HOME)) {
  if (!fs.existsSync(path.join(HOME, 'demo-fixtures', 'fixtures.json')) && fs.readdirSync(HOME).length) die(`${HOME} n'est pas un espace de démo : suppression refusée`);
  say(`Suppression de ${HOME}`);
  fs.rmSync(HOME, { recursive: true, force: true });
}

const write = (file, content, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
};

// ─── HOME factice ───────────────────────────────────────────────────────────
// Identité git de démo, aucun assistant d'identification, réseau git coupé (proxy injoignable).
write(path.join(HOME, '.gitconfig'), `[user]
\tname = Ismael
\temail = ismael@example.com
[init]
\tdefaultBranch = main
[credential]
\thelper =
[http]
\tproxy = http://127.0.0.1:9
[advice]
\tdetachedHead = false
`);
// Invite neutre (le /etc/zshrc de macOS affiche le nom de la machine).
write(path.join(HOME, '.zshrc'), "PROMPT='%F{39}%~%f %F{245}❯%f '\nRPROMPT=''\nunsetopt BEEP\n");
write(path.join(HOME, '.bashrc'), "PS1='\\w ❯ '\n");
write(path.join(HOME, '.hushlogin'), '');
// `pnpm run` sans l'en-tête « > paquet@version script /chemin/absolu » (seule la sortie du script est affichée).
write(path.join(HOME, '.npmrc'), 'reporter=silent\nupdate-notifier=false\n');

const gitEnv = (date) => ({
  ...process.env,
  HOME,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(HOME, '.gitconfig'),
  GIT_AUTHOR_NAME: 'Ismael', GIT_AUTHOR_EMAIL: 'ismael@example.com',
  GIT_COMMITTER_NAME: 'Ismael', GIT_COMMITTER_EMAIL: 'ismael@example.com',
  ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
});
const git = (dir, args, date) => execFileSync('git', args, { cwd: dir, env: gitEnv(date), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const AGE = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const dateOf = (age) => { const [, n, u] = age.match(/^([\d.]+)([mhd])$/); return new Date(NOW - Number(n) * AGE[u]).toISOString(); };
const later = (iso, min) => new Date(Date.parse(iso) + min * 60_000).toISOString();

// ─── Projets ────────────────────────────────────────────────────────────────
function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) write(path.join(dir, rel), content);
}

function installDeps(p, dir) {
  if (!install || !p.install) return;
  if (p.install === 'pnpm' && !fs.existsSync(path.join(dir, 'node_modules'))) {
    say(`  dépendances (pnpm) : ${p.dir}`);
    execFileSync('pnpm', ['install', '--silent', '--config.update-notifier=false'], { cwd: dir, stdio: 'inherit' });
  }
  if (p.install === 'venv' && !fs.existsSync(path.join(dir, '.venv', 'bin', 'python'))) {
    say(`  environnement Python : ${p.dir}`);
    execFileSync('python3', ['-m', 'venv', '.venv'], { cwd: dir, stdio: 'inherit' });
    execFileSync(path.join(dir, '.venv', 'bin', 'pip'), ['install', '-q', '--disable-pip-version-check', ...p.pip], { cwd: dir, stdio: 'inherit' });
  }
}

function buildHistory(p, dir) {
  const later_ = new Set(p.history.slice(1).flatMap((h) => h.add ?? []));
  git(dir, ['init', '-q', '-b', 'main']);
  const all = git(dir, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const commits = [];
  p.history.forEach((h, i) => {
    const date = dateOf(h.age);
    if (p.branch && i === p.history.length - 2) git(dir, ['checkout', '-q', '-b', p.branch]);
    if (i === 0) git(dir, ['add', '--', ...all.filter((f) => !later_.has(f))]);
    else if (h.add) git(dir, ['add', '--', ...h.add]);
    else {
      fs.appendFileSync(path.join(dir, 'CHANGELOG.md'), `\n- ${h.msg}`);
      git(dir, ['add', 'CHANGELOG.md']);
    }
    git(dir, ['commit', '-q', '-m', h.msg], date);
    commits.push({ sha: git(dir, ['rev-parse', 'HEAD']), date });
  });

  // Remote GitHub factice et branches distantes (jamais contactées : réseau git coupé dans le HOME de démo).
  git(dir, ['remote', 'add', 'origin', `https://github.com/${p.repo}.git`]);
  const branch = git(dir, ['branch', '--show-current']);
  const pushed = commits[commits.length - 1 - (p.pushedBack ?? 0)];
  const push = (ref, c) => git(dir, ['update-ref', '-m', 'update by push', `refs/remotes/origin/${ref}`, c.sha], later(c.date, 4));
  const mainTip = p.branch ? commits[commits.length - 3] : pushed;
  push('main', mainTip);
  if (branch !== 'main') push(branch, pushed);
  git(dir, ['config', `branch.${branch}.remote`, 'origin']);
  git(dir, ['config', `branch.${branch}.merge`, `refs/heads/${branch}`]);

  // Commits poussés depuis une autre machine : la branche locale est en retard.
  if (p.remoteAhead?.length) {
    const head = git(dir, ['rev-parse', 'HEAD']);
    p.remoteAhead.forEach((msg, i) => {
      fs.appendFileSync(path.join(dir, 'CHANGELOG.md'), `\n- ${msg}`);
      git(dir, ['commit', '-q', '-am', msg], dateOf(`${(p.remoteAhead.length - i) * 4}h`));
    });
    git(dir, ['update-ref', '-m', 'fetch: fast-forward', 'refs/remotes/origin/main', 'HEAD'], dateOf('1h'));
    git(dir, ['reset', '-q', '--hard', head]);
  }
}

function applyDirty(p, dir) {
  for (const [rel, change] of Object.entries(p.dirty ?? {})) {
    const file = path.join(dir, rel);
    if (typeof change === 'string') write(file, change);
    else fs.appendFileSync(file, change.append);
  }
}

/**
 * Dates de modification crédibles : fichiers suivis à la date du dernier commit, fichiers modifiés (et leur
 * dossier de premier niveau) 20 minutes avant la génération. Sans cela, tout semble modifié « à l'instant ».
 */
const SKIP = new Set(['node_modules', '.venv', '.git', '.turbo', '.astro', 'dist']);
function settleMtimes(dir) {
  const last = new Date(git(dir, ['log', '-1', '--format=%cI']));
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      fs.utimesSync(f, last, last);
    }
  };
  walk(dir);
  const dirtyAt = new Date(NOW - 20 * 60_000);
  for (const rel of git(dir, ['ls-files', '--modified', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
    fs.utimesSync(path.join(dir, rel), dirtyAt, dirtyAt);
    const top = path.join(dir, rel.split('/')[0]);
    if (top !== path.join(dir, rel)) fs.utimesSync(top, dirtyAt, dirtyAt);
  }
}

const todolists = {
  'nebula-store': todolistStorefront(NOW),
  'mission-control': todolistPlatform(NOW),
  'rocket-api': todolistRocketApi(NOW),
  'orbit-insights': todolistInsights(NOW),
  'pocket-pilot': todolistPilot(NOW),
};

fs.mkdirSync(DEV, { recursive: true });
for (const p of PROJECTS) {
  const dir = path.join(DEV, p.dir);
  if (fs.existsSync(path.join(dir, '.git'))) {
    say(`${p.dir} : déjà présent`);
    installDeps(p, dir);
    settleMtimes(dir);
    continue;
  }
  say(`${p.dir} (${p.repo})`);
  const files = { ...p.files };
  const todo = todolists[p.dir];
  if (todo) {
    files['Todolist/suivi.config.json'] = JSON.stringify(todo.config, null, 2) + '\n';
    files['Todolist/suivi.json'] = JSON.stringify(todo.data, null, 2) + '\n';
  }
  writeFiles(dir, files);
  installDeps(p, dir);
  buildHistory(p, dir);
  applyDirty(p, dir);
  settleMtimes(dir);
}

// ─── Sessions Claude Code (CLAUDE_CONFIG_DIR = <home>/.claude) ──────────────
const claudeProjects = path.join(HOME, '.claude', 'projects');
fs.rmSync(claudeProjects, { recursive: true, force: true });
const indexes = new Map();
for (const s of SESSIONS) {
  const cwd = path.join(DEV, s.project);
  const enc = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const t = transcript(s, cwd, NOW);
  const file = path.join(claudeProjects, enc, `${t.id}.jsonl`);
  write(file, t.jsonl);
  const end = new Date(NOW - s.age);
  fs.utimesSync(file, end, end);
  indexes.set(enc, [...(indexes.get(enc) ?? []), { sessionId: t.id, summary: s.title, messageCount: t.messages, gitBranch: s.branch, projectPath: cwd }]);
}
for (const [enc, entries] of indexes) write(path.join(claudeProjects, enc, 'sessions-index.json'), JSON.stringify({ version: 1, entries }, null, 2));
say(`${SESSIONS.length} sessions Claude Code factices`);

// Sessions « en cours hors Tarmac » : faux agents en arrière-plan (lancés par run-demo.sh via agents-demo.mjs).
fs.rmSync(path.join(HOME, '.claude', 'sessions'), { recursive: true, force: true });
const running = RUNNING_AGENTS.map((a) => {
  const cwd = path.join(DEV, a.project);
  const sessionId = sessionIdOf(a.project, a.session);
  const sub = path.join(claudeProjects, cwd.replace(/[^a-zA-Z0-9]/g, '-'), sessionId, 'subagents');
  for (const s of a.subagents) {
    const at = new Date(NOW - 3 * 60_000).toISOString();
    write(path.join(sub, `agent-${s.id}.jsonl`), JSON.stringify({ type: 'user', isSidechain: true, agentId: s.id, sessionId, cwd, timestamp: at, message: { role: 'user', content: s.description } }) + '\n');
    write(path.join(sub, `agent-${s.id}.meta.json`), JSON.stringify({ agentType: s.type, description: s.description, ...(s.finished ? { finished: true } : {}) }));
  }
  return { agent: 'claude', cwd, sessionId, entrypoint: a.entrypoint, status: a.status };
});

// ─── Sessions Codex (CODEX_HOME = <home>/.codex) ────────────────────────────
// Visibles quand Codex est coché dans Réglages → Agents ; jamais le vrai ~/.codex.
const codexSessions = path.join(HOME, '.codex', 'sessions');
fs.rmSync(codexSessions, { recursive: true, force: true });
for (const s of CODEX_SESSIONS) {
  const r = codexRollout(s, path.join(DEV, s.project), NOW);
  const file = path.join(codexSessions, r.rel);
  write(file, r.jsonl);
  const end = new Date(NOW - s.age);
  fs.utimesSync(file, end, end);
}
write(path.join(HOME, '.codex', 'session_index.jsonl'), CODEX_SESSIONS.map((s) => JSON.stringify({ id: codexSessionIdOf(s.project, s.title), thread_name: s.title, updated_at: new Date(NOW - s.age).toISOString() })).join('\n') + '\n');
for (const a of CODEX_RUNNING) running.push({ agent: 'codex', cwd: path.join(DEV, a.project), sessionId: codexSessionIdOf(a.project, a.session) });
say(`${CODEX_SESSIONS.length} sessions Codex factices`);

// ─── Données de Tarmac (DATA_DIR = <home>/.tarmac) ──────────────────────────
const dataDir = path.join(HOME, '.tarmac');
const settingsFile = path.join(dataDir, 'settings.json');
if (!fs.existsSync(settingsFile)) {
  write(settingsFile, JSON.stringify({
    roots: [DEV],
    cloneDir: DEV,
    github: { owners: ['orbit-labs', 'orbit-labs-oss'], token: '' },
    portRange: { start: 6100, end: 6199 },
    showAllProjects: true,
    theme: 'dark',
    language: 'en',
    favorites: [path.join(DEV, 'nebula-store'), path.join(DEV, 'mission-control')],
    urls: { [path.join(DEV, 'nebula-store')]: 'https://nebula-store.app', [path.join(DEV, 'launchpad-docs')]: 'https://launchpad-docs.dev' },
  }, null, 2));
  say('Réglages de démo écrits');
}

// ─── Fixtures du mode démo ──────────────────────────────────────────────────
const fx = path.join(HOME, 'demo-fixtures');
const { home: _h, ...data } = fixtures(HOME);
write(path.join(fx, 'fixtures.json'), JSON.stringify(data, null, 2));
fs.rmSync(path.join(fx, 'bin'), { recursive: true, force: true });
write(path.join(fx, 'bin', 'claude'), fs.readFileSync(path.join(HERE, 'claude-demo.mjs'), 'utf8'), 0o755);
write(path.join(fx, 'bin', 'codex'), fs.readFileSync(path.join(HERE, 'codex-demo.mjs'), 'utf8'), 0o755);
write(path.join(fx, 'bin', 'gh'), fs.readFileSync(path.join(HERE, 'gh-demo.mjs'), 'utf8'), 0o755);
// Faux `claude` des sessions en cours hors Tarmac (dossier à part : jamais dans le PATH des consoles).
fs.rmSync(path.join(fx, 'bin-agents'), { recursive: true, force: true });
write(path.join(fx, 'bin-agents', 'claude'), fs.readFileSync(path.join(HERE, 'agents-demo.mjs'), 'utf8'), 0o755);
write(path.join(fx, 'bin-agents', 'codex'), fs.readFileSync(path.join(HERE, 'agents-demo.mjs'), 'utf8'), 0o755);
write(path.join(fx, 'running-agents.json'), JSON.stringify(running, null, 2));
say(`Espace de démo prêt : ${HOME}`);
