import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from './args.js';
import { makeCtx, type Out, type Runner } from './context.js';
import { diagnose, type Facts } from './doctor.js';
import { executePlan } from './plan.js';
import { planUninstall } from './service.js';
import { pfRule, planSetup, setEnvVar, type SetupOptions } from './setup.js';
import { main } from './tarmac.js';

// ─── Bac à sable : faux dossier personnel, faux paquet, faux /etc/hosts, exécuteur factice ─────────────────
function sandbox(hosts = '127.0.0.1\tlocalhost\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-cli-'));
  const home = path.join(root, 'home');
  const appDir = path.join(root, 'pkg');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(appDir, 'dist/server'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: '@codustel/tarmac', version: '9.9.9' }));
  fs.writeFileSync(path.join(appDir, 'dist/server/index.js'), '');
  fs.mkdirSync(path.join(root, 'etc'));
  fs.writeFileSync(path.join(root, 'etc/hosts'), hosts);
  const ctx = makeCtx({ home, appDir, env: { PATH: '' }, uid: 501, nodeVersion: '22.13.0', platform: 'darwin', sysRoot: root });
  return { root, home, appDir, ctx };
}

function fakeRunner(responses: Record<string, string> = {}) {
  const runs: string[][] = [];
  const captures: string[][] = [];
  const runner: Runner = {
    run: (argv) => { runs.push(argv); return 0; },
    capture: (argv) => { captures.push(argv); return responses[argv.join(' ')] ?? null; },
  };
  return { runner, runs, captures };
}

function capture(): Out & { text: () => string } {
  const lines: string[] = [];
  return { log: (s = '') => lines.push(s), error: (s) => lines.push(s), text: () => lines.join('\n') };
}

const opts = (o: Partial<SetupOptions> = {}): SetupOptions => ({ domain: 'tarmac.localhost', sudo: true, claude: false, claudeDesktop: false, open: true, ...o });

// ─── Options ───────────────────────────────────────────────────────────────
test('options : commande, booléens, --domain avec ou sans =', () => {
  const p = parseArgs(['setup', '--dry-run', '--domain', 'dev.localhost', '--no-sudo', '-y']);
  assert.equal(p.error, undefined);
  assert.equal(p.command, 'setup');
  assert.deepEqual([p.flags.dryRun, p.flags.domain, p.flags.noSudo, p.flags.yes], [true, 'dev.localhost', true, true]);
  assert.equal(parseArgs(['setup', '--domain=Tarmac.Test']).flags.domain, 'tarmac.test');
  assert.equal(parseArgs(['uninstall', '--purge']).flags.purge, true);
  assert.equal(parseArgs([]).command, 'help');
  assert.equal(parseArgs(['status', '--help']).command, 'help');
  assert.equal(parseArgs(['--version']).command, 'version');
});

test('options : erreurs (inconnue, valeur manquante, domaine invalide, conflit, option hors commande)', () => {
  assert.match(parseArgs(['deploy']).error!, /Unknown command: deploy/);
  assert.match(parseArgs(['setup', '--force']).error!, /Unknown option: --force/);
  assert.match(parseArgs(['setup', '--domain']).error!, /needs a value/);
  assert.match(parseArgs(['setup', '--domain', '--no-sudo']).error!, /needs a value/);
  assert.match(parseArgs(['setup', '--domain', 'bad_domain']).error!, /Invalid domain/);
  assert.match(parseArgs(['setup', '--domain', 'localhost']).error!, /Invalid domain/);
  assert.match(parseArgs(['setup', '--with-claude', '--no-claude']).error!, /cannot be used together/);
  assert.match(parseArgs(['status', '--purge']).error!, /not supported by "status": --purge/);
  assert.match(parseArgs(['setup', 'now']).error!, /Unexpected argument/);
});

