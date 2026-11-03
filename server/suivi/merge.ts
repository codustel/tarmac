/**
 * Règles de fusion, sans accès à la base :
 * - par tâche, la modification la plus récente gagne (`updatedAt`, puis `rev`) ; la version perdante
 *   est renvoyée pour le journal, rien n'est perdu ;
 * - `note` : si les deux côtés ont un texte différent et qu'aucun ne contient l'autre, les deux sont
 *   gardés, séparés par « ⟂ (autre appareil, date) » ; un texte déjà présent (ou presque) n'est jamais
 *   réajouté, et la note d'une version antérieure à la gagnante (écriture de Claude, copie périmée de
 *   l'artefact) est remplacée sans bloc ⟂ (elle reste au journal) ;
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

// Une note fusionnée = texte principal, puis des blocs « ⟂ (en-tête) texte ».
const BLOCK = /^⟂ \(([^)\n]*)\) ([\s\S]*)$/;
function splitNote(note: string): { main: string; blocks: { raw: string; text: string }[] } {
  const [main, ...rest] = note.trim().split(/\n(?=⟂ \()/);
  const blocks = rest.map((raw) => ({ raw: raw.trim(), text: (raw.trim().match(BLOCK)?.[2] ?? raw).trim() }));
  return { main: main.trim(), blocks };
}

// Comparaison sans casse, ponctuation ni espaces multiples.
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();
const bigrams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) ?? 0) + 1); } return m; };
/** `kept` contient déjà `text` (inclus, ou quasi identique : Dice sur les bigrammes ≥ 0,9). */
function covers(kept: string, text: string): boolean {
  const k = norm(kept);
  const t = norm(text);
  if (!t || k.includes(t)) return true;
  if (!k || Math.abs(k.length - t.length) > 0.2 * Math.max(k.length, t.length)) return false;
  const a = bigrams(k);
  const b = bigrams(t);
  let common = 0;
  for (const [g, n] of a) common += Math.min(n, b.get(g) ?? 0);
  return (2 * common) / (k.length + t.length - 2) >= 0.9;
}

/** Note fusionnée : le texte gagnant d'abord, puis ce que l'autre apporte, sans doublon. */
export function mergeNotes(winner: string, loser: string, loserAt: string | null): string {
  if (!norm(loser)) return winner;
  if (!norm(winner)) return loser;
  const W = splitNote(winner);
  const L = splitNote(loser);
  // Ajout à la fin côté perdant : le texte le plus complet devient le texte principal.
  const main = norm(W.main) && covers(L.main, W.main) && !covers(W.main, L.main) ? L.main : W.main;
  const lang = uiLang();
  const header = `⟂ (${tr({ en: 'other device', fr: 'autre appareil' }, undefined, lang)}, ${fmtDate(loserAt, lang)})`;
  const candidates = [...W.blocks, { raw: `${header} ${L.main}`, text: L.main }, ...L.blocks];
  const kept: { raw: string; text: string }[] = [];
  for (const c of candidates) if (![main, ...kept.map((k) => k.text)].some((t) => covers(t, c.text))) kept.push(c);
  if (main === W.main && kept.length === W.blocks.length) return winner;
  return [main, ...kept.map((k) => k.raw)].join('\n');
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
  // Perdante antérieure à la gagnante (rev plus petit, plus ancienne) : qui a écrit la gagnante connaissait
  // sa note (écriture de Claude, copie périmée renvoyée par l'artefact) ; seules les modifications concurrentes
  // gardent les deux textes.
  const superseded = loser.rev < winner.rev && compareVersions(winner, loser) > 0;
  if (differing.includes('note') && !superseded) merged.note = mergeNotes(winner.note, loser.note, loser.updatedAt);
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
