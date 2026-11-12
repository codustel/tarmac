/**
 * Pastilles de sessions Claude fournies par les modules (`ctx.core.sessionBadges`). Le cœur transmet des données
 * figées, borne le délai de chaque fournisseur et nettoie ce qu'il renvoie : texte seul, tailles limitées.
 * Un fournisseur en erreur ou trop lent ne donne rien, la liste des sessions part quand même.
 */
import type { ModuleSessionRef, SessionBadge, SessionBadgeProvider } from './api.js';

export const BADGE_TIMEOUT_MS = 1500;
export const BADGES_PER_MODULE = 4;
export const BADGE_LABEL_MAX = 24;
export const BADGE_TITLE_MAX = 200;

interface Entry { moduleId: string; provider: SessionBadgeProvider; isActive: () => boolean }

/** Nettoie la réponse d'un fournisseur pour une session : au plus 4 pastilles valides, textes tronqués. */
function clean(raw: unknown): SessionBadge[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionBadge[] = [];
  for (const b of raw) {
    if (out.length >= BADGES_PER_MODULE) break;
    if (!b || typeof b !== 'object' || typeof (b as SessionBadge).label !== 'string') continue;
    const badge: SessionBadge = { label: (b as SessionBadge).label.slice(0, BADGE_LABEL_MAX) };
    const title = (b as SessionBadge).title;
    if (typeof title === 'string') badge.title = title.slice(0, BADGE_TITLE_MAX);
    out.push(badge);
  }
  return out;
}

export class SessionBadges {
  private entries = new Set<Entry>();
  private warn: (message: string) => void;
  private timeoutMs: number;

  constructor(opts: { warn?: (message: string) => void; timeoutMs?: number } = {}) {
    this.warn = opts.warn ?? ((m) => console.warn(m));
    this.timeoutMs = opts.timeoutMs ?? BADGE_TIMEOUT_MS;
  }

  /** Nombre de fournisseurs enregistrés (0 : aucun coût pour la liste des sessions). */
  get size(): number { return this.entries.size; }

  /** Enregistre un fournisseur ; `isActive` faux (module en erreur) : il est ignoré. Renvoie le désabonnement. */
  add(moduleId: string, provider: SessionBadgeProvider, isActive: () => boolean = () => true): () => void {
    if (typeof provider !== 'function') throw new TypeError('core.sessionBadges: provider must be a function');
    const entry: Entry = { moduleId, provider, isActive };
    this.entries.add(entry);
    return () => { this.entries.delete(entry); };
  }

  /** Pastilles par id de session (tableau vide si rien) ; ordre = ordre d'enregistrement des fournisseurs. */
  async collect(sessions: readonly { id: string }[]): Promise<Record<string, SessionBadge[]>> {
    const result: Record<string, SessionBadge[]> = {};
    for (const s of sessions) result[s.id] = [];
    const active = [...this.entries].filter((e) => e.isActive());
    if (!active.length) return result;
    const frozen = Object.freeze(sessions.map((s) => Object.freeze({ ...s }))) as unknown as readonly ModuleSessionRef[];
    const answers = await Promise.all(active.map((e) => this.ask(e, frozen)));
    for (const answer of answers) {
      if (!answer) continue;
      for (const id of Object.keys(result)) {
        if (Object.prototype.hasOwnProperty.call(answer, id)) result[id].push(...clean(answer[id]));
      }
    }
    return result;
  }

  private async ask(e: Entry, sessions: readonly ModuleSessionRef[]): Promise<Record<string, unknown> | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${this.timeoutMs} ms`)), this.timeoutMs); });
      const answer = await Promise.race([Promise.resolve().then(() => e.provider(sessions)), timeout]);
      return answer && typeof answer === 'object' && !Array.isArray(answer) ? (answer as Record<string, unknown>) : null;
    } catch (err) {
      this.warn(`⚠ Module ${e.moduleId}: sessionBadges ${(err as Error)?.message ?? err}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Ajoute `badges` à chaque session de la liste (tableau vide sans fournisseur : aucun coût, `fileOf` n'est pas appelé).
 * `file` (chemin du transcript) n'est transmis qu'aux modules, jamais ajouté à la réponse HTTP.
 */
export async function withBadges<T extends { id: string; cwd: string; sizeBytes: number; updatedAt: string }>(
  list: readonly T[],
  registry: SessionBadges,
  fileOf: (id: string) => string | null,
): Promise<Array<T & { badges: SessionBadge[] }>> {
  if (!registry.size) return list.map((s) => ({ ...s, badges: [] }));
  const refs: ModuleSessionRef[] = list.map((s) => ({ id: s.id, cwd: s.cwd, file: fileOf(s.id), sizeBytes: s.sizeBytes, updatedAt: s.updatedAt }));
  const byId = await registry.collect(refs);
  return list.map((s) => ({ ...s, badges: byId[s.id] ?? [] }));
}
