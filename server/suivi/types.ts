/**
 * Schéma « suivi v1 » : les champs d'origine de l'artefact de suivi, plus quelques champs optionnels.
 * Toute donnée qui arrive de l'extérieur (artefact, fichier, MCP) passe par `sanitizeTask`.
 */
import { tr } from '../i18n.js';
export type Who = 'toi' | 'ensemble' | 'claude';
export type Origin = 'artifact' | 'tarmac' | 'claude';

/** Origines acceptées en entrée ; `app-manager` (ancien nom de Tarmac, artefacts déjà publiés) devient `tarmac`. */
export const ORIGINS: readonly Origin[] = ['artifact', 'tarmac', 'claude'];
export const toOrigin = (v: unknown): Origin | null => (v === 'app-manager' ? 'tarmac' : ORIGINS.includes(v as Origin) ? (v as Origin) : null);
export type Channel = 'A' | 'B' | 'C' | 'file';

export interface Source {
  kind: 'session' | 'commit' | 'quote';
  ref: string;
  at?: string | null;
}

export interface Task {
  id: string;
  order: number;
  phase: number;
  phaseTitle: string;
  num: string;
  title: string;
  who: Who;
  minutes: number;
  why: string;
  steps: string[];
  check: string;
  done: boolean;
  doneAt: string | null;
  note: string;
  toTest: boolean;
  /** Testée par l'utilisateur (badge « ✓ Testé » de l'artefact), date et remarque du test. */
  tested: boolean;
  testedAt: string | null;
  testNote: string;
  // Ajouts « suivi v1 »
  rev: number;
  updatedAt: string | null;
  updatedBy: Origin | null;
  createdAt: string | null;
  parent: string | null;
  sources: Source[];
  archived: boolean;
  /**
   * « Demandée à Claude » (bouton ▶ Claude) : date de la demande et destinataire (nom de la session, `new` pour
   * une nouvelle session, `copy` pour une consigne copiée sans pont). Effacé quand la tâche passe à tester ou faite.
   */
  requestedAt: string | null;
  requestedTo: string;
  /** Marquée « auto » : candidate au traitement par un module de pilote automatique (inerte sans module). */
  auto: boolean;
}

/** Couleurs d'une variante (claire ou sombre) du thème d'un projet. */
export interface ThemeVariant {
  bg: string; surface: string; surface2: string; line: string;
  fg: string; muted: string; primary: string; primarySoft: string; primaryText: string;
}
export interface Theme {
  brand: string;
  primary: string;
  fonts: { display: string; body: string; mono: string };
  dark: ThemeVariant;
  light: ThemeVariant;
}

export interface SuiviProject {
  projectId: string;
  name: string;
  brand: string;
  title: string;
  subtitle: string;
  artifactUrl: string | null;
  theme: Theme;
  paths: string[];
  /** Nom du fichier de copie dans `Todolist/` (`suivi.json` par défaut, ou un nom choisi par le projet). */
  copyFile: string;
  createdAt: string;
  updatedAt: string;
}

/** Champs comparés lors d'une fusion et tracés dans le journal. */
export const TASK_FIELDS = [
  'order', 'phase', 'phaseTitle', 'num', 'title', 'who', 'minutes', 'why', 'steps', 'check',
  'done', 'doneAt', 'note', 'toTest', 'tested', 'testedAt', 'testNote', 'parent', 'sources', 'archived',
  'requestedAt', 'requestedTo', 'auto',
] as const;
export type TaskField = (typeof TASK_FIELDS)[number];

/** Champs modifiables depuis l'onglet Todolist de Tarmac et l'artefact (D7 : on y coche et on y annote). */
export const UI_FIELDS: readonly TaskField[] = ['done', 'doneAt', 'note', 'toTest', 'tested', 'testedAt', 'requestedAt', 'requestedTo'];

/** Champs modifiables depuis la vue Tarmac : ceux de l'artefact, plus `auto` (déclenche un traitement sans surveillance : l'artefact ne le modifie jamais, il l'affiche seulement). */
export const TARMAC_UI_FIELDS: readonly TaskField[] = [...UI_FIELDS, 'auto'];

/** Tâche « non traitée » : ni faite, ni à tester, ni archivée (seules celles-ci peuvent être envoyées à Claude). */
export const isUntreated = (t: Pick<Task, 'done' | 'toTest' | 'archived'>) => !t.done && !t.toTest && !t.archived;

