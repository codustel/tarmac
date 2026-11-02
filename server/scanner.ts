import fs from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { settings } from './settings.js';
import { resolveName, type NameSource } from './naming.js';
import { detectProdUrl, type ProdUrl } from './prodUrl.js';
import { detectNode } from './detectors/node.js';
import { detectPython } from './detectors/python.js';
import { detectBareRepo, detectCompose, detectDeno, detectGo, detectRuby, detectRust } from './detectors/misc.js';
import type { Command, Detection, DirContext, Kind, ServeSpec, Tech } from './detectors/types.js';

const IGNORED = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.vercel', '.netlify',
  '.cache', '.parcel-cache', '.expo', 'dist', 'build', 'out', 'coverage', '.venv', 'venv', 'env', '__pycache__',
  'vendor', 'Pods', 'DerivedData', '.idea', '.vscode', 'tmp', '.pnpm-store', '.yarn', 'target', '.angular',
  '.docusaurus', 'storybook-static', '.terraform', 'site-packages', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.tox', 'htmlcov', '.gradle', 'bin', 'obj',
  // Dossiers volumineux courants dans ~/Documents
  'Microsoft User Data', 'Adobe', 'Zoom', 'WhatsApp', 'Parallels', 'Virtual Machines.localized',
  // Edge functions Supabase (Deno) : rattachées au projet parent, pas des projets à part.
  'supabase',
]);

/** Paquets macOS (apps, bibliothèques Photos/Musique, projets Final Cut…) : jamais des projets de code. */
const BUNDLE_RE = /\.(app|photoslibrary|musiclibrary|tvlibrary|fcpbundle|imovielibrary|bundle|xcarchive|pkg|logicx|band|key|pages|numbers)$/i;

// PHP et pages HTML statiques volontairement ignorés.
const DETECTORS = [detectNode, detectPython, detectGo, detectRust, detectRuby, detectDeno, detectCompose, detectBareRepo];

export interface Project {
  id: string;
  name: string;
  dir: string;
  /** Racine de scan à laquelle appartient le projet. */
  root: string;
  relPath: string;
  kind: Kind;
  description: string | null;
  language: Tech;
  languages: Tech[];
  platform: Tech | null;
  framework: Tech | null;
  packageManager: string | null;
  serve: ServeSpec | null;
  commands: Command[];
  defaultCommand: string | null;
  env: Record<string, string>;
  pathPrepend: string[];
  readme: string | null;
  repoDir: string | null;
  supabaseProjectId: string | null;
  /** Nom d'application (affiché) + origine ; `techName` = nom technique (package, dossier). */
  techName: string;
  nameSource: NameSource;
  /** Nom « produit » détecté (titre, manifest…) s'il diffère du nom affiché. */
  appName: string | null;
  /** URL de production (saisie manuelle ou .env). */
  prodUrl: (ProdUrl & { manual: boolean }) | null;
  /** Dernière modification connue (fichiers du dossier). */
  activityAt: string | null;
  loose: boolean;
  /** Projet créé pour représenter un groupe (dossier racine sans outillage propre). */
  synthetic: boolean;
  group: GroupInfo;
}

/** Un « projet dev » : un dépôt, un monorepo, un projet et ses sous-projets, ou un dossier conteneur. */
export interface GroupInfo {
  id: string;
  dir: string;
  relPath: string;
  name: string;
  nameSource: NameSource;
  isRoot: boolean;
  /** Chemin relatif à la racine du groupe (« apps/web », « backend »). Vide pour la racine. */
  subPath: string;
  type: 'single' | 'monorepo' | 'repo' | 'folder' | 'loose';
  monorepoTool: string | null;
  size: number;
}

interface RawProject extends Omit<Project, 'name' | 'techName' | 'nameSource' | 'group' | 'synthetic' | 'appName' | 'prodUrl'> {
  technical: string | null;
  workspaceRoot: boolean;
  monorepoTool: string | null;
}

export interface LocalRepo {
  dir: string;
  root: string;
  relPath: string;
  /** Nom du projet git : nom du dépôt distant (origin), sinon nom du dossier. */
  name: string;
}

/** Nom du dépôt d'après le remote `origin` (`git@github.com:acme/shop.git` → `shop`). */
function gitRepoName(dir: string): string {
  try {
    let gitDir = path.join(dir, '.git');
    // Worktree / sous-module : `.git` est un fichier « gitdir: … »
    const st = statSync(gitDir);
    if (st.isFile()) gitDir = path.resolve(dir, readFileSync(gitDir, 'utf8').replace(/^gitdir:\s*/, '').trim());
    const cfg = readFileSync(path.join(gitDir, 'config'), 'utf8');
    const url = cfg.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1];
    const name = url?.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop();
    if (name) return name;
  } catch { /* pas de config lisible */ }
  return path.basename(dir);
}

