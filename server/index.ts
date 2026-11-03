import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { config, dockerSocketPath } from './config.js';
import { displayPath, scan, type Project, type ScanResult } from './scanner.js';
import { gitFetch, gitStatus, pool, type GitStatus } from './git.js';
import { cachedGithubRepos, invalidateGithubCache, listGithubRepos } from './github.js';
import { listSupabase } from './supabase.js';
import { dockerAct, dockerOverview, dockerStats, isComposeProject, isContainerId, isDockerAction, openDockerApp, setDockerProjects } from './docker.js';
import { processes } from './processes.js';
import { SYSTEM_ID, terminals } from './terminals.js';
import { EDITOR_APPS, matchOpen, openEditorFolders } from './editors.js';
import crypto from 'node:crypto';
import { assignSessions, claudeCommand, claudeDir, claudeProcs, claudeTurnState, listClaudeSessions, transcriptFile } from './claude.js';
import { buildRunningAgents, type RunningAgent } from './agents.js';
import { codexCommand, codexProcs, codexTranscriptFile, codexTurnState, listCodexSessions, readCodexUsage, type CodexUsage } from './codex.js';
import type { AgentKind } from './agentProcs.js';
import { RepoEventsCache, TIMELINE_DAYS, mergeTimeline, type TimelineEvent, type TimelineRepo } from './timeline.js';
import { ClaudeUsageService, readCredentials } from './claudeUsage.js';
import { GIT_COMMANDS, buildGitCommand } from './gitCommands.js';
import { msg, runWithRequestLang, tr, uiLang } from './i18n.js';
import { SUPABASE_COMMANDS, buildSupabaseCommand, findSupabaseDir } from './supabaseCommands.js';
import { freeHistoryPorts, isPortBusy, killPort } from './ports.js';
import { state, flushSync } from './store.js';
import { publicSettings, settings, updateSettings, type SettingsPatch } from './settings.js';
import { listDir, MAX_EDIT_BYTES, readFile as readProjectFile, resolveInside, statFile, writeFile as writeProjectFile } from './ide.js';
import { listEnvFiles, readEnvFile } from './envFiles.js';
import { SCM_ACTIONS, scmAction, scmLog, scmShow, scmStatus, type ScmAction, type ScmActionBody } from './scm.js';
import { ProjectWatcher } from './watch.js';
import { openDb as openSuiviDb } from './suivi/db.js';
import { SuiviService } from './suivi/service.js';
import { registerSuiviRoutes } from './suivi/routes.js';
import { suiviToken } from './suivi/token.js';
import { SyncRunner } from './suivi/sync.js';
import { SuiviDispatcher } from './suivi/dispatch.js';
import { setSuiviDir, TodolistWatcher, type ProjectRoot } from './suivi/watch.js';
import { demo, demoBinDir, demoClaudeUsage, isDemo } from './demo/index.js';
import { crossOriginFetch, originAllowed } from './originGuard.js';
import { loadModules, parseModuleDirs } from './modules/loader.js';
import { envVar } from './dataDir.js';
import { androidStatus, applyAndroidEnv, ensureEmulator, installCommand, isAvd, startAvd, stopAvd, waitForBootCommand } from './android.js';

const exec = promisify(execFile);
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
/** Racine du dépôt Tarmac (même chemin depuis server/ et depuis dist/server/). */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\/dist$/, '');
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

// ─── Sécurité ───────────────────────────────────────────────────────────────
// Tarmac peut lancer des commandes et des shells : on refuse toute requête dont l'hôte ou
// l'origine n'est pas locale (CSRF depuis un site tiers, DNS rebinding, WebSocket cross-origin).
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(process.env.ALLOWED_HOSTS ?? '').split(',').filter(Boolean)]);
if (config.publicUrl) allowedHosts.add(new URL(config.publicUrl).hostname);
const allowedOrigins = config.publicUrl ? [new URL(config.publicUrl).origin] : [];
const isAllowedHost = (h: string) => allowedHosts.has(h) || h.endsWith('.localhost') || h.endsWith('.test');

// Langue des textes renvoyés (en premier : les hooks et routes suivants s'exécutent dans ce contexte).
app.addHook('onRequest', (req, _reply, done) => runWithRequestLang(req.headers, done));

app.addHook('onRequest', async (req, reply) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (!isAllowedHost(host)) return reply.code(403).send({ error: msg('api.hostNotAllowed', { host }) });
  const fromOtherOrigin = !originAllowed(req.headers.origin, req.headers.host ?? '', allowedOrigins, `${req.protocol}:`)
    || ((req.url.startsWith('/api') || req.url.startsWith('/ws')) && crossOriginFetch(req.headers['sec-fetch-site'] as string | undefined));
  if (fromOtherOrigin) return reply.code(403).send({ error: msg('api.originNotAllowed') });
});

// Pages chargées via un domaine .test (non sécurisé pour Chrome) → tarmac.localhost, où l'installation
// PWA, le presse-papiers et le service worker fonctionnent. L'API et le WebSocket restent accessibles.
// L'ancien domaine manager.localhost (App Manager) suit la même redirection.
app.addHook('onRequest', async (req, reply) => {
  const [host, port] = (req.headers.host ?? '').split(':');
  const legacy = host === 'manager.localhost';
  if (req.method !== 'GET' || !(host.endsWith('.test') || legacy) || req.url.startsWith('/api') || req.url.startsWith('/ws')) return;
  if (process.env.NO_LOCALHOST_REDIRECT) return;
  return reply.redirect(`http://tarmac.localhost${port ? `:${port}` : ''}${req.url}`, 302);
});

await app.register(fastifyWebsocket);
// SDK Android et JDK 17 dans l'environnement hérité par les apps et les consoles.
await applyAndroidEnv();

// ─── État en mémoire ────────────────────────────────────────────────────────
let lastScan: ScanResult = { projects: [], repos: [], supabaseConfigs: [], scannedAt: '', durationMs: 0 };
const gitCache = new Map<string, GitStatus>();
let scanning: Promise<void> | null = null;
let fetching: Promise<void> | null = null;
let lastFetchAt: string | null = null;

async function refreshGit(dirs: string[]) {
  await pool(dirs, 8, async (d) => gitCache.set(d, await gitStatus(d)));
}

/** Dossier de la CLI Supabase par projet, recalculé à chaque scan. */
const supabaseDirs = new Map<string, ReturnType<typeof findSupabaseDir>>();
const supabaseDirOf = (p: Project) => {
  if (!supabaseDirs.has(p.id)) supabaseDirs.set(p.id, findSupabaseDir(p.dir, p.repoDir ?? p.dir));
  return supabaseDirs.get(p.id)!;
};

function rescan() {
  scanning ??= (async () => {
    lastScan = await scan();
    supabaseDirs.clear();
    await refreshGit(lastScan.repos.map((r) => r.dir));
    syncTodolists();
    broadcast({ type: 'scan', at: lastScan.scannedAt });
  })().finally(() => (scanning = null));
  return scanning;
}

function fetchAll() {
  fetching ??= (async () => {
    await pool(lastScan.repos, 4, async (r) => {
      try { await gitFetch(r.dir); } catch { /* repo sans remote / hors ligne */ }
    });
    await refreshGit(lastScan.repos.map((r) => r.dir));
    lastFetchAt = new Date().toISOString();
    broadcast({ type: 'scan', at: lastScan.scannedAt });
  })().finally(() => (fetching = null));
  return fetching;
}

const findProject = (id: string) => lastScan.projects.find((p) => p.id === id);
const inRoots = (p: string) => settings.roots.some((r) => p === r || p.startsWith(r + path.sep));

// ─── WebSocket : statuts en broadcast, logs et terminaux par abonnement ─────
interface Client { logs: Set<string>; terms: Set<string>; watch: Set<string> }
const clients = new Map<WebSocket, Client>();
function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(data);
}

