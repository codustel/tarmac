/**
 * Mode démo : données factices pour les captures, les vidéos et les démonstrations publiques.
 *
 * Activé par `TARMAC_DEMO_FIXTURES=<dossier>` (fichier `fixtures.json` dans ce dossier, généré par
 * `scripts/demo/create-demo.mjs`). Dans ce mode, rien de ce qui est lu hors du HOME n'atteint l'interface :
 * GitHub (API et CLI `gh`), conteneurs Docker (Supabase local), émulateurs Android, fenêtres VS Code ouvertes,
 * process `claude`, nom de la machine et adresses IP viennent du fichier ; `git fetch`, l'ouverture d'apps
 * (Finder, éditeur) et la connexion `gh` ne font rien ; le clonage (`gh`) et Claude Code sont de faux outils.
 * Sans la variable, toutes les fonctions de ce module renvoient `null` : aucun changement de comportement.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DockerAction, DockerContainer, DockerOverview, DockerStats } from '../docker.js';

export interface DemoRepo {
  name: string;
  owner: string;
  description?: string | null;
  private?: boolean;
  fork?: boolean;
  archived?: boolean;
  language?: string | null;
  defaultBranch?: string;
  /** Date ISO, ou décalage relatif à maintenant (`-3h`, `-2d`, `-30m`). */
  pushedAt: string;
}

export interface DemoSupabaseInstance {
  projectId: string;
  status: 'running' | 'partial' | 'stopped';
  ports: { api: number; db: number; studio: number; mail: number };
  services: Array<{ name: string; state: string; status: string; image: string }>;
}

export interface DemoAvd {
  name: string;
  device: string | null;
  api: string | null;
  image: string | null;
  state: 'stopped' | 'starting' | 'booting' | 'ready' | 'stopping';
  serial: string | null;
}

/** Conteneur Docker factice (hors stacks Supabase, déduites de `supabase.instances`). */
export interface DemoContainer {
  name: string;
  image: string;
  /** Projet compose et service ; `workingDir` (`~` accepté) relie le conteneur au projet Tarmac. */
  project?: string;
  service?: string;
  workingDir?: string;
  state: 'running' | 'exited';
  health?: 'healthy' | 'unhealthy' | 'starting';
  exitCode?: number;
  /** Démarrage (en cours) ou arrêt : ISO ou décalage (`-3h`). */
  since: string;
  /** [port interne, port publié]. */
  ports?: Array<[number, number]>;
  /** CPU moyen (% d'un cœur), mémoire utilisée et limite (Mo), réseau reçu / envoyé (Mo). */
  cpu?: number;
  memMb?: number;
  memLimitMb?: number;
  netMb?: [number, number];
}

export interface DemoDocker {
  engine: { name: string; version: string; cpus: number; memTotalGb: number };
  containers: DemoContainer[];
  images: { count: number; sizeGb: number };
  volumes: { count: number; sizeGb: number };
}

export interface DemoFixtures {
  machine: string;
  hostname: string;
  ips: Array<{ iface: string; address: string }>;
  github: { login: string; repos: DemoRepo[] };
  ghCli: { installed: boolean; loggedIn: boolean; user: string | null };
  supabase: { instances: DemoSupabaseInstance[] };
  /** Vue Docker (facultatif : sans elle, seules les stacks Supabase apparaissent). */
  docker?: DemoDocker;
  android: {
    sdk: string;
    checks: Array<{ id: string; label: string; ok: boolean; detail: string }>;
    avds: DemoAvd[];
  };
  /** Dossiers « ouverts dans VS Code » (`~` accepté). */
  editors: Array<{ editor: string; editorLabel: string; path: string }>;
  /** Dossiers où un process `claude` « tourne » (`~` accepté) : leur session la plus récente est active. */
  claudeActiveCwds: string[];
  /** Faux `claude` (relatif au dossier des fixtures, ou absolu ; nommé `claude`) ; le faux `gh` est à côté. */
  claudeCommand: string;
}

