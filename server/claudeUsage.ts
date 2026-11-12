import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claudeDir } from './claude.js';

const exec = promisify(execFile);

/**
 * Utilisation de l'abonnement Claude (session de 5 h, semaine, limites hebdomadaires par modèle), comme
 * l'écran `/usage` de Claude Code.
 *
 * Source : `GET https://api.anthropic.com/api/oauth/usage`, authentifié par le jeton OAuth de Claude Code
 * (macOS : trousseau, service `Claude Code-credentials` ; ailleurs `~/.claude/.credentials.json`).
 * Le jeton est relu à chaque rafraîchissement, gardé en mémoire le temps de la requête, envoyé seulement à
 * api.anthropic.com et jamais renvoyé, journalisé ni écrit. Tarmac ne le renouvelle jamais : s'il a expiré,
 * c'est Claude Code qui le renouvelle à son prochain lancement.
 */
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?skip_spend=1';
const OAUTH_BETA = 'oauth-2025-04-20';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
/** Durée de vie du cache (une requête au plus par minute, et seulement quand un client le demande). */
export const CACHE_MS = 60_000;
/** Après un 429 (trop de requêtes) : pause plus longue. */
const BACKOFF_MS = 5 * 60_000;
const TIMEOUT_MS = 6_000;
/**
 * Échéance globale d'un rafraîchissement (au-delà de 2 × 4 s pour le trousseau et 6 s pour le `fetch`) : après
 * une veille du Mac, une attente sous-jacente peut ne jamais se terminer ; sans cette borne, la promesse partagée
 * resterait en attente jusqu'au redémarrage du serveur.
 */
export const LOAD_TIMEOUT_MS = 15_000;

export interface UsageLimit {
  /** `session` (5 h), `week` (tous modèles) ou `model:<nom>` (limite hebdomadaire propre à un modèle). */
  id: string;
  kind: 'session' | 'week' | 'model';
  /** Nom du modèle pour `model` (ex. « Fable »), sinon null. */
  label: string | null;
  /** Pourcentage utilisé (0–100, plus au-delà de la limite). */
  utilization: number;
  /** Remise à zéro (ISO), si connue. */
  resetsAt: string | null;
}

export type UsageStatus = 'ok' | 'disabled' | 'not-connected' | 'expired' | 'error';

/** Réponse de `/api/claude/usage` : plan, limites et remises à zéro, rien d'autre. */
export interface ClaudeUsage {
  status: UsageStatus;
  plan: string | null;
  limits: UsageLimit[];
  fetchedAt: string | null;
  /** Code court pour `error` (`http-503`, `timeout`…), sans donnée sensible. */
  error?: string;
}

