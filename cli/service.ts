/**
 * Pilotage du service (LaunchAgent) : start, stop, restart, status, logs, open, et `tarmac uninstall`.
 */
import fs from 'node:fs';
import { ALIAS_DOMAIN, DEFAULT_DOMAIN, LABEL, PKG_NAME, c, configured, ok, tilde, warn, which, type Ctx, type Out, type Runner } from './context.js';
import type { Step } from './plan.js';
import { answers, hostsHas } from './setup.js';

const target = (ctx: Ctx) => `gui/${ctx.uid}/${LABEL}`;
export const isLoaded = (ctx: Ctx, runner: Runner) => runner.capture(['launchctl', 'print', target(ctx)]) !== null;

function notSetUp(ctx: Ctx, out: Out): number {
  out.error(`${c.red('✗')} Tarmac is not set up on this Mac (${tilde(ctx, ctx.plist)} not found). Run: tarmac setup`);
  return 1;
}

export function start(ctx: Ctx, runner: Runner, out: Out): number {
  if (!fs.existsSync(ctx.plist)) return notSetUp(ctx, out);
  if (isLoaded(ctx, runner)) {
    runner.capture(['launchctl', 'kickstart', target(ctx)]);
    ok(out, 'Tarmac is running');
    return 0;
  }
  if (runner.capture(['launchctl', 'bootstrap', `gui/${ctx.uid}`, ctx.plist]) === null && runner.capture(['launchctl', 'kickstart', '-k', target(ctx)]) === null) {
    out.error(`${c.red('✗')} Could not start ${LABEL}. See: tarmac logs`);
    return 1;
  }
  ok(out, 'Tarmac started');
  return 0;
}

export function stop(ctx: Ctx, runner: Runner, out: Out): number {
  if (!isLoaded(ctx, runner)) {
    ok(out, 'Tarmac is already stopped');
    return 0;
  }
  runner.capture(['launchctl', 'bootout', target(ctx)]);
  ok(out, 'Tarmac stopped (it starts again at the next login; tarmac start to start it now)');
  return 0;
}

export function restart(ctx: Ctx, runner: Runner, out: Out): number {
  if (!fs.existsSync(ctx.plist)) return notSetUp(ctx, out);
  if (!isLoaded(ctx, runner)) return start(ctx, runner, out);
  if (runner.capture(['launchctl', 'kickstart', '-k', target(ctx)]) === null) {
    out.error(`${c.red('✗')} Could not restart ${LABEL}. See: tarmac logs`);
    return 1;
  }
  ok(out, 'Tarmac restarted');
  return 0;
}

export async function status(ctx: Ctx, runner: Runner, out: Out): Promise<number> {
  if (!fs.existsSync(ctx.plist)) return notSetUp(ctx, out);
  const { port, url } = configured(ctx);
  const info = runner.capture(['launchctl', 'print', target(ctx)]);
  const pid = info?.match(/^\s*pid = (\d+)/m)?.[1];
  const up = await answers(`http://127.0.0.1:${port}`);
  out.log(`${c.bold('Tarmac')} ${ctx.version}  ${c.dim(tilde(ctx, ctx.appDir))}`);
  out.log(`  service   ${info ? c.green('loaded') : c.red('not loaded')}${pid ? ` (pid ${pid})` : ''}  ${c.dim(LABEL)}`);
  out.log(`  server    ${up ? c.green(`answers on 127.0.0.1:${port}`) : c.red(`no answer on 127.0.0.1:${port}`)}`);
  out.log(`  url       ${url}`);
  out.log(`  data      ${tilde(ctx, ctx.dataDir)}`);
  if (!up) out.log(c.dim('  → tarmac logs, or tarmac doctor'));
  return up ? 0 : 1;
}

