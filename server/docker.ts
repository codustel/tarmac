/**
 * Vue Docker : moteur, conteneurs (groupés par projet compose), statistiques et actions démarrer / arrêter /
 * redémarrer.
 *
 * Lecture par l'API du moteur sur son socket Unix (le même que la détection Supabase : Docker Desktop, OrbStack,
 * Colima), sans dépendre de la CLI `docker` dans le PATH du service. Les statistiques sont un instantané
 * (`stream=false`, comme `docker stats --no-stream`) ; après le premier passage, `one-shot=true` répond tout de
 * suite et le CPU est calculé sur l'écart avec l'instantané précédent. Aucun flux permanent : l'UI ne
 * sonde que lorsque la vue est affichée.
 *
 * Actions : liste blanche (`start`, `stop`, `restart`), identifiant hexadécimal présent dans la liste du moteur,
 * nom de projet compose présent dans la liste : rien de ce qui vient de la requête n'est passé tel quel.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dockerSocketPath } from './config.js';
import { demo, demoDockerAction, demoDockerOverview, demoDockerStats } from './demo/index.js';

const exec = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────
/** Conteneur tel que renvoyé par `GET /containers/json?all=1`. */
export interface RawContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Labels: Record<string, string> | null;
  Ports: Array<{ PrivatePort: number; PublicPort?: number; IP?: string; Type: string }> | null;
  Mounts?: Array<{ Type: string; Source?: string }> | null;
}

export interface DockerPort { private: number; public: number; type: string; http: boolean }

export type Health = 'healthy' | 'unhealthy' | 'starting' | null;

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  /** running, exited, paused, restarting, created, dead… */
  state: string;
  /** Texte brut du moteur (« Up 3 hours (healthy) »), en anglais : infobulle seulement. */
  status: string;
  health: Health;
  exitCode: number | null;
  createdAt: string;
  /** Démarrage (en cours) ou arrêt (arrêté), lu par `inspect` ; null si inconnu. */
  since: string | null;
  ports: DockerPort[];
  /** Projet compose (`com.docker.compose.project`) ; les stacks Supabase en ont un aussi. */
  group: string | null;
  service: string | null;
  workingDir: string | null;
  supabaseProject: string | null;
  /** Projet Tarmac relié (dossier compose, montage ou instance Supabase). */
  project: { id: string; name: string } | null;
}

export interface DockerStats {
  id: string;
  /** % d'un cœur (comme `docker stats` : peut dépasser 100) ; null au premier instantané sans référence. */
  cpu: number | null;
  memUsed: number;
  memLimit: number;
  netRx: number | null;
  netTx: number | null;
  blkRead: number | null;
  blkWrite: number | null;
  pids: number | null;
}

export type EngineApp = 'Docker' | 'OrbStack' | null;

export interface DockerEngine {
  status: 'ok' | 'absent' | 'stopped' | 'error';
  error?: string;
  /** « Docker Desktop 4.40.0 », « OrbStack »… */
  name: string | null;
  version: string | null;
  cpus: number | null;
  memTotal: number | null;
  /** Application à ouvrir (bouton « Ouvrir Docker »), null si aucune (Colima, Linux). */
  app: EngineApp;
}

export interface DockerOverview {
  engine: DockerEngine;
  containers: DockerContainer[];
  images: { count: number; size: number } | null;
  volumes: { count: number; size: number | null } | null;
}

export const DOCKER_ACTIONS = ['start', 'stop', 'restart'] as const;
export type DockerAction = (typeof DOCKER_ACTIONS)[number];
export const isDockerAction = (a: unknown): a is DockerAction => typeof a === 'string' && (DOCKER_ACTIONS as readonly string[]).includes(a);
/** Identifiant complet ou court du moteur (hexadécimal, 12 à 64 caractères). */
export const isContainerId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{12,64}$/.test(id);
/** Nom de projet compose (règles de compose : minuscules, chiffres, `-`, `_`, `.`). */
export const isComposeProject = (p: unknown): p is string => typeof p === 'string' && /^[a-z0-9][a-z0-9_.-]{0,99}$/.test(p);

