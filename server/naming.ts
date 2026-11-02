import fs from 'node:fs';
import path from 'node:path';
import { readJson, readText } from './detectors/types.js';

/**
 * Nom « produit » d'une application, par ordre de fiabilité :
 *   1. productName / displayName (package.json), Expo, Tauri, Capacitor, Electron
 *   2. manifest PWA (name / short_name)
 *   3. titre de l'app : <title> d'index.html, metadata Next.js, Nuxt, Astro/SvelteKit
 *   4. premier titre H1 du README
 *   5. nom technique (package.json, pyproject, go.mod…) puis nom du dossier
 */
export type NameSource = 'override' | 'git' | 'product' | 'manifest' | 'title' | 'readme' | 'package' | 'folder';

export interface ResolvedName {
  name: string;
  source: NameSource;
  /** Sources 1 à 4 : il s'agit d'un vrai nom d'application, pas d'un identifiant technique. */
  strong: boolean;
}

const GENERIC = new RegExp(
  '^(' +
    [
      'vite', 'vite app', 'vite \\+ .*', 'react app', 'react', 'create next app', 'next\\.?js', 'next app', 'nuxt', 'nuxt app',
      'astro', 'astro basics', 'sveltekit', 'svelte app', 'svelte', 'vue', 'vue app', 'angular', 'my app', 'my-app', 'app',
      'home', 'index', 'document', 'untitled', 'localhost', 'welcome.*', 'hello world', 'title', 'test', 'demo', 'starter',
      'template', 'boilerplate', 'readme', 'monorepo', 'root', 'workspace', 'turborepo', 'web', 'api', 'frontend', 'backend',
      'client', 'server', 'project', 'projet', 'site', 'website', 'remix', 'gatsby.*', 'expo', 'electron', 'tauri app',
    ].join('|') +
    ')$',
  'i',
);

/** « Acme Shop — Gestion de stock » → « Acme Shop » ; supprime le markdown et les emojis de tête. */
export function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw)
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/^[\p{Extended_Pictographic}\s]+/u, '')
    .trim();
  s = s.split(/\s+[—–|·:•]\s+|\s+-\s+/)[0].trim();
  if (s.length < 2 || s.length > 40 || GENERIC.test(s) || /^%|{{|\$\{|^\{/.test(s)) return null;
  return s;
}

const firstMatch = (file: string, re: RegExp) => readText(file)?.match(re)?.[1] ?? null;

function productName(dir: string): string | null {
  const pkg = readJson(path.join(dir, 'package.json'));
  const app = readJson(path.join(dir, 'app.json'));
  const tauri = readJson(path.join(dir, 'src-tauri', 'tauri.conf.json')) ?? readJson(path.join(dir, 'tauri.conf.json'));
  const cap = readJson(path.join(dir, 'capacitor.config.json'));
  const capTs = firstMatch(path.join(dir, 'capacitor.config.ts'), /appName:\s*['"`]([^'"`]+)/);
  return (
    cleanName(pkg?.productName) ??
    cleanName(pkg?.displayName) ??
    cleanName(pkg?.build?.productName) ??
    cleanName(app?.expo?.name) ??
    cleanName(app?.name) ??
    cleanName(tauri?.productName ?? tauri?.package?.productName) ??
    cleanName(cap?.appName) ??
    cleanName(capTs)
  );
}

function manifestName(dir: string): string | null {
  for (const f of ['public/manifest.json', 'public/site.webmanifest', 'public/manifest.webmanifest', 'static/manifest.json', 'manifest.json', 'site.webmanifest']) {
    const m = readJson(path.join(dir, f));
    const n = cleanName(m?.short_name) ?? cleanName(m?.name);
    if (n) return n;
  }
  for (const f of ['app/manifest.ts', 'src/app/manifest.ts']) {
    const src = readText(path.join(dir, f));
    const n = cleanName(src?.match(/short_name:\s*['"`]([^'"`]+)/)?.[1]) ?? cleanName(src?.match(/\bname:\s*['"`]([^'"`]+)/)?.[1]);
    if (n) return n;
  }
  return null;
}

function titleName(dir: string): string | null {
  // Next.js (App Router puis Pages Router)
  for (const f of ['app/layout.tsx', 'src/app/layout.tsx', 'app/layout.jsx', 'src/app/layout.jsx', 'app/layout.ts', 'src/app/layout.ts']) {
    const src = readText(path.join(dir, f));
    if (!src) continue;
    const n =
      cleanName(src.match(/title:\s*\{[^}]*default:\s*['"`]([^'"`]+)/)?.[1]) ??
      cleanName(src.match(/template:\s*['"`]%s\s*[|—–-]\s*([^'"`]+)/)?.[1]) ??
      cleanName(src.match(/title:\s*['"`]([^'"`]+)/)?.[1]) ??
      cleanName(src.match(/applicationName:\s*['"`]([^'"`]+)/)?.[1]);
    if (n) return n;
  }
  // HTML (Vite, CRA, sites statiques, SvelteKit app.html)
  for (const f of ['index.html', 'public/index.html', 'src/app.html']) {
    const n = cleanName(firstMatch(path.join(dir, f), /<title[^>]*>([^<]+)<\/title>/i));
    if (n) return n;
  }
  // Nuxt / config Vite PWA
  for (const f of ['nuxt.config.ts', 'nuxt.config.js', 'app.config.ts', 'vite.config.ts', 'vite.config.js']) {
    const src = readText(path.join(dir, f));
    const n = cleanName(src?.match(/title:\s*['"`]([^'"`]+)/)?.[1]) ?? cleanName(src?.match(/short_name:\s*['"`]([^'"`]+)/)?.[1]);
    if (n) return n;
  }
  // Django : nom du site dans les templates de base
  const base = ['templates/base.html', 'templates/layout.html'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (base) return cleanName(firstMatch(base, /<title[^>]*>([^<{]+)/i));
  return null;
}

export function readmeTitle(dir: string): string | null {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const readme = names.find((n) => /^readme(\.(md|markdown|mdx))?$/i.test(n));
  if (!readme) return null;
  const src = readText(path.join(dir, readme)) ?? '';
  const h1 = src.match(/^#\s+(.+)$/m)?.[1] ?? src.match(/^(.+)\n=+\s*$/m)?.[1] ?? src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return cleanName(h1);
}

export function resolveName(dir: string, technical: string | null | undefined, override?: string): ResolvedName {
  if (override?.trim()) return { name: override.trim(), source: 'override', strong: true };
  const tries: Array<[NameSource, () => string | null]> = [
    ['product', () => productName(dir)],
    ['manifest', () => manifestName(dir)],
    ['title', () => titleName(dir)],
    ['readme', () => readmeTitle(dir)],
  ];
  for (const [source, fn] of tries) {
    const n = fn();
    if (n) return { name: n, source, strong: true };
  }
  const tech = technical && !GENERIC.test(technical) ? technical : null;
  return tech ? { name: tech, source: 'package', strong: false } : { name: path.basename(dir), source: 'folder', strong: false };
}
