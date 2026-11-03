import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseToml } from 'smol-toml';
import {
  HOOK_FILE, MCP_START, RULE_START, codexPresence, planCodexSetup, planCodexUninstall, removeHook, removeMcpToml, removeRule,
  settingsAgents, upsertHook, upsertMcpToml, upsertRule,
} from './codex.js';
import { makeCtx, type Out, type Runner } from './context.js';
import { diagnose, type Facts } from './doctor.js';
import { executePlan } from './plan.js';
import { parseArgs } from './args.js';

const JS = '/home/me/.local/share/pnpm/global/5/node_modules/@codustel/tarmac/dist/server/mcp.js';
const USER_TOML = `# my Codex config
model = "gpt-5-codex"

[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]
`;

test('config.toml : table [mcp_servers.tarmac] ajoutée une fois, mise à jour sur place, le reste intact', () => {
  const a = upsertMcpToml(USER_TOML, JS);
  assert.equal(a.status, 'added');
  assert.ok(a.text.startsWith(USER_TOML), 'texte de l’utilisateur conservé (commentaires compris)');
  const cfg = parseToml(a.text) as any;
  assert.equal(cfg.model, 'gpt-5-codex');
  assert.deepEqual(cfg.mcp_servers.docs.args, ['-y', 'docs-mcp']);
  assert.equal(cfg.mcp_servers.tarmac.command, '/bin/zsh');
  assert.deepEqual(cfg.mcp_servers.tarmac.args, ['-lc', `exec node "${JS}"`]);
  // Idempotent.
  assert.deepEqual(upsertMcpToml(a.text, JS), { text: a.text, status: 'unchanged' });
  // Nouveau chemin (mise à jour de Tarmac) : remplacé sur place, une seule table.
  const b = upsertMcpToml(a.text, '/opt/tarmac/dist/server/mcp.js');
  assert.equal(b.status, 'updated');
  assert.equal(b.text.split(MCP_START).length, 2);
  assert.match((parseToml(b.text) as any).mcp_servers.tarmac.args[1], /\/opt\/tarmac/);
  // Fichier vide ou absent.
  assert.equal(upsertMcpToml('', JS).status, 'added');
  // Retrait : seulement le bloc de Tarmac.
  assert.deepEqual(parseToml(removeMcpToml(a.text)), parseToml(USER_TOML));
});

test('config.toml : table tarmac écrite à la main gardée, fichier invalide jamais touché, guillemets échappés', () => {
  const own = `${USER_TOML}\n[mcp_servers.tarmac]\ncommand = "node"\nargs = ["/x/mcp.js"]\n`;
  assert.deepEqual(upsertMcpToml(own, JS), { text: own, status: 'user-defined' });
  assert.deepEqual(upsertMcpToml('model = "x', JS), { text: 'model = "x', status: 'invalid' });
  const weird = '/home/a "b"/c\\d/mcp.js';
  const r = upsertMcpToml('', weird);
  assert.equal((parseToml(r.text) as any).mcp_servers.tarmac.args[1], `exec node "${weird}"`);
});

test('AGENTS.md : règle du suivi en bloc balisé (ajoutée une fois, remplacée, retirée)', () => {
  const mine = '# My rules\n\n- Be concise.\n';
  const a = upsertRule(mine, '## Project tracking (Todolist)\n- rule v1');
  assert.equal(a.status, 'added');
  assert.ok(a.text.startsWith(mine));
  assert.equal(upsertRule(a.text, '## Project tracking (Todolist)\n- rule v1').status, 'unchanged');
  const b = upsertRule(a.text, '## Project tracking (Todolist)\n- rule v2');
  assert.equal(b.status, 'updated');
  assert.equal(b.text.split(RULE_START).length, 2);
  assert.match(b.text, /rule v2/);
  assert.doesNotMatch(b.text, /rule v1/);
  assert.equal(removeRule(b.text).trim(), mine.trim());
});

