/**
 * Plan d'actions de `tarmac setup` / `tarmac uninstall` : une liste d'étapes décrites comme des données, que la
 * CLI affiche (`--dry-run`) ou exécute. Les tests vérifient le plan sans rien lancer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { c, tilde, type Ctx, type Out, type Runner } from './context.js';

export type Action =
  /** Commande ; `sudo` est alors explicite dans argv. */
  | { kind: 'exec'; argv: string[]; input?: string; allowFail?: boolean }
  | { kind: 'write'; path: string; content: string; mode?: number }
  | { kind: 'remove'; path: string; recursive?: boolean }
  /** Étape avec de la logique (attente, nouvel essai…) : `label` est ce que le dry-run affiche. */
  | { kind: 'task'; label: string; run: (rt: Runtime) => void | Promise<void> };

export interface Step {
  id: string;
  title: string;
  /** Demande les droits administrateur (sudo). */
  sudo?: boolean;
  /** Condition vérifiée au moment de l'exécution (le dry-run l'affiche). */
  when?: { label: string; check: (rt: Runtime) => boolean };
  /** Texte affiché quand la condition n'est pas remplie. */
  otherwise?: string;
  actions: Action[];
}

export interface Runtime {
  ctx: Ctx;
  runner: Runner;
  out: Out;
}

const q = (s: string) => (/^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const short = (s: string, n = 200) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Lignes affichées pour une action (dry-run). */
export function describeAction(ctx: Ctx, a: Action): string[] {
  switch (a.kind) {
    case 'exec': {
      const line = `$ ${a.argv.map((x) => q(tilde(ctx, x))).join(' ')}${a.allowFail ? '  (errors ignored)' : ''}`;
      return a.input ? [line, ...a.input.trimEnd().split('\n').map((l) => `  < ${short(l)}`)] : [line];
    }
    case 'write': {
      if (!a.content) return [`empty ${tilde(ctx, a.path)}`];
      const mode = a.mode ? ` (mode ${a.mode.toString(8)})` : '';
      return [`write ${tilde(ctx, a.path)}${mode}`, ...a.content.trimEnd().split('\n').map((l) => `  | ${short(l)}`)];
    }
    case 'remove':
      return [`delete ${tilde(ctx, a.path)}${a.recursive ? ' (folder)' : ''}`];
    case 'task':
      return [a.label];
  }
}

export function printPlan(ctx: Ctx, steps: Step[], out: Out, heading: string) {
  out.log(c.bold(heading));
  out.log(c.dim('Dry run: nothing is changed on this Mac.'));
  steps.forEach((s, i) => {
    out.log();
    out.log(`${c.blue(`${i + 1}.`)} ${s.title}${s.sudo ? c.yellow('  [sudo]') : ''}`);
    if (s.when) out.log(`   ${c.dim(`only if ${s.when.label}`)}`);
    for (const a of s.actions) for (const l of describeAction(ctx, a)) out.log(`   ${c.dim(l)}`);
  });
}

async function runAction(rt: Runtime, a: Action) {
  switch (a.kind) {
    case 'exec': {
      const code = rt.runner.run(a.argv, { input: a.input });
      if (code !== 0 && !a.allowFail) throw new Error(`Command failed (${code}): ${a.argv.join(' ')}`);
      return;
    }
    case 'write':
      fs.mkdirSync(path.dirname(a.path), { recursive: true });
      fs.writeFileSync(a.path, a.content, a.mode ? { mode: a.mode } : undefined);
      if (a.mode) fs.chmodSync(a.path, a.mode);
      return;
    case 'remove':
      fs.rmSync(a.path, { recursive: !!a.recursive, force: true });
      return;
    case 'task':
      await a.run(rt);
  }
}

export async function executePlan(rt: Runtime, steps: Step[]) {
  for (const s of steps) {
    if (s.when && !s.when.check(rt)) {
      if (s.otherwise) rt.out.log(`${c.yellow('!')} ${s.otherwise}`);
      continue;
    }
    rt.out.log(`${c.blue('▸')} ${s.title}`);
    for (const a of s.actions) await runAction(rt, a);
  }
}
