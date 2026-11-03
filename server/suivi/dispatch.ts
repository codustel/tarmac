/**
 * « Envoyer à Claude » (bouton ▶ Claude de l'artefact et de la vue Todolist) : une tâche non traitée est confiée
 * à une session Claude Code **ouverte dans une console de Tarmac** pour ce projet, ou à une nouvelle session.
 *
 * Garde-fous :
 * - projet et tâche validés ; seules les tâches non traitées (ni faites, ni à tester, ni archivées) partent ;
 * - la consigne ne contient que des données de la tâche, nettoyées (aucun caractère de contrôle : rien ne peut
 *   sortir du collage entre crochets ni injecter de touche dans la console) ;
 * - aucune écriture vers une console qui n'est pas une session Claude en cours d'un dossier de ce projet ;
 * - aucune écriture vers une session qui n'est pas **au repos, invite vide** (`consoleState`) : une session qui
 *   travaille, qui attend une permission (« Do you want to proceed? ») ou dont l'état est inconnu est refusée — la
 *   touche Entrée pourrait sinon approuver une permission ou valider une saisie en cours.
 *
 * Les sessions lancées hors de Tarmac (Terminal, Claude desktop) ne sont pas joignables : Tarmac n'a pas leur console.
 */
import path from 'node:path';
import { tr, type Lang } from '../i18n.js';
import type { SuiviService } from './service.js';
import { isUntreated, SuiviError, TASK_ID_RE, type SuiviProject, type Task } from './types.js';

/** Console de Tarmac (résumé de `TerminalManager.list`) vue par l'envoi. */
export interface ConsoleInfo {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  label: string;
  claudeSessionId: string | null;
  startedAt: string;
  lastActivityAt?: string | null;
}

/** Session Claude en cours dans une console de Tarmac, pour un projet de suivi. */
export interface ClaudeConsoleSession {
  terminalId: string;
  name: string;
  /** Titre de la session Claude (/rename, résumé), s'il est connu. */
  title: string | null;
  claudeSessionId: string | null;
  appProjectId: string;
  startedAt: string;
  lastActivityAt: string | null;
  /** État lu sur l'écran de la console ; seules les sessions `idle` peuvent recevoir une tâche. */
  state: ConsoleState;
  available: boolean;
}

/**
 * État d'une session Claude Code d'après la fin de sa sortie :
 * - `busy` : sortie il y a moins de `QUIET_MS` (animation du travail en cours) ou « esc to interrupt » en dernier ;
 * - `permission` : boîte de permission en dernier (« Do you want to … », « ❯ 1. Yes ») ;
 * - `idle` : invite vide en dernier (ligne « > » seule, ou « ? for shortcuts », affiché seulement quand la saisie
 *   est vide) et sortie calme ;
 * - `unknown` : rien de reconnu (refusé comme `busy`).
 */
export type ConsoleState = 'idle' | 'busy' | 'permission' | 'unknown';
export const QUIET_MS = 2000;

/** Texte lisible d'une sortie de terminal : séquences ANSI (CSI, OSC, autres ESC) et contrôles retirés. */
export function screenText(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    // Couleurs retirées, avance du curseur = espace, autres déplacements et effacements = saut de ligne.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*([@-~])/g, (_m, f: string) => (f === 'm' ? '' : f === 'C' ? ' ' : '\n'))
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

const lastMatch = (text: string, re: RegExp) => {
  let at = -1;
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) at = m.index!;
  return at;
};
const PERMISSION_RE = /Do you want to (?:proceed|make this edit|create|allow|run)|❯\s*1\.\s*Yes|\b1\.\s*Yes\b[^\n]*\n(?:[^\n]*\n){0,3}?[^\n]*\b2\.\s*(?:Yes|No)|\(esc\)\s*$/im;
const BUSY_RE = /esc to interrupt/i;
// Invite vide : une ligne faite seulement de « > » (bords de boîte permis), ou l'aide « ? for shortcuts ».
const IDLE_RE = /^[ \t│|]*>[ \t\u00a0]*[│|]?[ \t]*$|\? for shortcuts/m;
// Saisie commencée dans la boîte (« > texte ») : le collage s'y ajouterait.
const TYPED_RE = /^[ \t│|]*>[ \t\u00a0]+\S/m;

/**
 * `turn` : tour de parole lu dans le transcript de la session (`claudeTurnState`) ; `working` (réponse ou outil en
 * cours, permission demandée) l'emporte sur un écran qui a l'air au repos ; `none` laisse décider l'écran.
 */
