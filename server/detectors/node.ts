import path from 'node:path';
import { settings } from '../settings.js';
import { T, exists, readJson, type Command, type Detection, type Detector, type ServeSpec, type Tech } from './types.js';

type PM = 'pnpm' | 'yarn' | 'bun' | 'npm';

interface PackageJson {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  bin?: string | Record<string, string>;
}

const viteLike = (p: string) => ['--port', p, '--strictPort'];

/** Frameworks front : ordre = priorité. */
const WEB: Array<{ dep: string; tech: Tech; portArgs: (p: string) => string[] }> = [
  { dep: 'next', tech: T('next', 'Next.js'), portArgs: (p) => ['-p', p] },
  { dep: 'nuxt', tech: T('nuxt', 'Nuxt'), portArgs: (p) => ['--port', p] },
  { dep: 'astro', tech: T('astro', 'Astro'), portArgs: (p) => ['--port', p] },
  { dep: '@sveltejs/kit', tech: T('sveltekit', 'SvelteKit'), portArgs: viteLike },
  { dep: '@remix-run/dev', tech: T('remix', 'Remix'), portArgs: viteLike },
  { dep: '@react-router/dev', tech: T('react-router', 'React Router'), portArgs: viteLike },
  { dep: '@tanstack/react-start', tech: T('tanstack-start', 'TanStack Start'), portArgs: viteLike },
  { dep: '@tanstack/start', tech: T('tanstack-start', 'TanStack Start'), portArgs: viteLike },
  { dep: '@solidjs/start', tech: T('solid-start', 'SolidStart'), portArgs: viteLike },
  { dep: '@angular/cli', tech: T('angular', 'Angular'), portArgs: (p) => ['--port', p] },
  { dep: 'gatsby', tech: T('gatsby', 'Gatsby'), portArgs: (p) => ['-p', p] },
  { dep: 'react-scripts', tech: T('cra', 'Create React App'), portArgs: () => [] },
  { dep: '@vue/cli-service', tech: T('vue', 'Vue CLI'), portArgs: (p) => ['--port', p] },
  { dep: 'vite', tech: T('vite', 'Vite'), portArgs: viteLike },
  { dep: 'webpack-dev-server', tech: T('webpack', 'Webpack'), portArgs: (p) => ['--port', p] },
  { dep: 'parcel', tech: T('parcel', 'Parcel'), portArgs: (p) => ['--port', p] },
];

/** Backends HTTP : port transmis via `PORT`. */
/** Workers / jobs de fond : process sans interface, lancés à côté des apps. */
const WORKER: Array<{ dep: string; tech: Tech }> = [
  { dep: 'bullmq', tech: T('bullmq', 'BullMQ') },
  { dep: 'bull', tech: T('bull', 'Bull') },
  { dep: 'pg-boss', tech: T('pg-boss', 'pg-boss') },
  { dep: 'graphile-worker', tech: T('graphile-worker', 'Graphile Worker') },
  { dep: 'agenda', tech: T('agenda', 'Agenda') },
  { dep: 'bee-queue', tech: T('bee-queue', 'Bee-Queue') },
  { dep: 'node-cron', tech: T('cron', 'node-cron') },
  { dep: 'cron', tech: T('cron', 'cron') },
  { dep: 'croner', tech: T('cron', 'Croner') },
  { dep: 'inngest', tech: T('inngest', 'Inngest') },
  { dep: '@trigger.dev/sdk', tech: T('trigger', 'Trigger.dev') },
  { dep: '@temporalio/worker', tech: T('temporal', 'Temporal') },
  { dep: 'amqplib', tech: T('rabbitmq', 'RabbitMQ') },
  { dep: 'kafkajs', tech: T('kafka', 'Kafka') },
  { dep: 'telegraf', tech: T('telegram', 'Telegraf') },
  { dep: 'grammy', tech: T('telegram', 'grammY') },
];
const WORKER_NAME = /(^|[-_/@.])(worker|workers|jobs?|queue|cron|scheduler|consumer|bot|daemon|poller|sync)([-_.]|$)/i;

