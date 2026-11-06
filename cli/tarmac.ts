#!/usr/bin/env node
/**
 * CLI `tarmac` : installation (setup), mise à jour, désinstallation et pilotage du service macOS.
 * Messages en anglais (public international) ; commentaires en français comme le reste du code.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { HELP, parseArgs, type Flags } from './args.js';
import {
  DEFAULT_DOMAIN, MIN_NODE, PKG_NAME, c, configured, consoleOut, makeCtx, nodeOk, ok, realRunner, say, tilde, warn,
  type Ctx, type Out, type Runner,
} from './context.js';
import { doctor } from './doctor.js';
import { executePlan, printPlan } from './plan.js';
import { logs, open, planUninstall, restart, start, status, stop, uninstallNotes } from './service.js';
import { asideName, localTime, staleDataDir } from '../server/dataDir.js';
import { claudePresence, finalUrl, planSetup, type SetupOptions } from './setup.js';
import { codexPresence, settingsAgents } from './codex.js';
import { managedStatuses, toolsWanted } from './tools.js';

const interactive = () => !!process.stdin.isTTY && !!process.stdout.isTTY;

/** `~/.tarmac` existe mais `~/.app-manager` a des données plus récentes : explication (dates comparées). */
function staleNotice(ctx: Ctx, out: Out, s: { target: number; legacy: number }) {
  warn(out, `${tilde(ctx, ctx.dataDir)} already exists, but ${tilde(ctx, ctx.oldDataDir)} (App Manager) has newer data:`);
  out.log(`   ${tilde(ctx, ctx.oldDataDir).padEnd(16)} last write ${localTime(s.legacy)}`);
  out.log(`   ${tilde(ctx, ctx.dataDir).padEnd(16)} last write ${localTime(s.target)}`);
  out.log(`   Tarmac would start on the older data (suivi.db, state.json). Nothing is deleted: ${tilde(ctx, ctx.dataDir)}`);
  out.log(`   can be moved aside to ${tilde(ctx, asideName(ctx.dataDir))} before copying ${tilde(ctx, ctx.oldDataDir)}.`);
}

async function ask(question: string, def: boolean): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${c.blue('?')} ${question} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
    return a ? /^(y|yes|o|oui)$/.test(a) : def;
  } finally {
    rl.close();
  }
}

function preflight(ctx: Ctx, out: Out): boolean {
  if (ctx.platform !== 'darwin') { out.error(`${c.red('✗')} Tarmac runs on macOS only.`); return false; }
  if (!nodeOk(ctx.nodeVersion)) {
    out.error(`${c.red('✗')} Node ${ctx.nodeVersion} found, ${MIN_NODE.join('.')} or later required (node:sqlite).`);
    return false;
  }
  if (!fs.existsSync(ctx.serverJs)) {
    out.error(`${c.red('✗')} ${tilde(ctx, ctx.serverJs)} not found. From a clone: pnpm install && pnpm build.`);
    return false;
  }
  return true;
}