export function consoleState(raw: string, quietMs: number, turn: 'idle' | 'working' | 'none' = 'none'): ConsoleState {
  const text = screenText(raw.slice(-16_000)).slice(-6000);
  const permission = lastMatch(text, PERMISSION_RE);
  const busy = lastMatch(text, BUSY_RE);
  const idle = lastMatch(text, IDLE_RE);
  const typed = lastMatch(text, TYPED_RE);
  if (permission >= 0 && permission > idle) return 'permission';
  // L'indicateur de travail est juste au-dessus de la boîte de saisie : présent dans la toute fin = au travail.
  if (quietMs < QUIET_MS || turn === 'working' || (busy >= 0 && (busy > idle || text.length - busy < 600))) return 'busy';
  return idle >= 0 && typed < idle ? 'idle' : 'unknown';
}

export interface DispatchDeps {
  service: SuiviService;
  /** Projets scannés par Tarmac (id, dossier). */
  appProjects: () => { id: string; dir: string }[];
  /** Consoles ouvertes dans Tarmac. */
  consoles: () => ConsoleInfo[];
  /** Titre connu d'une session Claude (facultatif). */
  sessionTitle?: (claudeSessionId: string) => string | null;
  write: (terminalId: string, data: string) => void;
  /** Fin de la sortie brute d'une console et date de la dernière sortie (pour `consoleState`). */
  screen: (terminalId: string) => { text: string; lastOutputAt: string | null } | null;
  /** Tour de parole d'une session Claude d'après son transcript (facultatif). */
  turn?: (claudeSessionId: string) => 'idle' | 'working' | 'none';
  /** Horloge (tests). */
  now?: () => number;
  /** Ouvre une nouvelle session Claude (Remote Control) dans un projet scanné, avec un premier message. */
  openSession: (appProjectId: string, prompt: string) => Promise<{ id: string; label: string }>;
  lang: () => Lang;
  /** Pause entre le collage et la touche Entrée (la TUI de Claude Code traite le collage d'abord). */
  delay?: (ms: number) => Promise<void>;
}

export type DispatchTarget = 'new' | string;

export interface DispatchResult {
  ok: true;
  target: 'new' | 'session';
  terminalId: string;
  session: string;
  prompt: string;
  task: Task;
}

const busyMessage = (state: ConsoleState) => tr(state === 'permission'
  ? { en: 'This session is waiting for a permission answer: pick another one or New session (nothing was sent)', fr: 'Cette session attend une réponse de permission : choisis-en une autre ou Nouvelle session (rien n’a été envoyé)' }
  : state === 'busy'
    ? { en: 'This session is busy: pick another one or New session (nothing was sent)', fr: 'Session occupée : choisis-en une autre ou Nouvelle session (rien n’a été envoyé)' }
    : { en: 'This session’s state is unknown (no empty prompt seen): pick another one or New session (nothing was sent)', fr: 'État de la session inconnu (pas d’invite vide visible) : choisis-en une autre ou Nouvelle session (rien n’a été envoyé)' });

const TERMINAL_ID_RE = /^[\w-]{1,64}$/;

/**
 * Texte de tâche sûr pour une consigne : caractères de contrôle (C0, C1, DEL, ESC…), séparateurs de ligne et
 * marques de direction retirés, espaces regroupés, longueur bornée.
 */
