/**
 * Copies `Todolist/*.json` des projets :
 * import initial au démarrage, puis ré-import quand le fichier change (régénéré par Claude).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tr, uiLang } from '../i18n.js';
import { COPY_FILE_RE, type SuiviService, type SuiviFile } from './service.js';
import { buildTheme, detectPrimary } from './theme.js';
import type { Theme } from './types.js';

/** Dossier du suivi à la racine des projets (réglage, `Todolist` par défaut). */
let SUIVI_DIR = 'Todolist';
export const setSuiviDir = (d: string) => { SUIVI_DIR = d; };

export interface SuiviConfig {
  projectId?: string;
  name?: string;
  brand?: string;
  title?: string;
  subtitle?: string;
  artifactUrl?: string;
  theme?: Theme;
  /** Nom du fichier de copie dans `Todolist/`. */
  file?: string;
  /** Clé `localStorage` des phases ouvertes dans l'artefact (compatibilité avec un artefact antérieur au gabarit). */
  uiKey?: string;
  /** Nom de l'artefact (onglet, galerie) s'il en a déjà un ; défaut « Todolist <Nom> ». */
  artifactTitle?: string;
}

/** Dossier racine d'un projet scanné, avec de quoi calculer son identifiant de suivi. */
export interface ProjectRoot {
  dir: string;
  name: string;
  /** `github.com/owner/repo` (clé de remote normalisée), si le dépôt a un remote. */
  remoteKey: string | null;
}

const readJson = <T>(f: string): T | null => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T; } catch { return null; } };

/** `owner/repo` du remote, sinon le nom du dossier. */
export function projectIdOf(root: ProjectRoot, config: SuiviConfig | null): string {
  if (config?.projectId) return config.projectId;
  const m = root.remoteKey?.match(/^[^/]+\/(.+)$/);
  return m ? m[1] : path.basename(root.dir).replace(/[^\w.-]/g, '-').replace(/^[^A-Za-z0-9]+/, '') || 'projet';
}

/** Fichier de copie : celui de la config, sinon le premier `Todolist/*.json` qui contient un tableau `tasks`. */
export function findCopyFile(dir: string, config: SuiviConfig | null): string | null {
  const d = path.join(dir, SUIVI_DIR);
  if (config?.file && fs.existsSync(path.join(d, config.file))) return config.file;
  let names: string[];
  try { names = fs.readdirSync(d).filter((n) => n.endsWith('.json') && n !== 'suivi.config.json').sort((a, b) => (a === 'suivi.json' ? -1 : b === 'suivi.json' ? 1 : a.localeCompare(b))); } catch { return null; }
  return names.find((n) => Array.isArray(readJson<SuiviFile>(path.join(d, n))?.tasks)) ?? null;
}

const FONTS = ['Montserrat', 'Poppins', 'Inter', 'Roboto', 'Manrope', 'Outfit', 'DM Sans', 'Plus Jakarta Sans', 'Nunito', 'Lato', 'Space Grotesk', 'Sora'];
/** Police de titres citée dans le CLAUDE.md du projet, s'il y en a une connue (Google Fonts). */
export function detectDisplayFont(dir: string) {
  let md = '';
  try { md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'); } catch { return undefined; }
  return FONTS.find((f) => md.includes(f) && f !== 'Inter');
}

/** Vrai si `dir` est le worktree principal de son dépôt (pas un worktree lié), via `git rev-parse --git-common-dir`. */
function isMainWorktree(dir: string): boolean {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    return fs.realpathSync(path.dirname(common)) === fs.realpathSync(dir);
  } catch { return false; }
}

const dirExists = (d: string | undefined): d is string => !!d && fs.existsSync(d) && fs.statSync(d).isDirectory();