/** Sous-dossiers de code source : jamais des projets, inutile d'y descendre. */
const SOURCE_DIRS = new Set([
  'src', 'lib', 'components', 'pages', 'app', 'public', 'assets', 'styles', 'utils', 'hooks', 'types', 'tests', 'test',
  '__tests__', 'spec', 'docs', 'doc', 'scripts', 'migrations', 'prisma', 'config', 'static', 'templates', 'locales', 'i18n',
  'e2e', 'cypress', 'playwright', 'fixtures', 'examples', 'example', 'stories', 'routes', 'views', 'models', 'controllers',
  'middleware', 'store', 'context', 'images', 'img', 'fonts', 'icons', 'data', 'db', 'sql', 'logs', 'notebooks', 'resources',
  'android', 'ios', 'drizzle', 'generated', 'schemas', 'core', 'common', 'shared', 'modules', 'features', 'tools',
]);
/** Niveaux explorés sous la racine d'un projet (sous-apps : apps/web, backend, frontend…). */
const PROJECT_BUDGET = 2;
const BARE_REPO_BUDGET = 3;

export interface SupabaseConfigRef {
  projectId: string;
  dir: string;
  relPath: string;
  ports: { api?: number; db?: number; studio?: number };
}

export const LOOSE_GROUP_ID = '__divers__';

export interface ScanResult {
  projects: Project[];
  repos: LocalRepo[];
  supabaseConfigs: SupabaseConfigRef[];
  scannedAt: string;
  durationMs: number;
}

/** Identifiant stable dérivé du chemin absolu. */
export const projectId = (dir: string) => crypto.createHash('sha1').update(dir).digest('hex').slice(0, 10);

const README_RE = /^readme(\.(md|markdown|mdx|rst|txt))?$/i;

/** Libellé affiché d'un chemin : `Developer/acme/shop` (nom de la racine + chemin relatif). */
export const displayPath = (root: string, dir: string) => path.join(path.basename(root), path.relative(root, dir));

function readSupabaseConfig(dir: string, root: string): SupabaseConfigRef | null {
  try {
    const toml = parseToml(readFileSync(path.join(dir, 'supabase', 'config.toml'), 'utf8')) as any;
    if (!toml.project_id) return null;
    return {
      projectId: String(toml.project_id),
      dir,
      relPath: displayPath(root, dir),
      ports: { api: toml.api?.port, db: toml.db?.port, studio: toml.studio?.port },
    };
  } catch {
    return null;
  }
}

