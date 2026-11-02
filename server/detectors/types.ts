import fs from 'node:fs';
import path from 'node:path';

/**
 * - web     : interface ouvrable dans le navigateur (port géré)
 * - service : API / backend HTTP (port géré, ouvrable aussi)
 * - console : programme non-web → console interactive
 * - other   : dépôt / librairie sans commande de lancement évidente
 */
export type Kind = 'web' | 'service' | 'mobile' | 'worker' | 'console' | 'other';

export interface Tech {
  id: string;
  label: string;
}

/** Commande shell exécutée dans une console (cwd = dossier du projet). */
export interface Command {
  id: string;
  label: string;
  cmd: string;
  group?: 'run' | 'dev' | 'deps' | 'test' | 'tool';
}

/** Commande serveur lancée par le process manager. `{PORT}` est remplacé au démarrage. */
export interface ServeSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Port imposé et non réattribuable (rare : on réécrit d'habitude le script). */
  fixedPort: number | null;
  /** Port écrit en dur dans le script d'origine (remplacé par un port de la plage au lancement). */
  scriptPort?: number | null;
  /** Dossiers ajoutés au PATH (node_modules/.bin) quand le script est exécuté directement. */
  pathPrepend?: string[];
  /** Process sans port HTTP (worker, cron, bot) : démarré / arrêté, logs, pas d'URL. */
  noPort?: boolean;
}

export interface Detection {
  /** Plus le score est élevé, plus la détection est prioritaire quand un dossier en matche plusieurs. */
  score: number;
  kind: Kind;
  name?: string;
  description?: string | null;
  language: Tech;
  languages?: Tech[];
  platform?: Tech | null;
  framework?: Tech | null;
  packageManager?: string | null;
  serve?: ServeSpec | null;
  commands: Command[];
  defaultCommand?: string | null;
  /** Variables ajoutées aux consoles et au serveur (ex. venv Python). */
  env?: Record<string, string>;
  pathPrepend?: string[];
  /** Racine de workspace (monorepo) : ses sous-packages sont listés séparément. */
  workspaceRoot?: boolean;
  /** Pas un vrai projet (page HTML seule, scripts sans outillage…) → groupe « Divers ». */
  loose?: boolean;
  /** Libellé de l'outil de monorepo (pnpm workspaces, Turborepo, Nx…). */
  monorepoTool?: string | null;
}

export interface DirContext {
  dir: string;
  names: Set<string>;
  /** Le dossier est à l'intérieur d'un autre projet (hors racine de monorepo). */
  nested: boolean;
  isGitRoot: boolean;
}

export type Detector = (ctx: DirContext) => Detection | null;

export const T = (id: string, label: string): Tech => ({ id, label });

export function readText(file: string, max = 200_000): string | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function readJson<T = any>(file: string): T | null {
  const t = readText(file, 2_000_000);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const exists = (dir: string, ...p: string[]) => fs.existsSync(path.join(dir, ...p));
