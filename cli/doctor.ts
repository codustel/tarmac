/**
 * `tarmac doctor` : relevé des faits (Node, service, port, domaine, gh, Docker, Claude Code) puis diagnostic
 * pur, testable, avec pour chaque problème ce qu'il faut faire.
 */
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { LABEL, MIN_NODE, OLD_LABEL, c, configured, nodeOk, tilde, type Ctx, type Out, type Runner } from './context.js';
import { answers, type Port80 } from './setup.js';
import { codexPresence, settingsAgents } from './codex.js';
import { managedStatuses } from './tools.js';

export interface Facts {
  platform: string;
  node: string;
  built: boolean;
  envFile: boolean;
  plist: boolean;
  /** Le LaunchAgent lance bien le serveur de cette installation. */
  plistMatches: boolean;
  loaded: boolean;
  /** App Manager (ancien nom) encore installé comme service. */
  legacyService: boolean;
  port: number;
  portAnswers: boolean;
  url: string;
  domain: string;
  /** Adresses du domaine (vide si non résolu). */
  domainAddrs: string[];
  urlAnswers: boolean;
  /** Redirection du port 80 : active (127.0.0.1:80 atteint Tarmac), installée sans effet, ou absente. */
  pfRedirect: Port80;
  git: boolean;
  gh: 'missing' | 'logged-out' | 'ok';
  docker: string | null;
  claude: boolean;
  claudeMcp: boolean;
  claudeSkill: boolean;
  /** Serveur MCP sous l'ancien nom `app-manager`. */
  claudeMcpLegacy: boolean;
  /** Agents cochés dans Réglages → Agents (absent : Claude seul). Seuls les agents cochés sont vérifiés. */
  agents?: { claude: boolean; codex: boolean };
  /** Codex installé et intégration de Tarmac en place (voir codex.ts). */
  codex?: { installed: boolean; mcp: boolean; rule: boolean; skill: boolean; hook: boolean };
}

export type Level = 'ok' | 'warn' | 'fail';
export interface Check { name: string; level: Level; detail: string; fix?: string }