export async function scan(): Promise<ScanResult> {
  const t0 = Date.now();
  const raw: RawProject[] = [];
  const repos: LocalRepo[] = [];
  /** Dossiers « conteneurs » plausibles : README, compose, workspace VS Code, Supabase, Makefile… */
  const markerDirs = new Set<string>();
  const supabaseConfigs: SupabaseConfigRef[] = [];

  async function walk(root: string, dir: string, depth: number, repoDir: string | null, supabaseId: string | null, insideProject: boolean, inWorkspace = false, budget: number | null = null) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    const isGitRoot = names.has('.git');

    if (isGitRoot) {
      repoDir = dir;
      repos.push({ dir, root, relPath: displayPath(root, dir), name: gitRepoName(dir) });
    }
    if (names.has('supabase')) {
      const sb = readSupabaseConfig(dir, root);
      if (sb) {
        supabaseConfigs.push(sb);
        supabaseId = sb.projectId;
      }
    }

    if (!settings.roots.includes(dir) && [...names].some((n) => CONTAINER_MARKERS.test(n))) markerDirs.add(dir);

    const ctx: DirContext = { dir, names, nested: insideProject || inWorkspace, isGitRoot };
    let best: Detection | null = null;
    for (const d of DETECTORS) {
      const r = d(ctx);
      if (r && (!best || r.score > best.score)) best = r;
    }
    // Dans un projet, on ne liste que ce qui est lançable (pas un sous-dossier quelconque).
    if (best && (insideProject || inWorkspace) && best.score < 2) best = null;

    if (best) {
      const readme = [...names].find((n) => README_RE.test(n));
      // Dernière modification : fichiers et dossiers de premier niveau (hors dossiers générés).
      const stats = await Promise.all(
        entries.filter((e) => !IGNORED.has(e.name) && e.name !== '.git' && e.name !== '.DS_Store').slice(0, 300)
          .map((e) => fs.stat(path.join(dir, e.name)).then((x) => x.mtimeMs).catch(() => 0)),
      );
      const activity = Math.max(0, ...stats);
      raw.push({
        activityAt: activity ? new Date(activity).toISOString() : null,
        id: projectId(dir),
        technical: best.name ?? null,
        dir,
        root,
        relPath: displayPath(root, dir),
        kind: best.kind,
        description: best.description ?? null,
        language: best.language,
        languages: best.languages ?? [best.language],
        platform: best.platform ?? null,
        framework: best.framework ?? null,
        packageManager: best.packageManager ?? null,
        serve: best.serve ?? null,
        commands: best.commands,
        defaultCommand: best.defaultCommand ?? null,
        env: best.env ?? {},
        pathPrepend: best.pathPrepend ?? [],
        readme: readme ? path.join(dir, readme) : null,
        repoDir,
        supabaseProjectId: supabaseId,
        loose: !!best.loose,
        workspaceRoot: !!best.workspaceRoot,
        monorepoTool: best.monorepoTool ?? null,
      });
      // Les sous-packages d'un monorepo restent des projets à part entière.
      if (best.workspaceRoot) inWorkspace = true;
      else if (!best.loose) insideProject = true;
      // Structure du projet connue : on n'explore plus que ses sous-apps (2 niveaux, hors code source).
      if (!best.loose) budget = Math.min(budget ?? PROJECT_BUDGET, PROJECT_BUDGET);
    } else if (isGitRoot && budget === null) {
      budget = BARE_REPO_BUDGET; // dépôt sans outillage à la racine (frontend/ + backend/…)
    }

    if (depth >= settings.scanMaxDepth || budget === 0) return;
    const inProject = budget !== null;
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !IGNORED.has(e.name) && !e.name.startsWith('.') && !BUNDLE_RE.test(e.name))
        .filter((e) => !inProject || !SOURCE_DIRS.has(e.name.toLowerCase()))
        .map((e) => walk(root, path.join(dir, e.name), depth + 1, repoDir, supabaseId, insideProject, inWorkspace, budget === null ? null : budget - 1)),
    );
  }

  await Promise.all(settings.roots.map((root) => walk(root, root, 0, null, null, false)));
  const shown = settings.showAllProjects ? raw : raw.filter((p) => isUseful(p) || p.workspaceRoot);
  const projects = groupProjects(shown, repos, markerDirs, supabaseConfigs).filter((p, _, all) =>
    settings.showAllProjects || isUseful(p) || all.some((o) => o.group.id === p.group.id && o !== p && isUseful(o)),
  );
  repos.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { projects, repos, supabaseConfigs, scannedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
}

/** Ce qui intéresse : lançable (web, API, mobile/Expo, worker) ou projet Python (console). */
function isUseful(p: { serve: unknown; language: Tech; kind: string; synthetic?: boolean }) {
  return !!p.serve || p.language.id === 'python';
}

const CONTAINER_MARKERS = /^(readme(\.\w+)?|(docker-)?compose\.ya?ml|.*\.code-workspace|makefile|justfile|\.env)$/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const isUnder = (dir: string, parent: string) => dir.startsWith(parent + path.sep);

/**
 * Regroupement en « projets dev ». La racine d'un groupe est l'ancêtre le plus haut (racine de scan exclue)
 * parmi :
 *  - un dépôt git,
 *  - une racine de workspace (monorepo),
 *  - un vrai projet (ses sous-projets lui sont rattachés),
 *  - un dossier « conteneur » contenant ≥ 2 projets et soit un marqueur (README, compose, .code-workspace,
 *    supabase…), soit des sous-dossiers qui reprennent son nom (proconnect/ → proconnect-api, proconnect-web).
 * Les éléments isolés (page HTML seule, scripts sans outillage) vont dans le groupe « Divers ».
 */
