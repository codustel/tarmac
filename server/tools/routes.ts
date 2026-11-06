// Routes /api/tools : état des outils et actions (installer, se connecter, mettre à jour, intégrer) dans la console système.
// Tout est injecté (R2) : ce module n'importe ni config, ni settings, ni docker, ni terminaux.
import type { FastifyInstance } from 'fastify';
import { afterInstall, launchSpec, type ActionKind, type AfterInstallDeps } from './actions.js';
import { MANAGED, TOOLS, type ManagedId, type ToolId } from './registry.js';
import { allToolStatus, invalidateToolStatus, toolStatus, type StatusDeps, type ToolStatus } from './status.js';

export interface ToolRoutesDeps {
  status: StatusDeps;
  platform: NodeJS.Platform;
  isDemo: () => boolean;
  /** Console système : lance la commande, renvoie le résumé du terminal. */
  launch: (spec: { command: string; label: string; unsetEnv?: string[]; cols?: number; rows?: number }) => Promise<unknown>;
  /** Abonnement à la fin des consoles (évènement `exit` des terminaux) : le statut de l'outil est alors relu. */
  onSessionExit?: (listener: (sessionId: string) => void) => void;
  after: AfterInstallDeps;
  /** Texte serveur traduit (server/i18n.ts `msg`). */
  msg: (key: 'api.demoMode' | 'api.noToolAction' | 'api.unknownTool') => string;
}

type Body = { cols?: number; rows?: number };
const isTool = (id: string): id is ToolId => Object.prototype.hasOwnProperty.call(TOOLS, id);

/** Mode démo : tout prêt, sans rien lancer (ni accueil ni alerte dans les vidéos). */
export function demoToolStatuses(): ToolStatus[] {
  return (Object.keys(TOOLS) as ToolId[]).map((id) => {
    const def = TOOLS[id];
    return {
      id, state: 'ready', version: null, path: `/opt/homebrew/bin/${def.bin}`, method: def.managed ? 'brew' : null, installMethod: null,
      latest: null, updatable: false, managed: def.managed, loginable: def.loginable, docUrl: def.docUrl,
    };
  });
}

export function registerToolRoutes(app: FastifyInstance, deps: ToolRoutesDeps): void {
  app.get<{ Querystring: { fresh?: string } }>('/api/tools', async (req): Promise<ToolStatus[]> => {
    if (deps.isDemo()) return demoToolStatuses();
    if (req.query.fresh === '1') invalidateToolStatus();
    return allToolStatus(deps.status);
  });

  // Consoles lancées ici → outil concerné : à leur fin (connexion, mise à jour, installation), le statut est relu.
  const sessions = new Map<string, ToolId>();
  deps.onSessionExit?.((sid) => {
    const id = sessions.get(sid);
    if (!id) return;
    sessions.delete(sid);
    invalidateToolStatus(id);
  });

  const action = async (kind: ActionKind, id: string, body: Body | undefined, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (deps.isDemo()) return reply.code(400).send({ error: deps.msg('api.demoMode') });
    if (!isTool(id)) return reply.code(400).send({ error: deps.msg('api.unknownTool') });
    // Statut frais : l'action se décide sur l'état réel, pas sur un cache de 30 s.
    invalidateToolStatus(id);
    const spec = launchSpec(kind, await toolStatus(id, deps.status), deps.platform);
    if (!spec) return reply.code(400).send({ error: deps.msg('api.noToolAction') });
    try {
      const session = await deps.launch({ ...spec, cols: body?.cols, rows: body?.rows });
      const sid = (session as { id?: unknown } | null)?.id;
      if (typeof sid === 'string') sessions.set(sid, id);
      return session;
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  };

  for (const kind of ['install', 'login', 'update'] as const) {
    app.post<{ Params: { id: string }; Body: Body }>(`/api/tools/:id/${kind}`, (req, reply) => action(kind, req.params.id, req.body, reply));
  }

  /** Appelée par le client quand la console d'installation se termine avec le code 0. */
  app.post<{ Params: { id: string } }>('/api/tools/:id/after-install', async (req, reply) => {
    if (deps.isDemo()) return reply.code(400).send({ error: deps.msg('api.demoMode') });
    const id = req.params.id;
    if (!(MANAGED as string[]).includes(id)) return reply.code(400).send({ error: deps.msg('api.unknownTool') });
    try {
      const { integration } = await afterInstall(id as ManagedId, deps.after);
      return { ok: integration?.ok ?? true, integration };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // Ancienne route de connexion GitHub, gardée comme alias de /api/tools/gh/login.
  app.post<{ Body: Body }>('/api/github/cli/login', (req, reply) => action('login', 'gh', req.body, reply));
}
