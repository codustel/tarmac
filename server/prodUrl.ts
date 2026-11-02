import fs from 'node:fs';
import path from 'node:path';
import { readJson, readText } from './detectors/types.js';

/**
 * URL de production d'une app, lue dans ses fichiers d'environnement.
 * Ordre des fichiers : .env.production(.local) > .env > .env.local > .env.example/.sample,
 * puis `homepage` (package.json), `public/CNAME`, `vercel.json` (alias).
 */
export interface ProdUrl {
  url: string;
  /** Origine : « .env.production · NEXT_PUBLIC_SITE_URL », « manuel »… */
  source: string;
}

const ENV_FILES = ['.env.production', '.env.production.local', '.env.prod', '.env', '.env.local', '.env.example', '.env.sample', '.env.template'];

const PREFIX = '(?:NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_|NUXT_PUBLIC_|REACT_APP_|GATSBY_|ASTRO_)?';
const SITE_KEYS = ['SITE_URL', 'APP_URL', 'PRODUCTION_URL', 'PROD_URL', 'CANONICAL_URL', 'WEBSITE_URL', 'FRONTEND_URL', 'WEB_URL', 'BASE_URL', 'PUBLIC_URL', 'DOMAIN', 'APP_DOMAIN', 'SITE_DOMAIN', 'URL'];
const API_KEYS = ['API_URL', 'API_BASE_URL', 'BACKEND_URL', 'SERVER_URL', 'API_ENDPOINT'];
const AUTH_KEYS = ['NEXTAUTH_URL', 'AUTH_URL', 'BETTER_AUTH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'];

/** Valeurs à ignorer : local, exemples, services tiers (Supabase, Stripe…). */
const BAD = /localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b|\.test\b|example\.(com|org)|your[-_]?(domain|site|app)|xxx|changeme|<|\$\{|supabase\.(co|in)|stripe\.com|googleapis|sentry\.io|vercel\.app\/?$|ngrok|loca\.lt|github\.com|amazonaws\.com|cloudinary|resend\.com|upstash/i;

function normalize(v: string): string | null {
  let s = v.trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
  if (!s || BAD.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s)) return null; // domaine nu (VERCEL_PROJECT_PRODUCTION_URL)
    s = 'https://' + s;
  }
  try {
    const u = new URL(s);
    return u.hostname.includes('.') ? u.origin + (u.pathname !== '/' ? u.pathname : '') : null;
  } catch {
    return null;
  }
}

function parseEnv(file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of (readText(file) ?? '').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out.set(m[1], m[2].replace(/\s+#.*$/, ''));
  }
  return out;
}

/** Cherche dans `dirs` (dossier de l'app puis racine du projet). `api` : privilégie les clés *_API_URL. */
export function detectProdUrl(dirs: string[], api = false): ProdUrl | null {
  const keyOrder = api ? [...API_KEYS, ...SITE_KEYS, ...AUTH_KEYS] : [...SITE_KEYS, ...AUTH_KEYS];
  const keyRes = keyOrder.map((k) => ({ k, re: new RegExp(`^${PREFIX}${k}$`) }));

  for (const dir of [...new Set(dirs)]) {
    for (const f of ENV_FILES) {
      const file = path.join(dir, f);
      if (!fs.existsSync(file)) continue;
      const env = parseEnv(file);
      for (const { re } of keyRes) {
        for (const [key, value] of env) {
          if (!re.test(key)) continue;
          const url = normalize(value);
          if (url) return { url, source: `${path.relative(dirs[dirs.length - 1], file) || f} · ${key}` };
        }
      }
    }
    const pkg = readJson(path.join(dir, 'package.json'));
    const home = pkg?.homepage && normalize(String(pkg.homepage));
    if (home) return { url: home, source: 'package.json · homepage' };
    for (const f of ['public/CNAME', 'CNAME', 'static/CNAME']) {
      const c = readText(path.join(dir, f))?.trim().split('\n')[0];
      const url = c && normalize(c);
      if (url) return { url, source: f };
    }
    const vercel = readJson(path.join(dir, 'vercel.json'));
    const alias = Array.isArray(vercel?.alias) ? vercel.alias[0] : vercel?.alias;
    const v = alias && normalize(String(alias));
    if (v) return { url: v, source: 'vercel.json · alias' };
  }
  return null;
}