export async function setup(ctx: Ctx, flags: Flags, runner: Runner, out: Out): Promise<number> {
  if (!preflight(ctx, out)) return 1;
  // Outils manquants (git, gh, claude, codex) : choisis avant tout, car un outil installé compte comme présent
  // pour les intégrations Claude et Codex. Le dry-run ne pose pas de question : il montre tout ce qui serait proposé.
  const statuses = await managedStatuses(ctx, runner);
  const chosen = await toolsWanted({ yes: flags.yes || (flags.dryRun && interactive()) }, !flags.dryRun && interactive(), ask, statuses, out);
  const presence = claudePresence(ctx);
  const claudeNow = presence.code || chosen.includes('claude');
  const o: SetupOptions = {
    domain: flags.domain ?? DEFAULT_DOMAIN,
    sudo: !flags.noSudo,
    port80: flags.port80,
    claude: !flags.noClaude && claudeNow,
    claudeDesktop: !flags.noClaude && claudeNow && presence.desktop,
    open: !flags.noOpen,
    tools: { chosen, statuses, welcome: flags.yes },
  };
  // Codex : proposé seulement s'il est installé (ou vient d'être choisi) ou coché dans Réglages → Agents (ou demandé par --with-codex).
  const codexWanted = !flags.noCodex && (flags.withCodex || chosen.includes('codex') || codexPresence(ctx).installed || settingsAgents(ctx).codex);
  o.codex = codexWanted;
  if (!o.domain.endsWith('.localhost') && !o.sudo) {
    warn(out, `${o.domain} only resolves through /etc/hosts, which --no-sudo skips: use a *.localhost domain.`);
  }

  const stale = ctx.env.DATA_DIR ? null : staleDataDir(ctx.dataDir, ctx.oldDataDir);

  if (flags.dryRun) {
    o.replaceStale = !!stale;
    printPlan(ctx, planSetup(ctx, o, runner), out, `tarmac setup ${ctx.version} — ${tilde(ctx, ctx.appDir)}`);
    out.log();
    if (stale) {
      staleNotice(ctx, out, stale);
      out.log(c.dim('   Moving it aside is asked for confirmation (--yes accepts it); if refused, it is kept as is.'));
    }
    if (chosen.length && !flags.yes) out.log(c.dim('Each missing tool is asked for confirmation (--yes installs them all).'));
    if (o.sudo) out.log(c.dim('[sudo] steps are explained and confirmed first; --no-sudo skips them (URL with :port).'));
    if (o.claude) out.log(c.dim('The Claude Code step is asked for confirmation (--with-claude / --no-claude to decide up front).'));
    if (!claudeNow && !flags.noClaude) out.log(c.dim('Claude Code not found: its integration would be skipped.'));
    if (o.codex) out.log(c.dim('The Codex step is asked for confirmation (--with-codex / --no-codex to decide up front).'));
    else if (!flags.noCodex) out.log(c.dim('Codex not found (and not enabled in Settings → Agents): its integration would be skipped (--with-codex to set it up anyway).'));
    return 0;
  }

  // Questions posées avant toute modification.
  if (stale) {
    staleNotice(ctx, out, stale);
    if (flags.yes) o.replaceStale = true;
    else if (interactive()) o.replaceStale = await ask(`Move ${tilde(ctx, ctx.dataDir)} aside and copy ${tilde(ctx, ctx.oldDataDir)}?`, true);
    else warn(out, `Not interactive: ${tilde(ctx, ctx.dataDir)} is kept as is (use --yes to move it aside and copy ${tilde(ctx, ctx.oldDataDir)}).`);
    if (!o.replaceStale) out.log(c.dim(`   ${tilde(ctx, ctx.dataDir)} kept; Tarmac uses it.`));
  }
  let steps = planSetup(ctx, o, runner);
  const sudoSteps = steps.filter((s) => s.sudo);
  if (sudoSteps.length && !flags.yes) {
    out.log(`${c.bold('Administrator rights (sudo)')} are needed to:`);
    for (const s of sudoSteps) out.log(`  - ${s.title}`);
    out.log(c.dim(`  Optional: without them, Tarmac is reachable on http://${o.domain}:${configured(ctx).port}`
      + (o.domain.endsWith('.localhost') ? ' (Chrome, Firefox and Safari resolve *.localhost on their own).' : '.')));
    o.sudo = interactive() ? await ask('Use sudo for these steps?', true) : false;
    if (!interactive()) warn(out, 'Not interactive: sudo steps skipped (use --yes to run them).');
  }
  if (o.claude && !flags.withClaude && !flags.yes) {
    o.claude = interactive()
      ? await ask('Set up the Claude Code integration (MCP server "tarmac", /suivi skill, SessionStart hook, rule in ~/.claude/CLAUDE.md)?', true)
      : false;
  }
  if (o.claude && presence.desktop) {
    o.claudeDesktop = interactive() && !flags.yes
      ? await ask('Also register the MCP server in Claude desktop (Todolist artifact sync; Claude desktop must be quit and is relaunched)?', false)
      : false;
  } else o.claudeDesktop = false;
  if (flags.withClaude && !claudeNow) warn(out, 'Claude Code (claude CLI) not found: integration skipped.');
  if (o.codex && !flags.withCodex && !flags.yes) {
    o.codex = interactive()
      ? await ask('Set up the Codex (ChatGPT) integration (MCP server "tarmac" in ~/.codex/config.toml, rule in ~/.codex/AGENTS.md, $suivi skill, SessionStart hook)?', true)
      : false;
  }

  steps = planSetup(ctx, o, runner);
  if (steps.some((s) => s.sudo)) {
    say(out, 'sudo may ask for your macOS password.');
    if (runner.run(['sudo', '-v']) !== 0) {
      out.error(`${c.red('✗')} sudo refused: run tarmac setup --no-sudo, or try again.`);
      return 1;
    }
  }
  await executePlan({ ctx, runner, out }, steps);
  out.log();
  ok(out, `Tarmac is up → ${finalUrl}`);
  if (steps.some((s) => ['legacy-service', 'migrate-data', 'replace-stale-data'].includes(s.id))) {
    say(out, 'Migration from App Manager:');
    out.log(`   - the installed app (PWA) on manager.localhost must be reinstalled from ${finalUrl};`);
    out.log(`   - ${tilde(ctx, ctx.oldDataDir)} is kept and can be deleted once Tarmac is checked;`);
    if (steps.some((s) => s.id === 'replace-stale-data')) {
      out.log(`   - the outdated ${tilde(ctx, ctx.dataDir)} was moved to ${tilde(ctx, ctx.dataDir)}.old-… (same: delete it once checked);`);
      out.log('   - restart open Claude Code sessions so that their MCP server reads the new data;');
    }
    out.log('   - Claude: tarmac setup --with-claude replaces the "app-manager" MCP server with "tarmac".');
  }
  if (steps.some((s) => s.id === 'codex')) {
    say(out, 'Codex integration:');
    out.log('   - in Tarmac, tick Codex (ChatGPT) in Settings → Agents;');
    out.log('   - in Codex, type /hooks once to trust the Tarmac SessionStart hook (Codex skips untrusted hooks);');
    out.log('   - new Codex sessions see the "tarmac" MCP server and the $suivi skill.');
  }
  out.log(c.dim('Next: tarmac status · tarmac logs · tarmac doctor · tarmac --help'));
  return 0;
}