// ─── Todolist Claude (suivi de projets) ──────────────────────────────────────
const suivi = new SuiviService(openSuiviDb(path.join(config.dataDir, 'suivi.db')), (projectId) => broadcast({ type: 'suivi:changed', projectId }));
const todolists = new TodolistWatcher(suivi, (m) => console.log(m), (dir) => inRoots(dir));
/** Projet de suivi rattaché à un dossier (racine du dépôt), d'après les `paths` des projets de suivi. */
const suiviIdOf = (dir: string) => suivi.projects().find((sp) => sp.paths.includes(dir))?.projectId ?? null;
setSuiviDir(settings.suivi.folder);
/** Racines des dépôts scannés (un projet par dépôt) → import des copies `Todolist/*.json`. */
function syncTodolists() {
  const roots = new Map<string, ProjectRoot>();
  for (const r of lastScan.repos) roots.set(r.dir, { dir: r.dir, name: r.name, remoteKey: gitCache.get(r.dir)?.remoteKey ?? null });
  for (const p of lastScan.projects) {
    const dir = p.repoDir ?? p.dir;
    if (!roots.has(dir) || p.dir === dir) roots.set(dir, { dir, name: p.dir === dir ? p.name : roots.get(dir)?.name ?? path.basename(dir), remoteKey: gitCache.get(dir)?.remoteKey ?? null });
  }
  todolists.sync([...roots.values()]);
  todolists.start();
}
processes.on('status', (id, runtime) => broadcast({ type: 'status', id, runtime }));
processes.on('log', (id, line) => {
  const data = JSON.stringify({ type: 'log', id, line });
  for (const [ws, c] of clients) if (c.logs.has(id) && ws.readyState === 1) ws.send(data);
});
terminals.on('data', (sid: string, chunk: string) => {
  const data = JSON.stringify({ type: 'term:data', sid, data: chunk });
  for (const [ws, c] of clients) if (c.terms.has(sid) && ws.readyState === 1) ws.send(data);
});
const ideWatcher = new ProjectWatcher();
ideWatcher.on('change', (projectId: string, paths: string[], all: boolean) => {
  const data = JSON.stringify({ type: 'ide:fs', projectId, paths, all });
  for (const [ws, c] of clients) if (c.watch.has(projectId) && ws.readyState === 1) ws.send(data);
});
terminals.on('change', (projectId: string) => {
  broadcast({ type: 'terminals', projectId, sessions: terminals.list(projectId) });
  broadcast({ type: 'terminals:all', sessions: terminals.list() });
});

app.get('/ws', { websocket: true }, (socket) => {
  const c: Client = { logs: new Set(), terms: new Set(), watch: new Set() };
  clients.set(socket, c);
  socket.on('message', (raw: Buffer) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'logs:subscribe': c.logs.add(msg.id); break;
      case 'logs:unsubscribe': c.logs.delete(msg.id); break;
      case 'term:attach': {
        c.terms.add(msg.sid);
        const buf = terminals.replay(msg.sid);
        if (buf !== null) socket.send(JSON.stringify({ type: 'term:replay', sid: msg.sid, data: buf }));
        break;
      }
      case 'term:detach': c.terms.delete(msg.sid); break;
      case 'term:input': if (typeof msg.data === 'string') terminals.write(msg.sid, msg.data); break;
      case 'term:resize': terminals.resize(msg.sid, Number(msg.cols), Number(msg.rows)); break;
      case 'ide:watch': {
        const p = typeof msg.projectId === 'string' && !c.watch.has(msg.projectId) ? findProject(msg.projectId) : null;
        if (p) { c.watch.add(p.id); ideWatcher.watch(p.id, p.dir, p.repoDir); }
        break;
      }
      case 'ide:unwatch': if (c.watch.delete(msg.projectId)) ideWatcher.unwatch(msg.projectId); break;
    }
  });
  socket.on('close', () => {
    for (const id of c.watch) ideWatcher.unwatch(id);
    clients.delete(socket);
  });
});

// ─── API : méta & réglages ──────────────────────────────────────────────────
/** Nom de la machine : nom macOS (« MacBook Pro de Camille ») plutôt que le hostname technique. */
let machineName = os.hostname().replace(/\.local$/, '');
if (process.platform === 'darwin' && !isDemo()) {
  exec('scutil', ['--get', 'ComputerName'], { timeout: 3000 }).then(({ stdout }) => { if (stdout.trim()) machineName = stdout.trim(); }).catch(() => null);
}

/** Adresses IPv4 du réseau local (Wi-Fi / Ethernet en premier ; VPN, Docker et ponts relégués). */
function localIps() {
  const out: Array<{ iface: string; address: string }> = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) out.push({ iface, address: a.address });
  }
  const rank = (i: string) => (/^en\d/.test(i) ? 0 : /^eth|^wl/.test(i) ? 1 : /^(utun|tun|tap|bridge|docker|veth|vmnet|llw|awdl)/.test(i) ? 3 : 2);
  return out.sort((a, b) => rank(a.iface) - rank(b.iface) || a.iface.localeCompare(b.iface));
}

/** Build de l'UI actuellement servi (relu à chaque appel : change après `pnpm build`). */
function uiBuildId(): string | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(webDir, 'version.json'), 'utf8')).buildId ?? null;
  } catch {
    return null;
  }
}

app.get('/api/meta', async () => ({
  buildId: uiBuildId(),
  machine: demo()?.machine ?? machineName,
  ips: demo()?.ips ?? localIps(),
  home: os.homedir(),
  roots: settings.roots,
  portRange: settings.portRange,
  hostname: demo()?.hostname ?? os.hostname(),
  docker: dockerSocketPath(),
  terminals: terminals.available,
  scannedAt: lastScan.scannedAt,
  scanDurationMs: lastScan.durationMs,
  lastFetchAt,
  scanning: !!scanning,
  fetching: !!fetching,
}));

app.get('/api/settings', async () => publicSettings());

app.put<{ Body: SettingsPatch }>('/api/settings', async (req, reply) => {
  const { errors } = updateSettings(req.body ?? {});
  if (errors.length) return reply.code(400).send({ error: errors.join(' · '), errors });
  if (req.body.github) invalidateGithubCache();
  if (req.body.suivi?.folder) setSuiviDir(settings.suivi.folder);
  // Agents cochés : la timeline (sessions par agent) et l'usage Codex sont recalculés.
  if (req.body.agents || req.body.showCodexUsage !== undefined) { timelineMemo = null; codexUsageMemo = null; }
  if (req.body.roots || req.body.scanMaxDepth !== undefined || req.body.showAllProjects !== undefined || req.body.suivi?.folder) await rescan();
  return publicSettings();
});

// ─── API : projets ──────────────────────────────────────────────────────────
function publicProject(p: Project) {
  const { env: _env, pathPrepend: _pp, serve, ...rest } = p;
  return { ...rest, serve: serve ? { command: [serve.command, ...serve.args].join(' '), fixedPort: serve.fixedPort, scriptPort: serve.scriptPort ?? null, noPort: !!serve.noPort } : null, hasVenv: !!p.env.VIRTUAL_ENV };
}