export function logs(ctx: Ctx, runner: Runner, out: Out): number {
  if (!fs.existsSync(ctx.logFile)) {
    out.error(`${c.red('✗')} No log yet (${tilde(ctx, ctx.logFile)}). Run: tarmac setup`);
    return 1;
  }
  out.log(c.dim(`${tilde(ctx, ctx.logFile)} — Ctrl+C to quit`));
  return runner.run(['tail', '-n', '200', '-f', ctx.logFile]);
}

export function open(ctx: Ctx, runner: Runner): number {
  return runner.run(['open', configured(ctx).url]);
}

/** Plan de `tarmac uninstall` : service, redirection pf et domaines (sudo), serveur MCP, données avec --purge. */
export function planUninstall(ctx: Ctx, o: { sudo: boolean; purge: boolean }): Step[] {
  const steps: Step[] = [];
  steps.push({
    id: 'service',
    title: `Stop and remove the login service (${LABEL})`,
    actions: [
      { kind: 'exec', argv: ['launchctl', 'bootout', `gui/${ctx.uid}/${LABEL}`], allowFail: true },
      { kind: 'remove', path: ctx.plist },
    ],
  });
  if (o.sudo && (fs.existsSync(ctx.pfDaemon) || fs.existsSync(ctx.pfAnchor))) {
    steps.push({
      id: 'pf',
      title: 'Remove the port 80 redirect (pf)',
      sudo: true,
      actions: [
        { kind: 'exec', argv: ['sudo', 'launchctl', 'bootout', `system/${LABEL}.pf`], allowFail: true },
        { kind: 'exec', argv: ['sudo', 'pfctl', '-a', `com.apple/${LABEL}`, '-F', 'all'], allowFail: true },
        { kind: 'exec', argv: ['sudo', 'rm', '-f', ctx.pfDaemon, ctx.pfAnchor] },
      ],
    });
  }
  let hosts = '';
  try { hosts = fs.readFileSync(ctx.hostsFile, 'utf8'); } catch { /* illisible */ }
  const domains = [...new Set([configured(ctx).domain, DEFAULT_DOMAIN, ALIAS_DOMAIN])].filter((h) => hostsHas(hosts, h) || hostsHas(hosts, h, '::1'));
  if (o.sudo && domains.length) {
    steps.push({
      id: 'hosts',
      title: `Remove ${domains.join(', ')} from ${ctx.hostsFile}`,
      sudo: true,
      actions: domains.map((h) => ({ kind: 'exec' as const, argv: ['sudo', 'sed', '-i', '', '-E', `/^(127\\.0\\.0\\.1|::1)[[:space:]]+${h.replace(/\./g, '\\.')}[[:space:]]*$/d`, ctx.hostsFile] })),
    });
  }
  if (which('claude', ctx.env)) {
    steps.push({
      id: 'claude',
      title: 'Remove the "tarmac" MCP server from Claude Code',
      actions: [{ kind: 'exec', argv: ['claude', 'mcp', 'remove', '--scope', 'user', 'tarmac'], allowFail: true }],
    });
  }
  if (o.purge) {
    steps.push({
      id: 'purge',
      title: `Delete ${tilde(ctx, ctx.dataDir)} (settings, history, Todolist database)`,
      actions: [{ kind: 'remove', path: ctx.dataDir, recursive: true }],
    });
  }
  return steps;
}

export function uninstallNotes(ctx: Ctx, out: Out, o: { purge: boolean; sudo: boolean }) {
  if (!o.purge) out.log(`  ${tilde(ctx, ctx.dataDir)} is kept (tarmac uninstall --purge to delete it).`);
  if (!o.sudo) warn(out, 'Skipped (no sudo): /etc/hosts entries and the port 80 redirect, if any.');
  out.log('  Claude Code integration, if installed: delete ~/.claude/skills/suivi, ~/.claude/hooks/suivi-check.sh,');
  out.log('  its SessionStart entry in ~/.claude/settings.json and the "Project tracking" section of ~/.claude/CLAUDE.md.');
  out.log(ctx.isClone ? '  You can now delete this clone.' : `  To remove the command itself: npm uninstall -g ${PKG_NAME}`);
}
