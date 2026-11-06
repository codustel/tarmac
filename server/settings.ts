import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { msg } from './i18n.js';

export type Editor = 'vscode' | 'cursor' | 'zed' | 'webstorm';

export interface Settings {
  /** Dossiers locaux scannés (récursivement). */
  roots: string[];
  github: {
    /** Comptes et/ou organisations à suivre. Vide = tout ce qui est accessible au token. */
    owners: string[];
    /** Optionnel : sinon GITHUB_TOKEN, sinon `gh auth token`. Jamais renvoyé à l'UI. */
    token: string;
  };
  portRange: { start: number; end: number };
  scanMaxDepth: number;
  editor: Editor;
  /** Noms d'application choisis à la main, par dossier absolu. */
  names: Record<string, string>;
  /** false (défaut) : seulement les projets web / API / mobile et Python. */
  showAllProjects: boolean;
  /** Utilisation Claude (session, semaine, limites par modèle) affichée dans la sidebar. */
  showClaudeUsage: boolean;
  /** Utilisation Codex (limites du plan ChatGPT) affichée dans la sidebar, si Codex est coché. */
  showCodexUsage: boolean;
  /**
   * Agents de code affichés et pris en charge (sessions, LED, timeline, ▶, usage, doctor). Au moins un.
   * Par défaut Claude Code seul : comportement d'avant Codex, inchangé.
   */
  agents: { claude: boolean; codex: boolean };
  /** Écran d'accueil « outils fournis avec Tarmac » déjà vu (7.14). */
  toolsWelcomeSeen: boolean;
  /** Dossier où sont clonés les repos GitHub (par défaut le premier dossier scanné). */
  cloneDir: string;
  /** URL de production saisie à la main, par dossier absolu. */
  urls: Record<string, string>;
  theme: 'light' | 'dark' | 'system';
  /** Langue de l'interface : `auto` = langue du navigateur (fr*, sinon en). */
  language: 'auto' | 'fr' | 'en';
  /** Projets favoris (dossier absolu de la racine du projet). */
  favorites: string[];
  /** Todolist Claude. */
  suivi: SuiviSettings;
}

export interface SuiviSettings {
  /** Canaux de synchronisation actifs : A pont MCP de l'artefact, B Claude en session, C rattrapage. */
  channels: { A: boolean; B: boolean; C: boolean };
  /** Intervalle du pont MCP dans l'artefact, en secondes. */
  bridgeIntervalSec: number;
  /** Dossier du suivi à la racine de chaque projet. */
  folder: string;
}

const FILE = path.join(config.dataDir, 'settings.json');
const home = os.homedir();
export const expandHome = (p: string) => path.resolve(p.startsWith('~') ? path.join(home, p.slice(1)) : p);

// Seuls les dossiers existants sont retenus (ex. pas de ~/Documents sur une machine de CI).
const defaultRoots = () => (config.devRoots.some((r) => fs.existsSync(r)) ? config.devRoots.filter((r) => fs.existsSync(r)) : config.devRoots.slice(0, 1));

const defaults = (): Settings => ({
  roots: defaultRoots(),
  github: { owners: [], token: '' },
  portRange: config.portRange,
  scanMaxDepth: config.scanMaxDepth,
  editor: 'vscode',
  names: {},
  showAllProjects: false,
  showClaudeUsage: true,
  showCodexUsage: true,
  agents: { claude: true, codex: false },
  toolsWelcomeSeen: false,
  urls: {},
  theme: 'system',
  language: 'auto',
  favorites: [],
  suivi: { channels: { A: true, B: true, C: true }, bridgeIntervalSec: 30, folder: 'Todolist' },
  cloneDir: defaultRoots()[0],
});

function load(): Settings {
  const d = defaults();
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const agents = { ...d.agents, ...s.agents };
    return { ...d, ...s, agents: agents.claude || agents.codex ? agents : d.agents, github: { ...d.github, ...s.github }, portRange: { ...d.portRange, ...s.portRange }, suivi: { ...d.suivi, ...s.suivi, channels: { ...d.suivi.channels, ...s.suivi?.channels } } };
  } catch {
    return d;
  }
}

export const settings: Settings = load();
export const settingsEvents = new EventEmitter();

/** Vue publique : le token est masqué. */
export const publicSettings = () => ({
  ...settings,
  github: { owners: settings.github.owners, tokenSet: !!settings.github.token },
});

export interface SettingsPatch {
  roots?: string[];
  github?: { owners?: string[]; token?: string | null };
  portRange?: { start: number; end: number };
  scanMaxDepth?: number;
  editor?: Editor;
  /** Renommage : { dossier: nom } ; nom vide = retour au nom détecté. */
  names?: Record<string, string>;
  showAllProjects?: boolean;
  showClaudeUsage?: boolean;
  showCodexUsage?: boolean;
  agents?: { claude?: boolean; codex?: boolean };
  toolsWelcomeSeen?: boolean;
  cloneDir?: string;
  urls?: Record<string, string>;
  suivi?: { channels?: Partial<SuiviSettings['channels']>; bridgeIntervalSec?: number; folder?: string };
  theme?: Settings['theme'];
  language?: Settings['language'];
  /** { dossier: true | false } */
  favorites?: Record<string, boolean>;
}

