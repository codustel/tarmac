/**
 * Page de l'artefact de suivi d'un projet : le gabarit commun `templates/suivi-artifact.html`
 * avec la marque, le titre et le thème du projet injectés. Les tâches restent dans la db de l'artefact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SuiviProject, ThemeVariant } from './types.js';

// Même chemin depuis les sources (server/suivi) et depuis le bundle (dist/server).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = [path.resolve(HERE, '../../templates/suivi-artifact.html'), path.resolve(HERE, '../templates/suivi-artifact.html')].find((f) => fs.existsSync(f))!;

/** Couleurs d'état communes à tous les projets (ok, ambre « à tester », cyan « Claude »). */
const STATUS = {
  light: { ok: '#047857', 'ok-soft': '#D1FAE5', 'ok-line': '#6EE7B7', amber: '#B45309', 'amber-soft': '#FEF3C7', 'amber-line': '#F59E0B', cyan: '#0284C7', 'cyan-soft': '#E0F2FE' },
  dark: { ok: '#34D399', 'ok-soft': '#0F2E24', 'ok-line': '#1E5A45', amber: '#F5A524', 'amber-soft': '#3A2A0C', 'amber-line': '#6B4A12', cyan: '#38BDF8', 'cyan-soft': '#0E2A38' },
};

const vars = (v: ThemeVariant, status: Record<string, string>) =>
  Object.entries({
    bg: v.bg, surface: v.surface, 'surface-2': v.surface2, line: v.line, fg: v.fg, muted: v.muted,
    primary: v.primary, 'primary-soft': v.primarySoft, 'primary-text': v.primaryText, ...status,
  }).map(([k, c]) => `--${k}:${c}`).join(';');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface ArtifactOptions {
  bridgeIntervalSec: number;
  /** Clé `localStorage` des phases ouvertes (un artefact antérieur au gabarit peut garder la sienne). */
  uiKey?: string;
  /** `$schema` de la sauvegarde JSON, repris de la copie du dépôt. */
  schema?: string;
  /** Nom de l'artefact, s'il en a déjà un (gardé d'une publication à l'autre). */
  title?: string;
}

export function renderArtifact(p: SuiviProject, opts: ArtifactOptions): string {
  const t = p.theme;
  const fonts = `--display:'${t.fonts.display}',Arial,sans-serif;--body:'${t.fonts.body}',Arial,sans-serif;--mono:'${t.fonts.mono}','Courier New',monospace`;
  // Thème clair par défaut, sombre selon le système (sauf choix « Clair »), ou forcé par « Sombre ».
  const theme = [
    `:root{color-scheme:light;${fonts};${vars(t.light, STATUS.light)}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;${vars(t.dark, STATUS.dark)}}}`,
    `:root[data-theme="dark"]{color-scheme:dark;${vars(t.dark, STATUS.dark)}}`,
  ].join('\n');
  const families = [...new Set([t.fonts.display, t.fonts.body, t.fonts.mono])].filter((f) => /^[A-Za-z0-9 ]+$/.test(f));
  const fontLink = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700;800`).join('&')}&display=swap">`;
  const config = {
    projectId: p.projectId, brand: p.brand, title: p.title, subtitle: p.subtitle, copyFile: p.copyFile,
    bridgeIntervalSec: opts.bridgeIntervalSec, ...(opts.uiKey ? { uiKey: opts.uiKey } : {}), ...(opts.schema ? { schema: opts.schema } : {}),
  };
  return fs.readFileSync(TEMPLATE, 'utf8')
    .replace('__TITLE__', () => esc((opts.title ?? `Todolist ${p.name.charAt(0).toUpperCase()}${p.name.slice(1)}`).slice(0, 60)))
    .replace('__FONTS__', () => fontLink)
    .replace('__CONFIG__', () => JSON.stringify(config).replace(/</g, '\\u003c'))
    .replace('__THEME__', () => theme);
}