app.get('/api/projects', async () => {
  const sbConfigs = new Map(lastScan.supabaseConfigs.map((c) => [c.projectId, c]));
  const folders = await openEditorFolders().catch(() => []);
  const claude = assignSessions(await listClaudeSessions().catch(() => []), lastScan.projects.map((p) => p.dir));
  const codex = settings.agents.codex ? assignSessions(await listCodexSessions().catch(() => []), lastScan.projects.map((p) => p.dir)) : null;
  const running = assignSessions((await runningAgents().catch(() => [])).flatMap((a) => (a.cwd ? [{ ...a, cwd: a.cwd }] : [])), lastScan.projects.map((p) => p.dir));
  /** Sessions d'un agent et agents en cours (Tarmac ou ailleurs) dans le dossier d'un projet. */
  const agentInfo = (sessions: Map<string, { updatedAt: string }[]>, agent: AgentKind, dir: string) => {
    const list = sessions.get(dir) ?? [];
    // `active` : sessions en cours (Tarmac ou ailleurs), `working` : celles où un agent travaille.
    const live = (running.get(dir) ?? []).filter((a) => a.agent === agent);
    return { count: list.length, active: live.length, working: live.filter((a) => a.working).length, lastAt: list[0]?.updatedAt ?? null };
  };
  const ghPushed = new Map(cachedGithubRepos().map((r) => [r.key, r.pushedAt]));
  return Promise.all(
    lastScan.projects.map(async (p) => {
      const runtime = processes.summary(p.id);
      const port = p.serve?.noPort ? null : p.serve?.fixedPort ?? (p.serve ? state.assignedPorts[p.id] : null) ?? null;
      const idle = runtime.status === 'stopped' || runtime.status === 'crashed';
      // Serveur lancé hors de Tarmac (console, terminal, `pnpm dev` à la racine) : port attribué ou port du script en écoute.
      let external: { port: number; url: string } | null = null;
      if (idle && p.serve && !p.serve.noPort) {
        for (const candidate of [port, p.serve.scriptPort].filter((x): x is number => !!x)) {
          if (await isPortBusy(candidate)) { external = { port: candidate, url: `http://localhost:${candidate}` }; break; }
        }
      }
      return {
        ...publicProject(p),
        plannedPort: port,
        portBusy: !!external && external.port === port,
        external,
        repo: p.repoDir
          ? (() => {
            const git = gitCache.get(p.repoDir!) ?? null;
            const gh = git?.remoteKey ? ghPushed.get(git.remoteKey) ?? null : null;
            // Dernier push : reflog local ou, à défaut / si plus récent, pushed_at de l'API GitHub.
            const pushedAt = [git?.lastPushAt, gh].filter(Boolean).sort().at(-1) ?? null;
            return { relPath: displayPath(p.root, p.repoDir!), git, onGithub: !!git?.remoteKey?.startsWith('github.com/'), pushedAt };
          })()
          : null,
        supabase: p.supabaseProjectId ? { projectId: p.supabaseProjectId, ports: sbConfigs.get(p.supabaseProjectId)?.ports ?? {}, relPath: sbConfigs.get(p.supabaseProjectId)?.relPath ?? null } : null,
        suiviId: suiviIdOf(p.repoDir ?? p.dir),
        supabaseCli: (() => {
          const sb = supabaseDirOf(p);
          return sb && { relPath: displayPath(p.root, sb.dir), hasFolder: sb.hasFolder };
        })(),
        runtime,
        terminals: terminals.list(p.id),
        envFiles: listEnvFiles(p.dir),
        openIn: matchOpen(p.dir, folders),
        favorite: settings.favorites.includes(p.dir),
        claude: agentInfo(claude, 'claude', p.dir),
        // Codex : seulement s'il est coché dans Réglages → Agents.
        codex: codex ? agentInfo(codex, 'codex', p.dir) : null,
      };
    }),
  );
});

/** Favori (marqué sur la racine du projet). */
app.put<{ Params: { id: string }; Body: { on: boolean } }>('/api/projects/:id/favorite', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  updateSettings({ favorites: { [p.dir]: !!req.body?.on } });
  return { ok: true, favorite: !!req.body?.on };
});

/** URL de production saisie à la main (vide = revenir à la détection .env). */
app.put<{ Params: { id: string }; Body: { url: string } }>('/api/projects/:id/url', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  const { errors } = updateSettings({ urls: { [p.dir]: String(req.body?.url ?? '') } });
  if (errors.length) return reply.code(400).send({ error: errors.join(' · ') });
  await rescan();
  return { ok: true };
});

/** Renommer l'application (nom vide = revenir au nom détecté). */
app.put<{ Params: { id: string }; Body: { name: string } }>('/api/projects/:id/name', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  updateSettings({ names: { [p.dir]: String(req.body?.name ?? '') } });
  await rescan();
  return { ok: true };
});

app.get<{ Params: { id: string } }>('/api/projects/:id/logs', async (req) => processes.logs(req.params.id));

for (const action of ['start', 'stop', 'restart'] as const) {
  app.post<{ Params: { id: string } }>(`/api/projects/:id/${action}`, async (req, reply) => {
    const p = findProject(req.params.id);
    if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
    try {
      if (action === 'stop') {
        const rt = processes.summary(p.id);
        if (rt.status !== 'stopped' && rt.status !== 'crashed') return await processes.stop(p.id);
        // Pas géré par Tarmac : on arrête ce qui écoute sur le port de l'app.
        const ports = [p.serve?.fixedPort ?? state.assignedPorts[p.id], p.serve?.scriptPort].filter((x): x is number => !!x);
        for (const port of ports) if (await isPortBusy(port)) await killPort(port);
        return rt;
      }
      return action === 'start' ? await processes.start(p) : await processes.restart(p);
    } catch (e: any) {
      return reply.code(409).send({ error: e.message });
    }
  });
}

/**
 * Navigateur interne : la page du projet lancé peut-elle s'afficher dans un cadre ?
 * (X-Frame-Options ou CSP frame-ancestors). Seulement l'URL locale du projet, jamais une adresse fournie.
 */
app.get<{ Params: { id: string } }>('/api/projects/:id/frame-check', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  const url = processes.summary(p.id).url;
  if (!url || !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url)) return { url: null, frameable: false, reason: msg('api.notRunning') };
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(4000) });
    const xfo = r.headers.get('x-frame-options')?.toLowerCase() ?? '';
    const fa = r.headers.get('content-security-policy')?.match(/frame-ancestors([^;]*)/i)?.[1].trim().toLowerCase() ?? '';
    const blocked = xfo.includes('deny') || xfo.includes('sameorigin') || (!!fa && !fa.includes('*') && !/https?:\/\/(\*\.)?localhost/.test(fa));
    return { url, frameable: !blocked, reason: blocked ? tr({ en: 'The project does not allow being shown in a frame ({header}).', fr: 'Le projet interdit l’affichage dans un cadre ({header}).' }, { header: xfo ? `X-Frame-Options: ${xfo}` : `frame-ancestors ${fa}` }) : null };
  } catch {
    return { url, frameable: true, reason: null, pending: true };
  }
});

app.get<{ Params: { id: string } }>('/api/projects/:id/readme', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p?.readme) return reply.code(404).send({ error: msg('api.noReadme') });
  const content = await fs.promises.readFile(p.readme, 'utf8');
  const ext = path.extname(p.readme).toLowerCase();
  return { path: displayPath(p.root, p.readme), format: ext === '.rst' ? 'rst' : ext === '.txt' || !ext ? 'txt' : 'md', content: content.slice(0, 1_000_000) };
});

/** Images référencées par les README (chemins relatifs au projet uniquement). */
const ASSET_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif' };
app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/asset', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send();
  const base = p.readme ? path.dirname(p.readme) : p.dir;
  const file = path.resolve(base, req.query.path ?? '');
  const type = ASSET_TYPES[path.extname(file).toLowerCase()];
  if (!type || !(file.startsWith(p.dir + path.sep) || (p.repoDir && file.startsWith(p.repoDir + path.sep))) || !fs.existsSync(file)) return reply.code(404).send();
  reply.header('Content-Type', type).header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  return fs.createReadStream(file);
});

// ─── API : IDE (fichiers du projet) ─────────────────────────────────────────
type FsReq = { Params: { id: string }; Querystring: { path?: string } };
const fsError = (reply: any, e: any) => reply.code(e.statusCode ?? (e.code === 'ENOENT' ? 404 : 500)).send({ error: e.code === 'ENOENT' ? msg('api.fileNotFound') : e.message });

app.get<FsReq>('/api/projects/:id/fs/list', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  try { return await listDir(p.dir, req.query.path ?? ''); } catch (e) { return fsError(reply, e); }
});

app.get<FsReq>('/api/projects/:id/fs/file', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  try { return await readProjectFile(p.dir, req.query.path ?? ''); } catch (e) { return fsError(reply, e); }
});

app.get<FsReq>('/api/projects/:id/fs/stat', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  try { return await statFile(p.dir, req.query.path ?? ''); } catch (e) { return fsError(reply, e); }
});

/** Image du projet (aperçu dans l'IDE). */
app.get<FsReq>('/api/projects/:id/fs/raw', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send();
  try {
    const file = await resolveInside(p.dir, req.query.path ?? '');
    const type = ASSET_TYPES[path.extname(file).toLowerCase()];
    if (!type || !fs.existsSync(file)) return reply.code(404).send();
    reply.header('Content-Type', type).header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return fs.createReadStream(file);
  } catch (e) {
    return fsError(reply, e);
  }
});

app.put<{ Params: { id: string }; Body: { path: string; content: string; mtime?: number | null; force?: boolean } }>(
  '/api/projects/:id/fs/file',
  { bodyLimit: MAX_EDIT_BYTES * 2 },
  async (req, reply) => {
    const p = findProject(req.params.id);
    if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
    const { path: rel, content, mtime = null, force = false } = req.body ?? ({} as any);
    if (typeof rel !== 'string' || !rel || typeof content !== 'string') return reply.code(400).send({ error: msg('api.badRequest') });
    try { return await writeProjectFile(p.dir, rel, content, mtime, force); } catch (e) { return fsError(reply, e); }
  },
);