function groupProjects(raw: RawProject[], repos: LocalRepo[], markerDirs: Set<string>, sb: SupabaseConfigRef[]): Project[] {
  const roots = new Set(settings.roots);
  const real = raw.filter((p) => !p.loose);
  const repoDirs = new Set(repos.map((r) => r.dir));
  const realDirs = new Set(real.map((p) => p.dir));
  const workspaceDirs = new Set(real.filter((p) => p.workspaceRoot).map((p) => p.dir));

  const rootOf = (dir: string) => settings.roots.find((r) => dir === r || isUnder(dir, r)) ?? path.dirname(dir);
  /** Ancêtres stricts, du plus haut au plus bas, racine de scan exclue. */
  const ancestors = (dir: string) => {
    const out: string[] = [];
    const root = rootOf(dir);
    for (let d = path.dirname(dir); d !== root && isUnder(d, root); d = path.dirname(d)) out.unshift(d);
    return out;
  };
  const unitsUnder = (dir: string) => real.filter((p) => isUnder(p.dir, dir));

  // Dossiers conteneurs (ni dépôt, ni projet) qui méritent un groupe.
  const containerDirs = new Set<string>();
  const plainAncestors = new Set(real.flatMap((p) => ancestors(p.dir)).filter((d) => !repoDirs.has(d) && !realDirs.has(d) && !roots.has(d)));
  for (const d of plainAncestors) {
    const units = unitsUnder(d);
    if (units.length < 2) continue;
    const firstLevel = new Set(units.map((u) => path.relative(d, u.dir).split(path.sep)[0]));
    const key = norm(path.basename(d));
    const named = key.length >= 3 && [...firstLevel].filter((f) => norm(f).includes(key)).length >= 2;
    const sbHere = sb.some((c) => c.dir === d);
    if (named || markerDirs.has(d) || sbHere) containerDirs.add(d);
  }

  const isCandidate = (d: string) => !roots.has(d) && (repoDirs.has(d) || workspaceDirs.has(d) || realDirs.has(d) || containerDirs.has(d));
  const groupRootOf = (p: RawProject) => [...ancestors(p.dir), p.dir].find(isCandidate) ?? p.dir;

  const byRoot = new Map<string, RawProject[]>();
  const loose: RawProject[] = [];
  for (const p of raw) {
    if (p.loose) {
      // Dépôt « nu » qui contient de vraies apps : il devient la racine de leur groupe.
      if (repoDirs.has(p.dir) && unitsUnder(p.dir).length) p.loose = false;
      // Script ou page isolée dans un vrai projet : fait partie du projet parent, pas listé.
      else if (ancestors(p.dir).some((d) => realDirs.has(d))) continue;
      else {
        loose.push(p);
        continue;
      }
    }
    const g = groupRootOf(p);
    byRoot.set(g, [...(byRoot.get(g) ?? []), p]);
  }

  const out: Project[] = [];
  const repoName = new Map(repos.map((r) => [r.dir, r.name]));
  const detected = (p: RawProject) => resolveName(p.dir, p.technical, undefined);
  /** Nom affiché : choisi à la main > nom du projet git > nom d'app détecté > nom technique. */
  const nameOf = (p: RawProject): ReturnType<typeof resolveName> => {
    const o = settings.names[p.dir];
    if (o) return { name: o, source: 'override', strong: true };
    const g = repoName.get(p.dir);
    if (g) return { name: g, source: 'git' as NameSource, strong: true };
    return detected(p);
  };
  const childName = (p: RawProject) => {
    const o = settings.names[p.dir];
    if (o) return { name: o, source: 'override' as NameSource, strong: true };
    const g = repoName.get(p.dir);
    if (g) return { name: g, source: 'git' as NameSource, strong: true };
    return { name: p.technical ?? path.basename(p.dir), source: (p.technical ? 'package' : 'folder') as NameSource, strong: false };
  };

  for (const [gdir, members] of byRoot) {
    let rootUnit = members.find((m) => m.dir === gdir) ?? null;
    let units = members;

    // Racine sans outillage propre (dépôt nu, dossier conteneur) : projet synthétique s'il y a ≥ 2 apps.
    if (!rootUnit) {
      if (members.length === 1) {
        const only = members[0];
        out.push(finalize(only, { root: only, members: [only], gdir: only.dir, rootName: nameOf(only) }));
        continue;
      }
      rootUnit = synthetic(gdir, members, sb);
      units = [rootUnit, ...members];
    }

    // Nom du groupe : celui de la racine s'il est « fort », sinon le nom fort le plus fréquent parmi les apps.
    let rootName = nameOf(rootUnit);
    if (!rootName.strong) {
      const strong = members.filter((m) => m !== rootUnit).map(nameOf).filter((n) => n.strong);
      const counts = new Map<string, number>();
      for (const n of strong) counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) rootName = { name: best[0], source: strong.find((n) => n.name === best[0])!.source, strong: true };
    }
    for (const u of units) out.push(finalize(u, { root: rootUnit, members: units, gdir, rootName }));
  }

  for (const p of loose) {
    const n = nameOf(p);
    out.push({
      ...strip(p), name: n.name, techName: p.technical ?? path.basename(p.dir), nameSource: n.source, synthetic: false, appName: null, prodUrl: prodUrlOf(p, p.dir),
      group: { id: LOOSE_GROUP_ID, dir: '', relPath: '', name: 'Divers', nameSource: 'folder', isRoot: false, subPath: p.relPath, type: 'loose', monorepoTool: null, size: loose.length },
    });
  }

  return out.sort((a, b) =>
    a.group.type === 'loose' ? 1 : b.group.type === 'loose' ? -1
      : a.group.name.localeCompare(b.group.name, 'fr', { sensitivity: 'base' }) || a.group.id.localeCompare(b.group.id)
        || Number(b.group.isRoot) - Number(a.group.isRoot) || a.group.subPath.localeCompare(b.group.subPath),
  );

  function finalize(p: RawProject, g: { root: RawProject; members: RawProject[]; gdir: string; rootName: ReturnType<typeof nameOf> }): Project {
    const isRoot = p === g.root;
    const own = isRoot ? g.rootName : childName(p);
    const app = detected(p);
    const children = g.members.length - 1;
    const type: GroupInfo['type'] =
      children === 0 ? 'single'
        : g.root.workspaceRoot || (repoDirs.has(g.gdir) && g.members.every((m) => m.repoDir === g.gdir)) ? 'monorepo'
          : repoDirs.has(g.gdir) ? 'repo' : 'folder';
    return {
      ...strip(p),
      name: own.name,
      techName: p.technical ?? path.basename(p.dir),
      nameSource: own.source,
      appName: app.strong && app.name.toLowerCase() !== own.name.toLowerCase() ? app.name : null,
      prodUrl: prodUrlOf(p, g.gdir),
      synthetic: p.id.startsWith('g-'),
      group: {
        id: projectId(g.gdir),
        dir: g.gdir,
        relPath: displayPath(rootOf(g.gdir), g.gdir),
        name: g.rootName.name,
        nameSource: g.rootName.source,
        isRoot,
        subPath: path.relative(g.gdir, p.dir),
        type,
        monorepoTool: g.root.monorepoTool,
        size: g.members.length,
      },
    };
  }
}