test('hooks.json : hook SessionStart de Tarmac ajouté une fois, autres hooks gardés, retrait propre', () => {
  const other = JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }], Stop: [] } });
  const a = upsertHook(other, `"/h/.codex/hooks/${HOOK_FILE}" codex`);
  assert.equal(a.status, 'added');
  const cfg = JSON.parse(a.text);
  assert.equal(cfg.hooks.SessionStart.length, 2);
  assert.equal(cfg.hooks.SessionStart[1].matcher, 'startup|resume');
  assert.equal(cfg.hooks.SessionStart[1].hooks[0].timeout, 10);
  assert.equal(upsertHook(a.text, `"/h/.codex/hooks/${HOOK_FILE}" codex`).status, 'unchanged');
  assert.equal(upsertHook(null, 'x/' + HOOK_FILE).status, 'added');
  assert.equal(upsertHook('{', 'x').status, 'invalid');
  assert.deepEqual(JSON.parse(removeHook(a.text)), JSON.parse(other));
});

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-codex-cli-'));
  const home = path.join(root, 'home');
  const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  fs.mkdirSync(home, { recursive: true });
  const ctx = makeCtx({ home, appDir, env: { PATH: '', DATA_DIR: path.join(root, 'data') }, platform: 'darwin', sysRoot: root });
  return { root, home, ctx };
}
const quiet: Out = { log: () => {}, error: () => {} };
const noRun: Runner = { run: () => { throw new Error('aucune commande attendue'); }, capture: () => null };

