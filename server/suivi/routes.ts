/**
 * API REST du suivi. Mêmes protections que le reste de l'API (hôtes autorisés).
 * Création de tâche et import : réservés au serveur MCP (D7), qui envoie le jeton `x-suivi-token`.
 */
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SuiviService, SuiviFile } from './service.js';
import type { TodolistWatcher } from './watch.js';
import { renderArtifact } from './artifact.js';
import type { SyncRunner } from './sync.js';
import type { SuiviDispatcher } from './dispatch.js';
import { buildTheme, detectPrimary } from './theme.js';
import { detectDisplayFont } from './watch.js';
import { countTasks, SuiviError, toOrigin, type Origin } from './types.js';
import { tr } from '../i18n.js';

type P = { projectId: string };
type PT = P & { taskId: string };

/** `projectId` contient un `/` (owner/repo) : il est passé encodé dans l'URL. */
const pid = (s: string) => decodeURIComponent(s);

export function registerSuiviRoutes(app: FastifyInstance, service: SuiviService, opts: {
  token: (kind: 'claude' | 'artifact') => string | null;
  watcher: TodolistWatcher;
  /** Dossiers acceptés dans `paths` (dossiers scannés). */
  allowDir: (dir: string) => boolean;
  bridgeIntervalSec: () => number;
  sync: SyncRunner;
  /** « Envoyer à Claude » (sessions des consoles de Tarmac). */
  dispatcher?: SuiviDispatcher;
}) {
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof SuiviError) return reply.code(e.statusCode).send({ error: e.message, ...(e.data ? { current: e.data } : {}) });
    throw e;
  };
  const hasToken = (headers: Record<string, unknown>, kind: 'claude' | 'artifact') => {
    const t = opts.token(kind);
    return !!t && headers['x-suivi-token'] === t;
  };
  const isClaude = (headers: Record<string, unknown>) => hasToken(headers, 'claude');

  app.get('/api/suivi/projects', async () => service.listProjects());

  app.get<{ Params: P }>('/api/suivi/projects/:projectId', async (req, reply) => {
    try {
      const projectId = pid(req.params.projectId);
      const project = service.requireProject(projectId);
      const tasks = service.tasks(projectId);
      return { project, tasks, counts: countTasks(tasks), syncs: service.syncs(projectId) };
    } catch (e) { return fail(reply, e); }
  });

  app.patch<{ Params: PT; Body: { baseRev: number; changes: Record<string, unknown>; origin?: Origin } }>(
    '/api/suivi/projects/:projectId/tasks/:taskId',
    async (req, reply) => {
      try {
        const { baseRev, changes } = req.body ?? ({} as any);
        if (!changes || typeof changes !== 'object') throw new SuiviError(tr({ en: 'Expected body: { baseRev, changes }', fr: 'Corps attendu : { baseRev, changes }' }));
        const asked = toOrigin(req.body.origin);
        const origin: Origin = asked && asked !== 'claude' ? asked : 'tarmac';
        return service.patchTask(pid(req.params.projectId), req.params.taskId, Number(baseRev), changes, origin);
      } catch (e) { return fail(reply, e); }
    },
  );

  app.post<{ Params: P; Body: Record<string, unknown> }>('/api/suivi/projects/:projectId/tasks', async (req, reply) => {
    if (!isClaude(req.headers)) return reply.code(403).send({ error: tr({ en: 'Adding or editing a task (other than checking and notes) goes through Claude (tarmac MCP server)', fr: 'Ajouter ou modifier une tâche (hors coche et note) passe par Claude (serveur MCP tarmac)' }) });
    try {
      const projectId = pid(req.params.projectId);
      const t = service.upsertTask(projectId, req.body ?? {}, 'claude');
      service.recordSync(projectId, 'B', `${t.num} ${t.title.slice(0, 60)}`);
      return t;
    } catch (e) { return fail(reply, e); }
  });

  // ─── « Envoyer à Claude » : sessions Claude en cours dans les consoles de Tarmac, envoi d'une tâche ───
  // Même accès que l'ouverture d'une session Claude depuis l'UI (garde d'origine) ; le serveur MCP passe aussi
  // par ici (outils `suivi_sessions` et `suivi_dispatch`, mode artefact compris).
  app.get<{ Params: P }>('/api/suivi/projects/:projectId/sessions', async (req, reply) => {
    if (!opts.dispatcher) return reply.code(501).send({ error: 'Unavailable' });
    try { return opts.dispatcher.sessions(pid(req.params.projectId)); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: PT; Body: { target?: string } }>('/api/suivi/projects/:projectId/tasks/:taskId/dispatch', async (req, reply) => {
    if (!opts.dispatcher) return reply.code(501).send({ error: 'Unavailable' });
    try {
      return await opts.dispatcher.dispatch(pid(req.params.projectId), req.params.taskId, String(req.body?.target ?? ''));
    } catch (e: any) {
      if (e instanceof SuiviError) return fail(reply, e);
      return reply.code(e?.statusCode ?? 500).send({ error: e?.message ?? String(e) });
    }
  });

  app.post<{ Params: P; Body: SuiviFile }>('/api/suivi/projects/:projectId/import', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    if (!isClaude(req.headers)) return reply.code(403).send({ error: tr({ en: 'Import goes through Claude (tarmac MCP server)', fr: 'L’import passe par Claude (serveur MCP tarmac)' }) });
    try { return service.importFile(pid(req.params.projectId), req.body, 'claude', 'import API'); } catch (e) { return fail(reply, e); }
  });

  const claudeOnly = (reply: FastifyReply) => reply.code(403).send({ error: tr({ en: 'Reserved for the tarmac MCP server (x-suivi-token token)', fr: 'Réservé au serveur MCP tarmac (jeton x-suivi-token)' }) });

  /** Enregistre ou complète un projet de suivi (`/suivi init`). */
  app.post<{ Body: Record<string, any> }>('/api/suivi/projects', async (req, reply) => {
    if (!isClaude(req.headers)) return claudeOnly(reply);
    try {
      const b = req.body ?? {};
      if (typeof b.projectId !== 'string' || typeof b.name !== 'string') throw new SuiviError(tr({ en: 'projectId and name required', fr: 'projectId et name requis' }));
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
      const paths = Array.isArray(b.paths) ? b.paths.filter((x: unknown): x is string => typeof x === 'string' && path.isAbsolute(x) && opts.allowDir(path.resolve(x))).map((x: string) => path.resolve(x)) : undefined;
      // Sans thème fourni, un nouveau projet prend la charte détectée dans son dossier.
      const detected = !b.theme && paths?.[0] && !service.getProject(b.projectId)
        ? buildTheme(detectPrimary(paths[0]), str(b.brand) ?? b.name.toUpperCase(), { display: detectDisplayFont(paths[0]) })
        : undefined;
      return service.registerProject({
        projectId: b.projectId, name: b.name, brand: str(b.brand), title: str(b.title), subtitle: str(b.subtitle),
        artifactUrl: b.artifactUrl === undefined ? undefined : str(b.artifactUrl) ?? null,
        theme: b.theme && typeof b.theme === 'object' ? b.theme : detected,
        paths,
        copyFile: typeof b.copyFile === 'string' && /^[\w.-]{1,80}\.json$/.test(b.copyFile) ? b.copyFile : undefined,
      });
    } catch (e) { return fail(reply, e); }
  });

  /** Tâches modifiées depuis le curseur (pull du pont MCP, rattrapage léger). */
  app.get<{ Params: P; Querystring: { since?: string } }>('/api/suivi/projects/:projectId/changes', async (req, reply) => {
    try {
      const projectId = pid(req.params.projectId);
      service.requireProject(projectId);
      return service.changedSince(projectId, Math.max(0, Number(req.query.since) || 0));
    } catch (e) { return fail(reply, e); }
  });

  /** Tâches venues de l'artefact (canal A en direct, canal C au rattrapage). */
  app.post<{ Params: P; Body: { tasks: unknown[]; channel?: 'A' | 'C' } }>('/api/suivi/projects/:projectId/push', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    // Jeton artefact : canal A seulement, coche et note de tâches existantes (D7).
    const artifact = !isClaude(req.headers) && hasToken(req.headers, 'artifact');
    if (!isClaude(req.headers) && !artifact) return claudeOnly(reply);
    try {
      return service.pushTasks(pid(req.params.projectId), req.body?.tasks, !artifact && req.body?.channel === 'C' ? 'C' : 'A', { uiOnly: artifact });
    } catch (e) { return fail(reply, e); }
  });

  /** Régénère la copie `Todolist/<fichier>` du dépôt depuis la base. */
  app.post<{ Params: P }>('/api/suivi/projects/:projectId/write-copy', async (req, reply) => {
    if (!isClaude(req.headers)) return claudeOnly(reply);
    try { return { file: opts.watcher.writeCopy(pid(req.params.projectId)) }; } catch (e: any) { return e instanceof SuiviError ? fail(reply, e) : reply.code(500).send({ error: e.message }); }
  });

  /** Page de l'artefact du projet (gabarit commun + marque et thème), à publier par `/suivi init` ou `upgrade`. */
  app.get<{ Params: P }>('/api/suivi/projects/:projectId/artifact.html', async (req, reply) => {
    try {
      const projectId = pid(req.params.projectId);
      const html = renderArtifact(service.requireProject(projectId), { bridgeIntervalSec: opts.bridgeIntervalSec(), ...opts.watcher.artifactExtras(projectId) });
      return reply.type('text/html; charset=utf-8').send(html);
    } catch (e) { return fail(reply, e); }
  });

  // ─── Rattrapage avec l'artefact (canal C), mené par une session Claude desktop (/suivi sync) ───
  app.post<{ Params: P }>('/api/suivi/projects/:projectId/sync/prepare', async (req, reply) => {
    if (!isClaude(req.headers)) return claudeOnly(reply);
    try { const projectId = pid(req.params.projectId); service.requireProject(projectId); return { dir: opts.sync.prepare(projectId) }; } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: P }>('/api/suivi/projects/:projectId/sync/merge', async (req, reply) => {
    if (!isClaude(req.headers)) return claudeOnly(reply);
    try { return opts.sync.merge(pid(req.params.projectId)); } catch (e) { return fail(reply, e); }
  });

  app.get<{ Params: P }>('/api/suivi/projects/:projectId/export', async (req, reply) => {
    try { return service.exportFile(pid(req.params.projectId)); } catch (e) { return fail(reply, e); }
  });

  app.get<{ Params: PT }>('/api/suivi/projects/:projectId/history/:taskId', async (req, reply) => {
    try {
      const projectId = pid(req.params.projectId);
      service.requireProject(projectId);
      return service.history(projectId, req.params.taskId);
    } catch (e) { return fail(reply, e); }
  });
}