export function cleanText(s: unknown, max = 200): string {
  const text = String(s ?? '')
    // Séquences ANSI complètes (couleurs, collage entre crochets…), puis tout caractère de contrôle restant.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/** Consigne envoyée à Claude, dans la langue de l'app. */
export function buildPrompt(task: Pick<Task, 'id' | 'num' | 'title'>, projectId: string, lang: Lang): string {
  const num = cleanText(task.num, 20).replace(/[^\w.-]/g, '') || task.id;
  const title = cleanText(task.title);
  return tr({
    fr: 'Traite la tâche {num} « {title} » (id {id}) du suivi {project} : lis-la avec suivi_get, fais-la, puis passe-la à tester (règles du suivi).',
    en: 'Handle task {num} “{title}” (id {id}) from the {project} tracker: read it with suivi_get, do it, then mark it to test (tracker rules).',
  }, { num, title, id: task.id, project: projectId }, lang);
}

/** Collage entre crochets puis Entrée : la TUI de Claude Code le reçoit comme un message tapé. */
export const pasteSequence = (prompt: string) => `\x1b[200~${prompt}\x1b[201~`;

export class SuiviDispatcher {
  constructor(private deps: DispatchDeps) {}

  /** Projets scannés dont le dossier est (ou est sous) un des dossiers du projet de suivi ; la racine d'abord. */
  appProjectsOf(sp: SuiviProject) {
    const roots = sp.paths.map((p) => path.resolve(p));
    return this.deps.appProjects()
      .filter((p) => roots.some((r) => p.dir === r || p.dir.startsWith(r + path.sep)))
      .sort((a, b) => Number(roots.includes(b.dir)) - Number(roots.includes(a.dir)) || a.dir.length - b.dir.length);
  }

  /** Sessions Claude en cours dans les consoles de Tarmac pour ce projet (la plus récemment active d'abord). */
  sessions(projectId: string): ClaudeConsoleSession[] {
    const sp = this.deps.service.requireProject(projectId);
    const ids = new Set(this.appProjectsOf(sp).map((p) => p.id));
    return this.deps.consoles()
      .filter((c) => c.kind === 'claude' && c.status === 'running' && ids.has(c.projectId))
      .map((c) => {
        const state = this.state(c.id, c.claudeSessionId);
        return {
        terminalId: c.id,
        name: cleanText(c.label, 120),
        title: c.claudeSessionId ? cleanText(this.deps.sessionTitle?.(c.claudeSessionId) ?? '', 120) || null : null,
        claudeSessionId: c.claudeSessionId,
        appProjectId: c.projectId,
        startedAt: c.startedAt,
        lastActivityAt: c.lastActivityAt ?? null,
        state,
        available: state === 'idle',
      };
      })
      .sort((a, b) => (b.lastActivityAt ?? b.startedAt).localeCompare(a.lastActivityAt ?? a.startedAt));
  }

  /** État d'une console (voir `consoleState`) ; sans écran lisible : `unknown`. */
  state(terminalId: string, claudeSessionId: string | null = null): ConsoleState {
    const sc = this.deps.screen(terminalId);
    if (!sc) return 'unknown';
    const last = sc.lastOutputAt ? Date.parse(sc.lastOutputAt) : NaN;
    const quiet = Number.isNaN(last) ? Infinity : (this.deps.now ?? Date.now)() - last;
    return consoleState(sc.text, quiet, claudeSessionId && this.deps.turn ? this.deps.turn(claudeSessionId) : 'none');
  }

  /** Envoie la tâche à une session en cours (`terminalId`) ou à une nouvelle session (`new`), puis la marque demandée. */
  async dispatch(projectId: string, taskId: string, target: DispatchTarget): Promise<DispatchResult> {
    const { service } = this.deps;
    const sp = service.requireProject(projectId);
    if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) throw new SuiviError(tr({ en: 'Invalid task ID', fr: 'Identifiant de tâche invalide' }));
    const task = service.task(projectId, taskId);
    if (!task) throw new SuiviError(tr({ en: 'Unknown task', fr: 'Tâche inconnue' }), 404);
    if (!isUntreated(task)) throw new SuiviError(tr({ en: 'This task is already handled (done, to test or archived)', fr: 'Cette tâche est déjà traitée (faite, à tester ou archivée)' }), 409, task);
    if (target !== 'new' && (typeof target !== 'string' || !TERMINAL_ID_RE.test(target))) {
      throw new SuiviError(tr({ en: 'Expected target: a session (terminalId) or "new"', fr: 'Cible attendue : une session (terminalId) ou « new »' }));
    }
    const prompt = buildPrompt(task, projectId, this.deps.lang());

    let terminalId: string, session: string;
    if (target === 'new') {
      const app = this.appProjectsOf(sp)[0];
      if (!app) throw new SuiviError(tr({ en: 'No project folder scanned by Tarmac for this tracker: cannot open a Claude session', fr: 'Aucun dossier de ce suivi n’est scanné par Tarmac : impossible d’ouvrir une session Claude' }), 404);
      const t = await this.deps.openSession(app.id, prompt);
      terminalId = t.id;
      session = cleanText(t.label, 120);
    } else {
      const s = this.sessions(projectId).find((x) => x.terminalId === target);
      if (!s) throw new SuiviError(tr({ en: 'This console is not a running Claude session of this project', fr: 'Cette console n’est pas une session Claude en cours de ce projet' }), 404);
      if (s.state !== 'idle') throw new SuiviError(busyMessage(s.state), 409, { state: s.state });
      this.deps.write(s.terminalId, pasteSequence(prompt));
      await (this.deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(150);
      // Une boîte de permission apparue entre-temps : pas d'Entrée (elle l'approuverait).
      if (this.state(s.terminalId, s.claudeSessionId) === 'permission') throw new SuiviError(busyMessage('permission'), 409, { state: 'permission' });
      this.deps.write(s.terminalId, '\r');
      terminalId = s.terminalId;
      session = s.name;
    }

    const current = service.task(projectId, taskId) ?? task;
    const marked = service.patchTask(projectId, taskId, current.rev, {
      requestedAt: new Date().toISOString(),
      requestedTo: target === 'new' ? 'new' : session,
    }, 'tarmac');
    return { ok: true, target: target === 'new' ? 'new' : 'session', terminalId, session, prompt, task: marked };
  }
}