/** Une tâche traitée (à tester ou faite) n'est plus « demandée à Claude » : champs effacés. */
export function clearRequestIfHandled<T extends Task>(t: T): T {
  return (t.done || t.toTest) && (t.requestedAt || t.requestedTo) ? { ...t, requestedAt: null, requestedTo: '' } : t;
}

const WHO: readonly Who[] = ['toi', 'ensemble', 'claude'];
export const TASK_ID_RE = /^[A-Za-z0-9][\w.-]{0,79}$/;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : fallback);
const date = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export class SuiviError extends Error {
  constructor(message: string, public statusCode = 400, public data?: unknown) {
    super(message);
  }
}

function sanitizeSources(v: unknown): Source[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).flatMap((s) => {
    if (!s || typeof s !== 'object') return [];
    const kind = (s as any).kind;
    if (kind !== 'session' && kind !== 'commit' && kind !== 'quote') return [];
    const ref = str((s as any).ref, 500).trim();
    return ref ? [{ kind, ref, at: date((s as any).at) }] : [];
  });
}

/** Valide et borne une valeur de champ (données non fiables). */
export function sanitizeField(field: TaskField, v: unknown): unknown {
  switch (field) {
    case 'order': return num(v, 0);
    case 'phase': return Math.trunc(num(v, 0));
    case 'minutes': return Math.max(0, Math.round(num(v, 0)));
    case 'phaseTitle': return str(v, 200);
    case 'num': return str(v, 20);
    case 'title': return str(v, 300);
    case 'why': return str(v, 4000);
    case 'check': return str(v, 2000);
    case 'note': return str(v, 10_000);
    case 'testNote': return str(v, 4000);
    case 'who': return WHO.includes(v as Who) ? v : 'claude';
    case 'steps': return Array.isArray(v) ? v.slice(0, 60).map((s) => str(s, 2000)) : [];
    case 'done': case 'toTest': case 'tested': case 'archived': case 'auto': return v === true;
    case 'doneAt': case 'testedAt': case 'requestedAt': return date(v);
    // Texte affiché tel quel : caractères de contrôle retirés.
    case 'requestedTo': return str(v, 120).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
    case 'parent': return typeof v === 'string' && TASK_ID_RE.test(v) ? v : null;
    case 'sources': return sanitizeSources(v);
  }
}

/** Tâche complète et valide à partir d'un objet quelconque ; erreur si l'identifiant manque. */
export function sanitizeTask(raw: unknown): Task {
  if (!raw || typeof raw !== 'object') throw new SuiviError(tr({ en: 'Invalid task', fr: 'Tâche invalide' }));
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!TASK_ID_RE.test(id)) throw new SuiviError(tr({ en: 'Invalid task ID: {id}', fr: 'Identifiant de tâche invalide : {id}' }, { id: String(r.id).slice(0, 40) }));
  const t: Record<string, unknown> = { id };
  for (const f of TASK_FIELDS) t[f] = sanitizeField(f, r[f]);
  t.rev = Math.max(0, Math.trunc(num(r.rev, 0)));
  t.updatedAt = date(r.updatedAt);
  t.updatedBy = toOrigin(r.updatedBy);
  t.createdAt = date(r.createdAt);
  return t as unknown as Task;
}

/** Compteurs d'un projet, mêmes règles que l'artefact (tâches archivées exclues). */
export function countTasks(all: Task[]) {
  const tasks = all.filter((t) => !t.archived).sort((a, b) => a.order - b.order);
  const done = tasks.filter((t) => t.done).length;
  const next = tasks.find((t) => !t.done) ?? null;
  const activity = tasks.flatMap((t) => [t.updatedAt, t.doneAt]).filter(Boolean).sort().at(-1) ?? null;
  return {
    total: tasks.length,
    done,
    remaining: tasks.length - done,
    // « À tester » : traitée mais pas encore validée ; une tâche cochée n'est plus à tester.
    toTest: tasks.filter((t) => t.toTest && !t.done).length,
    // « Demandées à Claude » et pas encore traitées.
    requested: tasks.filter((t) => isUntreated(t) && !!t.requestedAt).length,
    pct: tasks.length ? Math.round((done * 100) / tasks.length) : 0,
    minutesLeft: tasks.filter((t) => !t.done).reduce((a, t) => a + (t.minutes || 0), 0),
    next: next && { id: next.id, num: next.num, title: next.title, who: next.who },
    lastActivity: activity,
  };
}