// ─── Lecture (fonctions pures, testées) ─────────────────────────────────────
export function parseHealth(status: string): Health {
  const m = status.match(/\((healthy|unhealthy|health: starting)\)/);
  return !m ? null : m[1] === 'health: starting' ? 'starting' : (m[1] as Health);
}

export function parseExitCode(status: string): number | null {
  const m = status.match(/^Exited \((-?\d+)\)/);
  return m ? Number(m[1]) : null;
}

/** Ports privés de services qui ne parlent pas HTTP (bases, files, mail…) : pas de lien. */
const NON_HTTP = new Set([21, 22, 25, 53, 465, 587, 1025, 1433, 1521, 2525, 3306, 4222, 5432, 5433, 5672, 6379, 6380, 9042, 9092, 9300, 11211, 27017, 26257, 2181, 1883, 8883, 5671, 61616, 6432]);
export const isHttpPort = (privatePort: number, type: string) => type === 'tcp' && !NON_HTTP.has(privatePort);

/** Ports publiés, sans les doublons IPv4 / IPv6, triés. */
export function parsePorts(ports: RawContainer['Ports']): DockerPort[] {
  const seen = new Map<string, DockerPort>();
  for (const p of ports ?? []) {
    if (!p.PublicPort) continue;
    const key = `${p.PublicPort}/${p.Type}`;
    if (!seen.has(key)) seen.set(key, { private: p.PrivatePort, public: p.PublicPort, type: p.Type, http: isHttpPort(p.PrivatePort, p.Type) });
  }
  return [...seen.values()].sort((a, b) => a.public - b.public);
}

