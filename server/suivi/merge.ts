/**
 * Règles de fusion, sans accès à la base :
 * - par tâche, la modification la plus récente gagne (`updatedAt`, puis `rev`) ; la version perdante
 *   est renvoyée pour le journal, rien n'est perdu ;
 * - `note` : si les deux côtés ont un texte différent et qu'aucun ne contient l'autre, les deux sont
 *   gardés, séparés par « ⟂ (autre appareil, date) » ;
 * - une tâche absente d'un côté est créée, jamais supprimée de l'autre (`archived` est un champ comme un autre).
 */
import { clearRequestIfHandled, TASK_FIELDS, type Origin, type Task, type TaskField } from './types.js';
import { tr, uiLang, type Lang } from '../i18n.js';

export interface FieldChange {
  field: TaskField;
  before: unknown;
  after: unknown;
}

export interface MergeResult {
  task: Task;
  created: boolean;
  /** Champs modifiés côté local (à écrire et à journaliser). */
  changes: FieldChange[];
  /** Valeurs entrantes écartées parce que la version locale est plus récente (journalisées comme perdues). */
  lost: FieldChange[];
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** > 0 si `a` est plus récente que `b`. Une date absente compte comme la plus ancienne. */
export function compareVersions(a: Pick<Task, 'updatedAt' | 'rev'>, b: Pick<Task, 'updatedAt' | 'rev'>): number {
  const time = (d: string | null) => { const t = d ? Date.parse(d) : NaN; return Number.isNaN(t) ? -Infinity : t; };
  const ta = time(a.updatedAt);
  const tb = time(b.updatedAt);
  if (ta !== tb) return ta > tb ? 1 : -1;
  return (a.rev ?? 0) - (b.rev ?? 0);
}

// Texte enregistré dans la note (affiché tel quel) : langue de l'UI, heure locale de la machine.
const fmtDate = (iso: string | null, lang: Lang) =>
  iso ? new Date(iso).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : tr({ en: 'unknown date', fr: 'date inconnue' }, undefined, lang);

/** Note fusionnée : le texte gagnant d'abord, puis l'autre s'il apporte quelque chose. */
export function mergeNotes(winner: string, loser: string, loserAt: string | null): string {
  const w = winner.trim();
  const l = loser.trim();
  if (!l || w.includes(l)) return winner;
  if (!w || l.includes(w)) return loser;
  const lang = uiLang();
  return `${winner}\n⟂ (${tr({ en: 'other device', fr: 'autre appareil' }, undefined, lang)}, ${fmtDate(loserAt, lang)}) ${loser}`;
}

/**
 * Fusionne une version entrante dans la version locale.
 * `now` et `origin` servent aux tâches créées sans date ni origine.
 */
export function mergeTask(local: Task | undefined, incoming: Task, origin: Origin, now = new Date().toISOString(), opts: { incomingWinsTie?: boolean } = {}): MergeResult {
  if (!local) {
    const task: Task = clearRequestIfHandled({
      ...incoming,
      rev: Math.max(1, incoming.rev),
      createdAt: incoming.createdAt ?? incoming.updatedAt ?? now,
      updatedAt: incoming.updatedAt ?? now,
      updatedBy: incoming.updatedBy ?? origin,
    });
    return { task, created: true, changes: TASK_FIELDS.map((field) => ({ field, before: null, after: task[field] })), lost: [] };
  }

  const differing = TASK_FIELDS.filter((f) => !same(local[f], incoming[f]));
  if (differing.length === 0) return { task: local, created: false, changes: [], lost: [] };

  // Copie de fichier à la même date que la version locale : c'est la même source, le fichier fait foi
  // (champs ajoutés au schéma depuis le précédent import).
  const sameTime = !!incoming.updatedAt && incoming.updatedAt === local.updatedAt;
  const incomingWins = (opts.incomingWinsTie && sameTime) || compareVersions(incoming, local) > 0;
  const winner = incomingWins ? incoming : local;
  const loser = incomingWins ? local : incoming;
  let merged: Task = { ...local };
  for (const f of differing) (merged as any)[f] = winner[f];
  if (differing.includes('note')) merged.note = mergeNotes(winner.note, loser.note, loser.updatedAt);
  // Tâche traitée (à tester ou faite) : la demande à Claude est close, quel que soit le côté qui l'a portée.
  merged = clearRequestIfHandled(merged);
  const cleared = (f: TaskField) => (f === 'requestedAt' || f === 'requestedTo') && (merged.done || merged.toTest);

  const changes = TASK_FIELDS.filter((f) => !same(local[f], merged[f])).map((field) => ({ field, before: local[field], after: merged[field] }));
  const lost = differing
    .filter((f) => !same(incoming[f], merged[f]) && !cleared(f) && !(f === 'note' && merged.note.includes(incoming.note.trim())))
    .map((field) => ({ field, before: incoming[field], after: merged[field] }));
  if (changes.length === 0) return { task: local, created: false, changes, lost };

  merged.rev = Math.max(local.rev, incoming.rev) + 1;
  merged.updatedAt = incomingWins ? incoming.updatedAt ?? now : now;
  merged.updatedBy = incomingWins ? incoming.updatedBy ?? origin : local.updatedBy;
  return { task: merged, created: false, changes, lost };
}
