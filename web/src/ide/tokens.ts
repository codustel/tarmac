import { useSyncExternalStore } from 'react';
import type { ITheme } from '@xterm/xterm';
import { alpha, ANSI } from './palette';

/**
 * Jetons de couleur de l'app (`--bg`, `--panel`, `--accent`… de index.css) lus au moment où un thème s'applique,
 * et bascule clair / sombre en direct (classe `dark` posée sur <html> par App). Sans Monaco : le terminal
 * (chargé partout) s'en sert aussi.
 */

// ─── Clair / sombre en direct ───────────────────────────────────────────────
export const isDark = () => document.documentElement.classList.contains('dark');
// Un seul observateur pour tous les abonnés (une icône de fichier par ligne de l'explorateur, etc.).
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!observer) {
    observer = new MutationObserver(() => listeners.forEach((l) => l()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size) { observer?.disconnect(); observer = null; }
  };
}
/** `true` quand l'app est en thème sombre ; se met à jour à chaque bascule. */
export const useDarkMode = () => useSyncExternalStore(subscribe, isDark, () => false);

// ─── Jetons de l'app ────────────────────────────────────────────────────────
export type Tokens = Record<'bg' | 'panel' | 'panel2' | 'line' | 'fg' | 'muted' | 'faint' | 'accent' | 'accentFg', string>;
const VARS: Record<keyof Tokens, string> = {
  bg: '--bg', panel: '--panel', panel2: '--panel-2', line: '--line', fg: '--fg', muted: '--muted', faint: '--faint', accent: '--accent', accentFg: '--accent-fg',
};
/** Jetons calculés (valeurs hexadécimales de index.css), avec des valeurs de secours si la feuille manque. */
export function readTokens(dark: boolean): Tokens {
  const cs = getComputedStyle(document.documentElement);
  const fallback: Tokens = dark
    ? { bg: '#0b0d12', panel: '#12151c', panel2: '#181c25', line: '#242a36', fg: '#e6e9ef', muted: '#9aa3b5', faint: '#626b7d', accent: '#818cf8', accentFg: '#0b0d12' }
    : { bg: '#f6f7f9', panel: '#ffffff', panel2: '#f1f3f6', line: '#e4e7ec', fg: '#0f172a', muted: '#5b6475', faint: '#98a1b2', accent: '#4f46e5', accentFg: '#ffffff' };
  const out = {} as Tokens;
  for (const k of Object.keys(VARS) as Array<keyof Tokens>) {
    const v = cs.getPropertyValue(VARS[k]).trim();
    out[k] = /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback[k];
  }
  return out;
}

// ─── Terminal (xterm) ───────────────────────────────────────────────────────
/** Thème xterm du terminal intégré : fond du panneau, texte, curseur et sélection de l'app. */
export function terminalTheme(dark = isDark()): ITheme {
  const k = readTokens(dark);
  return {
    background: k.panel,
    foreground: k.fg,
    cursor: k.accent,
    cursorAccent: k.panel,
    selectionBackground: alpha(k.accent, dark ? 0.35 : 0.22),
    selectionInactiveBackground: alpha(k.accent, dark ? 0.2 : 0.12),
    scrollbarSliderBackground: alpha(k.faint, 0.28),
    scrollbarSliderHoverBackground: alpha(k.faint, 0.45),
    scrollbarSliderActiveBackground: alpha(k.faint, 0.6),
    ...ANSI[dark ? 'dark' : 'light'],
  };
}