export function parseContainer(c: RawContainer): DockerContainer {
  const labels = c.Labels ?? {};
  return {
    id: c.Id,
    name: (c.Names?.[0] ?? c.Id.slice(0, 12)).replace(/^\//, ''),
    image: c.Image,
    state: c.State,
    status: c.Status,
    health: parseHealth(c.Status),
    exitCode: parseExitCode(c.Status),
    createdAt: new Date(c.Created * 1000).toISOString(),
    since: null,
    ports: parsePorts(c.Ports),
    group: labels['com.docker.compose.project'] ?? labels['com.supabase.cli.project'] ?? null,
    service: labels['com.docker.compose.service'] ?? null,
    workingDir: labels['com.docker.compose.project.working_dir'] ?? null,
    supabaseProject: labels['com.supabase.cli.project'] ?? null,
    project: null,
  };
}

export interface LinkableProject { id: string; name: string; dir: string; repoDir: string | null; supabaseProjectId: string | null }

// `/` ou `\` : sous Windows, le moteur peut donner des chemins Windows ou de WSL (`/mnt/c/…`, `/home/…`).
const inside = (child: string, parent: string) =>
  child === parent || [path.sep, '/'].some((sep) => child.startsWith(parent.endsWith(sep) ? parent : parent + sep));

/**
 * Projet Tarmac d'un conteneur : instance Supabase détectée, puis dossier compose, puis montages (bind).
 * Pour un dossier : le projet le plus profond qui le contient ; sinon (compose à la racine d'un monorepo)
 * le projet le moins profond qu'il contient.
 */
export function linkProject(c: { supabaseProject: string | null; workingDir: string | null }, mounts: string[], projects: LinkableProject[]): { id: string; name: string } | null {
  const pick = (p: LinkableProject | undefined) => (p ? { id: p.id, name: p.name } : null);
  const shallow = (a: LinkableProject, b: LinkableProject) => a.dir.length - b.dir.length || a.dir.localeCompare(b.dir);
  if (c.supabaseProject) {
    const sb = projects.filter((p) => p.supabaseProjectId === c.supabaseProject).sort(shallow)[0];
    if (sb) return pick(sb);
  }
  for (const dir of [c.workingDir, ...mounts].filter((d): d is string => !!d && path.isAbsolute(d))) {
    // Chemin Linux (WSL, moteur distant) vu depuis Windows : gardé tel quel, sans lecteur ajouté.
    const d = process.platform === 'win32' && dir.startsWith('/') ? path.posix.resolve(dir) : path.resolve(dir);
    const owner = projects.filter((p) => inside(d, p.dir)).sort((a, b) => shallow(b, a))[0];
    if (owner) return pick(owner);
    const child = projects.filter((p) => inside(p.dir, d) && d !== path.parse(d).root && d !== os.homedir()).sort(shallow)[0];
    if (child) return pick(child);
  }
  return null;
}

/** Montages « bind » (dossiers de la machine) d'un conteneur. */
export const bindMounts = (c: RawContainer) => (c.Mounts ?? []).filter((m) => m.Type === 'bind' && m.Source).map((m) => m.Source!);

/** Échantillon CPU retenu entre deux instantanés. */
export interface CpuSample { total: number; system: number; online: number }

/** Statistiques d'un instantané de `/containers/{id}/stats` (formules de `docker stats`). */
export function computeStats(id: string, s: any, prev?: CpuSample | null): { stats: DockerStats; sample: CpuSample | null } {
  const cpu = s?.cpu_stats ?? {};
  const pre = s?.precpu_stats ?? {};
  const online = cpu.online_cpus || cpu.cpu_usage?.percpu_usage?.length || 1;
  const sample = cpu.cpu_usage?.total_usage != null && cpu.system_cpu_usage ? { total: cpu.cpu_usage.total_usage, system: cpu.system_cpu_usage, online } : null;
  // Référence : precpu (instantané classique) ou, en one-shot, l'instantané précédent gardé en mémoire.
  const ref = pre.system_cpu_usage && pre.cpu_usage?.total_usage != null ? { total: pre.cpu_usage.total_usage, system: pre.system_cpu_usage } : prev ?? null;
  let cpuPct: number | null = null;
  if (sample && ref) {
    const dc = sample.total - ref.total;
    const ds = sample.system - ref.system;
    if (ds > 0 && dc >= 0) cpuPct = (dc / ds) * online * 100;
  }
  const mem = s?.memory_stats ?? {};
  const ms = mem.stats ?? {};
  // Mémoire « utilisée » comme `docker stats` : usage moins le cache de fichiers inactif (cgroup v2, puis v1).
  const inactive = ms.inactive_file ?? ms.total_inactive_file ?? 0;
  const memUsed = Math.max(0, (mem.usage ?? 0) - (inactive < (mem.usage ?? 0) ? inactive : 0));
  const nets = s?.networks ? Object.values(s.networks as Record<string, { rx_bytes: number; tx_bytes: number }>) : null;
  const io = s?.blkio_stats?.io_service_bytes_recursive as Array<{ op: string; value: number }> | null | undefined;
  const sumOp = (op: string) => (io ? io.filter((e) => e.op.toLowerCase() === op).reduce((a, e) => a + e.value, 0) : null);
  return {
    stats: {
      id,
      cpu: cpuPct == null ? null : Math.round(cpuPct * 100) / 100,
      memUsed,
      memLimit: mem.limit ?? 0,
      netRx: nets ? nets.reduce((a, n) => a + (n.rx_bytes ?? 0), 0) : null,
      netTx: nets ? nets.reduce((a, n) => a + (n.tx_bytes ?? 0), 0) : null,
      blkRead: sumOp('read'),
      blkWrite: sumOp('write'),
      pids: s?.pids_stats?.current ?? null,
    },
    sample,
  };
}

/** Application du moteur : d'après le socket utilisé (lien suivi), sinon ce qui est installé. */
export function engineAppOf(socket: string | null, installed: (app: 'Docker' | 'OrbStack') => boolean): EngineApp {
  let real = socket;
  try { if (socket) real = fs.realpathSync(socket); } catch { /* socket absent */ }
  if (real?.includes('/.orbstack/')) return 'OrbStack';
  if (real?.includes('/.colima/')) return null;
  if (real?.includes('/.docker/')) return installed('Docker') ? 'Docker' : installed('OrbStack') ? 'OrbStack' : null;
  return installed('Docker') ? 'Docker' : installed('OrbStack') ? 'OrbStack' : null;
}

/** Docker Desktop sous Windows (OrbStack n'existe que sur macOS). */
const WINDOWS_DOCKER = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');

const appInstalled = (app: 'Docker' | 'OrbStack') =>
  process.platform === 'win32'
    ? app === 'Docker' && fs.existsSync(WINDOWS_DOCKER)
    : [`/Applications/${app}.app`, path.join(os.homedir(), 'Applications', `${app}.app`)].some((p) => fs.existsSync(p));

// ─── Accès au moteur ────────────────────────────────────────────────────────
export class DockerError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message); }
}