export function updateSettings(patch: SettingsPatch): { errors: string[] } {
  const errors: string[] = [];
  const next: Settings = structuredClone(settings);

  if (patch.roots) {
    const roots = [...new Set(patch.roots.map((r) => r.trim()).filter(Boolean).map(expandHome))];
    if (!roots.length) errors.push(msg('settings.rootRequired'));
    for (const r of roots) if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) errors.push(msg('settings.folderNotFound', { path: r }));
    // Un dossier inclus dans un autre serait scanné deux fois.
    for (const a of roots) for (const b of roots) if (a !== b && a.startsWith(b + path.sep)) errors.push(msg('settings.folderNested', { path: a, parent: b }));
    next.roots = roots;
  }
  if (patch.github?.owners) next.github.owners = [...new Set(patch.github.owners.map((o) => o.trim().replace(/^@|^https?:\/\/github\.com\//g, '').replace(/\/.*$/, '')).filter(Boolean))];
  if (patch.github && patch.github.token !== undefined) next.github.token = (patch.github.token ?? '').trim();
  if (patch.portRange) {
    const { start, end } = patch.portRange;
    if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 1024 && end <= 65535 && end - start >= 10)) errors.push(msg('settings.badPortRange'));
    next.portRange = { start, end };
  }
  if (patch.scanMaxDepth !== undefined) {
    if (!(patch.scanMaxDepth >= 1 && patch.scanMaxDepth <= 12)) errors.push(msg('settings.badDepth'));
    next.scanMaxDepth = patch.scanMaxDepth;
  }
  if (patch.editor) next.editor = patch.editor;
  if (patch.favorites) {
    const set = new Set(next.favorites);
    for (const [dir, on] of Object.entries(patch.favorites)) on ? set.add(dir) : set.delete(dir);
    next.favorites = [...set];
  }
  if (patch.theme && ['light', 'dark', 'system'].includes(patch.theme)) next.theme = patch.theme;
  if (patch.language && ['auto', 'fr', 'en'].includes(patch.language)) next.language = patch.language;
  if (patch.urls) {
    for (const [dir, raw] of Object.entries(patch.urls)) {
      let u = (raw ?? '').trim();
      if (!u) { delete next.urls[dir]; continue; }
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      try { next.urls[dir] = new URL(u).href.replace(/\/$/, ''); } catch { errors.push(msg('settings.badUrl', { url: String(raw) })); }
    }
  }
  if (patch.cloneDir !== undefined) {
    const d = expandHome(patch.cloneDir.trim() || next.roots[0] || config.devRoots[0]);
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) errors.push(msg('settings.cloneDirNotFound', { path: d }));
    next.cloneDir = d;
  }
  if (patch.showAllProjects !== undefined) next.showAllProjects = !!patch.showAllProjects;
  if (patch.showClaudeUsage !== undefined) next.showClaudeUsage = !!patch.showClaudeUsage;
  if (patch.showCodexUsage !== undefined) next.showCodexUsage = !!patch.showCodexUsage;
  if (patch.toolsWelcomeSeen !== undefined) next.toolsWelcomeSeen = !!patch.toolsWelcomeSeen;
  if (patch.agents) {
    for (const k of ['claude', 'codex'] as const) if (typeof patch.agents[k] === 'boolean') next.agents[k] = patch.agents[k]!;
    if (!next.agents.claude && !next.agents.codex) errors.push(msg('settings.agentRequired'));
  }
  if (patch.suivi) {
    const { channels, bridgeIntervalSec, folder } = patch.suivi;
    if (channels) for (const k of ['A', 'B', 'C'] as const) if (typeof channels[k] === 'boolean') next.suivi.channels[k] = channels[k]!;
    if (bridgeIntervalSec !== undefined) {
      if (!(Number.isInteger(bridgeIntervalSec) && bridgeIntervalSec >= 10 && bridgeIntervalSec <= 600)) errors.push(msg('settings.badBridgeInterval'));
      else next.suivi.bridgeIntervalSec = bridgeIntervalSec;
    }
    if (folder !== undefined) {
      if (!/^[\w.-]{1,40}$/.test(folder) || folder.startsWith('.')) errors.push(msg('settings.badSuiviFolder'));
      else next.suivi.folder = folder;
    }
  }
  if (patch.names) {
    for (const [dir, name] of Object.entries(patch.names)) {
      const n = name.trim().slice(0, 60);
      if (n) next.names[dir] = n;
      else delete next.names[dir];
    }
  }

  if (errors.length) return { errors };
  Object.assign(settings, next);
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2), { mode: 0o600 }); // contient éventuellement un token
  settingsEvents.emit('change', patch);
  return { errors };
}
