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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

export interface DemoFixtures {
  machine: string;
  hostname: string;
  ips: Array<{ iface: string; address: string }>;
  github: { login: string; repos: DemoRepo[] };
  ghCli: { installed: boolean; loggedIn: boolean; user: string | null };
  supabase: { instances: DemoSupabaseInstance[] };
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