test('tarmac setup --with-codex (HOME de test) : MCP, règle, skill, hook ; deuxième passage sans doublon ; désinstallation', { skip: process.platform === 'win32' && 'CLI et hooks sh : macOS seulement' }, async () => {
  const { root, home, ctx } = sandbox();
  try {
    const codexHome = path.join(home, '.codex');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'config.toml'), USER_TOML);
    fs.writeFileSync(path.join(codexHome, 'AGENTS.md'), '# Mine\n');
    const step = planCodexSetup(ctx);
    await executePlan({ ctx, runner: noRun, out: quiet }, [step]);
    await executePlan({ ctx, runner: noRun, out: quiet }, [planCodexSetup(ctx)]);
    const toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.equal(toml.split(MCP_START).length, 2);
    assert.equal((parseToml(toml) as any).mcp_servers.tarmac.args[1], `exec node "${ctx.mcpJs}"`);
    assert.equal(fs.readFileSync(path.join(codexHome, 'AGENTS.md'), 'utf8').split(RULE_START).length, 2);
    assert.match(fs.readFileSync(path.join(home, '.agents/skills/suivi/SKILL.md'), 'utf8'), /^---\nname: suivi\ndescription: /);
    const hook = path.join(codexHome, 'hooks', HOOK_FILE);
    assert.ok(fs.statSync(hook).mode & 0o100, 'hook exécutable');
    assert.equal(JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8')).hooks.SessionStart.length, 1);
    assert.ok(fs.readdirSync(codexHome).some((f) => f.startsWith('config.toml.bak-')), 'copie de sauvegarde');
    assert.deepEqual(codexPresence(ctx), { installed: false, mcp: true, rule: true, skill: true, hook: true });

    const un = planCodexUninstall(ctx)!;
    await executePlan({ ctx, runner: noRun, out: quiet }, [un]);
    assert.deepEqual(parseToml(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')), parseToml(USER_TOML));
    assert.equal(fs.readFileSync(path.join(codexHome, 'AGENTS.md'), 'utf8').trim(), '# Mine');
    assert.ok(!fs.existsSync(hook));
    assert.ok(!fs.existsSync(path.join(home, '.agents/skills/suivi')));
    assert.equal(planCodexUninstall(ctx), null, 'plus rien à retirer');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup : options --with-codex / --no-codex ; réglages : agents cochés (Claude seul par défaut)', () => {
  assert.equal(parseArgs(['setup', '--with-codex']).flags.withCodex, true);
  assert.match(parseArgs(['setup', '--with-codex', '--no-codex']).error!, /cannot be used together/);
  assert.match(parseArgs(['update', '--with-codex']).error!, /not supported/);
  const { root, ctx } = sandbox();
  try {
    assert.deepEqual(settingsAgents(ctx), { claude: true, codex: false });
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.dataDir, 'settings.json'), JSON.stringify({ agents: { claude: true, codex: true } }));
    assert.deepEqual(settingsAgents(ctx), { claude: true, codex: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const facts = (f: Partial<Facts> = {}): Facts => ({
  platform: 'darwin', node: '22.13.0', built: true, envFile: true, plist: true, plistMatches: true, loaded: true, legacyService: false,
  port: 7777, portAnswers: true, url: 'http://tarmac.localhost', domain: 'tarmac.localhost', domainAddrs: ['127.0.0.1'],
  urlAnswers: true, pfRedirect: 'active', git: true, gh: 'ok', docker: '/var/run/docker.sock', claude: true, claudeMcp: true, claudeSkill: true, claudeMcpLegacy: false, ...f,
});

test('doctor : seuls les agents cochés sont vérifiés (Claude seul = comme avant)', () => {
  const names = (f: Partial<Facts>) => diagnose(facts(f)).map((c) => c.name);
  assert.ok(names({}).includes('Claude Code'));
  assert.ok(!names({}).includes('Codex'));
  const both = diagnose(facts({ agents: { claude: true, codex: true }, codex: { installed: true, mcp: false, rule: true, skill: true, hook: false } }));
  const codex = both.find((c) => c.name === 'Codex')!;
  assert.equal(codex.level, 'warn');
  assert.match(codex.fix!, /--with-codex/);
  const only = names({ agents: { claude: false, codex: true }, codex: { installed: false, mcp: false, rule: false, skill: false, hook: false } });
  assert.ok(!only.includes('Claude Code'));
  assert.ok(only.includes('Codex'));
  assert.equal(diagnose(facts({ agents: { claude: true, codex: true }, codex: { installed: true, mcp: true, rule: true, skill: true, hook: true } })).find((c) => c.name === 'Codex')!.level, 'ok');
});

test('hook SessionStart pour Codex (argument codex) : texte Todolist, $suivi, AGENTS.md ; sans dépôt git : rien', { skip: process.platform === 'win32' && 'CLI et hooks sh : macOS seulement' }, () => {
  const { root } = sandbox();
  try {
    const repo = path.join(root, 'shop');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const hook = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../claude/hooks/suivi-check.sh');
    const run = (cwd: string, ...args: string[]) => execFileSync('bash', [hook, ...args], {
      input: JSON.stringify({ cwd, session_id: 'x', source: 'startup' }), env: { PATH: process.env.PATH, HOME: root, TARMAC_PORT: '1' }, encoding: 'utf8',
    });
    const out = JSON.parse(run(repo, 'codex'));
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /^Todolist: project shop has no tracker yet.*\$suivi init/);
    fs.mkdirSync(path.join(repo, 'Todolist'));
    fs.writeFileSync(path.join(repo, 'Todolist/suivi.config.json'), JSON.stringify({ projectId: 'acme/shop', file: 'suivi.json' }));
    const tracked = JSON.parse(run(repo, 'codex')).hookSpecificOutput.additionalContext;
    assert.match(tracked, /AGENTS\.md/);
    assert.doesNotMatch(tracked, /artifact db|CLAUDE\.md|skill \/suivi/);
    assert.match(JSON.parse(run(repo)).hookSpecificOutput.additionalContext, /^Claude Todolist: .*CLAUDE\.md/, 'sans argument : texte de Claude, inchangé');
    assert.equal(run(root, 'codex'), '', 'hors dépôt git : silencieux');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
