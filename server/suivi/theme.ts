/**
 * Charte d'un projet : variantes claire et sombre calculées depuis la couleur primaire,
 * avec un contraste WCAG AA (4,5:1) pour le texte en couleur primaire.
 * Les neutres sombres sont ceux du premier artefact de suivi.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Theme, ThemeVariant } from './types.js';

export const DEFAULT_PRIMARY = '#6366F1'; // accent de Tarmac
const HEX_RE = /^#[0-9a-f]{6}$/i;

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
/** Mélange `a` vers `b` (t = 0 → a, 1 → b). */
const mix = (a: string, b: string, t: number) => { const x = toRgb(a), y = toRgb(b); return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB); };

function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Assombrit (vers le noir) ou éclaircit (vers le blanc) jusqu'au contraste demandé. */
function ensureContrast(color: string, bg: string, ratio: number) {
  const toward = luminance(bg) > 0.5 ? '#000000' : '#FFFFFF';
  let c = color;
  for (let t = 0.05; contrast(c, bg) < ratio && t <= 1; t += 0.05) c = mix(color, toward, t);
  return c;
}

export function buildTheme(primaryIn: string | null | undefined, brand: string, fonts?: Partial<Theme['fonts']>): Theme {
  const primary = primaryIn && HEX_RE.test(primaryIn) ? primaryIn.toUpperCase() : DEFAULT_PRIMARY;
  const darkBg = '#0D0D0F';
  const dark: ThemeVariant = {
    bg: darkBg, surface: '#17171A', surface2: '#1F1F23', line: '#2C2C31', fg: '#F2F2F4', muted: '#A9A9B3',
    primary,
    primarySoft: mix(darkBg, primary, 0.2),
    primaryText: ensureContrast(mix(primary, '#FFFFFF', 0.45), mix(darkBg, primary, 0.2), 4.5),
  };
  const lightBg = '#FFFFFF';
  const lightPrimary = ensureContrast(primary, lightBg, 4.5);
  const light: ThemeVariant = {
    bg: lightBg, surface: '#F7F7F9', surface2: '#EFEFF3', line: '#E2E2E8', fg: '#141417', muted: '#5E5E6A',
    primary: lightPrimary,
    primarySoft: mix(lightBg, primary, 0.1),
    primaryText: ensureContrast(lightPrimary, mix(lightBg, primary, 0.1), 4.5),
  };
  return {
    brand,
    primary,
    fonts: { display: fonts?.display ?? 'Inter', body: fonts?.body ?? 'Inter', mono: fonts?.mono ?? 'JetBrains Mono' },
    dark,
    light,
  };
}

const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const firstHex = (s: string | null, re: RegExp) => { const m = s?.match(re); return m ? `#${m[1]}` : null; };

/**
 * Couleur primaire détectée dans le projet (étapes 2 à 4 ; l'étape 1, `suivi.config.json`,
 * est lue par l'appelant ; le logo viendra avec `/suivi theme`).
 */
export function detectPrimary(dir: string): string | null {
  for (const f of ['CLAUDE.md', 'docs/design.md', 'DESIGN.md']) {
    const hex = firstHex(read(path.join(dir, f)), /primary[^#\n]{0,40}#([0-9a-f]{6})\b/i);
    if (hex) return hex;
  }
  for (const f of ['src/index.css', 'src/app/globals.css', 'app/globals.css', 'src/styles/globals.css', 'styles/globals.css']) {
    const hex = firstHex(read(path.join(dir, f)), /--(?:color-)?primary\s*:\s*#([0-9a-f]{6})\b/i);
    if (hex) return hex;
  }
  const appJson = read(path.join(dir, 'app.json'));
  const hex = firstHex(appJson, /"primaryColor"\s*:\s*"#([0-9a-f]{6})"/i)
    ?? firstHex(read(path.join(dir, 'public/manifest.json')), /"theme_color"\s*:\s*"#([0-9a-f]{6})"/i);
  return hex;
}

const FONT_RE = /^[A-Za-z0-9 _-]{1,40}$/;
const VARIANT_KEYS = ['bg', 'surface', 'surface2', 'line', 'fg', 'muted', 'primary', 'primarySoft', 'primaryText'] as const;

/**
 * Thème venu de l'extérieur (`suivi.config.json`, MCP) : chaque couleur doit être un `#RRGGBB` et chaque
 * police un nom simple, sinon le thème est recalculé depuis la primaire (valeurs injectées en CSS).
 */
export function sanitizeTheme(raw: unknown, brand: string): Theme {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const primary = typeof t.primary === 'string' && HEX_RE.test(t.primary) ? t.primary : null;
  const fonts = Object.fromEntries((['display', 'body', 'mono'] as const)
    .map((k) => [k, typeof t.fonts?.[k] === 'string' && FONT_RE.test(t.fonts[k]) ? t.fonts[k] : undefined]));
  const built = buildTheme(primary, brand, fonts);
  const variant = (v: any, fallback: ThemeVariant): ThemeVariant =>
    VARIANT_KEYS.every((k) => typeof v?.[k] === 'string' && HEX_RE.test(v[k]))
      ? (Object.fromEntries(VARIANT_KEYS.map((k) => [k, v[k].toUpperCase()])) as unknown as ThemeVariant)
      : fallback;
  return { ...built, dark: variant(t.dark, built.dark), light: variant(t.light, built.light) };
}