// ─── API : Source Control de l'IDE ──────────────────────────────────────────
const scmProject = (id: string, reply: any) => {
  const p = findProject(id);
  if (!p) return void reply.code(404).send({ error: msg('api.unknownProject') });
  if (!p.repoDir) return void reply.code(404).send({ error: msg('api.notGitRepo') });
  return p;
};
const scmError = (reply: any, e: any) => reply.code(e.statusCode ?? 500).send({ error: e.message });

app.get<{ Params: { id: string } }>('/api/projects/:id/scm', async (req, reply) => {
  const p = scmProject(req.params.id, reply);
  if (!p) return;
  try { return await scmStatus(p.dir); } catch (e) { return scmError(reply, e); }
});

app.get<{ Params: { id: string } }>('/api/projects/:id/scm/log', async (req, reply) => {
  const p = scmProject(req.params.id, reply);
  if (!p) return;
  try { return await scmLog(p.dir); } catch (e) { return scmError(reply, e); }
});

app.get<{ Params: { id: string }; Querystring: { path?: string; from?: string } }>('/api/projects/:id/scm/show', async (req, reply) => {
  const p = scmProject(req.params.id, reply);
  if (!p) return;
  try { return await scmShow(p.dir, req.query.path ?? '', req.query.from === 'INDEX' ? 'INDEX' : 'HEAD'); } catch (e) { return scmError(reply, e); }
});

app.post<{ Params: { id: string; action: string }; Body: ScmActionBody }>('/api/projects/:id/scm/:action', async (req, reply) => {
  const p = scmProject(req.params.id, reply);
  if (!p) return;
  if (!SCM_ACTIONS.includes(req.params.action as ScmAction)) return reply.code(400).send({ error: msg('api.unknownAction') });
  try {
    const r = await scmAction(p.dir, req.params.action as ScmAction, req.body ?? {});
    // Avance / retard des badges du tableau de bord.
    if (['commit', 'push', 'pull', 'sync', 'fetch'].includes(req.params.action)) gitStatus(p.repoDir!).then((g) => { gitCache.set(p.repoDir!, g); broadcast({ type: 'scan', at: lastScan.scannedAt }); }).catch(() => null);
    return r;
  } catch (e) {
    return scmError(reply, e);
  }
});

// ─── API : variables d'environnement (.env* à la racine) ────────────────────
app.get<{ Params: { id: string }; Querystring: { file?: string } }>('/api/projects/:id/env', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  try {
    return { files: listEnvFiles(p.dir), lines: readEnvFile(p.dir, req.query.file ?? '.env') };
  } catch (e: any) {
    return reply.code(e.statusCode ?? 500).send({ error: e.message });
  }
});

// ─── API : consoles ─────────────────────────────────────────────────────────
app.get<{ Params: { id: string } }>('/api/projects/:id/terminals', async (req) => terminals.list(req.params.id));

app.post<{ Params: { id: string }; Body: { commandId?: string; shell?: boolean; cols?: number; rows?: number } }>(
  '/api/projects/:id/terminals',
  async (req, reply) => {
    const p = findProject(req.params.id);
    if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
    const { commandId, shell, cols, rows } = req.body ?? {};
    let command: string | null = null;
    let label = path.basename(process.env.SHELL || 'zsh');
    if (!shell) {
      const c = p.commands.find((x) => x.id === (commandId ?? p.defaultCommand));
      if (!c) return reply.code(400).send({ error: msg('api.unknownCommand') });
      command = c.cmd;
      label = c.label;
    }
    try {
      return await terminals.create(p, { command, label, cols, rows, projectName: p.name });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  },
);
app.get('/api/terminals', async () => terminals.list());

/** Agents cochés dans Réglages → Agents (Claude d'abord). */
const enabledAgents = (): AgentKind[] => (['claude', 'codex'] as const).filter((a) => settings.agents[a]);

// « Envoyer à Claude / Codex » : sessions d'agent des consoles de Tarmac rattachées aux dossiers d'un projet de suivi.
let claudeTitles = new Map<string, string>();
let codexTitles = new Map<string, string>();
const suiviDispatcher = new SuiviDispatcher({
  service: suivi,
  appProjects: () => lastScan.projects.map((p) => ({ id: p.id, dir: p.dir })),
  consoles: () => {
    // Titres des sessions (/rename, résumé) rafraîchis en arrière-plan (cache de 8 s des listes de sessions).
    if (settings.agents.claude) listClaudeSessions().then((all) => { claudeTitles = new Map(all.filter((x) => x.titleSource === 'custom' || x.titleSource === 'summary').map((x) => [x.id, x.title])); }).catch(() => {});
    if (settings.agents.codex) runningAgents().then(() => listCodexSessions()).then((all) => { codexTitles = new Map(all.filter((x) => x.titleSource === 'custom').map((x) => [x.id, x.title])); }).catch(() => {});
    return terminals.list();
  },
  sessionTitle: (id, agent) => (agent === 'codex' ? codexTitles : claudeTitles).get(id) ?? null,
  write: (id, data) => terminals.write(id, data),
  screen: (id) => terminals.screen(id),
  turn: (id, agent) => (agent === 'codex' ? codexTurnState(id) : claudeTurnState(id)),
  agents: enabledAgents,
  openSession: async (appProjectId, prompt, agent) => {
    const p = findProject(appProjectId);
    if (!p) throw Object.assign(new Error(msg('api.unknownProject')), { statusCode: 404 });
    return agent === 'codex' ? openCodexConsole(p, { prompt }) : openClaudeConsole(p, { prompt });
  },
  lang: uiLang,
});
registerSuiviRoutes(app, suivi, { token: (kind) => suiviToken(kind, config.dataDir), watcher: todolists, allowDir: inRoots, bridgeIntervalSec: () => settings.suivi.bridgeIntervalSec,
  sync: new SyncRunner(suivi, (job) => broadcast({ type: 'suivi:sync', projectId: job.projectId, job })), dispatcher: suiviDispatcher });

// ─── Menu git de la console ─────────────────────────────────────────────────
app.get('/api/git/commands', async () => GIT_COMMANDS.map(({ cmd: _c, ...rest }) => ({ ...rest, preview: _c })));

app.post<{ Params: { id: string }; Body: { command: string; arg?: string; cols?: number; rows?: number } }>('/api/projects/:id/git', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  if (!p.repoDir) return reply.code(400).send({ error: msg('api.notGitRepo') });
  let built;
  try {
    built = buildGitCommand(req.body?.command, req.body?.arg);
  } catch (e: any) {
    return reply.code(400).send({ error: e.message });
  }
  try {
    return await terminals.create(p, {
      command: built.shell,
      label: built.cmd.label,
      kind: 'command',
      projectName: p.name,
      cols: req.body?.cols,
      rows: req.body?.rows,
    });
  } catch (e: any) {
    return reply.code(500).send({ error: e.message });
  }
});

// ─── Menu Supabase des consoles ─────────────────────────────────────────────
app.get('/api/supabase/commands', async () => SUPABASE_COMMANDS.map(({ cmd: _c, ...rest }) => ({ ...rest, preview: _c })));

app.post<{ Params: { id: string }; Body: { command: string; arg?: string; cols?: number; rows?: number } }>('/api/projects/:id/supabase', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  const cfg = supabaseDirOf(p);
  if (!cfg) return reply.code(400).send({ error: msg('api.noSupabase') });
  let built;
  try {
    built = buildSupabaseCommand(req.body?.command, req.body?.arg, cfg.dir);
  } catch (e: any) {
    return reply.code(400).send({ error: e.message });
  }
  try {
    return await terminals.create({ ...p, dir: cfg.dir }, {
      command: built.shell,
      label: built.cmd.label,
      kind: 'command',
      projectName: p.name,
      cols: req.body?.cols,
      rows: req.body?.rows,
    });
  } catch (e: any) {
    return reply.code(500).send({ error: e.message });
  }
});