/** Identifiants lus localement (le jeton ne sort jamais de ce module). */
export interface Credentials {
  accessToken: string;
  expiresAt: number | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isoOf = (v: unknown) => (typeof v === 'number' ? new Date(v * 1000).toISOString() : str(v));

/** Extrait les identifiants du JSON de Claude Code (`{ claudeAiOauth: { accessToken, … } }`). */
export function parseCredentials(raw: string): Credentials | null {
  let j: any;
  try { j = JSON.parse(raw); } catch { return null; }
  const o = j?.claudeAiOauth;
  const accessToken = str(o?.accessToken);
  if (!accessToken) return null;
  return { accessToken, expiresAt: num(o.expiresAt), subscriptionType: str(o.subscriptionType), rateLimitTier: str(o.rateLimitTier) };
}

/** Lecture des identifiants : trousseau macOS, sinon `<config Claude>/.credentials.json`. Null si absents. */
export async function readCredentials(): Promise<Credentials | null> {
  if (process.platform === 'darwin') {
    // Le trousseau de connexion de l'utilisateur, même si HOME pointe ailleurs (instance isolée).
    const keychain = path.join(os.userInfo().homedir, 'Library', 'Keychains', 'login.keychain-db');
    for (const extra of [[], [keychain]]) {
      try {
        const { stdout } = await exec('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w', ...extra], { timeout: 4000 });
        const c = parseCredentials(stdout.trim());
        if (c) return c;
      } catch { /* absent de ce trousseau : essai suivant (l'erreur n'est jamais journalisée) */ }
    }
  }
  try {
    return parseCredentials(fs.readFileSync(path.join(claudeDir(), '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Nom lisible du plan d'après `subscriptionType` et `rateLimitTier` ; inconnu → valeur brute. */
export function planLabel(subscriptionType: string | null, rateLimitTier: string | null): string | null {
  const tier = (rateLimitTier ?? '').toLowerCase();
  const sub = (subscriptionType ?? '').toLowerCase();
  if (/max_20x/.test(tier)) return 'Max 20x';
  if (/max_5x/.test(tier)) return 'Max 5x';
  const known: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
  if (known[sub]) return known[sub];
  if (/_pro$/.test(tier)) return 'Pro';
  return subscriptionType ?? rateLimitTier ?? null;
}

/**
 * Limites de la réponse de l'API : `five_hour` (session, absente des plans sans limite de session),
 * `seven_day` (semaine, tous modèles), puis les limites hebdomadaires par modèle (`limits[]` de type
 * `weekly_scoped`, ou `model_scoped[]`, ou les anciens `seven_day_opus` / `seven_day_sonnet`).
 */
export function parseUsage(j: any): UsageLimit[] {
  const out: UsageLimit[] = [];
  const window = (id: 'session' | 'week', w: any) => {
    const u = num(w?.utilization);
    if (u !== null) out.push({ id, kind: id, label: null, utilization: u, resetsAt: isoOf(w.resets_at) });
  };
  window('session', j?.five_hour);
  window('week', j?.seven_day);
  const seen = new Set<string>();
  const model = (name: unknown, utilization: unknown, resets: unknown) => {
    const label = str(name);
    const u = num(utilization);
    if (!label || u === null || seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    out.push({ id: `model:${label.toLowerCase()}`, kind: 'model', label, utilization: u, resetsAt: isoOf(resets) });
  };
  for (const l of Array.isArray(j?.limits) ? j.limits : []) {
    if (l?.kind === 'weekly_scoped') model(l.scope?.model?.display_name, l.percent ?? l.utilization, l.resets_at);
  }
  for (const m of Array.isArray(j?.model_scoped) ? j.model_scoped : []) model(m?.display_name, m?.utilization, m?.resets_at);
  model(j?.seven_day_opus ? 'Opus' : null, j?.seven_day_opus?.utilization, j?.seven_day_opus?.resets_at);
  model(j?.seven_day_sonnet ? 'Sonnet' : null, j?.seven_day_sonnet?.utilization, j?.seven_day_sonnet?.resets_at);
  return out;
}

export interface UsageDeps {
  readCredentials: () => Promise<Credentials | null>;
  fetch: typeof fetch;
  now: () => number;
  /** Mode démo : valeurs fixes, aucun appel réseau ni lecture du jeton. */
  demo: () => ClaudeUsage | null;
  /** false : affichage désactivé dans les réglages (rien n'est lu). */
  enabled: () => boolean;
  /** Échéance globale d'un rafraîchissement (défaut `LOAD_TIMEOUT_MS`) ; injectable pour les tests. */
  timeoutMs?: number;
}

/** Service avec cache : `get()` relit le jeton et appelle l'API au plus une fois par minute. */
export class ClaudeUsageService {
  private cache: { at: number; ttl: number; value: ClaudeUsage } | null = null;
  private inflight: Promise<ClaudeUsage> | null = null;
  constructor(private deps: UsageDeps) {}

  async get(): Promise<ClaudeUsage> {
    const d = this.deps.demo();
    if (d) return d;
    if (!this.deps.enabled()) return { status: 'disabled', plan: null, limits: [], fetchedAt: null };
    const now = this.deps.now();
    if (this.cache && now - this.cache.at < this.cache.ttl) return this.cache.value;
    this.inflight ??= this.load().finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async load(): Promise<ClaudeUsage> {
    const at = this.deps.now();
    let ttl = CACHE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<ClaudeUsage>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'error', plan: null, limits: [], fetchedAt: null, error: 'timeout' }), this.deps.timeoutMs ?? LOAD_TIMEOUT_MS);
    });
    const value = await Promise.race([deadline, (async (): Promise<ClaudeUsage> => {
      const c = await this.deps.readCredentials().catch(() => null);
      if (!c) return { status: 'not-connected', plan: null, limits: [], fetchedAt: null };
      const plan = planLabel(c.subscriptionType, c.rateLimitTier);
      if (c.expiresAt !== null && c.expiresAt <= at) return { status: 'expired', plan, limits: [], fetchedAt: null };
      try {
        const r = await this.deps.fetch(USAGE_URL, {
          headers: { Authorization: `Bearer ${c.accessToken}`, 'anthropic-beta': OAUTH_BETA, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'error', // le jeton ne suit jamais une redirection vers un autre hôte
        });
        if (r.status === 401 || r.status === 403) return { status: 'expired', plan, limits: [], fetchedAt: null };
        if (r.status === 429) ttl = BACKOFF_MS;
        if (!r.ok) return { status: 'error', plan, limits: [], fetchedAt: null, error: `http-${r.status}` };
        return { status: 'ok', plan, limits: parseUsage(await r.json()), fetchedAt: new Date(at).toISOString() };
      } catch (e: any) {
        return { status: 'error', plan, limits: [], fetchedAt: null, error: e?.name === 'TimeoutError' ? 'timeout' : 'network' };
      }
    })()]).finally(() => clearTimeout(timer));
    this.cache = { at, ttl, value };
    return value;
  }
}
