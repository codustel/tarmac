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
import { claudePresence, finalUrl, planSetup, type SetupOptions } from './setup.js';

const interactive = () => !!process.stdin.isTTY && !!process.stdout.isTTY;

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
  const presence = claudePresence(ctx);
  const o: SetupOptions = {
    domain: flags.domain ?? DEFAULT_DOMAIN,
    sudo: !flags.noSudo,
    claude: !flags.noClaude && presence.code,
    claudeDesktop: !flags.noClaude && presence.code && presence.desktop,
    open: !flags.noOpen,
  };
  if (!o.domain.endsWith('.localhost') && !o.sudo) {
    warn(out, `${o.domain} only resolves through /etc/hosts, which --no-sudo skips: use a *.localhost domain.`);
  }

  if (flags.dryRun) {
    printPlan(ctx, planSetup(ctx, o, runner), out, `tarmac setup ${ctx.version} — ${tilde(ctx, ctx.appDir)}`);
    out.log();
    if (o.sudo) out.log(c.dim('[sudo] steps are explained and confirmed first; --no-sudo skips them (URL with :port).'));
    if (o.claude) out.log(c.dim('The Claude Code step is asked for confirmation (--with-claude / --no-claude to decide up front).'));
    if (!presence.code && !flags.noClaude) out.log(c.dim('Claude Code not found: its integration would be skipped.'));
    return 0;
  }

  // Questions posées avant toute modification.
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
  if (flags.withClaude && !presence.code) warn(out, 'Claude Code (claude CLI) not found: integration skipped.');

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
  if (steps.some((s) => s.id === 'legacy-service' || s.id === 'migrate-data')) {
    say(out, 'Migration from App Manager:');
    out.log(`   - the installed app (PWA) on manager.localhost must be reinstalled from ${finalUrl};`);
    out.log(`   - ${tilde(ctx, ctx.oldDataDir)} is kept and can be deleted once Tarmac is checked;`);
    out.log('   - Claude: tarmac setup --with-claude replaces the "app-manager" MCP server with "tarmac".');
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
