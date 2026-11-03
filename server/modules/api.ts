/**
 * Contrat public des modules Tarmac (API version 1), publié avec le paquet npm : `@codustel/tarmac/modules`.
 * Types seulement : un module ne dépend jamais du code interne du cœur. Doc : docs/extensions.md.
 */
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

/** Texte dans les deux langues de l'interface. */
export type ModuleText = string | { en: string; fr: string };

/** Champ `tarmac` du `package.json` d'un module. Chemins relatifs au dossier du module, sans `..`. */
export interface ModuleManifest {
  apiVersion: 1;
  /** Identifiant : minuscules, chiffres et tirets (`^[a-z][a-z0-9-]{1,39}$`), unique. */
  id: string;
  /** Nom affiché (navigation, réglages). */
  name: ModuleText;
  /** Icône de la navigation : balisage SVG, dessiné en `currentColor` (sert de masque). */
  icon?: string;
  /** Module ES du serveur, qui exporte `register`. */
  server?: string;
  /** Module ES de la vue web, qui exporte `mount` ; son dossier est servi sous `/modules/<id>/`. */
  web?: string;
}

/** Projet détecté par le cœur (lecture seule). */
export interface ModuleProject {
  id: string;
  name: string;
  dir: string;
  /** Racine du dépôt Git, null hors dépôt. */
  repoDir: string | null;
}

export interface ModuleSettings {
  get(): Record<string, unknown>;
  /** Fusion superficielle avec les réglages existants ; renvoie le résultat. */
  set(patch: Record<string, unknown>): Record<string, unknown>;
}

// ─── Événements du cœur (lecture seule) ─────────────────────────────────────

/**
 * État d'une session d'agent : `working` (réponse ou outil en cours), `idle` (tour fini, attend un message),
 * `permission` (boîte de permission ou de choix affichée ; repérée seulement dans les consoles de Tarmac, dont le
 * cœur lit l'écran : ailleurs, une permission en attente reste `working`).
 */
export type ModuleAgentState = 'working' | 'idle' | 'permission';

/** `agent:turn` : l'état d'une session d'agent en cours a changé (ou la session vient d'être vue). */
export interface ModuleAgentTurnEvent {
  agent: 'claude' | 'codex';
  /** Clé stable de la session en cours : `<agent>:<pid>`. */
  key: string;
  sessionId: string | null;
  /** Console de Tarmac qui héberge la session, null si elle tourne ailleurs (Terminal, éditeur…). */
  terminalId: string | null;
  projectId: string | null;
  projectName: string | null;
  /** Titre de la session (nom donné, résumé ou début du premier message), tel que le cœur l'affiche. */
  title: string | null;
  state: ModuleAgentState;
  /** État précédent ; null à la première observation (session nouvelle, ou premier abonnement). */
  previous: ModuleAgentState | null;
  /** Durée de l'état précédent en millisecondes (null à la première observation). */
  previousMs: number | null;
  at: string;
}

export type ModuleProcessStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

/**
 * `process:status` : le statut d'une app lancée par Tarmac a changé. `crashed` = le process s'est arrêté seul avec
 * un code ≠ 0 (ou un signal) : un arrêt demandé donne `stopped`.
 */
export interface ModuleProcessStatusEvent {
  projectId: string;
  projectName: string | null;
  status: ModuleProcessStatus;
  previous: ModuleProcessStatus | null;
  exitCode: number | null;
  at: string;
}

export type ModuleTaskStatus = 'todo' | 'toTest' | 'done';

/** `suivi:task` : une tâche de la Todolist a changé de statut (création comprise : `previous` null). */
export interface ModuleTaskStatusEvent {
  /** Projet de suivi (Todolist), pas forcément un projet scanné. */
  suiviProjectId: string;
  projectName: string | null;
  taskId: string;
  num: string;
  title: string;
  status: ModuleTaskStatus;
  previous: ModuleTaskStatus | null;
  at: string;
}

/** Événements auxquels un module peut s'abonner par `ctx.core.on(event, cb)`. */
export interface ModuleCoreEvents {
  'agent:turn': ModuleAgentTurnEvent;
  'process:status': ModuleProcessStatusEvent;
  'suivi:task': ModuleTaskStatusEvent;
}
export type ModuleCoreEventName = keyof ModuleCoreEvents;

export interface ModuleContext {
  id: string;
  /** Instance Fastify encapsulée : ses routes vivent sous `/api/modules/<id>`, avec les protections du cœur. */
  app: FastifyInstance;
  /** Dossier de données propre au module (`~/.tarmac/modules/<id>/`), créé au besoin. */
  dataDir: string;
  /** Base SQLite du module (`<dataDir>/data.db`) ; une migration par élément, appliquées dans l'ordre. */
  openDb(migrations: readonly string[]): DatabaseSync;
  /** Réglages du module (`<dataDir>/settings.json`). */
  settings: ModuleSettings;
  log: FastifyBaseLogger;
  core: {
    version: string;
    projects(): ModuleProject[];
    /** Langue de l'interface (réglage, sinon celle du système). */
    lang(): 'en' | 'fr';
    /**
     * Abonnement en lecture seule à un événement du cœur ; renvoie de quoi se désabonner. Les données reçues sont
     * figées ; une erreur levée par `cb` est journalisée et n'arrête ni le cœur ni les autres abonnés.
     */
    on<E extends ModuleCoreEventName>(event: E, cb: (payload: ModuleCoreEvents[E]) => void): () => void;
  };
}

/** Export attendu du module serveur. */
export type RegisterModule = (ctx: ModuleContext) => void | Promise<void>;

export interface ModuleWebContext {
  id: string;
  lang: 'en' | 'fr';
  theme(): 'light' | 'dark';
  /** Appelé à chaque changement de thème ; renvoie de quoi se désabonner. */
  onThemeChange(cb: (theme: 'light' | 'dark') => void): () => void;
  /** `fetch` vers les routes du module : `api('/stats')` → `/api/modules/<id>/stats`. */
  api(path: string, init?: RequestInit): Promise<Response>;
}

/** Export attendu de la vue web : monte la vue dans `el`, renvoie éventuellement de quoi la démonter. */
export type MountModule = (el: HTMLElement, ctx: ModuleWebContext) => void | (() => void);