// ─── Plan de setup ─────────────────────────────────────────────────────────
test('setup sur un Mac neuf : env, LaunchAgent, hosts et pf (sudo), vérification', () => {
  const { ctx, appDir, home } = sandbox();
  fs.mkdirSync(path.join(home, 'Developer'));
  fs.mkdirSync(path.join(home, 'code'));
  const steps = planSetup(ctx, opts(), fakeRunner().runner);
  assert.deepEqual(steps.map((s) => s.id), ['env', 'launch-agent', 'hosts', 'pf', 'start']);
  assert.deepEqual(steps.filter((s) => s.sudo).map((s) => s.id), ['hosts', 'pf']);

  const env = steps[0].actions[0];
  assert.equal(env.kind, 'write');
  if (env.kind !== 'write') return;
  assert.equal(env.path, path.join(home, '.tarmac/env'));
  assert.equal(env.mode, 0o600);
  assert.match(env.content, /^TARMAC_PORT=7777$/m);
  assert.match(env.content, /^TARMAC_URL=http:\/\/tarmac\.localhost$/m);
  const real = (d: string) => fs.realpathSync(path.join(home, d));
  assert.match(env.content, new RegExp(`^DEV_ROOTS=${real('Developer')},${real('code')}$`, 'm'));

  const plist = steps[1].actions[0];
  assert.ok(plist.kind === 'write' && plist.path.endsWith('Library/LaunchAgents/com.codustel.tarmac.plist'));
  assert.ok(plist.kind === 'write' && plist.content.includes(`exec node "${path.join(appDir, 'dist/server/index.js')}"`));

  const hosts = steps[2].actions.find((a) => a.kind === 'exec' && a.argv[1] === 'tee');
  assert.ok(hosts?.kind === 'exec' && hosts.input === '127.0.0.1\ttarmac.localhost\n127.0.0.1\ttarmac.test\n');
  const pf = steps[3].actions[0];
  assert.ok(pf.kind === 'exec' && pf.input === pfRule(7777));
  assert.equal(steps[3].when?.label, 'port 80 is free');
});

test('setup --no-sudo : aucune étape sudo, URL avec le port', () => {
  const { ctx } = sandbox();
  const steps = planSetup(ctx, opts({ sudo: false }), fakeRunner().runner);
  assert.deepEqual(steps.map((s) => s.id), ['env', 'launch-agent', 'start']);
  assert.ok(steps.every((s) => !s.sudo && s.actions.every((a) => a.kind !== 'exec' || a.argv[0] !== 'sudo')));
  const env = steps[0].actions[0];
  assert.ok(env.kind === 'write' && /^TARMAC_URL=http:\/\/tarmac\.localhost:7777$/m.test(env.content));
});

test('setup : domaines déjà dans /etc/hosts → pas d’étape hosts ; ligne ::1 → retirée ; --domain personnalisé', () => {
  let s = sandbox('127.0.0.1\ttarmac.localhost\n127.0.0.1 tarmac.test\n');
  assert.ok(!planSetup(s.ctx, opts(), fakeRunner().runner).some((st) => st.id === 'hosts'));

  s = sandbox('127.0.0.1\ttarmac.localhost\n127.0.0.1\ttarmac.test\n::1\ttarmac.localhost\n');
  const hosts = planSetup(s.ctx, opts(), fakeRunner().runner).find((st) => st.id === 'hosts')!;
  assert.ok(hosts.actions.some((a) => a.kind === 'exec' && a.argv.includes('sed')));
  assert.ok(!hosts.actions.some((a) => a.kind === 'exec' && a.argv.includes('tee')));

  s = sandbox();
  const custom = planSetup(s.ctx, opts({ domain: 'runway.localhost' }), fakeRunner().runner).find((st) => st.id === 'hosts')!;
  assert.ok(custom.actions.some((a) => a.kind === 'exec' && a.input === '127.0.0.1\trunway.localhost\n127.0.0.1\ttarmac.test\n'));
});

test('setup --dry-run : tout est affiché, rien n’est lancé ni écrit', async () => {
  const { ctx, home } = sandbox();
  const { runner, runs, captures } = fakeRunner();
  const out = capture();
  assert.equal(await main(['setup', '--dry-run'], ctx, runner, out), 0);
  assert.deepEqual(runs, [], 'aucune commande lancée');
  assert.ok(captures.every((a) => ['launchctl print', 'nc -z'].some((p) => a.join(' ').startsWith(p))), 'seulement des lectures');
  assert.deepEqual(fs.readdirSync(home), [], 'rien d’écrit dans le dossier personnel');
  const text = out.text();
  for (const s of ['Dry run', 'Create the configuration ~/.tarmac/env', 'Install the login service', 'launchctl bootstrap gui/501',
    'Redirect port 80 to 7777', '[sudo]', 'only if port 80 is free', 'TARMAC_PORT=7777']) assert.ok(text.includes(s), s);
});