export function diagnose(f: Facts): Check[] {
  const checks: Check[] = [];
  const add = (name: string, level: Level, detail: string, fix?: string) => checks.push({ name, level, detail, fix });

  add('macOS', f.platform === 'darwin' ? 'ok' : 'fail', f.platform === 'darwin' ? 'macOS' : f.platform, f.platform === 'darwin' ? undefined : 'Tarmac runs on macOS only.');
  add('Node.js', nodeOk(f.node) ? 'ok' : 'fail', `v${f.node.replace(/^v/, '')}`,
    nodeOk(f.node) ? undefined : `Node ${MIN_NODE.join('.')} or later is required (node:sqlite). Install the current LTS (https://nodejs.org, or nvm / fnm / Homebrew), then reinstall Tarmac.`);
  add('Build', f.built ? 'ok' : 'fail', f.built ? 'dist/server/index.js present' : 'dist/server/index.js missing',
    f.built ? undefined : 'From a clone: pnpm install && pnpm build. From npm: npm install -g @codustel/tarmac');
  add('Configuration', f.envFile ? 'ok' : 'fail', f.envFile ? '~/.tarmac/env' : 'no ~/.tarmac/env', f.envFile ? undefined : 'Run: tarmac setup');

  if (!f.plist && f.legacyService) add('Service', 'fail', 'App Manager (former name of Tarmac) is still installed', 'Run: tarmac setup (migrates its service, data and domain)');
  else if (!f.plist) add('Service', 'fail', `${LABEL} not installed`, 'Run: tarmac setup');
  else if (!f.loaded) add('Service', 'fail', `${LABEL} not loaded`, 'Run: tarmac start (then tarmac logs if it stops again)');
  else if (!f.plistMatches) add('Service', 'warn', 'loaded, but it runs another Tarmac installation', 'Run: tarmac setup (points the service to this installation)');
  else add('Service', 'ok', `${LABEL} loaded`);

  if (!f.portAnswers && f.pfRedirect === 'active') {
    // Vu après un redémarrage (4.11a) : la règle pf du port 80 active, Tarmac atteint par le port 80 mais plus
    // par son propre port (MCP, artefacts, sessions coupés).
    add('Port', 'fail', `no answer on 127.0.0.1:${f.port}, while port 80 reaches Tarmac: the pf redirect blocks the direct port`,
      `Run: sudo pfctl -a com.apple/${LABEL} -F all  (removes the port 80 redirect until the next boot; see "Port 80" in docs/troubleshooting.md)`);
  } else {
    add('Port', f.portAnswers ? 'ok' : 'fail', f.portAnswers ? `answers on 127.0.0.1:${f.port}` : `no answer on 127.0.0.1:${f.port}`,
      f.portAnswers ? undefined : 'Run: tarmac logs (another app on this port? change TARMAC_PORT in ~/.tarmac/env, then tarmac restart)');
  }

  const loopback = f.domainAddrs.length > 0 && f.domainAddrs.every((a) => a === '127.0.0.1' || a === '::1');
  if (!f.domainAddrs.length) {
    add('Domain', 'warn', `${f.domain} does not resolve`, `Run: tarmac setup (adds it to /etc/hosts), or use http://localhost:${f.port}`);
  } else if (!loopback) {
    add('Domain', 'fail', `${f.domain} → ${f.domainAddrs.join(', ')} (not this Mac)`, `Fix the ${f.domain} line in /etc/hosts`);
  } else {
    add('Domain', 'ok', `${f.domain} → ${f.domainAddrs.join(', ')}`);
  }
  add('URL', f.urlAnswers ? 'ok' : 'warn', `${f.url}${f.urlAnswers ? '' : ' does not answer'}`,
    f.urlAnswers ? undefined : `Open http://${f.domain}:${f.port} instead, or run tarmac setup to fix the URL`);
  if (f.pfRedirect === 'active') add('Port 80', 'ok', `redirect active: 127.0.0.1:80 reaches Tarmac (pf → ${f.port})`);
  else if (f.pfRedirect === 'not-applied') {
    add('Port 80', 'warn', `redirect installed but not applied by macOS (use http://${f.domain}:${f.port})`,
      'Optional: see "Port 80" in docs/troubleshooting.md for the diagnosis commands');
  } else add('Port 80', 'warn', 'not redirected (URL with :port)', 'Optional: tarmac setup (without --no-sudo) for an URL without port');

  add('git', f.git ? 'ok' : 'fail', f.git ? 'installed' : 'not found', f.git ? undefined : 'Install the Xcode command line tools: xcode-select --install');
  if (f.gh === 'ok') add('GitHub CLI', 'ok', 'gh logged in');
  else if (f.gh === 'logged-out') add('GitHub CLI', 'warn', 'gh not logged in', 'Optional (GitHub tab, Clone): gh auth login, or "Connect the gh CLI" in Settings');
  else add('GitHub CLI', 'warn', 'gh not found', 'Optional (GitHub tab, Clone): brew install gh');
  add('Docker', f.docker ? 'ok' : 'warn', f.docker ?? 'no Docker socket', f.docker ? undefined : 'Optional (local Supabase): start Docker Desktop, OrbStack or Colima');
  const agents = f.agents ?? { claude: true, codex: false };
  if (!agents.claude) { /* Claude Code décoché : pas vérifié */ }
  else if (!f.claude) add('Claude Code', 'warn', 'claude CLI not found', 'Optional (Claude sessions, Todolist): https://claude.com/claude-code');
  else if (!f.claudeMcp && f.claudeMcpLegacy) add('Claude Code', 'warn', 'MCP server registered under its former name "app-manager"', 'Run: tarmac setup --with-claude (replaces it with "tarmac")');
  else if (!f.claudeMcp || !f.claudeSkill) {
    const missing = [!f.claudeMcp && 'MCP server "tarmac"', !f.claudeSkill && '/suivi skill'].filter(Boolean).join(' and ');
    add('Claude Code', 'warn', `installed; ${missing} not set up`, 'Optional: tarmac setup --with-claude');
  } else add('Claude Code', 'ok', 'installed, MCP server "tarmac" and /suivi skill set up');
  if (agents.codex) {
    const x = f.codex ?? { installed: false, mcp: false, rule: false, skill: false, hook: false };
    if (!x.installed) add('Codex', 'warn', 'codex CLI not found', 'Optional (Codex sessions): npm install -g @openai/codex (or brew install codex), then codex login');
    else if (!x.mcp || !x.skill || !x.rule) {
      const missing = [!x.mcp && 'MCP server "tarmac"', !x.skill && '$suivi skill', !x.rule && 'AGENTS.md rule'].filter(Boolean).join(', ');
      add('Codex', 'warn', `installed; ${missing} not set up`, 'Optional: tarmac setup --with-codex');
    } else add('Codex', 'ok', `installed, MCP server "tarmac", \$suivi skill and AGENTS.md rule set up${x.hook ? '' : ' (no SessionStart hook)'}`);
  }
  return checks;
}