export async function update(ctx: Ctx, flags: Flags, runner: Runner, out: Out): Promise<number> {
  if (ctx.isClone) {
    out.log(`This is a clone (${tilde(ctx, ctx.appDir)}). Update it with:`);
    out.log('  git pull && pnpm install && pnpm build && node dist/cli/tarmac.js restart');
    return 0;
  }
  const viaPnpm = ctx.appDir.includes('/pnpm/');
  const install = viaPnpm ? ['pnpm', 'add', '-g', `${PKG_NAME}@latest`] : ['npm', 'install', '-g', `${PKG_NAME}@latest`];
  const restartCmd = [process.execPath, path.join(ctx.appDir, 'dist/cli/tarmac.js'), 'restart'];
  if (flags.dryRun) {
    out.log(c.bold(`tarmac update ${ctx.version}`));
    out.log(c.dim('Dry run: nothing is changed on this Mac.'));
    out.log(`$ ${install.join(' ')}`);
    out.log(`$ tarmac restart`);
    return 0;
  }
  say(out, `Updating ${PKG_NAME} (current: ${ctx.version})…`);
  const code = runner.run(install);
  if (code !== 0) return code;
  if (!fs.existsSync(ctx.plist)) {
    warn(out, 'Tarmac is not set up as a service yet: run tarmac setup');
    return 0;
  }
  // La nouvelle version, installée au même endroit, redémarre le service.
  return runner.run(restartCmd);
}

export async function uninstall(ctx: Ctx, flags: Flags, runner: Runner, out: Out): Promise<number> {
  const o = { sudo: !flags.noSudo, purge: flags.purge };
  if (flags.dryRun) {
    printPlan(ctx, planUninstall(ctx, o), out, `tarmac uninstall ${ctx.version}`);
    return 0;
  }
  let steps = planUninstall(ctx, o);
  const sudoSteps = steps.filter((s) => s.sudo);
  if (sudoSteps.length && !flags.yes) {
    out.log(`${c.bold('Administrator rights (sudo)')} are needed to:`);
    for (const s of sudoSteps) out.log(`  - ${s.title}`);
    o.sudo = interactive() ? await ask('Use sudo for these steps?', true) : false;
  }
  if (o.purge && !flags.yes && interactive() && !(await ask(`Delete ${tilde(ctx, ctx.dataDir)} for good?`, false))) o.purge = false;
  steps = planUninstall(ctx, o);
  await executePlan({ ctx, runner, out }, steps);
  ok(out, 'Tarmac uninstalled');
  uninstallNotes(ctx, out, o);
  return 0;
}

export async function main(argv: string[], ctx: Ctx = makeCtx(), runner: Runner = realRunner, out: Out = consoleOut): Promise<number> {
  const { command, flags, error } = parseArgs(argv);
  if (error) {
    out.error(`${c.red('✗')} ${error}`);
    out.error('Run tarmac --help for the list of commands.');
    return 2;
  }
  switch (command) {
    case 'help': out.log(HELP); return 0;
    case 'version': out.log(ctx.version); return 0;
    case 'setup': return setup(ctx, flags, runner, out);
    case 'update': return update(ctx, flags, runner, out);
    case 'uninstall': return uninstall(ctx, flags, runner, out);
    case 'start': return start(ctx, runner, out);
    case 'stop': return stop(ctx, runner, out);
    case 'restart': return restart(ctx, runner, out);
    case 'status': return status(ctx, runner, out);
    case 'logs': return logs(ctx, runner, out);
    case 'open': return open(ctx, runner);
    case 'doctor': return doctor(ctx, runner, out);
  }
}

// Point d'entrée (pas à l'import depuis les tests).
const entry = process.argv[1] && fs.realpathSync(process.argv[1]);
if (entry && /[/\\]tarmac(\.[cm]?[jt]s)?$/.test(entry)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { console.error(`${c.red('✗')} ${(e as Error).message}`); process.exitCode = 1; },
  );
}