export function dockerRequest<T>(socketPath: string, method: 'GET' | 'POST', url: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: url, method, timeout: timeoutMs, headers: { host: 'docker' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 400) {
          let m = body;
          try { m = JSON.parse(body).message ?? body; } catch { /* texte brut */ }
          return reject(new DockerError(m.trim() || `Docker ${status}`, undefined, status));
        }
        if (!body.trim()) return resolve(undefined as T);
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new DockerError('Docker timeout', 'ETIMEDOUT')));
    req.on('error', (e: NodeJS.ErrnoException) => reject(e instanceof DockerError ? e : new DockerError(e.message, e.code)));
    req.end();
  });
}

/** Petite file : au plus `n` requêtes simultanées. */
async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export interface DockerDeps {
  /** Socket du moteur (null : aucun trouvé). */
  socket: () => string | null;
  installed: (app: 'Docker' | 'OrbStack') => boolean;
  projects: () => LinkableProject[];
}

/**
 * Client du moteur avec les petits caches de la vue : dates de démarrage (`inspect`, relu quand le statut
 * change), espace disque (`/system/df`, 60 s), dernier instantané CPU par conteneur.
 */
export class DockerService {
  private since = new Map<string, { key: string; since: string | null }>();
  private disk: { at: number; images: DockerOverview['images']; volumes: DockerOverview['volumes'] } | null = null;
  private cpu = new Map<string, CpuSample>();
  private statsInflight: Promise<DockerStats[]> | null = null;

  constructor(private deps: DockerDeps) {}

  private engineBase(socket: string | null): DockerEngine {
    return { status: 'ok', name: null, version: null, cpus: null, memTotal: null, app: engineAppOf(socket, this.deps.installed) };
  }

  async overview(): Promise<DockerOverview> {
    const socket = this.deps.socket();
    const engine = this.engineBase(socket);
    const empty = (e: Partial<DockerEngine>): DockerOverview => ({ engine: { ...engine, ...e }, containers: [], images: null, volumes: null });
    if (!socket) return empty({ status: engine.app ? 'stopped' : 'absent' });
    let raw: RawContainer[];
    let version: any;
    let info: any;
    try {
      [version, raw, info] = await Promise.all([
        dockerRequest<any>(socket, 'GET', '/version'),
        dockerRequest<RawContainer[]>(socket, 'GET', '/containers/json?all=1'),
        dockerRequest<any>(socket, 'GET', '/info').catch(() => null),
      ]);
    } catch (e: any) {
      // Socket présent mais personne n'écoute : moteur arrêté (Docker Desktop / OrbStack fermés).
      if (['ECONNREFUSED', 'ENOENT', 'ECONNRESET', 'EPIPE'].includes(e.code)) return empty({ status: 'stopped' });
      return empty({ status: 'error', error: e.message });
    }
    engine.name = version?.Platform?.Name || info?.OperatingSystem || 'Docker Engine';
    engine.version = version?.Version ?? null;
    engine.cpus = info?.NCPU ?? null;
    engine.memTotal = info?.MemTotal ?? null;

    const projects = this.deps.projects();
    const containers = raw.map((r) => {
      const c = parseContainer(r);
      c.project = linkProject(c, bindMounts(r), projects);
      return c;
    });
    await this.fillSince(socket, containers);
    const disk = await this.diskUsage(socket);
    return { engine, containers: sortContainers(containers), images: disk.images, volumes: disk.volumes };
  }