/** Socket Docker usuels sur macOS (Docker Desktop, OrbStack, Colima), comme le serveur. */
function dockerSocket(ctx: Ctx): string | null {
  const fromEnv = ctx.env.DOCKER_HOST?.replace(/^unix:\/\//, '');
  const list = [fromEnv, '.docker/run/docker.sock', '.orbstack/run/docker.sock', '.colima/default/docker.sock', '/var/run/docker.sock']
    .filter(Boolean)
    .map((p) => (p!.startsWith('/') ? p! : path.join(ctx.home, p!)));
  return list.find((p) => fs.existsSync(p)) ?? null;
}

export async function gatherFacts(ctx: Ctx, runner: Runner): Promise<Facts> {
  const { port, url, domain } = configured(ctx);
  let domainAddrs: string[] = [];
  try { domainAddrs = (await dns.lookup(domain, { all: true })).map((a) => a.address); } catch { /* non résolu */ }
  const plistText = fs.existsSync(ctx.plist) ? fs.readFileSync(ctx.plist, 'utf8') : '';
  // git, gh, claude, codex : mêmes faits que l'écran Réglages → Outils (server/tools/status.ts).
  const tool = new Map((await managedStatuses(ctx, runner)).map((t) => [t.id, t.state]));
  const gh = tool.get('gh') === 'absent' ? 'missing' : tool.get('gh') === 'ready' ? 'ok' : 'logged-out';
  const claudeJson = (() => { try { return JSON.parse(fs.readFileSync(path.join(ctx.home, '.claude.json'), 'utf8')); } catch { return {}; } })();
  const claudeDir = ctx.env.CLAUDE_CONFIG_DIR ?? path.join(ctx.home, '.claude');
  const pfInstalled = fs.existsSync(ctx.pfAnchor);
  const [portAnswers, urlAnswers, port80] = await Promise.all([
    answers(`http://127.0.0.1:${port}`), answers(url), pfInstalled ? answers('http://127.0.0.1') : Promise.resolve(false),
  ]);
  return {
    platform: ctx.platform,
    node: ctx.nodeVersion,
    built: fs.existsSync(ctx.serverJs),
    envFile: fs.existsSync(ctx.envFile),
    plist: !!plistText,
    plistMatches: plistText.includes(ctx.serverJs),
    loaded: runner.capture(['launchctl', 'print', `gui/${ctx.uid}/${LABEL}`]) !== null,
    legacyService: fs.existsSync(ctx.oldPlist) || runner.capture(['launchctl', 'print', `gui/${ctx.uid}/${OLD_LABEL}`]) !== null,
    port,
    portAnswers,
    url,
    domain,
    domainAddrs,
    urlAnswers,
    pfRedirect: !pfInstalled ? 'none' : port80 ? 'active' : 'not-applied',
    git: tool.get('git') !== 'absent',
    gh,
    docker: dockerSocket(ctx),
    claude: tool.get('claude') !== 'absent',
    claudeMcp: !!claudeJson?.mcpServers?.tarmac,
    claudeSkill: fs.existsSync(path.join(claudeDir, 'skills/suivi/SKILL.md')),
    claudeMcpLegacy: !!claudeJson?.mcpServers?.['app-manager'],
    agents: settingsAgents(ctx),
    codex: { ...codexPresence(ctx), installed: tool.get('codex') !== 'absent' },
  };
}

export async function doctor(ctx: Ctx, runner: Runner, out: Out): Promise<number> {
  out.log(`${c.bold('Tarmac doctor')} ${ctx.version}  ${c.dim(tilde(ctx, ctx.appDir))}`);
  const checks = diagnose(await gatherFacts(ctx, runner));
  const icon = { ok: c.green('✓'), warn: c.yellow('!'), fail: c.red('✗') };
  for (const ch of checks) {
    out.log(`${icon[ch.level]} ${ch.name.padEnd(13)} ${ch.detail}`);
    if (ch.fix) out.log(`  ${c.dim('→ ' + ch.fix)}`);
  }
  const fails = checks.filter((ch) => ch.level === 'fail').length;
  out.log();
  out.log(fails ? c.red(`${fails} problem(s) to fix.`) : c.green('Everything required is in place.'));
  return fails ? 1 : 0;
}