/** Branches (locales puis distantes) pour l'autocomplétion de switch / merge. */
app.get<{ Params: { id: string } }>('/api/projects/:id/git/branches', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p?.repoDir) return reply.code(404).send({ error: msg('api.noGitRepo') });
  try {
    const { stdout } = await exec('git', ['branch', '-a', '--format=%(refname:short)'], { cwd: p.repoDir, timeout: 5000 });
    const names = stdout.split('\n').map((s) => s.trim()).filter((s) => s && !s.endsWith('/HEAD') && s !== 'origin');
    return [...new Set(names.map((n) => n.replace(/^origin\//, '')))];
  } catch {
    return [];
  }
});

// Commande git terminée → statut git rafraîchi (badges, filtre GitHub).
terminals.on('exit', (_sid: string, projectId: string) => {
  const p = findProject(projectId);
  if (p?.repoDir) gitStatus(p.repoDir).then((g) => { gitCache.set(p.repoDir!, g); broadcast({ type: 'scan', at: lastScan.scannedAt }); });
});

// ─── Sessions Claude Code ───────────────────────────────────────────────────
const withTerminal = <T extends { id: string }>(s: T) => ({ ...s, terminalId: terminals.findByClaude(s.id) });

/** Sessions d'un projet : son dossier et tous ses sous-dossiers (une racine de groupe voit tout le groupe). */
app.get<{ Params: { id: string }; Querystring: { force?: string } }>('/api/projects/:id/claude-sessions', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  const all = await listClaudeSessions(req.query.force === '1');
  return all.filter((s) => s.cwd === p.dir || s.cwd.startsWith(p.dir + path.sep)).map(withTerminal);
});

// Utilisation de l'abonnement Claude : plan, limites et remises à zéro (jamais le jeton, voir claudeUsage.ts).
const claudeUsage = new ClaudeUsageService({
  readCredentials,
  fetch: (url, init) => fetch(url, init),
  now: Date.now,
  demo: () => { const d = demo(); return d ? demoClaudeUsage(d) : null; },
  enabled: () => settings.showClaudeUsage,
});
app.get('/api/claude/usage', async () => claudeUsage.get());

// ─── Sessions Codex (ChatGPT), si Codex est coché ───────────────────────────
const withCodexTerminal = <T extends { id: string }>(s: T) => ({ ...s, terminalId: terminals.findByCodex(s.id) });

app.get<{ Params: { id: string }; Querystring: { force?: string } }>('/api/projects/:id/codex-sessions', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  if (!settings.agents.codex) return [];
  await runningAgents().catch(() => []); // consoles Codex de Tarmac rattachées à leur session
  const all = await listCodexSessions(req.query.force === '1');
  return all.filter((s) => s.cwd === p.dir || s.cwd.startsWith(p.dir + path.sep)).map(withCodexTerminal);
});

app.get('/api/codex/sessions', async () => {
  if (!settings.agents.codex) return [];
  await runningAgents().catch(() => []);
  const all = await listCodexSessions();
  const projectOf = projectsOf(all, (s) => s.id);
  return all.map((s) => ({ ...withCodexTerminal(s), project: projectOf.get(s.id) ?? null }));
});

/**
 * Utilisation du plan ChatGPT pour Codex : dernières limites enregistrées par Codex dans ses transcripts locaux
 * (aucun réseau, aucun jeton lu ; voir readCodexUsage). Rien si Codex n'est pas coché ou si l'affichage est coupé.
 */
let codexUsageMemo: { at: number; u: CodexUsage } | null = null;
app.get('/api/codex/usage', async (): Promise<CodexUsage> => {
  if (!settings.agents.codex || !settings.showCodexUsage) return { status: 'disabled', plan: null, limits: [], fetchedAt: null };
  if (codexUsageMemo && Date.now() - codexUsageMemo.at < 30_000) return codexUsageMemo.u;
  let u: CodexUsage;
  try { u = readCodexUsage(); } catch { u = { status: 'error', plan: null, limits: [], fetchedAt: null }; }
  codexUsageMemo = { at: Date.now(), u };
  return u;
});

/** Nom affiché d'un projet (« Groupe › app » pour une app d'un groupe). */
const projectLabel = (p: Project) => {
  const child = p.name === p.group.name ? p.techName : p.name;
  return { id: p.id, name: p.group.isRoot || p.group.type === 'single' ? p.name : `${p.group.name} › ${child}` };
};
/** Projet le plus profond qui contient chaque élément (par son `cwd`). */
function projectsOf<T extends { cwd: string }>(items: T[], key: (x: T) => string) {
  const out = new Map<string, { id: string; name: string }>();
  for (const [dir, list] of assignSessions(items, lastScan.projects.map((p) => p.dir))) {
    const p = lastScan.projects.find((x) => x.dir === dir)!;
    for (const x of list) out.set(key(x), projectLabel(p));
  }
  return out;
}

app.get('/api/claude/sessions', async () => {
  const all = await listClaudeSessions();
  const projectOf = projectsOf(all, (s) => s.id);
  return all.map((s) => ({ ...withTerminal(s), project: projectOf.get(s.id) ?? null }));
});

// ─── Agents en cours (Tarmac et ailleurs) ───────────────────────────────────
/** Sessions d'agent en cours, rattachées à leur session, console de Tarmac et sous-agents (voir agents.ts). */
async function runningAgents(): Promise<RunningAgent[]> {
  const { claude, codex } = settings.agents;
  const [cProcs, cSessions, xProcs, xSessions] = await Promise.all([
    claude ? claudeProcs().catch(() => []) : [],
    claude ? listClaudeSessions().catch(() => []) : [],
    codex ? codexProcs().catch(() => []) : [],
    codex ? listCodexSessions().catch(() => []) : [],
  ]);
  const dirOf = new Map(lastScan.projects.map((p) => [p.id, p.dir]));
  const kinds = new Set<string>(enabledAgents());
  const list = buildRunningAgents({
    procs: [...cProcs, ...xProcs],
    sessions: [...cSessions, ...xSessions],
    terminals: terminals.list().filter((t) => !['claude', 'codex'].includes(t.kind) || kinds.has(t.kind)).map((t) => ({ ...t, cwd: dirOf.get(t.projectId) ?? null })),
    turn: (id, agent) => (agent === 'codex' ? codexTurnState(id) : claudeTurnState(id)),
    transcriptOf: (id, agent) => (agent === 'codex' ? codexTranscriptFile(id) : transcriptFile(id)),
  });
  // Console Codex de Tarmac : sa session est connue dès que le process est rattaché à son transcript (reprise,
  // « Relancer », titre dans ▶).
  for (const a of list) if (a.agent === 'codex' && a.terminalId && a.sessionId) terminals.setCodexSession(a.terminalId, a.sessionId);
  return list;
}

app.get('/api/agents/running', async () => {
  const list = await runningAgents();
  const projectOf = projectsOf(list.flatMap((a) => (a.cwd ? [{ ...a, cwd: a.cwd }] : [])), (a) => a.key);
  return list.map((a) => ({ ...a, project: projectOf.get(a.key) ?? null }));
});

// ─── Timeline de tous les projets ───────────────────────────────────────────
const repoEvents = new RepoEventsCache();
let timelineMemo: { at: number; events: TimelineEvent[] } | null = null;
let timelineRun: Promise<TimelineEvent[]> | null = null;

/** Projet qui représente un dépôt : celui de sa racine, sinon la racine du groupe, sinon la première app. */
function repoProject(dir: string): Project | undefined {
  const inRepo = lastScan.projects.filter((p) => (p.repoDir ?? p.dir) === dir);
  return inRepo.find((p) => p.dir === dir) ?? inRepo.find((p) => p.group.isRoot) ?? inRepo[0];
}