test('setup : la préparation refuse un Node trop ancien ou un paquet non construit', async () => {
  const s = sandbox();
  const out = capture();
  const old = makeCtx({ home: s.home, appDir: s.appDir, env: { PATH: '' }, nodeVersion: '22.12.0', platform: 'darwin', sysRoot: s.root });
  assert.equal(await main(['setup', '--dry-run'], old, fakeRunner().runner, out), 1);
  assert.match(out.text(), /22\.13 or later required/);
  fs.rmSync(path.join(s.appDir, 'dist'), { recursive: true });
  assert.equal(await main(['setup', '--dry-run'], s.ctx, fakeRunner().runner, capture()), 1);
});

// ─── Migration depuis App Manager ──────────────────────────────────────────
test('migration : service App Manager retiré, données copiées, port conservé, réseau nettoyé (sudo)', async () => {
  const { ctx, home } = sandbox('127.0.0.1\tmanager.localhost\n127.0.0.1\tmanager.test\n');
  const old = path.join(home, '.app-manager');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'env'), 'MANAGER_PORT=7790\nMANAGER_URL=http://manager.localhost\nSUIVI_TOKEN=t\n');
  fs.writeFileSync(path.join(old, 'settings.json'), '{}');
  const oldPlist = path.join(home, 'Library/LaunchAgents/com.codustel.app-manager.plist');
  fs.mkdirSync(path.dirname(oldPlist), { recursive: true });
  fs.writeFileSync(oldPlist, '<plist/>');

  const { runner, runs } = fakeRunner();
  const steps = planSetup(ctx, opts(), runner);
  assert.deepEqual(steps.map((s) => s.id), ['legacy-service', 'migrate-data', 'env', 'launch-agent', 'legacy-network', 'hosts', 'pf', 'start']);
  assert.equal(steps[2].title, 'Keep the existing configuration ~/.tarmac/env');
  assert.ok(steps.find((s) => s.id === 'pf')!.actions.some((a) => a.kind === 'exec' && a.input === pfRule(7790)), 'port de l’ancienne installation');
  const net = steps.find((s) => s.id === 'legacy-network')!;
  assert.ok(net.sudo && net.actions.filter((a) => a.kind === 'exec' && a.argv.includes('sed')).length === 2);

  // Exécution des trois premières étapes (sans réseau ni launchd réels).
  await executePlan({ ctx, runner, out: capture() }, steps.slice(0, 3));
  assert.deepEqual(runs, [['launchctl', 'bootout', 'gui/501/com.codustel.app-manager']]);
  assert.equal(fs.existsSync(oldPlist), false, 'ancien LaunchAgent supprimé');
  assert.ok(fs.existsSync(path.join(old, 'settings.json')), 'ancien dossier conservé');
  const env = fs.readFileSync(path.join(home, '.tarmac/env'), 'utf8');
  assert.match(env, /^TARMAC_PORT=7790$/m);
  assert.match(env, /^TARMAC_URL=http:\/\/tarmac\.localhost$/m);
  assert.match(env, /^SUIVI_TOKEN=t$/m);
});

test('migration : DATA_DIR défini → pas de copie depuis ~/.app-manager', () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.home, '.app-manager'));
  const ctx = makeCtx({ home: s.home, appDir: s.appDir, env: { PATH: '', DATA_DIR: path.join(s.root, 'data') }, platform: 'darwin', sysRoot: s.root });
  assert.ok(!planSetup(ctx, opts(), fakeRunner().runner).some((st) => st.id === 'migrate-data'));
});

test('env existant : un port < 1024 est remplacé par 7777, le reste est gardé', async () => {
  const { ctx, home } = sandbox();
  fs.mkdirSync(path.join(home, '.tarmac'));
  fs.writeFileSync(path.join(home, '.tarmac/env'), 'DEV_ROOTS=/x\nMANAGER_PORT=80\n\nGITHUB_TOKEN=abc\n');
  const steps = planSetup(ctx, opts({ sudo: false }), fakeRunner().runner);
  await executePlan({ ctx, runner: fakeRunner().runner, out: capture() }, steps.filter((s) => s.id === 'env'));
  assert.equal(fs.readFileSync(path.join(home, '.tarmac/env'), 'utf8'), 'DEV_ROOTS=/x\nTARMAC_PORT=7777\n\nGITHUB_TOKEN=abc\n');
});

