/**
 * Chargement des modules listés dans `TARMAC_MODULES` (dossiers séparés par `path.delimiter`).
 * Rien n'est découvert automatiquement. Un module invalide ou en erreur est signalé, jamais bloquant : le cœur
 * démarre toujours. Un module a les droits du serveur (comme une extension d'éditeur).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { openSqlite } from '../sqlite.js';
import type { ModuleContext, ModuleManifest, ModuleProject, ModuleText, RegisterModule } from './api.js';

export const MODULE_API_VERSION = 1;
const ID = /^[a-z][a-z0-9-]{1,39}$/;

export type ModuleStatus = 'loaded' | 'ignored' | 'error';

/** Ce que `GET /api/modules` renvoie pour chaque dossier listé. */
export interface ModuleInfo {
  id: string;
  name: ModuleText;
  version: string;
  dir: string;
  icon: string | null;
  /** URL du module ES de la vue web, null sans vue. */
  webUrl: string | null;
  status: ModuleStatus;
  error: string | null;
}

export interface LoadOptions {
  dirs: string[];
  /** Dossier de données du cœur : chaque module reçoit `<dataDir>/modules/<id>/`. */
  dataDir: string;
  coreVersion: string;
  projects: () => ModuleProject[];
}

/** `TARMAC_MODULES` → dossiers absolus (vides ignorés). */
export const parseModuleDirs = (value: string | undefined): string[] =>
  (value ?? '').split(path.delimiter).map((d) => d.trim()).filter(Boolean).map((d) => path.resolve(d));

/** Chemin relatif du manifeste → chemin absolu dans le dossier du module, ou erreur s'il en sort. */
function inside(dir: string, rel: string, field: string): string {
  const abs = path.resolve(dir, rel);
  if (path.isAbsolute(rel) || !abs.startsWith(dir + path.sep)) throw new Error(`tarmac.${field} must stay inside the module folder`);
  if (!fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`tarmac.${field} not found: ${rel}`);
  return abs;
}

function readManifest(dir: string): { manifest: ModuleManifest; version: string } {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const m = pkg.tarmac;
  if (!m || typeof m !== 'object') throw new Error('package.json has no "tarmac" field');
  return { manifest: m, version: typeof pkg.version === 'string' ? pkg.version : '0.0.0' };
}

function jsonSettings(file: string): ModuleContext['settings'] {
  const get = (): Record<string, unknown> => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  return {
    get,
    set(patch) {
      const next = { ...get(), ...patch };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
      fs.renameSync(`${file}.tmp`, file);
      return next;
    },
  };
}

/**
 * Charge les modules et enregistre `GET /api/modules`. À appeler avant `listen`. Les routes d'un module dont
 * `register` échoue répondent 503 : celles déjà déclarées ne restent pas actives à moitié.
 */
export async function loadModules(app: FastifyInstance, opts: LoadOptions): Promise<ModuleInfo[]> {
  const infos: ModuleInfo[] = [];
  for (const dir of opts.dirs) {
    const info: ModuleInfo = { id: path.basename(dir), name: path.basename(dir), version: '', dir, icon: null, webUrl: null, status: 'error', error: null };
    infos.push(info);
    try {
      const { manifest: m, version } = readManifest(dir);
      info.version = version;
      if (m.apiVersion !== MODULE_API_VERSION) {
        info.status = 'ignored';
        info.error = `apiVersion ${m.apiVersion} not supported (expected ${MODULE_API_VERSION})`;
        continue;
      }
      if (typeof m.id !== 'string' || !ID.test(m.id)) throw new Error(`invalid id: ${JSON.stringify(m.id)}`);
      if (infos.some((x) => x !== info && x.id === m.id && x.status === 'loaded')) throw new Error(`duplicate id: ${m.id}`);
      info.id = m.id;
      info.name = m.name ?? m.id;
      info.icon = typeof m.icon === 'string' ? m.icon : null;
      const serverFile = m.server ? inside(dir, m.server, 'server') : null;
      const webFile = m.web ? inside(dir, m.web, 'web') : null;

      if (serverFile) {
        const mod = await import(pathToFileURL(serverFile).href);
        const register: RegisterModule | undefined = mod.register;
        if (typeof register !== 'function') throw new Error(`${m.server} does not export register()`);
        const dataDir = path.join(opts.dataDir, 'modules', m.id);
        await app.register(async (scope) => {
          scope.addHook('onRequest', async (_req, reply) => {
            if (info.status !== 'loaded') return reply.code(503).send({ error: `Module ${m.id} is not available` });
          });
          fs.mkdirSync(dataDir, { recursive: true });
          const ctx: ModuleContext = {
            id: m.id,
            app: scope,
            dataDir,
            openDb: (migrations) => openSqlite(path.join(dataDir, 'data.db'), migrations),
            settings: jsonSettings(path.join(dataDir, 'settings.json')),
            log: scope.log.child({ module: m.id }),
            core: { version: opts.coreVersion, projects: opts.projects },
          };
          try {
            await register(ctx);
          } catch (e) {
            info.error = (e as Error).message;
          }
        }, { prefix: `/api/modules/${m.id}` });
        if (info.error) throw new Error(info.error);
      }

      if (webFile) {
        await app.register(fastifyStatic, { root: path.dirname(webFile), prefix: `/modules/${m.id}/`, decorateReply: false });
        info.webUrl = `/modules/${m.id}/${path.basename(webFile)}`;
      }
      info.status = 'loaded';
      info.error = null;
    } catch (e) {
      info.status = 'error';
      info.error = (e as Error).message;
    }
    if (info.error) console.warn(`⚠ Module ${info.id} (${dir}): ${info.error}`);
  }
  app.get('/api/modules', async () => infos);
  return infos;
}