async function computeTimeline(): Promise<TimelineEvent[]> {
  const since = Date.now() - TIMELINE_DAYS * 86_400_000;
  const repos: TimelineRepo[] = lastScan.repos.map((r) => {
    const p = repoProject(r.dir);
    return { dir: r.dir, projectId: p?.id ?? null, projectName: p ? projectLabel(p).name : r.name };
  });
  repoEvents.retain(repos.map((r) => r.dir));
  const git = await pool(repos, 6, (r) => repoEvents.events(r, since).catch(() => []));

  const sessions = [
    ...(settings.agents.claude ? (await listClaudeSessions().catch(() => [])).map((s) => ({ ...s, agent: 'claude' as const })) : []),
    ...(settings.agents.codex ? await listCodexSessions().catch(() => []) : []),
  ].filter((s) => s.createdAt && Date.parse(s.createdAt) >= since);
  const sessionProject = projectsOf(sessions, (s) => `${s.agent}:${s.id}`);
  const sessionEvents: TimelineEvent[] = sessions.map((s) => {
    const p = sessionProject.get(`${s.agent}:${s.id}`);
    return { id: `session:${s.agent}:${s.id}`, type: 'session', at: s.createdAt!, projectId: p?.id ?? null, projectName: p?.name ?? path.basename(s.cwd), text: s.title, agent: s.agent, sessionId: s.id, branch: s.gitBranch };
  });

  const taskEvents: TimelineEvent[] = [];
  const sinceIso = new Date(since).toISOString();
  for (const sp of suivi.projects()) {
    const candidates = lastScan.projects.filter((p) => sp.paths.includes(p.repoDir ?? p.dir));
    const p = candidates.find((x) => sp.paths.includes(x.dir)) ?? candidates[0];
    const where = { projectId: p?.id ?? null, projectName: p ? projectLabel(p).name : sp.name };
    const tasks = new Map(suivi.tasks(sp.projectId).map((t) => [t.id, t]));
    const ev = (t: ReturnType<typeof suivi.tasks>[number], status: 'created' | 'toTest' | 'done', at: string): TimelineEvent =>
      ({ id: `task:${sp.projectId}:${t.id}:${status}`, type: 'task', at, ...where, text: t.title, task: { suiviId: sp.projectId, taskId: t.id, num: t.num, status } });
    for (const t of tasks.values()) {
      if (t.createdAt && t.createdAt >= sinceIso) taskEvents.push(ev(t, 'created', t.createdAt));
      if (t.done && t.doneAt && t.doneAt >= sinceIso) taskEvents.push(ev(t, 'done', t.doneAt));
    }
    for (const x of suivi.toTestSince(sp.projectId, sinceIso)) {
      const t = tasks.get(x.taskId);
      if (t && !t.done) taskEvents.push(ev(t, 'toTest', x.at));
    }
  }
  return mergeTimeline([...git, sessionEvents, taskEvents], since);
}

/** Timeline (calcul paresseux, mémorisé 15 s ; git relu seulement pour les dépôts qui ont changé). */
app.get('/api/timeline', async () => {
  if (timelineMemo && Date.now() - timelineMemo.at < 15_000) return { events: timelineMemo.events, days: TIMELINE_DAYS };
  timelineRun ??= computeTimeline().then((events) => ((timelineMemo = { at: Date.now(), events }), events)).finally(() => (timelineRun = null));
  return { events: await timelineRun, days: TIMELINE_DAYS };
});

/**
 * Ouvre une session Claude Code (Remote Control) dans une console de Tarmac : nouvelle ou reprise.
 * Erreur avec `statusCode` (400 : identifiant invalide ou CLI absente).
 */
async function openClaudeConsole(p: Project, opts: { resume?: string; prompt?: string; cols?: number; rows?: number }) {
  const { resume, cols, rows } = opts;
  let prompt = typeof opts.prompt === 'string' ? opts.prompt.trim().slice(0, 4000) : undefined;
  // `/suivi …` avant l'installation du skill (scripts/suivi-install.sh) : Claude lit le skill du dépôt de Tarmac.
  if (prompt?.startsWith('/suivi') && !fs.existsSync(path.join(claudeDir(), 'skills', 'suivi', 'SKILL.md'))) {
    const skill = path.join(APP_ROOT, 'claude', 'skills', 'suivi', 'SKILL.md');
    prompt = `The /suivi skill (Claude Todolist) is not installed in ~/.claude yet: read ${skill} and apply it to run "${prompt}" on this project. Answer in the user's language.`;
  }
  if (resume) {
    if (!/^[0-9a-f-]{8,64}$/i.test(resume)) throw Object.assign(new Error(msg('api.badSessionId')), { statusCode: 400 });
    const open = terminals.findByClaude(resume);
    if (open) return terminals.list().find((t) => t.id === open)!;
  }
  try {
    if (!isDemo()) await exec('/bin/sh', ['-c', 'command -v claude'], { env: process.env, timeout: 3000 });
  } catch {
    throw Object.assign(new Error(msg('api.noClaudeCli')), { statusCode: 400 });
  }
  const displayName = p.group.isRoot || p.group.type === 'single' ? p.name : `${p.group.name} · ${p.name === p.group.name ? p.techName : p.name}`;
  const sessionId = resume ?? crypto.randomUUID();
  const sessions = resume ? await listClaudeSessions() : [];
  const title = sessions.find((s) => s.id === resume)?.title;
  // Mode démo : `claude` résolu vers le faux Claude Code des fixtures (jamais le vrai).
  const d = demo();
  const target = d ? { ...p, pathPrepend: [demoBinDir(d, 'claude'), ...p.pathPrepend] } : p;
  return terminals.create(target, {
    command: claudeCommand(resume ? { resume } : { sessionId, name: displayName, prompt }),
    label: resume ? (title ?? tr({ en: 'Resumed session', fr: 'Session reprise' })) : `Claude · ${displayName}`,
    kind: 'claude',
    projectName: displayName,
    claudeSessionId: sessionId,
    cols,
    rows,
    // Remote Control est désactivé si l'une de ces variables est présente.
    unsetEnv: ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_GROWTHBOOK', 'DISABLE_TELEMETRY', 'DO_NOT_TRACK'],
  });
}

app.post<{ Params: { id: string }; Body: { resume?: string; prompt?: string; cols?: number; rows?: number } }>('/api/projects/:id/claude', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  try {
    return await openClaudeConsole(p, req.body ?? {});
  } catch (e: any) {
    return reply.code(e.statusCode ?? 500).send({ error: e.message });
  }
});

/**
 * Ouvre une session Codex dans une console de Tarmac : nouvelle (premier message facultatif) ou reprise
 * (`codex resume <id>`). Seulement si Codex est coché dans Réglages → Agents. Erreur avec `statusCode`.
 */
async function openCodexConsole(p: Project, opts: { resume?: string; prompt?: string; cols?: number; rows?: number }) {
  if (!settings.agents.codex) throw Object.assign(new Error(msg('api.agentDisabled')), { statusCode: 400 });
  const { resume, cols, rows } = opts;
  let prompt = typeof opts.prompt === 'string' ? opts.prompt.trim().slice(0, 4000) : undefined;
  // `$suivi …` avant l'installation du skill pour Codex (tarmac setup) : Codex lit le skill du dépôt de Tarmac.
  const skillHome = path.join(os.homedir(), '.agents', 'skills', 'suivi', 'SKILL.md');
  if (prompt && /^[$/]suivi\b/.test(prompt) && !fs.existsSync(skillHome)) {
    const skill = path.join(APP_ROOT, 'codex', 'skills', 'suivi', 'SKILL.md');
    prompt = `The $suivi skill (Todolist) is not installed for Codex yet: read ${skill} and apply it to run "${prompt.replace(/^\//, '$')}" on this project. Answer in the user's language.`;
  }
  if (resume) {
    if (!/^[0-9a-f-]{8,64}$/i.test(resume)) throw Object.assign(new Error(msg('api.badSessionId')), { statusCode: 400 });
    const open = terminals.findByCodex(resume);
    if (open) return terminals.list().find((t) => t.id === open)!;
  }
  try {
    if (!isDemo()) await exec('/bin/sh', ['-c', 'command -v codex'], { env: process.env, timeout: 3000 });
  } catch {
    throw Object.assign(new Error(msg('api.noCodexCli')), { statusCode: 400 });
  }
  const displayName = p.group.isRoot || p.group.type === 'single' ? p.name : `${p.group.name} · ${p.name === p.group.name ? p.techName : p.name}`;
  const title = resume ? (await listCodexSessions()).find((s) => s.id === resume)?.title : undefined;
  // Mode démo : `codex` résolu vers le faux Codex des fixtures (jamais le vrai).
  const d = demo();
  const target = d ? { ...p, pathPrepend: [demoBinDir(d, 'codex'), ...p.pathPrepend] } : p;
  return terminals.create(target, {
    command: codexCommand(resume ? { resume } : { prompt }),
    label: resume ? (title ?? tr({ en: 'Resumed session', fr: 'Session reprise' })) : `Codex · ${displayName}`,
    kind: 'codex',
    projectName: displayName,
    codexSessionId: resume ?? null,
    cols,
    rows,
  });
}

app.post<{ Params: { id: string }; Body: { resume?: string; prompt?: string; cols?: number; rows?: number } }>('/api/projects/:id/codex', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  try {
    return await openCodexConsole(p, req.body ?? {});
  } catch (e: any) {
    return reply.code(e.statusCode ?? 500).send({ error: e.message });
  }
});

app.post<{ Params: { sid: string } }>('/api/terminals/:sid/kill', async (req) => (terminals.kill(req.params.sid), { ok: true }));
app.delete<{ Params: { sid: string } }>('/api/terminals/:sid', async (req) => (terminals.close(req.params.sid), { ok: true }));

