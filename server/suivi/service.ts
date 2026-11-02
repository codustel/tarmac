/**
 * Lecture, écriture, fusion et journal du suivi.
 * Aucune suppression physique : une tâche retirée de la vue a `archived: true`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import { msg, tr, uiLang } from '../i18n.js';
import { compareVersions, mergeTask, same, type FieldChange } from './merge.js';
import { buildTheme, sanitizeTheme } from './theme.js';
import {
  countTasks, sanitizeField, sanitizeTask, SuiviError, TASK_FIELDS, TASK_ID_RE, UI_FIELDS,
  type Channel, type Origin, type SuiviProject, type Task, type TaskField,
} from './types.js';

export interface JournalEntry {
  seq: number; taskId: string; rev: number; field: string; before: unknown; after: unknown; origin: string; lost: boolean; at: string;
}
export interface SyncState { channel: Channel; at: string; result: string; marker: string | null }
export interface ImportResult { created: number; updated: number; unchanged: number; lost: number; total: number }

/** Format de copie / sauvegarde : celui de `Todolist/suivi.json` et du bouton de sauvegarde de l’artefact. */
export interface SuiviFile {
  $schema?: string;
  source?: string | null;
  collection?: string;
  exportedAt?: string;
  counts?: { total: number; done: number; remaining: number; toTest: number };
  tasks: unknown[];
}

/** Seules les URL d'artefact claude.ai sont gardées (lien affiché et ouvert depuis l'interface). */
const safeArtifactUrl = (u: unknown) =>
  typeof u === 'string' && /^https:\/\/claude\.ai\/[\w\-/]{1,200}$/.test(u) ? u : null;

/** Nom simple de fichier JSON dans `Todolist/` (jamais de chemin). */
export const COPY_FILE_RE = /^[\w-][\w.-]{0,79}\.json$/;

const PROJECT_ID_RE = /^[A-Za-z0-9][\w.-]{0,99}(\/[A-Za-z0-9][\w.-]{0,99})?$/;
const parse = <T>(s: string | null) => (s == null ? null : (JSON.parse(s) as T));

export class SuiviService {
  constructor(private db: Db, private onChange: (projectId: string) => void = () => {}) {}

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ─── Projets ───────────────────────────────────────────────────────────────
  getProject(projectId: string): SuiviProject | null {
    const row = this.db.prepare('SELECT data FROM projects WHERE project_id = ?').get(projectId) as { data: string } | undefined;
    return row ? parse<SuiviProject>(row.data) : null;
  }

  requireProject(projectId: string): SuiviProject {
    const p = this.getProject(projectId);
    if (!p) throw new SuiviError(tr({ en: 'Unknown Todolist project: {id}', fr: 'Projet de suivi inconnu : {id}' }, { id: projectId }), 404);
    return p;
  }