  /** Depuis quand : `State.StartedAt` (en cours) ou `State.FinishedAt` (arrêté), relu quand le statut change. */
  private async fillSince(socket: string, containers: DockerContainer[]) {
    const live = new Set(containers.map((c) => c.id));
    for (const id of this.since.keys()) if (!live.has(id)) this.since.delete(id);
    await mapLimit(containers, 8, async (c) => {
      // Clé : état et statut sans les nombres (« Up # hours ») : un redémarrage change l'unité, donc la clé.
      const key = `${c.state}|${c.status.replace(/\d+/g, '#')}`;
      const hit = this.since.get(c.id);
      if (hit && hit.key === key) { c.since = hit.since; return; }
      try {
        const st = (await dockerRequest<any>(socket, 'GET', `/containers/${c.id}/json`))?.State ?? {};
        const at = c.state === 'running' || c.state === 'restarting' || c.state === 'paused' ? st.StartedAt : st.FinishedAt;
        c.since = at && !at.startsWith('0001-') ? at : null;
      } catch { c.since = null; }
      this.since.set(c.id, { key, since: c.since });
    });
  }

  private async diskUsage(socket: string) {
    if (this.disk && Date.now() - this.disk.at < 60_000) return this.disk;
    try {
      const df = await dockerRequest<any>(socket, 'GET', '/system/df', 15_000);
      const vols = (df?.Volumes ?? []) as Array<{ UsageData?: { Size: number } | null }>;
      const sized = vols.map((v) => v.UsageData?.Size ?? -1).filter((s) => s >= 0);
      this.disk = {
        at: Date.now(),
        images: { count: (df?.Images ?? []).length, size: df?.LayersSize ?? (df?.Images ?? []).reduce((a: number, i: any) => a + (i.Size ?? 0), 0) },
        volumes: { count: vols.length, size: sized.length ? sized.reduce((a, b) => a + b, 0) : null },
      };
    } catch {
      this.disk = { at: Date.now(), images: null, volumes: null };
    }
    return this.disk;
  }

  /** Instantané des conteneurs en cours (une requête à la fois par client : les appels simultanés partagent le résultat). */
  stats(): Promise<DockerStats[]> {
    this.statsInflight ??= this.readStats().finally(() => { this.statsInflight = null; });
    return this.statsInflight;
  }

  private async readStats(): Promise<DockerStats[]> {
    const socket = this.deps.socket();
    if (!socket) return [];
    let running: RawContainer[];
    try {
      running = await dockerRequest<RawContainer[]>(socket, 'GET', '/containers/json');
    } catch {
      return [];
    }
    const live = new Set(running.map((c) => c.Id));
    for (const id of this.cpu.keys()) if (!live.has(id)) this.cpu.delete(id);
    const out = await mapLimit(running, 48, async (c) => {
      const prev = this.cpu.get(c.Id);
      try {
        // one-shot : réponse immédiate, sans precpu → CPU sur l'écart avec l'instantané précédent.
        const raw = await dockerRequest<any>(socket, 'GET', `/containers/${c.Id}/stats?stream=false${prev ? '&one-shot=true' : ''}`, 8000);
        const { stats, sample } = computeStats(c.Id, raw, prev);
        if (sample) this.cpu.set(c.Id, sample);
        return stats;
      } catch {
        return null;
      }
    });
    return out.filter((s): s is DockerStats => !!s);
  }