// ─── API : Supabase, GitHub, ports ──────────────────────────────────────────
app.get('/api/supabase', async () => {
  const res = await listSupabase();
  const cfg = new Map(lastScan.supabaseConfigs.map((c) => [c.projectId, c]));
  return {
    ...res,
    instances: res.instances.map((i) => ({
      ...i,
      localPath: cfg.get(i.projectId)?.relPath ?? null,
      localDir: cfg.get(i.projectId)?.dir ?? null,
      apps: lastScan.projects.filter((p) => p.supabaseProjectId === i.projectId).map((p) => ({ id: p.id, name: p.name })),
    })),
    notCreated: lastScan.supabaseConfigs
      .filter((c) => !res.instances.some((i) => i.projectId === c.projectId))
      .map((c) => ({ projectId: c.projectId, localPath: c.relPath, localDir: c.dir, ports: c.ports })),
  };
});

// ─── API : Docker ───────────────────────────────────────────────────────────
// Lecture : moteur, conteneurs, stats (sondées par l'UI seulement quand la vue est affichée).
// Actions : liste blanche start / stop / restart, identifiant ou projet compose vérifiés dans la liste du moteur.
setDockerProjects(() => lastScan.projects);
app.get('/api/docker', async () => dockerOverview());
app.get('/api/docker/stats', async () => dockerStats());
const dockerFail = (reply: FastifyReply, e: any) => {
  if (e.code === 'ENOTFOUND') return reply.code(404).send({ error: msg('api.dockerUnknownContainer') });
  if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') return reply.code(503).send({ error: msg('api.dockerUnavailable') });
  if (e.code === 'ENOAPP') return reply.code(404).send({ error: msg('api.dockerNoApp') });
  return reply.code(502).send({ error: msg('api.dockerFailed', { error: e.message }) });
};
app.post<{ Params: { id: string; action: string } }>('/api/docker/containers/:id/:action', async (req, reply) => {
  const { id, action } = req.params;
  if (!isDockerAction(action)) return reply.code(400).send({ error: msg('api.unknownAction') });
  if (!isContainerId(id)) return reply.code(400).send({ error: msg('api.badRequest') });
  try { return await dockerAct(action, { id }); } catch (e) { return dockerFail(reply, e); }
});
app.post<{ Params: { group: string; action: string } }>('/api/docker/groups/:group/:action', async (req, reply) => {
  const { group, action } = req.params;
  if (!isDockerAction(action)) return reply.code(400).send({ error: msg('api.unknownAction') });
  if (!isComposeProject(group)) return reply.code(400).send({ error: msg('api.badRequest') });
  try { return await dockerAct(action, { group }); } catch (e) { return dockerFail(reply, e); }
});
app.post('/api/docker/open', async (_req, reply) => {
  try { return await openDockerApp(); } catch (e) { return dockerFail(reply, e); }
});

app.get<{ Querystring: { force?: string } }>('/api/github', async (req, reply) => {
  try {
    const gh = await listGithubRepos(req.query.force === '1');
    const local = new Map<string, { relPath: string; dir: string; git: GitStatus }>();
    for (const r of lastScan.repos) {
      const g = gitCache.get(r.dir);
      if (g?.remoteKey) local.set(g.remoteKey, { relPath: r.relPath, dir: r.dir, git: g });
    }
    const remoteKeys = new Set(gh.repos.map((r) => r.key));
    return {
      configured: gh.configured,
      login: gh.login,
      owners: settings.github.owners,
      fetchedAt: new Date(gh.at).toISOString(),
      remoteOnly: gh.repos.filter((r) => !local.has(r.key)),
      cloned: gh.repos.filter((r) => local.has(r.key)).map((r) => ({ ...r, local: local.get(r.key)! })),
      localOnly: lastScan.repos
        .map((r) => ({ relPath: r.relPath, dir: r.dir, git: gitCache.get(r.dir) ?? null }))
        .filter((r) => !r.git?.remoteKey || !remoteKeys.has(r.git.remoteKey)),
    };
  } catch (e: any) {
    return reply.code(502).send({ error: e.message });
  }
});

// ─── Clonage d'un repo GitHub dans le dossier de clonage ────────────────────
const CLONE_PREFIX = '__clone__:';