  /** Crée ou complète un projet ; les champs fournis remplacent les anciens. */
  registerProject(input: Partial<SuiviProject> & { projectId: string; name: string }): SuiviProject {
    if (!PROJECT_ID_RE.test(input.projectId)) throw new SuiviError(tr({ en: 'Invalid project ID: {id}', fr: 'Identifiant de projet invalide : {id}' }, { id: input.projectId }));
    const now = new Date().toISOString();
    const prev = this.getProject(input.projectId);
    const brand = (input.brand ?? prev?.brand ?? input.name.toUpperCase()).slice(0, 60);
    const p: SuiviProject = {
      projectId: input.projectId,
      name: (input.name ?? prev?.name).slice(0, 120),
      brand,
      title: (input.title ?? prev?.title ?? tr({ en: 'Project tracker', fr: 'Suivi du projet' }, undefined, uiLang())).slice(0, 200),
      subtitle: (input.subtitle ?? prev?.subtitle ?? '').slice(0, 500),
      artifactUrl: input.artifactUrl !== undefined ? safeArtifactUrl(input.artifactUrl) : prev?.artifactUrl ?? null,
      theme: input.theme ? sanitizeTheme(input.theme, brand) : prev?.theme ?? buildTheme(null, brand),
      paths: [...new Set([...(prev?.paths ?? []), ...(input.paths ?? [])])],
      copyFile: input.copyFile !== undefined && COPY_FILE_RE.test(input.copyFile) ? input.copyFile : prev?.copyFile ?? 'suivi.json',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    this.db.prepare('INSERT INTO projects (project_id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(p.projectId, JSON.stringify(p), p.createdAt, p.updatedAt);
    this.onChange(p.projectId);
    return p;
  }

  projects(): SuiviProject[] {
    return (this.db.prepare('SELECT data FROM projects ORDER BY project_id').all() as { data: string }[]).map((r) => parse<SuiviProject>(r.data)!);
  }

  /** Projets avec compteurs et état de synchronisation (vue globale). */
  listProjects() {
    return this.projects().map((p) => ({ ...p, counts: countTasks(this.tasks(p.projectId)), syncs: this.syncs(p.projectId) }));
  }

  // ─── Tâches ────────────────────────────────────────────────────────────────
  tasks(projectId: string, opts: { archived?: boolean } = {}): Task[] {
    const rows = this.db.prepare(`SELECT data FROM tasks WHERE project_id = ? ${opts.archived ? '' : 'AND archived = 0'} ORDER BY ord, task_id`).all(projectId) as { data: string }[];
    // Relu à travers la validation : les tâches écrites avant un ajout de champ reçoivent sa valeur par défaut.
    return rows.map((r) => sanitizeTask(parse(r.data)));
  }

  task(projectId: string, taskId: string): Task | null {
    const row = this.db.prepare('SELECT data FROM tasks WHERE project_id = ? AND task_id = ?').get(projectId, taskId) as { data: string } | undefined;
    return row ? sanitizeTask(parse(row.data)) : null;
  }

  private write(projectId: string, t: Task) {
    this.db.prepare(`INSERT INTO tasks (project_id, task_id, ord, rev, updated_at, archived, data) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, task_id) DO UPDATE SET ord = excluded.ord, rev = excluded.rev, updated_at = excluded.updated_at, archived = excluded.archived, data = excluded.data`)
      .run(projectId, t.id, t.order, t.rev, t.updatedAt, t.archived ? 1 : 0, JSON.stringify(t));
  }

  private log(projectId: string, taskId: string, rev: number, changes: FieldChange[], origin: string, lost = false) {
    const ins = this.db.prepare('INSERT INTO journal (project_id, task_id, rev, field, before, after, origin, lost, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const at = new Date().toISOString();
    for (const c of changes) ins.run(projectId, taskId, rev, c.field, JSON.stringify(c.before ?? null), JSON.stringify(c.after ?? null), origin, lost ? 1 : 0, at);
  }

  /** Fusionne une tâche entrante (import, canal B / C) ; renvoie ce qui a changé. */
  private mergeOne(projectId: string, incoming: Task, origin: Origin, journalOrigin: string, opts: { incomingWinsTie?: boolean } = {}) {
    const local = this.task(projectId, incoming.id) ?? undefined;
    const r = mergeTask(local, incoming, origin, undefined, opts);
    if (r.created) {
      this.write(projectId, r.task);
      this.log(projectId, r.task.id, r.task.rev, [{ field: 'created' as TaskField, before: null, after: r.task.title }], journalOrigin);
    } else if (r.changes.length) {
      this.write(projectId, r.task);
      this.log(projectId, r.task.id, r.task.rev, r.changes, journalOrigin);
    }
    if (r.lost.length) this.log(projectId, incoming.id, local?.rev ?? 0, r.lost, journalOrigin, true);
    return r;
  }

  /**
   * Écriture par Claude (MCP, canal B) : la version fournie est la plus récente.
   * Les champs absents de `raw` gardent leur valeur actuelle.
   */
  upsertTask(projectId: string, raw: Record<string, unknown>, origin: Origin = 'claude'): Task {
    this.requireProject(projectId);
    const current = typeof raw.id === 'string' ? this.task(projectId, raw.id) : null;
    const base = current ?? this.newTaskDefaults(projectId, raw);
    // rev + 1 : l'écriture de Claude l'emporte même à la milliseconde près.
    const incoming = sanitizeTask({ ...base, ...raw, id: base.id, rev: (current?.rev ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: origin });
    const r = this.tx(() => this.mergeOne(projectId, incoming, origin, origin));
    if (r.created || r.changes.length) this.onChange(projectId);
    return r.task;
  }

  /** Identifiant, ordre et numéro d'une nouvelle tâche (phase donnée, ou sous-tâche lettrée de `parent`). */
  private newTaskDefaults(projectId: string, raw: Record<string, unknown>): Task {
    const all = this.tasks(projectId, { archived: true });
    const parent = typeof raw.parent === 'string' ? all.find((t) => t.id === raw.parent) : undefined;
    const phase = parent?.phase ?? (Number.isFinite(Number(raw.phase)) ? Math.trunc(Number(raw.phase)) : Math.max(1, ...all.map((t) => t.phase)));
    const inPhase = all.filter((t) => t.phase === phase).sort((a, b) => a.order - b.order);
    let id: string, num: string, order: number;
    if (parent) {
      // 7.32 → 7.32a, 7.32b… placée juste après la mère et ses sous-tâches existantes.
      const kids = all.filter((t) => t.parent === parent.id).sort((a, b) => a.order - b.order);
      const letter = String.fromCharCode(97 + kids.length);
      num = `${parent.num}${letter}`;
      id = `${parent.id}${letter}`;
      const after = kids.at(-1) ?? parent;
      const nextT = all.filter((t) => t.order > after.order).sort((a, b) => a.order - b.order)[0];
      order = nextT ? (after.order + nextT.order) / 2 : after.order + 1;
    } else {
      // Numéro suivant le plus grand « <phase>.<n> » de la phase (les sous-tâches lettrées ne comptent pas).
      const n = Math.max(0, ...inPhase.map((t) => Number(t.num.match(new RegExp(`^${phase}\\.(\\d+)$`))?.[1] ?? 0))) + 1;
      num = `${phase}.${n}`;
      id = `t-${phase}-${String(n).padStart(2, '0')}`;
      while (all.some((t) => t.id === id)) id += 'x';
      const last = inPhase.at(-1);
      const nextT = last && all.filter((t) => t.order > last.order).sort((a, b) => a.order - b.order)[0];
      order = last ? (nextT ? (last.order + nextT.order) / 2 : last.order + 1) : Math.max(0, ...all.map((t) => t.order)) + 1;
    }
    if (typeof raw.id === 'string' && TASK_ID_RE.test(raw.id)) id = raw.id;
    return sanitizeTask({
      id, num: raw.num ?? num, order: raw.order ?? order, phase,
      phaseTitle: raw.phaseTitle ?? inPhase[0]?.phaseTitle ?? parent?.phaseTitle ?? '',
      who: 'claude', done: false, toTest: false,
    });
  }

  /**
   * Modification depuis l'onglet Tarmac ou l'artefact : seuls `done`, `doneAt`, `note`, `toTest`
   * (D7) ; `409` si la tâche a changé depuis `baseRev`.
   */
  patchTask(projectId: string, taskId: string, baseRev: number, changes: Record<string, unknown>, origin: Origin, allowed: readonly TaskField[] = UI_FIELDS): Task {
    this.requireProject(projectId);
    const current = this.task(projectId, taskId);
    if (!current) throw new SuiviError(tr({ en: 'Unknown task', fr: 'Tâche inconnue' }), 404);
    if (!Number.isInteger(baseRev) || baseRev < current.rev) throw new SuiviError(tr({ en: 'The task has changed in the meantime', fr: 'La tâche a changé entre-temps' }), 409, current);
    const refused = Object.keys(changes).filter((k) => !allowed.includes(k as TaskField));
    if (refused.length) throw new SuiviError(tr({ en: 'Fields not editable here: {fields} (adding and removing go through Claude)', fr: 'Champs non modifiables ici : {fields} (ajouts et suppressions passent par Claude)' }, { fields: refused.join(', ') }), 403);

    const next: Task = { ...current };
    for (const [k, v] of Object.entries(changes)) (next as any)[k] = sanitizeField(k as TaskField, v);
    if ('done' in changes && !('doneAt' in changes)) next.doneAt = next.done ? current.doneAt ?? new Date().toISOString() : null;
    const diff = (Object.keys(changes) as TaskField[]).concat('doneAt').filter((f, i, a) => a.indexOf(f) === i && !same(current[f], next[f]))
      .map((field) => ({ field, before: current[field], after: next[field] }));
    if (!diff.length) return current;
    next.rev = current.rev + 1;
    next.updatedAt = new Date().toISOString();
    next.updatedBy = origin;
    this.tx(() => {
      this.write(projectId, next);
      this.log(projectId, taskId, next.rev, diff, origin);
    });
    this.onChange(projectId);
    return next;
  }

  // ─── Import / export ───────────────────────────────────────────────────────
  /**
   * Importe un fichier au format de la copie (`SuiviFile`). Les tâches sans `updatedAt` prennent la date d'export du
   * fichier : une modification plus récente côté Tarmac l'emporte donc sur une copie ancienne.
   */
  importFile(projectId: string, file: SuiviFile, origin: Origin = 'claude', journalOrigin = 'import'): ImportResult {
    this.requireProject(projectId);
    if (!file || !Array.isArray(file.tasks)) throw new SuiviError(tr({ en: 'Invalid Todolist file: `tasks` array expected', fr: 'Fichier de suivi invalide : tableau `tasks` attendu' }));
    if (file.tasks.length > 5000) throw new SuiviError(msg('suivi.tooManyTasks'));
    const exportedAt = file.exportedAt && !Number.isNaN(Date.parse(file.exportedAt)) ? new Date(file.exportedAt).toISOString() : null;
    const incoming = file.tasks.map((raw) => {
      const t = sanitizeTask(raw);
      return { ...t, updatedAt: t.updatedAt ?? exportedAt, updatedBy: t.updatedBy ?? origin };
    });
    const res: ImportResult = { created: 0, updated: 0, unchanged: 0, lost: 0, total: incoming.length };
    this.tx(() => {
      for (const t of incoming) {
        const r = this.mergeOne(projectId, t, origin, journalOrigin, { incomingWinsTie: true });
        if (r.created) res.created++;
        else if (r.changes.length) res.updated++;
        else res.unchanged++;
        if (r.lost.length) res.lost++;
      }
    });
    if (res.created || res.updated) this.onChange(projectId);
    return res;
  }

  /**
   * Tâches modifiées dans l'artefact (pont MCP, canal A ; rattrapage, canal C) : fusion tâche par tâche,
   * la plus récente gagne. Chaque tâche doit porter son `updatedAt` (sinon elle perd face à Tarmac).
   */
  pushTasks(projectId: string, raws: unknown[], channel: 'A' | 'C', opts: { uiOnly?: boolean } = {}): ImportResult & { cursor: number; refused: number } {
    this.requireProject(projectId);
    if (!Array.isArray(raws)) throw new SuiviError(tr({ en: '`tasks` array expected', fr: 'Tableau `tasks` attendu' }));
    if (raws.length > 5000) throw new SuiviError(msg('suivi.tooManyTasks'));
    let refused = 0;
    const incoming = raws.flatMap((raw) => {
      const t = { ...sanitizeTask(raw), updatedBy: 'artifact' as const };
      if (!opts.uiOnly) return [t];
      // Page d'artefact (D7) : seulement la coche et la note de tâches existantes.
      const local = this.task(projectId, t.id);
      if (!local) { refused++; return []; }
      const ui = Object.fromEntries(UI_FIELDS.map((f) => [f, t[f]]));
      return [{ ...local, ...ui, rev: t.rev, updatedAt: t.updatedAt, updatedBy: 'artifact' as const }];
    });
    const res: ImportResult = { created: 0, updated: 0, unchanged: 0, lost: 0, total: incoming.length };
    this.tx(() => {
      for (const t of incoming) {
        const r = this.mergeOne(projectId, t, 'artifact', tr({ en: 'artifact (channel {channel})', fr: 'artefact (canal {channel})' }, { channel }, uiLang()));
        if (r.created) res.created++;
        else if (r.changes.length) res.updated++;
        else res.unchanged++;
        if (r.lost.length) res.lost++;
      }
    });
    const lang = uiLang();
    const lost = res.lost ? tr({ en: ', {n} conflict(s) logged', fr: ', {n} écart(s) au journal' }, { n: res.lost }, lang) : '';
    this.recordSync(projectId, channel, tr({ en: '{total} received: {created} created, {updated} updated{lost}', fr: '{total} reçue(s) : {created} créée(s), {updated} mise(s) à jour{lost}' }, { ...res, lost }, lang));
    if (res.created || res.updated) this.onChange(projectId);
    return { ...res, refused, cursor: this.changedSince(projectId, Number.MAX_SAFE_INTEGER).cursor };
  }

  /**
   * Rattrapage (canal C) depuis un export de la db de l'artefact (un fichier JSON par document dans `dumpDir`) :
   * les tâches de l'artefact sont fusionnées ici, puis on calcule ce qu'il faut réécrire dans l'artefact
   * (tâche absente ou différente après fusion). Chaque écriture pointe vers un fichier prêt à envoyer.
   */
  mergeArtifactDump(projectId: string, dumpDir: string, outDir: string) {
    this.requireProject(projectId);
    const docs = new Map<string, Record<string, unknown>>();
    const files = fs.existsSync(dumpDir) ? fs.readdirSync(dumpDir).filter((f) => f.endsWith('.json')) : [];
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dumpDir, f), 'utf8'));
        const id = f.slice(0, -5);
        if (TASK_ID_RE.test(id) && raw && typeof raw === 'object') docs.set(id, raw.data && typeof raw.data === 'object' ? raw.data : raw);
      } catch { /* document illisible : ignoré */ }
    }
    // Une tâche jamais datée côté artefact (anciennes coches) prend la date de sa coche.
    const incoming = [...docs].map(([id, d]) => ({ ...d, id, updatedAt: (d.updatedAt as string) || (d.doneAt as string) || null }));
    const fromArtifact = incoming.length ? this.pushTasks(projectId, incoming, 'C') : null;
    fs.mkdirSync(outDir, { recursive: true });
    const writes: { op: 'set' | 'update'; collection: 'tasks'; doc_id: string; file_path: string }[] = [];
    for (const t of this.tasks(projectId, { archived: true })) {
      const d = docs.get(t.id);
      const differs = !d || TASK_FIELDS.some((f) => !same(sanitizeField(f, d[f]), t[f])) || d.rev !== t.rev;
      if (!differs) continue;
      const { id, ...data } = t;
      const file = path.join(outDir, `${id}.json`);
      fs.writeFileSync(file, JSON.stringify(data));
      writes.push({ op: d ? 'update' : 'set', collection: 'tasks', doc_id: id, file_path: file });
    }
    const batches: (typeof writes)[] = [];
    for (let i = 0; i < writes.length; i += 50) batches.push(writes.slice(i, i + 50));
    return {
      fromArtifact: fromArtifact ? { received: fromArtifact.total, created: fromArtifact.created, updated: fromArtifact.updated, lost: fromArtifact.lost } : { received: 0, created: 0, updated: 0, lost: 0 },
      toArtifact: writes.length,
      batches,
    };
  }

  exportFile(projectId: string): SuiviFile & { counts: NonNullable<SuiviFile['counts']> } {
    const p = this.requireProject(projectId);
    const tasks = this.tasks(projectId, { archived: true });
    const c = countTasks(tasks);
    return {
      source: p.artifactUrl,
      collection: 'tasks',
      exportedAt: new Date().toISOString(),
      counts: { total: c.total, done: c.done, remaining: c.remaining, toTest: c.toTest },
      tasks,
    };
  }

  history(projectId: string, taskId: string): JournalEntry[] {
    const rows = this.db.prepare('SELECT seq, task_id, rev, field, before, after, origin, lost, at FROM journal WHERE project_id = ? AND task_id = ? ORDER BY seq DESC LIMIT 500')
      .all(projectId, taskId) as any[];
    return rows.map((r) => ({ seq: r.seq, taskId: r.task_id, rev: r.rev, field: r.field, before: parse(r.before), after: parse(r.after), origin: r.origin, lost: !!r.lost, at: r.at }));
  }

  // ─── Synchronisations ──────────────────────────────────────────────────────
  recordSync(projectId: string, channel: Channel, result: string, marker: string | null = null) {
    this.db.prepare('INSERT INTO syncs (project_id, channel, at, result, marker) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, channel) DO UPDATE SET at = excluded.at, result = excluded.result, marker = excluded.marker')
      .run(projectId, channel, new Date().toISOString(), result.slice(0, 500), marker);
  }

  syncs(projectId: string): SyncState[] {
    return (this.db.prepare('SELECT channel, at, result, marker FROM syncs WHERE project_id = ? ORDER BY channel').all(projectId) as any[])
      .map((r) => ({ channel: r.channel, at: r.at, result: r.result, marker: r.marker }));
  }

  /**
   * Tâches modifiées depuis le curseur `since` (numéro de ligne du journal), pour le pull du pont MCP
   * (canal A) et le rattrapage léger. Renvoie aussi le nouveau curseur.
   */
  changedSince(projectId: string, since: number): { cursor: number; tasks: Task[] } {
    const cursor = (this.db.prepare('SELECT coalesce(max(seq), 0) AS c FROM journal WHERE project_id = ?').get(projectId) as { c: number }).c;
    const ids = (this.db.prepare('SELECT DISTINCT task_id FROM journal WHERE project_id = ? AND seq > ?').all(projectId, since) as { task_id: string }[]).map((r) => r.task_id);
    return { cursor, tasks: ids.map((id) => this.task(projectId, id)).filter((t): t is Task => !!t) };
  }

  /** Version la plus récente entre deux copies d'une même tâche (utilisé par le rattrapage). */
  static newer(a: Task, b: Task) {
    return compareVersions(a, b) >= 0 ? a : b;
  }
}