  /** Démarrer / arrêter / redémarrer des conteneurs connus du moteur (identifiants vérifiés dans sa liste). */
  async act(action: DockerAction, target: { id: string } | { group: string }): Promise<{ ok: true; ids: string[] }> {
    if (!isDockerAction(action)) throw new DockerError('unknown action', 'EBADACTION', 400);
    const socket = this.deps.socket();
    if (!socket) throw new DockerError('Docker unavailable', 'ENOENT', 503);
    const all = await dockerRequest<RawContainer[]>(socket, 'GET', '/containers/json?all=1');
    let ids: string[];
    if ('id' in target) {
      if (!isContainerId(target.id)) throw new DockerError('invalid container', 'EBADID', 400);
      const c = all.find((x) => x.Id === target.id || x.Id.startsWith(target.id));
      if (!c) throw new DockerError('unknown container', 'ENOTFOUND', 404);
      ids = [c.Id];
    } else {
      if (!isComposeProject(target.group)) throw new DockerError('invalid group', 'EBADID', 400);
      ids = all.filter((c) => parseContainer(c).group === target.group).map((c) => c.Id);
      if (!ids.length) throw new DockerError('unknown group', 'ENOTFOUND', 404);
    }
    // L'identifiant vient de la liste du moteur (hexadécimal) ; l'action, de la liste blanche.
    await Promise.all(ids.map((id) => dockerRequest(socket, 'POST', `/containers/${id}/${action}`, 60_000)));
    for (const id of ids) this.since.delete(id);
    // La liste du moteur peut garder l'ancien état un instant après la réponse (constaté avec Docker Desktop) :
    // on attend (3 s au plus) qu'elle reflète l'action, pour que l'UI rafraîchie affiche le bon état.
    const want = (s: string) => (action === 'stop' ? s !== 'running' && s !== 'restarting' : s === 'running');
    for (let i = 0; i < 12; i++) {
      const now = await dockerRequest<RawContainer[]>(socket, 'GET', '/containers/json?all=1').catch(() => null);
      if (!now || ids.every((id) => want(now.find((c) => c.Id === id)?.State ?? 'exited'))) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return { ok: true, ids };
  }
}

/** Ordre d'affichage : groupes (projets compose) puis conteneurs isolés ; en cours d'abord, puis par nom. */
export function sortContainers(list: DockerContainer[]): DockerContainer[] {
  return [...list].sort((a, b) =>
    (a.group ?? '￿').localeCompare(b.group ?? '￿')
    || Number(b.state === 'running') - Number(a.state === 'running')
    || a.name.localeCompare(b.name));
}

// ─── Service de l'application ───────────────────────────────────────────────
let service: DockerService | null = null;
let projectsOf: () => LinkableProject[] = () => [];
export function setDockerProjects(fn: () => LinkableProject[]) { projectsOf = fn; }
const docker = () => (service ??= new DockerService({ socket: dockerSocketPath, installed: appInstalled, projects: () => projectsOf() }));

/** Vue d'ensemble (mode démo : fixtures, jamais le vrai moteur). */
export async function dockerOverview(): Promise<DockerOverview> {
  const d = demo();
  if (d) {
    const projects = projectsOf();
    const o = demoDockerOverview(d);
    return {
      ...o,
      containers: sortContainers(o.containers.map(({ mounts, ...c }) => ({
        ...c,
        ports: c.ports.map((p) => ({ ...p, http: isHttpPort(p.private, p.type) })),
        project: linkProject(c, mounts, projects),
      }))),
    };
  }
  return docker().overview();
}

export async function dockerStats(): Promise<DockerStats[]> {
  const d = demo();
  if (d) return demoDockerStats(d);
  return docker().stats();
}

export async function dockerAct(action: DockerAction, target: { id: string } | { group: string }) {
  const d = demo();
  if (d) return demoDockerAction(d, action, target);
  return docker().act(action, target);
}

/** Ouvre l'application du moteur (`open -a`, l'exe sous Windows) ; rien en mode démo. */
export async function openDockerApp(): Promise<{ ok: true; app: EngineApp }> {
  if (demo()) return { ok: true, app: 'Docker' };
  const app = engineAppOf(dockerSocketPath(), appInstalled);
  if (!app) throw new DockerError('no Docker app installed', 'ENOAPP', 404);
  if (process.platform === 'win32') spawn(WINDOWS_DOCKER, [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  else await exec('open', ['-a', app]);
  return { ok: true, app };
}
