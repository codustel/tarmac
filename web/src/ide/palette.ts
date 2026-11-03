/** Palette de l'IDE (sans dépendance à Monaco : testée par palette.test.ts). */

// ─── Couleurs ───────────────────────────────────────────────────────────────
export const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
/** Mélange opaque de `a` vers `b` (t = part de `b`). */
export const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => hex2(v + (y[i] - v) * t)).join('')}`;
};
/** Couleur avec transparence (#rrggbbaa). */
export const alpha = (c: string, a: number) => `${c.slice(0, 7)}${hex2(a * 255)}`;

/**
 * Coloration syntaxique : palette sobre accordée à l'indigo. Chaque couleur dépasse 4,5:1 (WCAG AA) sur le fond
 * de l'éditeur (`--panel`), vérifié par palette.test.ts.
 */
export const SYNTAX = {
  light: {
    keyword: '#4f46e5', // indigo-600 (= accent)
    string: '#047857', // emerald-700
    number: '#b45309', // amber-700
    type: '#0369a1', // sky-700
    tag: '#7c3aed', // violet-600
    attribute: '#0e7490', // cyan-700
    regexp: '#be185d', // pink-700
    comment: '#6b7280', // gray-500
    delimiter: '#5b6475', // --muted
    brackets: ['#b45309', '#4f46e5', '#0f766e'],
  },
  dark: {
    keyword: '#a5b4fc', // indigo-300
    string: '#6ee7b7', // emerald-300
    number: '#fcd34d', // amber-300
    type: '#7dd3fc', // sky-300
    tag: '#c4b5fd', // violet-300
    attribute: '#67e8f9', // cyan-300
    regexp: '#f9a8d4', // pink-300
    comment: '#7d879b',
    delimiter: '#9aa3b5', // --muted
    brackets: ['#fcd34d', '#a5b4fc', '#5eead4'],
  },
} as const;
/** Ajouts / suppressions (diff) : vert et rouge des badges de l'app. */
export const DIFF = { light: { add: '#10b981', del: '#ef4444' }, dark: { add: '#34d399', del: '#f87171' } };

/** 16 couleurs ANSI lisibles sur le fond du panneau (clair : teintes 700, sombre : teintes 300-400). */
export const ANSI = {
  light: {
    black: '#334155', red: '#b91c1c', green: '#15803d', yellow: '#a16207', blue: '#1d4ed8', magenta: '#a21caf', cyan: '#0e7490', white: '#64748b',
    brightBlack: '#475569', brightRed: '#dc2626', brightGreen: '#047857', brightYellow: '#b45309', brightBlue: '#4f46e5', brightMagenta: '#c026d3', brightCyan: '#155e75', brightWhite: '#1e293b',
  },
  dark: {
    black: '#7d879b', red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', magenta: '#e879f9', cyan: '#22d3ee', white: '#e5e7eb',
    brightBlack: '#9aa3b5', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde047', brightBlue: '#93c5fd', brightMagenta: '#f0abfc', brightCyan: '#67e8f9', brightWhite: '#ffffff',
  },
};

/** Contraste WCAG entre deux couleurs hexadécimales. */
export function contrast(a: string, b: string) {
  const lum = (h: string) => {
    const [r, g, bl] = rgb(h).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Couleur rapprochée du noir (fond clair) ou du blanc (fond sombre) juste assez pour atteindre `min`:1 sur `bg`
 * (icônes de fichiers Seti, pensées pour un fond sombre : 3:1 au moins, seuil WCAG des éléments graphiques).
 */
export function ensureContrast(color: string, bg: string, min: number) {
  const target = contrast(bg, '#000000') > contrast(bg, '#ffffff') ? '#000000' : '#ffffff';
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(color, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}
