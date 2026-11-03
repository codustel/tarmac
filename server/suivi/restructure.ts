/**
 * Restructuration d'un suivi (/suivi restructure) : phases renumérotées, tâches déplacées d'une phase à l'autre,
 * titres de phase. Les identifiants ne changent jamais (la db de l'artefact garde ses documents, l'historique reste
 * attaché) ; seuls `phase`, `phaseTitle`, `num` et `order` bougent, et `order` le moins possible.
 */
import { tr } from '../i18n.js';
import { SuiviError, type Task } from './types.js';

export interface RestructurePlan {
  /** Phases entières renumérotées (8 → 10) : toutes leurs tâches suivent, sauf celles de `moves`. */
  phases?: { from: number; to: number }[];
  /** Tâches déplacées une à une ; une sous-tâche suit toujours sa mère. */
  moves?: { taskId: string; phase: number }[];
  /** Titres des phases finales (obligatoire pour une phase qui ne reçoit que des tâches déplacées une à une). */
  titles?: { phase: number; title: string }[];
  /** Renuméroter de 1 à N chaque phase touchée ; sinon chaque tâche garde son numéro quand c'est possible. */
  compact?: boolean;
}

export interface RestructureResult {
  /** Tâches modifiées (version complète, avant incrément de `rev`). */
  changed: Task[];
  /** Changements de numéro ou de phase, dans l'ordre final. */
  mapping: { id: string; title: string; from: string; to: string }[];
  /** Phases finales : numéro, titre, nombre de tâches (archivées comprises), phases d'origine. */
  phases: { phase: number; title: string; tasks: number; from: number[] }[];
}

const isPhase = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 10000;
const fail = (en: string, fr: string, vars?: Record<string, string | number>) => { throw new SuiviError(tr({ en, fr }, vars)); };