/** URL de prod : saisie manuelle, sinon .env de l'app puis de la racine du projet. */
function prodUrlOf(p: RawProject, groupDir: string): Project['prodUrl'] {
  const manual = settings.urls[p.dir];
  if (manual) return { url: manual, source: 'manual', manual: true }; // libellé traduit côté client (manual)
  const found = detectProdUrl(p.dir === groupDir ? [p.dir] : [p.dir, groupDir], p.kind === 'service');
  return found ? { ...found, manual: false } : null;
}

function strip(p: RawProject): Omit<Project, 'name' | 'techName' | 'nameSource' | 'group' | 'synthetic' | 'appName' | 'prodUrl'> {
  const { technical: _t, workspaceRoot: _w, monorepoTool: _m, ...rest } = p;
  return rest;
}

/** Projet représentant la racine d'un groupe sans outillage propre (README, console, git au niveau du dossier). */
function synthetic(dir: string, members: RawProject[], sb: SupabaseConfigRef[]): RawProject {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { /* illisible */ }
  const readme = names.find((n) => README_RE.test(n));
  const langs = new Map<string, { t: Tech; n: number }>();
  for (const m of members) {
    const e = langs.get(m.language.id) ?? { t: m.language, n: 0 };
    e.n++;
    langs.set(m.language.id, e);
  }
  const language = [...langs.values()].sort((a, b) => b.n - a.n)[0].t;
  const root = settings.roots.find((r) => isUnder(dir, r)) ?? path.dirname(dir);
  const compose = names.find((n) => /^(docker-)?compose\.ya?ml$/.test(n));
  return {
    id: 'g-' + projectId(dir),
    technical: null,
    activityAt: members.map((m) => m.activityAt).filter(Boolean).sort().at(-1) ?? null,
    dir,
    root,
    relPath: displayPath(root, dir),
    kind: 'other',
    description: null,
    language,
    languages: [...langs.values()].map((l) => l.t),
    platform: null,
    framework: null,
    packageManager: null,
    serve: null,
    commands: compose ? [
      { id: 'compose:up', label: 'compose up', cmd: 'docker compose up', group: 'run' },
      { id: 'compose:down', label: 'compose down', cmd: 'docker compose down', group: 'tool' },
    ] : [],
    defaultCommand: null,
    env: {},
    pathPrepend: [],
    readme: readme ? path.join(dir, readme) : null,
    repoDir: members.find((m) => m.repoDir && (m.repoDir === dir || isUnder(dir, m.repoDir)))?.repoDir ?? null,
    supabaseProjectId: sb.find((c) => c.dir === dir)?.projectId ?? members.find((m) => m.supabaseProjectId)?.supabaseProjectId ?? null,
    loose: false,
    workspaceRoot: false,
    monorepoTool: null,
  };
}