test('setEnvVar : remplace l’ancien nom MANAGER_URL, sinon ajoute la ligne', () => {
  const { root } = sandbox();
  const f = path.join(root, 'env-test');
  fs.writeFileSync(f, 'A=1\nMANAGER_URL=http://manager.localhost\n');
  setEnvVar(f, 'TARMAC_URL', 'http://tarmac.localhost', /^(?:TARMAC|MANAGER)_URL=/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'A=1\nTARMAC_URL=http://tarmac.localhost\n');
  setEnvVar(f, 'B', '2');
  assert.equal(fs.readFileSync(f, 'utf8'), 'A=1\nTARMAC_URL=http://tarmac.localhost\nB=2\n');
});

// ─── Désinstallation, doctor, divers ───────────────────────────────────────
test('uninstall : service, domaines (sudo), --purge ; dry-run sans effet', async () => {
  const { ctx, home } = sandbox('127.0.0.1\ttarmac.localhost\n127.0.0.1\ttarmac.test\n');
  assert.deepEqual(planUninstall(ctx, { sudo: true, purge: false }).map((s) => s.id), ['service', 'hosts']);
  assert.deepEqual(planUninstall(ctx, { sudo: false, purge: true }).map((s) => s.id), ['service', 'purge']);
  const { runner, runs } = fakeRunner();
  const out = capture();
  assert.equal(await main(['uninstall', '--purge', '--dry-run'], ctx, runner, out), 0);
  assert.deepEqual(runs, []);
  assert.deepEqual(fs.readdirSync(home), []);
  assert.match(out.text(), /Delete ~\/\.tarmac/);
});

const facts = (f: Partial<Facts> = {}): Facts => ({
  platform: 'darwin', node: '22.22.0', built: true, envFile: true, plist: true, plistMatches: true, loaded: true, legacyService: false,
  port: 7777, portAnswers: true, url: 'http://tarmac.localhost', domain: 'tarmac.localhost', domainAddrs: ['127.0.0.1'],
  urlAnswers: true, pfRedirect: true, git: true, gh: 'ok', docker: '/var/run/docker.sock', claude: true, claudeMcp: true, claudeSkill: true, claudeMcpLegacy: false, ...f,
});

test('doctor : tout va bien, puis chaque problème avec quoi faire', () => {
  assert.ok(diagnose(facts()).every((ch) => ch.level === 'ok'));
  const byName = (f: Partial<Facts>) => Object.fromEntries(diagnose(facts(f)).map((ch) => [ch.name, ch]));
  assert.equal(byName({ node: '20.20.2' })['Node.js'].level, 'fail');
  assert.match(byName({ node: '20.20.2' })['Node.js'].fix!, /22\.13/);
  assert.match(byName({ loaded: false })['Service'].fix!, /tarmac start/);
  assert.match(byName({ plist: false })['Service'].fix!, /tarmac setup/);
  assert.equal(byName({ plistMatches: false })['Service'].level, 'warn');
  assert.equal(byName({ domainAddrs: ['10.0.0.2'] })['Domain'].level, 'fail');
  assert.equal(byName({ gh: 'missing', docker: null, claude: false })['GitHub CLI'].level, 'warn');
  assert.match(byName({ claudeMcp: false })['Claude Code'].fix!, /--with-claude/);
  assert.match(byName({ plist: false, legacyService: true })['Service'].fix!, /migrates/);
  assert.match(byName({ claudeMcp: false, claudeMcpLegacy: true })['Claude Code'].detail, /app-manager/);
});

test('--version, --help et commande inconnue', async () => {
  const { ctx } = sandbox();
  let out = capture();
  assert.equal(await main(['--version'], ctx, fakeRunner().runner, out), 0);
  assert.equal(out.text(), '9.9.9');
  out = capture();
  assert.equal(await main(['--help'], ctx, fakeRunner().runner, out), 0);
  assert.match(out.text(), /Usage: tarmac <command>/);
  out = capture();
  assert.equal(await main(['fly'], ctx, fakeRunner().runner, out), 2);
  assert.match(out.text(), /Unknown command: fly/);
});
