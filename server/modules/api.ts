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
