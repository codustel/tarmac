import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alpha, ANSI, contrast, ensureContrast, mix, SYNTAX } from './palette';

/** Fond de l'éditeur et du terminal de l'IDE : `--panel` de index.css. */
const PANEL = { light: '#ffffff', dark: '#12151c' } as const;

test('coloration syntaxique : contraste WCAG AA (4,5:1) sur le fond de l’éditeur, clair et sombre', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const [k, c] of Object.entries(SYNTAX[mode])) {
      for (const color of Array.isArray(c) ? c : [c]) {
        assert.ok(contrast(color, PANEL[mode]) >= 4.5, `${mode} ${k} ${color} : ${contrast(color, PANEL[mode]).toFixed(2)}`);
      }
    }
  }
});

test('terminal : les 16 couleurs ANSI restent lisibles (4,5:1) sur le fond du panneau', () => {
  for (const mode of ['light', 'dark'] as const) {
    assert.equal(Object.keys(ANSI[mode]).length, 16);
    for (const [k, c] of Object.entries(ANSI[mode])) {
      assert.ok(contrast(c, PANEL[mode]) >= 4.5, `${mode} ${k} ${c} : ${contrast(c, PANEL[mode]).toFixed(2)}`);
    }
  }
});

test('mélanges de couleurs', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#4f46e5', '#4f46e5', 0.3), '#4f46e5');
  assert.equal(alpha('#4f46e5', 0.2), '#4f46e533');
  assert.equal(contrast('#000000', '#ffffff').toFixed(0), '21');
});

test('icônes Seti : couleurs ajustées seulement quand le contraste manque', () => {
  assert.equal(ensureContrast('#cc3e44', '#f6f7f9', 3.5), '#cc3e44');
  const yellow = ensureContrast('#cbcb41', '#f6f7f9', 3.5);
  assert.notEqual(yellow, '#cbcb41');
  assert.ok(contrast(yellow, '#f6f7f9') >= 3.5);
  assert.ok(contrast(ensureContrast('#41535b', '#0b0d12', 3.5), '#0b0d12') >= 3.5);
});