export function planRestructure(all: Task[], plan: RestructurePlan): RestructureResult {
  const byId = new Map(all.map((t) => [t.id, t]));
  const phaseMap = new Map<number, number>();
  for (const { from, to } of plan.phases ?? []) {
    if (!isPhase(from) || !isPhase(to)) fail('Invalid phase number: {from} → {to}', 'Numéro de phase invalide : {from} → {to}', { from, to });
    if (phaseMap.has(from)) fail('Phase {from} is renumbered twice', 'La phase {from} est renumérotée deux fois', { from });
    phaseMap.set(from, to);
  }
  // Mère la plus haute d'une tâche (une sous-tâche suit sa mère) ; une boucle de `parent` s'arrête là où elle revient.
  const root = (t: Task) => {
    const seen = new Set([t.id]);
    let r = t;
    while (r.parent && byId.has(r.parent) && !seen.has(r.parent)) { r = byId.get(r.parent)!; seen.add(r.id); }
    return r;
  };
  const moves = new Map<string, number>();
  for (const { taskId, phase } of plan.moves ?? []) {
    const t = byId.get(taskId);
    if (!t) fail('Unknown task: {id}', 'Tâche inconnue : {id}', { id: taskId });
    if (!isPhase(phase)) fail('Invalid phase number for {id}: {phase}', 'Numéro de phase invalide pour {id} : {phase}', { id: taskId, phase });
    if (root(t!) !== t) fail('{num} is a subtask: it follows its parent, move the parent instead', '{num} est une sous-tâche : elle suit sa mère, déplace la mère', { num: t!.num });
    moves.set(taskId, phase);
  }
  const titles = new Map<number, string>();
  for (const { phase, title } of plan.titles ?? []) {
    if (!isPhase(phase)) fail('Invalid phase number: {phase}', 'Numéro de phase invalide : {phase}', { phase });
    if (typeof title !== 'string' || !title.trim()) fail('Empty title for phase {phase}', 'Titre vide pour la phase {phase}', { phase });
    titles.set(phase, title.trim().slice(0, 200));
  }

  const target = new Map<string, number>();
  const moved = new Set<string>();
  for (const t of all) {
    const r = root(t);
    const p = moves.get(r.id) ?? phaseMap.get(r.phase) ?? r.phase;
    target.set(t.id, p);
    if (moves.has(r.id) && moves.get(r.id) !== (phaseMap.get(r.phase) ?? r.phase)) moved.add(t.id);
  }
  const changesPhase = (t: Task) => target.get(t.id) !== t.phase;
  // Phases finales touchées : elles reçoivent des tâches, ou en perdent (phase d'origine, à son numéro final).
  const touched = new Set<number>();
  for (const t of all) {
    if (!changesPhase(t)) continue;
    touched.add(target.get(t.id)!);
    touched.add(phaseMap.get(t.phase) ?? t.phase);
  }

  // Ordre final : par phase finale, puis dans l'ordre actuel (une sous-tâche reste sous sa mère).
  const seq = [...all].sort((a, b) => target.get(a.id)! - target.get(b.id)! || a.order - b.order || a.id.localeCompare(b.id));

  // ─── Titres ───
  const finalTitle = new Map<number, string>();
  for (const t of seq) {
    const p = target.get(t.id)!;
    if (titles.has(p)) finalTitle.set(p, titles.get(p)!);
    else if (!finalTitle.has(p) && !moved.has(t.id) && t.phaseTitle) finalTitle.set(p, t.phaseTitle);
  }
  for (const t of seq) {
    const p = target.get(t.id)!;
    if (!finalTitle.has(p)) {
      if (moved.has(t.id)) fail('Phase {phase} only receives moved tasks: give it a title', 'La phase {phase} ne reçoit que des tâches déplacées : donne-lui un titre', { phase: p });
      finalTitle.set(p, t.phaseTitle);
    }
  }

  // ─── Numéros ───
  const num = new Map<string, string>();
  const isTop = (t: Task) => root(t) === t;
  const phasesFinal = [...new Set(seq.map((t) => target.get(t.id)!))];
  for (const p of phasesFinal) {
    const tops = seq.filter((t) => target.get(t.id) === p && isTop(t));
    const renumber = touched.has(p);
    if (!renumber) { for (const t of tops) num.set(t.id, t.num); continue; }
    const keep = new Map<string, string>();
    const taken = new Set<number>();
    let collision = false;
    const suffix = (t: Task) => Number(t.num.match(new RegExp(`^${t.phase}\\.(\\d+)$`))?.[1] ?? NaN);
    // Gardent leur numéro : les tâches restées dans la phase, puis celles arrivées avec leur phase entière.
    for (const pass of [false, true]) {
      for (const t of tops) {
        if (moved.has(t.id) || changesPhase(t) !== pass) continue;
        const n = suffix(t);
        if (!Number.isFinite(n) || n <= 0) { if (!pass) keep.set(t.id, t.num); continue; } // numéro libre d'une tâche qui ne bouge pas
        if (taken.has(n)) collision = true;
        else { taken.add(n); keep.set(t.id, `${p}.${n}`); }
      }
    }
    // Deux phases fusionnées dont les numéros se chevauchent : toute la phase est renumérotée, dans l'ordre.
    if (plan.compact || collision) { tops.forEach((t, i) => num.set(t.id, `${p}.${i + 1}`)); continue; }
    let next = Math.max(0, ...taken);
    for (const t of tops) num.set(t.id, keep.get(t.id) ?? `${p}.${++next}`);
  }
  // Sous-tâches : numéro de la mère + leur lettre (7.32a reste « a » sous sa mère renumérotée).
  const subNum = (t: Task): string => {
    if (num.has(t.id)) return num.get(t.id)!;
    const mother = byId.get(t.parent!)!;
    const base = subNum(mother);
    const kids = all.filter((k) => k.parent === mother.id).sort((a, b) => a.order - b.order);
    const letter = t.num.startsWith(mother.num) && /^[a-z]+$/.test(t.num.slice(mother.num.length))
      ? t.num.slice(mother.num.length)
      : String.fromCharCode(97 + Math.max(0, kids.indexOf(t)));
    const n = base === mother.num ? t.num : `${base}${letter}`;
    num.set(t.id, n);
    return n;
  };
  for (const t of seq) subNum(t);

  // ─── Ordre : les tâches déplacées une à une prennent une valeur intermédiaire, les autres gardent la leur ───
  const order = keepIncreasing(seq.map((t) => t.order), seq.map((t) => !moved.has(t.id)));

  const changed: Task[] = [];
  const mapping: RestructureResult['mapping'] = [];
  seq.forEach((t, i) => {
    const next: Task = { ...t, phase: target.get(t.id)!, phaseTitle: finalTitle.get(target.get(t.id)!)!, num: num.get(t.id)!, order: order[i] };
    if (next.phase !== t.phase || next.num !== t.num) mapping.push({ id: t.id, title: t.title, from: t.num, to: next.num });
    if (next.phase !== t.phase || next.num !== t.num || next.phaseTitle !== t.phaseTitle || next.order !== t.order) changed.push(next);
  });
  const phases = phasesFinal.map((p) => {
    const items = seq.filter((t) => target.get(t.id) === p);
    return { phase: p, title: finalTitle.get(p)!, tasks: items.length, from: [...new Set(items.map((t) => t.phase))].sort((a, b) => a - b) };
  });
  return { changed, mapping, phases };
}

/**
 * Valeurs strictement croissantes qui modifient le moins d'éléments possible : la plus longue sous-suite
 * strictement croissante parmi les éléments `eligible` est gardée, chaque trou est rempli de valeurs régulièrement
 * espacées entre ses voisines.
 */
export function keepIncreasing(values: number[], eligible: boolean[] = values.map(() => true)): number[] {
  const n = values.length;
  const tails: number[] = []; // indice de fin de la meilleure suite de chaque longueur
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!eligible[i]) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (values[tails[m]] < values[i]) lo = m + 1; else hi = m; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]) keep.add(i);
  const out = [...values];
  let i = 0;
  while (i < n) {
    if (keep.has(i)) { i++; continue; }
    let j = i;
    while (j < n && !keep.has(j)) j++;
    const left = i > 0 ? out[i - 1] : null;
    const right = j < n ? out[j] : null;
    const gap = j - i;
    for (let k = 0; k < gap; k++) {
      out[i + k] = left !== null && right !== null ? left + ((right - left) * (k + 1)) / (gap + 1)
        : left !== null ? left + k + 1
        : right! - (gap - k);
    }
    i = j;
  }
  return out;
}