let loaded: { dir: string; mtimeMs: number; data: DemoFixtures } | null = null;

const expand = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

/** Dossier des fixtures si le mode démo est actif, sinon null. */
export function demoDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const d = env.TARMAC_DEMO_FIXTURES?.trim();
  return d ? path.resolve(expand(d)) : null;
}

export const isDemo = (env: NodeJS.ProcessEnv = process.env) => demoDir(env) !== null;

/** Fixtures du mode démo (relues si le fichier change), ou null hors de ce mode. */
export function demo(env: NodeJS.ProcessEnv = process.env): DemoFixtures | null {
  const dir = demoDir(env);
  if (!dir) return null;
  const file = path.join(dir, 'fixtures.json');
  const st = fs.statSync(file); // mode démo demandé sans fichier : erreur explicite plutôt que des données réelles
  if (!loaded || loaded.dir !== dir || loaded.mtimeMs !== st.mtimeMs) {
    loaded = { dir, mtimeMs: st.mtimeMs, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  return loaded.data;
}

/** Date ISO, ou décalage relatif (`-3h`, `-2d`, `-45m`) par rapport à `now`. */
export function demoDate(v: string, now = Date.now()): string {
  const m = v.match(/^-(\d+(?:\.\d+)?)([mhd])$/);
  if (!m) return v;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'];
  return new Date(now - Number(m[1]) * unit).toISOString();
}

/** Dépôts GitHub factices, au format de `listGithubRepos`. */
export function demoGithubRepos(d: DemoFixtures) {
  return d.github.repos
    .map((r) => {
      const fullName = `${r.owner}/${r.name}`;
      return {
        fullName,
        name: r.name,
        owner: r.owner,
        description: r.description ?? null,
        private: !!r.private,
        fork: !!r.fork,
        archived: !!r.archived,
        language: r.language ?? null,
        defaultBranch: r.defaultBranch ?? 'main',
        pushedAt: demoDate(r.pushedAt),
        htmlUrl: `https://github.com/${fullName}`,
        sshUrl: `git@github.com:${fullName}.git`,
        key: `github.com/${fullName}`.toLowerCase(),
      };
    })
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
}

/** Instances Supabase factices, au format de `listSupabase`. */
export function demoSupabase(d: DemoFixtures) {
  return {
    docker: 'ok' as const,
    instances: d.supabase.instances.map((i) => {
      const running = i.services.filter((s) => s.state === 'running').length;
      const up = i.status !== 'stopped';
      return {
        projectId: i.projectId,
        status: i.status,
        running,
        total: i.services.length,
        urls: up ? { studio: `http://127.0.0.1:${i.ports.studio}`, api: `http://127.0.0.1:${i.ports.api}`, mail: `http://127.0.0.1:${i.ports.mail}` } : {},
        ...(up ? { dbUrl: `postgresql://postgres:postgres@127.0.0.1:${i.ports.db}/postgres` } : {}),
        services: [...i.services].sort((a, b) => a.name.localeCompare(b.name)),
      };
    }),
  };
}

/** État Android factice, au format de `androidStatus`. */
export function demoAndroid(d: DemoFixtures) {
  return {
    sdk: d.android.sdk, // affichage seulement (`~/…` : aucun chemin absolu à l'écran)
    sdkExists: true,
    checks: d.android.checks.map((c) => ({ ...c, install: null, blockedBy: [] as string[] })),
    avds: d.android.avds.map((a) => ({ ...a, missingImage: null, pid: a.state === 'stopped' ? null : 4242, error: null })),
  };
}

export const demoEditors = (d: DemoFixtures) => d.editors.map((e) => ({ ...e, path: expand(e.path), workspaceFile: null }));

export const demoClaudeCwds = (d: DemoFixtures) => new Map(d.claudeActiveCwds.map((c) => [expand(c), 1]));

/**
 * Dossier des faux outils du mode démo (`claude`, `gh`), placé en tête du PATH des consoles qui les lancent :
 * la console affiche la vraie commande (`claude --resume …`, `gh repo clone …`) mais n'exécute jamais le vrai
 * outil. Le faux exécutable est exigé : sans lui, erreur (jamais de repli sur l'outil réel).
 */
export function demoBinDir(d: DemoFixtures, tool: 'claude' | 'gh'): string {
  const claude = path.isAbsolute(d.claudeCommand) ? d.claudeCommand : path.join(demoDir()!, d.claudeCommand);
  if (path.basename(claude) !== 'claude') throw new Error(`Demo mode: ${claude} must be an executable named claude`);
  const bin = path.join(path.dirname(claude), tool);
  if (!fs.statSync(bin).isFile()) throw new Error(`Demo mode: ${bin} missing`);
  return path.dirname(claude);
}

// ─── Docker ─────────────────────────────────────────────────────────────────
const MB = 1024 * 1024;
const GB = 1024 * MB;
const demoId = (name: string) => crypto.createHash('sha256').update(`tarmac-demo:${name}`).digest('hex');
/** Actions faites dans la démo (démarrer / arrêter) : gardées en mémoire, jamais transmises au moteur. */
const dockerOverrides = new Map<string, { state: 'running' | 'exited'; since: string }>();

/** Ports internes des services Supabase (même correspondance que la détection réelle). */
const SB_PORTS: Record<string, Array<[number, keyof DemoSupabaseInstance['ports']]>> = {
  studio: [[3000, 'studio']], kong: [[8000, 'api']], db: [[5432, 'db']], inbucket: [[9000, 'mail']],
};
/** Charge crédible des services Supabase au repos (CPU %, Mo). */
const SB_LOAD: Record<string, [number, number]> = {
  db: [1.2, 182], analytics: [2.4, 312], studio: [0.4, 148], kong: [0.3, 96], realtime: [0.8, 164], storage: [0.2, 88],
  auth: [0.1, 24], rest: [0.1, 18], meta: [0.2, 92], pooler: [0.6, 132], edge_runtime: [0.3, 78], vector: [0.5, 46], inbucket: [0.1, 14],
};

/** Tous les conteneurs factices : ceux des fixtures, plus les stacks Supabase (`supabase_<service>_<projet>`). */
export function demoContainers(d: DemoFixtures): DemoContainer[] {
  const sb = d.supabase.instances.flatMap((i) => i.services.map((s): DemoContainer => {
    const running = s.state === 'running';
    const [cpu, mem] = SB_LOAD[s.name] ?? [0.2, 40];
    return {
      name: `supabase_${s.name}_${i.projectId}`,
      image: s.image,
      project: i.projectId,
      service: s.name,
      state: running ? 'running' : 'exited',
      ...(s.status.includes('(healthy)') ? { health: 'healthy' as const } : {}),
      ...(running ? {} : { exitCode: 0 }),
      since: running ? '-3h' : '-2d',
      ports: (SB_PORTS[s.name] ?? []).map(([priv, key]) => [priv, i.ports[key]] as [number, number]),
      cpu, memMb: mem, netMb: [mem / 9, mem / 14],
    };
  }));
  return [...(d.docker?.containers ?? []), ...sb];
}

const supabaseOf = (d: DemoFixtures, c: DemoContainer) => (d.supabase.instances.some((i) => i.projectId === c.project && c.name.startsWith('supabase_')) ? c.project! : null);

/** Vue d'ensemble factice, au format de `dockerOverview` (avec les montages pour relier les projets). */
export function demoDockerOverview(d: DemoFixtures, now = Date.now()): Omit<DockerOverview, 'containers'> & { containers: Array<DockerContainer & { mounts: string[] }> } {
  const e = d.docker?.engine ?? { name: 'Docker Desktop 4.40.0', version: '28.0.4', cpus: 12, memTotalGb: 16 };
  return {
    engine: { status: 'ok', name: e.name, version: e.version, cpus: e.cpus, memTotal: Math.round(e.memTotalGb * GB), app: 'Docker' },
    containers: demoContainers(d).map((c) => {
      const id = demoId(c.name);
      const o = dockerOverrides.get(id);
      const state = o?.state ?? c.state;
      const since = demoDate(o?.since ?? c.since, now);
      const health = state === 'running' ? c.health ?? null : null;
      const exitCode = state === 'exited' ? (o ? 0 : c.exitCode ?? 0) : null;
      const supabaseProject = supabaseOf(d, c);
      return {
        id,
        name: c.name,
        image: c.image,
        state,
        status: state === 'running' ? `Up${health ? ` (${health === 'starting' ? 'health: starting' : health})` : ''}` : `Exited (${exitCode})`,
        health,
        exitCode,
        createdAt: demoDate('-30d', now),
        since,
        // `http` : calculé par server/docker.ts (même règle que pour le vrai moteur).
        ports: state === 'running' ? (c.ports ?? []).map(([priv, pub]) => ({ private: priv, public: pub, type: 'tcp', http: false })) : [],
        group: c.project ?? null,
        service: c.service ?? null,
        workingDir: c.workingDir ? expand(c.workingDir) : null,
        supabaseProject,
        project: null,
        mounts: [],
      };
    }),
    images: d.docker ? { count: d.docker.images.count, size: Math.round(d.docker.images.sizeGb * GB) } : null,
    volumes: d.docker ? { count: d.docker.volumes.count, size: Math.round(d.docker.volumes.sizeGb * GB) } : null,
  };
}

/** Statistiques factices des conteneurs en cours : valeurs des fixtures avec une légère variation dans le temps. */
export function demoDockerStats(d: DemoFixtures, now = Date.now()): DockerStats[] {
  const t = now / 1000;
  return demoContainers(d).flatMap((c, i) => {
    const id = demoId(c.name);
    if ((dockerOverrides.get(id)?.state ?? c.state) !== 'running') return [];
    const wave = (k: number, amp: number) => 1 + amp * Math.sin(t / (6 + k) + i * 1.7);
    const mem = (c.memMb ?? 40) * wave(3, 0.04);
    const [rx, tx] = c.netMb ?? [mem / 10, mem / 15];
    const uptime = Math.max(60, (now - Date.parse(demoDate(dockerOverrides.get(id)?.since ?? c.since, now))) / 1000);
    const grow = Math.min(1, uptime / (6 * 3600));
    return [{
      id,
      cpu: Math.round((c.cpu ?? 0.3) * wave(0, 0.35) * 100) / 100,
      memUsed: Math.round(mem * MB),
      memLimit: Math.round((c.memLimitMb ?? (d.docker?.engine.memTotalGb ?? 16) * 1024) * MB),
      netRx: Math.round(rx * grow * MB + (t % 600) * 1024),
      netTx: Math.round(tx * grow * MB + (t % 600) * 700),
      blkRead: Math.round(mem * 0.6 * MB),
      blkWrite: Math.round(mem * 0.25 * grow * MB),
      pids: 4 + (i % 9),
    }];
  });
}

/** Action factice : change l'état affiché, sans aucun appel au moteur réel. */
export function demoDockerAction(d: DemoFixtures, action: DockerAction, target: { id: string } | { group: string }) {
  const all = demoContainers(d).map((c) => ({ c, id: demoId(c.name) }));
  const hits = 'id' in target ? all.filter((x) => x.id === target.id || (target.id.length >= 12 && x.id.startsWith(target.id))) : all.filter((x) => x.c.project === target.group);
  if (!hits.length) throw Object.assign(new Error('unknown container'), { code: 'ENOTFOUND', status: 404 });
  const at = new Date().toISOString();
  for (const { id } of hits) dockerOverrides.set(id, { state: action === 'stop' ? 'exited' : 'running', since: at });
  return { ok: true as const, ids: hits.map((x) => x.id) };
}

/** Réinitialise les actions de démo (tests). */
export const resetDemoDocker = () => dockerOverrides.clear();