app.post<{ Body: { fullName: string; cols?: number; rows?: number } }>('/api/github/clone', async (req, reply) => {
  const fullName = String(req.body?.fullName ?? '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return reply.code(400).send({ error: msg('api.badRepo') });
  const repo = cachedGithubRepos().find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
  const name = fullName.split('/')[1];
  const dest = path.join(settings.cloneDir, name);
  if (fs.existsSync(dest)) return reply.code(409).send({ error: msg('api.alreadyExists', { path: dest }) });
  // Déjà en cours ?
  const running = terminals.list(CLONE_PREFIX + fullName).find((t) => t.status === 'running');
  if (running) return running;

  // `gh repo clone` réutilise l'authentification de la CLI (repos privés) ; sinon git clone en SSH.
  // Mode démo : faux `gh` (sans réseau) en tête du PATH.
  const st = await ghCliStatus();
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  // Destination sous le dossier personnel écrite `~/…` (développé par le shell) : chemin court dans la console.
  const home = os.homedir();
  const qDest = dest.startsWith(home + path.sep) ? `~/${q(dest.slice(home.length + 1))}` : q(dest);
  const d = demo();
  const command = st.loggedIn || d
    ? `gh repo clone ${q(fullName)} ${qDest}`
    : `git clone ${q(repo?.sshUrl ?? `git@github.com:${fullName}.git`)} ${qDest}`;
  try {
    return await terminals.create(
      { id: CLONE_PREFIX + fullName, dir: settings.cloneDir, env: {}, pathPrepend: d ? [demoBinDir(d, 'gh')] : [] },
      { command, label: tr({ en: 'Cloning {repo}', fr: 'Clonage de {repo}' }, { repo: fullName }), kind: 'system', projectName: fullName, cols: req.body?.cols, rows: req.body?.rows },
    );
  } catch (e: any) {
    return reply.code(500).send({ error: e.message });
  }
});

// Clonage terminé → rescan : le repo passe dans « Clonés » et ses apps apparaissent dans Projets.
terminals.on('exit', (_sid: string, projectId: string, code: number) => {
  if (projectId.startsWith(CLONE_PREFIX) && code === 0) rescan().then(() => fetchAll());
});

// ─── CLI GitHub (`gh`) ──────────────────────────────────────────────────────
async function ghCliStatus() {
  const d = demo();
  if (d) return d.ghCli;
  try {
    await exec('gh', ['--version'], { timeout: 5000 });
  } catch {
    return { installed: false, loggedIn: false, user: null as string | null };
  }
  try {
    const { stdout, stderr } = await exec('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 8000 });
    const txt = stdout + stderr;
    return { installed: true, loggedIn: true, user: txt.match(/account (\S+)/)?.[1] ?? txt.match(/as (\S+)/)?.[1] ?? null };
  } catch {
    return { installed: true, loggedIn: false, user: null };
  }
}

app.get('/api/github/cli', async () => ghCliStatus());

/** Lance `gh auth login` (flux navigateur + code à usage unique) dans une console système. */
app.post<{ Body: { cols?: number; rows?: number } }>('/api/github/cli/login', async (req, reply) => {
  if (isDemo()) return reply.code(400).send({ error: msg('api.demoMode') });
  const st = await ghCliStatus();
  if (!st.installed) return reply.code(400).send({ error: msg('api.noGhCli') });
  try {
    return await terminals.create(
      { id: SYSTEM_ID, dir: os.homedir(), env: {}, pathPrepend: [] },
      {
        command: 'gh auth login --hostname github.com --git-protocol https --web',
        label: 'gh auth login',
        // gh refuse de stocker un token si GH_TOKEN / GITHUB_TOKEN est défini dans l'environnement.
        unsetEnv: ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN'],
        cols: req.body?.cols,
        rows: req.body?.rows,
      },
    );
  } catch (e: any) {
    return reply.code(500).send({ error: e.message });
  }
});

// Fin d'une connexion gh → le cache GitHub est invalidé pour utiliser le nouveau token.
terminals.on('change', (projectId: string) => {
  if (projectId === SYSTEM_ID) invalidateGithubCache();
});

// ─── Émulateur Android ──────────────────────────────────────────────────────
const ANDROID_ID = '__android__';

app.get('/api/android', async () => androidStatus());

/** Installation d'un prérequis dans une console système (commande choisie côté serveur). */
app.post<{ Body: { id: string; cols?: number; rows?: number } }>('/api/android/install', async (req, reply) => {
  if (isDemo()) return reply.code(400).send({ error: msg('api.demoMode') });
  const command = installCommand(String(req.body?.id ?? ''));
  if (!command) return reply.code(400).send({ error: msg('api.unknownPrereq') });
  try {
    return await terminals.create(
      { id: ANDROID_ID, dir: os.homedir(), env: {}, pathPrepend: [] },
      { command, label: tr({ en: 'Android: {id}', fr: 'Android : {id}' }, { id: req.body.id }), kind: 'system', projectName: 'Android', cols: req.body?.cols, rows: req.body?.rows },
    );
  } catch (e: any) {
    return reply.code(500).send({ error: e.message });
  }
});

app.post<{ Params: { name: string }; Body: { cold?: boolean } }>('/api/android/avds/:name/start', async (req, reply) => {
  if (!isAvd(req.params.name)) return reply.code(404).send({ error: msg('api.unknownAvd') });
  try {
    await startAvd(req.params.name, !!req.body?.cold);
    return { ok: true };
  } catch (e: any) {
    return reply.code(500).send({ error: e.message });
  }
});

app.post<{ Params: { name: string } }>('/api/android/avds/:name/stop', async (req, reply) => {
  if (!isAvd(req.params.name)) return reply.code(404).send({ error: msg('api.unknownAvd') });
  await stopAvd(req.params.name);
  return { ok: true };
});

/** Projet mobile : démarre un émulateur si besoin, attend le boot, puis lance l'app sur Android. */
app.post<{ Params: { id: string }; Body: { cols?: number; rows?: number } }>('/api/projects/:id/android', async (req, reply) => {
  const p = findProject(req.params.id);
  if (!p) return reply.code(404).send({ error: msg('api.unknownProject') });
  const script = p.commands.find((c) => c.id === 'script:android');
  const run = script?.cmd ?? (p.framework?.id === 'react-native' ? 'npx react-native run-android' : 'npx expo start --android');
  if (isDemo()) return reply.code(400).send({ error: msg('api.demoMode') });
  try {
    const avd = await ensureEmulator();
    return await terminals.create(p, {
      command: `${waitForBootCommand()} && ${run}`,
      label: `Android (${avd})`,
      projectName: p.name,
      cols: req.body?.cols,
      rows: req.body?.rows,
    });
  } catch (e: any) {
    return reply.code(500).send({ error: e.message });
  }
});

app.get('/api/ports', async () => ({
  range: settings.portRange,
  assigned: Object.entries(state.assignedPorts).map(([appId, port]) => ({
    appId, port, appName: lastScan.projects.find((p) => p.id === appId)?.name ?? appId,
  })),
  history: [...state.portHistory].reverse().slice(0, 200),
}));

app.post('/api/ports/free', async () => {
  await processes.stopAll();
  const report = await freeHistoryPorts();
  processes.reconcile();
  return { report };
});

app.post('/api/scan', async () => {
  await rescan();
  return { ok: true, scannedAt: lastScan.scannedAt };
});

app.post('/api/git/fetch', async () => {
  await fetchAll();
  return { ok: true, lastFetchAt };
});

// ─── Ouverture dans l'éditeur / le Finder (macOS) ──────────────────────────
const EDITORS: Record<string, { app: string; cli: string }> = {
  vscode: { app: 'Visual Studio Code', cli: 'code' },
  cursor: { app: 'Cursor', cli: 'cursor' },
  zed: { app: 'Zed', cli: 'zed' },
  webstorm: { app: 'WebStorm', cli: 'webstorm' },
};

app.post<{ Body: { dir: string; with: 'finder' | 'editor' | 'terminal' } }>('/api/open', async (req, reply) => {
  const dir = path.resolve(req.body.dir);
  if (!inRoots(dir)) return reply.code(400).send({ error: msg('api.outsideRoots') });
  if (isDemo()) return { ok: true }; // mode démo : n'ouvre aucune app de la machine
  try {
    if (req.body.with === 'finder') await exec('open', fs.statSync(dir).isFile() ? ['-R', dir] : [dir]);
    else if (req.body.with === 'terminal') await exec('open', ['-a', 'Terminal', dir]);
    else {
      // Projet déjà ouvert (directement, via un dossier parent ou un .code-workspace) : on rouvre la même
      // cible dans le même éditeur → VS Code met au premier plan la fenêtre existante au lieu d'en créer une.
      const open = matchOpen(dir, await openEditorFolders(true).catch(() => []));
      const existing = open && EDITOR_APPS.find((e) => e.id === open.editor);
      const ed = existing ?? EDITORS[settings.editor] ?? EDITORS.vscode;
      const target = open ? open.workspaceFile ?? open.path : dir;
      // `open -a` fonctionne sans la CLI ; repli sur la CLI (`code`) si l'app n'est pas dans /Applications.
      await exec('open', ['-a', ed.app, target]).catch(() => exec(ed.cli, [target]));
      return { ok: true, reused: !!open, target };
    }
    return { ok: true };
  } catch (e: any) {
    return reply.code(500).send({ error: msg('api.openFailed', { error: e.message }) });
  }
});

// ─── Modules (TARMAC_MODULES, docs/extensions.md) ───────────────────────────
await loadModules(app, {
  dirs: parseModuleDirs(envVar('MODULES')),
  dataDir: config.dataDir,
  coreVersion: JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version,
  projects: () => lastScan.projects.map(({ id, name, dir, repoDir }) => ({ id, name, dir, repoDir })),
});

// ─── UI ─────────────────────────────────────────────────────────────────────
if (fs.existsSync(webDir)) {
  await app.register(fastifyStatic, {
    root: webDir,
    // index.html / sw.js / manifest toujours revalidés ; assets fingerprintés (assets/*-hash.js) en cache long.
    setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      else res.header('Cache-Control', 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api') ? reply.code(404).send({ error: msg('api.notFound') }) : reply.sendFile('index.html'),
  );
}

// ─── Démarrage ──────────────────────────────────────────────────────────────
for (const r of settings.roots) if (!fs.existsSync(r)) console.warn(`⚠ Folder not found: ${r}`);

// On écoute AVANT le premier scan : sur un gros dossier de code, scan + statut git peuvent prendre du temps.
try {
  await app.listen({ host: config.host, port: config.port });
} catch (e: any) {
  if (e.code === 'EACCES') console.error(`✗ Port ${config.port} denied: on macOS, ports < 1024 are not allowed on ${config.host} without root. Use TARMAC_PORT=7777 (the install script redirects port 80).`);
  else if (e.code === 'EADDRINUSE') console.error(`✗ Port ${config.port} already in use (lsof -nP -iTCP:${config.port} -sTCP:LISTEN).`);
  else console.error(e);
  process.exit(1);
}
console.log(`Tarmac → http://${config.host}:${config.port}  (${settings.roots.join(', ')})`);

const t0 = Date.now();
rescan().then(() => console.log(`Initial scan: ${lastScan.projects.length} projects, ${lastScan.repos.length} repositories in ${Date.now() - t0} ms`));
setInterval(rescan, config.scanIntervalMs).unref();

// Fenêtres VS Code ouvertes : sondage léger, diffusion uniquement en cas de changement.
let lastEditors = '';
setInterval(async () => {
  if (!clients.size) return;
  const folders = await openEditorFolders().catch(() => []);
  const open = Object.fromEntries(lastScan.projects.map((p) => [p.id, matchOpen(p.dir, folders)]).filter(([, m]) => m));
  const sig = JSON.stringify(open);
  if (sig !== lastEditors) {
    lastEditors = sig;
    broadcast({ type: 'editors', open });
  }
}, 5000).unref();
setInterval(fetchAll, config.gitFetchIntervalMs).unref();
setTimeout(fetchAll, 3000).unref();
// Charge la liste GitHub en arrière-plan (date du dernier push côté GitHub).
setTimeout(() => listGithubRepos().catch(() => null), 2000).unref();


// Arrêt propre : les apps serveur survivent (ré-adoptées) ; les consoles, liées au PTY, sont fermées.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    terminals.killAll();
    flushSync();
    await app.close();
    process.exit(0);
  });
}