export class TodolistWatcher {
  /** projectId → dossier racine, pour la surveillance. */
  private roots = new Map<string, ProjectRoot>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private service: SuiviService,
    private log: (msg: string) => void = () => {},
    /** Dossiers où l'écriture de la copie est permise (dossiers scannés). */
    private allowDir: (dir: string) => boolean = () => true,
  ) {}

  /** Appelé après chaque scan : enregistre les projets qui ont un `Todolist/` et importe leurs copies. */
  sync(roots: ProjectRoot[]) {
    const seen = new Set<string>();
    const chosen = new Set<string>();
    // Worktree principal d'abord : les worktrees liés (même projectId) ne le supplantent pas.
    const ordered = roots.map((r) => ({ r, main: isMainWorktree(r.dir) })).sort((a, b) => Number(b.main) - Number(a.main)).map((x) => x.r);
    for (const root of ordered) {
      if (seen.has(root.dir)) continue;
      seen.add(root.dir);
      const config = readJson<SuiviConfig>(path.join(root.dir, SUIVI_DIR, 'suivi.config.json'));
      const file = findCopyFile(root.dir, config);
      if (!file && !config) continue;
      const projectId = projectIdOf(root, config);
      if (chosen.has(projectId)) continue;
      chosen.add(projectId);
      this.roots.set(projectId, root);
      try {
        this.register(projectId, root, config, file);
        if (file) this.importIfNewer(projectId, root.dir, file);
      } catch (e: any) {
        this.service.recordSync(projectId, 'file', tr({ en: 'Error: {error}', fr: 'Erreur : {error}' }, { error: e.message }, uiLang()));
        this.log(`[suivi] ${projectId} : ${e.message}`);
      }
    }
  }

  private register(projectId: string, root: ProjectRoot, config: SuiviConfig | null, file: string | null) {
    const prev = this.service.getProject(projectId);
    const brand = config?.brand ?? prev?.brand ?? (config?.name ?? root.name).toUpperCase();
    const source = file ? readJson<SuiviFile>(path.join(root.dir, SUIVI_DIR, file))?.source : null;
    const artifactUrl = config?.artifactUrl ?? prev?.artifactUrl ?? (typeof source === 'string' && source.startsWith('https://claude.ai/') ? source : null);
    // La config du dépôt fait foi ; sinon on garde le thème déjà enregistré, sinon on le détecte.
    const theme = config?.theme ?? prev?.theme ?? buildTheme(detectPrimary(root.dir), brand, { display: detectDisplayFont(root.dir) });
    if (prev && !config && prev.paths.includes(root.dir) && (prev.artifactUrl ?? null) === artifactUrl) return;
    this.service.registerProject({
      projectId,
      name: config?.name ?? prev?.name ?? root.name,
      brand,
      title: config?.title,
      subtitle: config?.subtitle,
      artifactUrl,
      theme,
      paths: [root.dir],
      copyFile: file ?? config?.file ?? 'suivi.json',
    });
  }

  /** Importe la copie si elle a changé depuis le dernier import (marqueur = mtime). */
  importIfNewer(projectId: string, dir: string, file: string) {
    const f = path.join(dir, SUIVI_DIR, file);
    let mtime: string;
    try { mtime = String(fs.statSync(f).mtimeMs); } catch { return; }
    const last = this.service.syncs(projectId).find((s) => s.channel === 'file');
    if (last?.marker === mtime) return;
    const json = readJson<SuiviFile>(f);
    if (!json) return this.service.recordSync(projectId, 'file', tr({ en: 'Unreadable JSON: {file}', fr: 'JSON illisible : {file}' }, { file }, uiLang()), mtime);
    const lang = uiLang();
    const r = this.service.importFile(projectId, json, 'claude', tr({ en: 'file {file}', fr: 'fichier {file}' }, { file }, lang));
    const lost = r.lost ? tr({ en: ', {n} conflict(s) kept in the log', fr: ', {n} écart(s) gardé(s) au journal' }, { n: r.lost }, lang) : '';
    this.service.recordSync(projectId, 'file', tr({ en: '{file}: {created} created, {updated} updated, {unchanged} unchanged{lost}', fr: '{file} : {created} créée(s), {updated} mise(s) à jour, {unchanged} inchangée(s){lost}' }, { file, created: r.created, updated: r.updated, unchanged: r.unchanged, lost }, lang), mtime);
    if (r.created || r.updated) this.log(`[suivi] ${projectId} ← ${file} (${r.created} created, ${r.updated} updated)`);
  }

  /**
   * Régénère la copie `Todolist/<fichier>` depuis la base (règle « copie à chaque changement »).
   * Le `$schema` d'une copie existante est conservé ; le marqueur évite de la ré-importer aussitôt.
   */
  writeCopy(projectId: string): string {
    const p = this.service.requireProject(projectId);
    // Premier dossier qui existe : jamais de création d'un dossier de projet absent (worktree supprimé).
    const dir = [this.roots.get(projectId)?.dir, ...p.paths].find(dirExists);
    if (!dir) throw new Error(tr({ en: 'No known folder for this project', fr: 'Aucun dossier connu pour ce projet' }));
    if (!COPY_FILE_RE.test(p.copyFile)) throw new Error(tr({ en: 'Invalid copy name: {file}', fr: 'Nom de copie invalide : {file}' }, { file: p.copyFile }));
    if (!this.allowDir(dir)) throw new Error(tr({ en: 'Folder outside the scanned folders: {dir}', fr: 'Dossier hors des dossiers scannés : {dir}' }, { dir }));
    const todo = path.join(dir, SUIVI_DIR);
    const f = path.join(todo, p.copyFile);
    if (path.dirname(f) !== todo) throw new Error(tr({ en: 'Invalid copy path', fr: 'Chemin de copie invalide' }));
    fs.mkdirSync(todo, { recursive: true });
    // Jamais d'écriture à travers un lien symbolique (dossier ou fichier).
    for (const x of [todo, f]) if (fs.existsSync(x) && fs.lstatSync(x).isSymbolicLink()) throw new Error(tr({ en: 'Symbolic link refused: {path}', fr: 'Lien symbolique refusé : {path}' }, { path: x }));
    const prev = readJson<SuiviFile>(f);
    const out = { ...(prev?.$schema ? { $schema: prev.$schema } : {}), ...this.service.exportFile(projectId) };
    fs.writeFileSync(f, JSON.stringify(out, null, 2) + '\n');
    this.service.recordSync(projectId, 'file', tr({ en: '{file} written from Tarmac ({n} tasks)', fr: '{file} écrite depuis Tarmac ({n} tâches)' }, { file: p.copyFile, n: out.tasks.length }, uiLang()), String(fs.statSync(f).mtimeMs));
    return f;
  }

  /** Options du gabarit d'artefact tirées du dépôt : `uiKey` de la config, `$schema` de la copie. */
  artifactExtras(projectId: string): { uiKey?: string; schema?: string; title?: string } {
    const p = this.service.getProject(projectId);
    const dir = this.roots.get(projectId)?.dir ?? p?.paths[0];
    if (!p || !dir) return {};
    const config = readJson<SuiviConfig>(path.join(dir, SUIVI_DIR, 'suivi.config.json'));
    const schema = readJson<SuiviFile>(path.join(dir, SUIVI_DIR, p.copyFile))?.$schema;
    const ok = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : undefined);
    return { uiKey: ok(config?.uiKey, /^[\w:.-]{1,60}$/), schema: ok(schema, /^https?:\/\/[\w./-]{1,200}$/), title: ok(config?.artifactTitle, /^[^<>\n]{1,60}$/) };
  }

  /** Surveillance légère des copies connues (un `stat` par projet). */
  start(intervalMs = 10_000) {
    this.timer ??= setInterval(() => {
      for (const [projectId, root] of this.roots) {
        const p = this.service.getProject(projectId);
        if (p) try { this.importIfNewer(projectId, root.dir, p.copyFile); } catch (e: any) { this.log(`[suivi] ${projectId} : ${e.message}`); }
      }
    }, intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