const SERVICE: Array<{ dep: string; tech: Tech }> = [
  { dep: '@nestjs/core', tech: T('nestjs', 'NestJS') },
  { dep: 'fastify', tech: T('fastify', 'Fastify') },
  { dep: 'hono', tech: T('hono', 'Hono') },
  { dep: 'express', tech: T('express', 'Express') },
  { dep: 'koa', tech: T('koa', 'Koa') },
  { dep: '@hapi/hapi', tech: T('hapi', 'hapi') },
  { dep: 'elysia', tech: T('elysia', 'Elysia') },
];

/** Apps non-web reconnues (desktop, mobile, bots). */
const APP: Array<{ dep: string; tech: Tech }> = [
  { dep: 'electron', tech: T('electron', 'Electron') },
  { dep: 'expo', tech: T('expo', 'Expo') },
  { dep: '@tauri-apps/cli', tech: T('tauri', 'Tauri') },
  { dep: 'react-native', tech: T('react-native', 'React Native') },
  { dep: 'discord.js', tech: T('discord', 'discord.js') },
];

const RUNNABLE = ['dev', 'start', 'serve', 'develop'];
const FIXED_PORT_RE = /(--port[= ]|-p[= ]|\bPORT=)(\d{2,5})\b/;

/** Dossiers node_modules/.bin du package et de ses parents (monorepo), comme le fait `pnpm run`. */
function binDirs(dir: string): string[] {
  const out: string[] = [];
  let cur = dir;
  for (let i = 0; i < 5; i++) {
    if (exists(cur, 'node_modules', '.bin')) out.push(path.join(cur, 'node_modules', '.bin'));
    if (settings.roots.includes(cur)) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

/**
 * Script avec un port écrit en dur (`next dev -p 3100`) : on exécute le script lui-même en remplaçant
 * le port par celui attribué dans la plage → plus de port hors plage ni de conflit.
 */
function rewriteFixedPort(dir: string, script: string): { serve: ServeSpec; scriptPort: number } | null {
  const m = script.match(FIXED_PORT_RE);
  if (!m) return null;
  const rewritten = script.replace(new RegExp(FIXED_PORT_RE.source, 'g'), (_s, flag) => `${flag}{PORT}`);
  return {
    scriptPort: Number(m[2]),
    serve: { command: '/bin/sh', args: ['-c', rewritten], env: {}, fixedPort: null, scriptPort: Number(m[2]), pathPrepend: binDirs(dir) },
  };
}

export function detectPackageManager(dir: string): PM {
  let cur = dir;
  while (true) {
    if (exists(cur, 'pnpm-lock.yaml')) return 'pnpm';
    if (exists(cur, 'bun.lockb') || exists(cur, 'bun.lock')) return 'bun';
    if (exists(cur, 'yarn.lock')) return 'yarn';
    if (exists(cur, 'package-lock.json')) return 'npm';
    const parent = path.dirname(cur);
    if (settings.roots.includes(cur) || parent === cur) return 'npm';
    cur = parent;
  }
}

/** npm exige `--` pour transmettre des arguments au script. */
export function runScript(pm: PM, script: string, extra: string[]): [string, string[]] {
  if (pm === 'npm') return ['npm', ['run', script, ...(extra.length ? ['--', ...extra] : [])]];
  return [pm, ['run', script, ...extra]];
}

export const detectNode: Detector = ({ dir, names, nested }) => {
  if (!names.has('package.json')) return null;
  const pkg = readJson<PackageJson>(path.join(dir, 'package.json'));
  if (!pkg) return null;

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};
  const pm = detectPackageManager(dir);
  const ts = names.has('tsconfig.json') || 'typescript' in deps;
  const language = ts ? T('typescript', 'TypeScript') : T('javascript', 'JavaScript');
  const platform = pm === 'bun' ? T('bun', 'Bun') : T('node', 'Node.js');
  const devScript = RUNNABLE.find((k) => scripts[k]) ?? null;

  const commands: Command[] = Object.keys(scripts).map((s) => ({
    id: `script:${s}`,
    label: s,
    cmd: `${pm} run ${s}`,
    group: RUNNABLE.includes(s) ? 'run' : /test|lint|check/.test(s) ? 'test' : 'dev',
  }));
  commands.push({ id: 'deps:install', label: `${pm} install`, cmd: `${pm} install`, group: 'deps' });

  const base = {
    description: pkg.description ?? null,
    name: pkg.name && !pkg.name.startsWith('@') ? pkg.name : pkg.name?.split('/')[1] ?? path.basename(dir),
    language,
    languages: [language],
    platform,
    packageManager: pm,
    commands,
    defaultCommand: devScript ? `script:${devScript}` : null,
  };

  // Racine de monorepo : listée (README, console, `turbo dev`), ses packages aussi.
  if (pkg.workspaces || names.has('pnpm-workspace.yaml')) {
    const fw = names.has('turbo.json') ? T('turborepo', 'Turborepo') : names.has('nx.json') ? T('nx', 'Nx') : null;
    const tool = fw?.label ?? (names.has('pnpm-workspace.yaml') || pm === 'pnpm' ? 'pnpm workspaces' : pm === 'yarn' ? 'Yarn workspaces' : pm === 'bun' ? 'Bun workspaces' : 'npm workspaces');
    return { ...base, score: 2, kind: 'console', framework: fw, workspaceRoot: true, monorepoTool: tool };
  }

  const web = WEB.find((f) => f.dep in deps);
  if (web && devScript) {
    const fixed = rewriteFixedPort(dir, scripts[devScript]);
    if (fixed) return { ...base, score: 5, kind: 'web', framework: web.tech, serve: fixed.serve };
    const [command, args] = runScript(pm, devScript, web.portArgs('{PORT}'));
    return { ...base, score: 5, kind: 'web', framework: web.tech, serve: { command, args, env: {}, fixedPort: null } };
  }

  // Worker : dépendance de file / cron / bot, ou package nommé worker, jobs, queue… avec un script de lancement.
  const worker = WORKER.find((f) => f.dep in deps);
  const workerName = WORKER_NAME.test(pkg.name ?? '') || WORKER_NAME.test(path.basename(dir));
  if (devScript && (workerName || (worker && !SERVICE.some((f) => f.dep in deps)))) {
    const [command, args] = runScript(pm, devScript, []);
    return { ...base, score: 4, kind: 'worker', framework: worker?.tech ?? T('worker', 'Worker'), serve: { command, args, env: {}, fixedPort: null, noPort: true } };
  }

  const service = SERVICE.find((f) => f.dep in deps);
  if (service && devScript) {
    const fixed = rewriteFixedPort(dir, scripts[devScript]);
    if (fixed) return { ...base, score: 4, kind: 'service', framework: service.tech, serve: fixed.serve };
    const [command, args] = runScript(pm, devScript, []);
    return { ...base, score: 4, kind: 'service', framework: service.tech, serve: { command, args, env: {}, fixedPort: null } };
  }

  const app = APP.find((f) => f.dep in deps);
  // Expo / React Native : serveur Metro (+ version web si configurée) sur un port géré.
  if ((app?.tech.id === 'expo' || app?.tech.id === 'react-native') && (devScript || scripts.web)) {
    const script = devScript ?? 'web';
    const [command, args] = runScript(pm, script, ['--port', '{PORT}']);
    return { ...base, score: 4, kind: 'mobile', framework: app.tech, serve: { command, args, env: { EXPO_NO_TELEMETRY: '1' } as Record<string, string>, fixedPort: null } };
  }
  if (devScript || pkg.bin || app) return { ...base, score: 2, kind: 'console', framework: app?.tech ?? null };

  // Librairie sans script de lancement : visible seulement si ce n'est pas un sous-package.
  // Un package.json sans aucune dépendance ni TypeScript n'est qu'un fichier d'outillage → « Divers ».
  if (nested) return null;
  const trivial = !Object.keys(deps).length && !names.has('tsconfig.json');
  return { ...base, score: 1, kind: 'other', framework: null, loose: trivial };
};
