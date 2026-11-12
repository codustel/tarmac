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
 *
 * Codex (ChatGPT) : mêmes règles pour ses consoles quand il est coché dans Réglages → Agents, avec une lecture
 * d'écran propre à sa TUI (`codexConsoleState`) et son tour de parole lu dans son transcript.
 */
import path from 'node:path';
import { tr, type Lang } from '../i18n.js';
import type { AgentKind } from '../agentProcs.js';
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
  codexSessionId?: string | null;
  startedAt: string;
  lastActivityAt?: string | null;
}

/** Session d'agent (Claude ou Codex) en cours dans une console de Tarmac, pour un projet de suivi. */
export interface ClaudeConsoleSession {
  terminalId: string;
  /** Agent de la session. */
  agent: AgentKind;
  name: string;
  /** Titre de la session (/rename, résumé), s'il est connu. */
  title: string | null;
  claudeSessionId: string | null;
  /** Session Codex (si connue). */
  codexSessionId: string | null;
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

// ─── TUI de Codex (codex-rs/tui du code ouvert de Codex) ────────────────────
// Boîte d'approbation : « Would you like to run the following command? », « … make the following edits? »,
// « … grant these permissions? », « Do you want to approve network access … », options « Yes, proceed »,
// « No, and tell Codex what to do differently ».
const CODEX_PERMISSION_RE = /Would you like to (?:run|make|grant|send)|Do you want to approve|Yes, proceed|No, and tell Codex what to do differently/i;
// Indicateur de travail : « Working (12s • esc to interrupt) ».
const CODEX_BUSY_RE = /esc to interrupt|\bWorking \(\d/i;
// Saisie vide : le texte d'attente de la boîte (« Ask Codex to do anything », ou « Ask a follow-up question »),
// affiché seulement quand la boîte est vide.
const CODEX_IDLE_RE = /Ask Codex to do anything|Ask a follow-up question/;
// Liste d'options d'approbation dans la fin d'écran (« › 1. Yes, proceed », « 2. No… », « Allow », « Approve »…) :
// toujours `permission`, même si le texte d'attente de la boîte vide a été redessiné après (Entrée l'approuverait).
const CODEX_OPTIONS_RE = /[›❯]\s*1\.\s*Yes|\b1\.\s*Yes\b|\b\d\.\s*No\b|\b(?:Allow|Approve|Deny|Reject)\b/i;
const CODEX_OPTIONS_TAIL = 2000;
// Ligne entière de pied de page, de cadre ou de contexte restant (ou ses seuls chiffres redessinés). L'écran est du
// contenu non fiable : pas de regex à répétition imbriquée (retour arrière catastrophique). Les expressions connues
// sont retirées (regex linéaires), puis chaque mot restant doit être un mot de cadre ou un nombre (regex ancrée
// simple). Ligne trop longue, ou mot inconnu : pas un pied de page.
const FOOTER_PHRASES = [
  /\?\s?for shortcuts/gi,
  /\b(?:ctrl|alt|option|shift)[+-]?\w{1,12} for agents/gi,
  /⌃\w{1,12} for agents/gi,
  /\b\d{1,3}% context (?:left|used)/gi,
  /\(?shift\+tab to cycle\)?/gi,
];
const FOOTER_WORD = /^(?:[›>│|─╭╮╰╯·•]+|\d{1,3}%?)$/;
const FOOTER_MAX_LINE = 300;
export function isCodexFooterLine(line: string): boolean {
  if (line.length > FOOTER_MAX_LINE) return false;
  let rest = line;
  for (const re of FOOTER_PHRASES) rest = rest.replace(re, ' ');
  return rest.split(/\s+/).every((w) => !w || FOOTER_WORD.test(w));
}

/**
 * État d'une session Codex d'après la fin de sa sortie : comme `consoleState`, avec les textes de la TUI de Codex.
 * La TUI ne redessine que les cellules qui changent : un ancien « esc to interrupt » peut rester après le texte
 * d'attente. Le tour de parole lu dans le transcript fait donc foi quand il est connu (`working` = occupée,
 * `idle` = l'indicateur de travail est périmé) ; sans transcript, l'indicateur récent l'emporte.
 * Au repos seulement si le texte d'attente de la boîte vide est le dernier élément reconnu, qu'aucune liste
 * d'options d'approbation n'est dans la fin d'écran, et que chaque ligne écrite après lui est entièrement un pied
 * de page connu (une saisie commencée, ou toute ligne non reconnue : `unknown`). Dans le doute, jamais `idle`.
 */
export function codexConsoleState(raw: string, quietMs: number, turn: 'idle' | 'working' | 'none' = 'none'): ConsoleState {
  const text = screenText(raw.slice(-16_000)).slice(-6000);
  const permission = lastMatch(text, CODEX_PERMISSION_RE);
  const busy = lastMatch(text, CODEX_BUSY_RE);
  const idle = lastMatch(text, CODEX_IDLE_RE);
  if (permission >= 0 && permission > idle) return 'permission';
  if (CODEX_OPTIONS_RE.test(text.slice(-CODEX_OPTIONS_TAIL))) return 'permission';
  if (quietMs < QUIET_MS || turn === 'working') return 'busy';
  if (turn === 'none' && busy >= 0 && (busy > idle || text.length - busy < 600)) return 'busy';
  if (idle < 0) return 'unknown';
  const after = text.slice(idle).replace(CODEX_IDLE_RE, '').split('\n');
  return after.every(isCodexFooterLine) ? 'idle' : 'unknown';
}

/** Lecture d'écran selon l'agent. */
export const agentConsoleState = (agent: AgentKind, raw: string, quietMs: number, turn: 'idle' | 'working' | 'none' = 'none') =>
  agent === 'codex' ? codexConsoleState(raw, quietMs, turn) : consoleState(raw, quietMs, turn);

const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' };

export interface DispatchDeps {
  service: SuiviService;
  /** Projets scannés par Tarmac (id, dossier). */
  appProjects: () => { id: string; dir: string }[];
  /** Consoles ouvertes dans Tarmac. */
  consoles: () => ConsoleInfo[];
  /** Titre connu d'une session (facultatif). */
  sessionTitle?: (sessionId: string, agent: AgentKind) => string | null;
  write: (terminalId: string, data: string) => void;
  /** Fin de la sortie brute d'une console et date de la dernière sortie (pour `consoleState`). */
  screen: (terminalId: string) => { text: string; lastOutputAt: string | null } | null;
  /** Tour de parole d'une session d'après son transcript (facultatif). */
  turn?: (sessionId: string, agent: AgentKind) => 'idle' | 'working' | 'none';
  /** Horloge (tests). */
  now?: () => number;
  /** Agents cochés dans Réglages → Agents (Claude seul par défaut). */
  agents?: () => AgentKind[];
  /** Ouvre une nouvelle session de l'agent dans un projet scanné, avec un premier message. */
  openSession: (appProjectId: string, prompt: string, agent: AgentKind) => Promise<{ id: string; label: string }>;
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

/** Suffixe fixe des consignes envoyées par un pilote automatique (module) : jamais de push, s'arrêter si bloqué. */
export const AUTOPILOT_SUFFIX = {
  fr: ' Mode pilote automatique : ne fais aucun git push ; si tu es bloqué ou as une question, arrête-toi et dis-le sans passer la tâche à tester.',
  en: ' Autopilot mode: do not run any git push; if you are blocked or have a question, stop and say so without marking the task to test.',
} as const;

/** Consigne envoyée à Claude, dans la langue de l'app (`autopilot` : suffixe du pilote automatique ajouté). */
export function buildPrompt(task: Pick<Task, 'id' | 'num' | 'title'>, projectId: string, lang: Lang, autopilot = false): string {
  const num = cleanText(task.num, 20).replace(/[^\w.-]/g, '') || task.id;
  const title = cleanText(task.title);
  const base = tr({
    fr: 'Traite la tâche {num} « {title} » (id {id}) du suivi {project} : lis-la avec suivi_get, fais-la, puis passe-la à tester (règles du suivi).',
    en: 'Handle task {num} “{title}” (id {id}) from the {project} tracker: read it with suivi_get, do it, then mark it to test (tracker rules).',
  }, { num, title, id: task.id, project: projectId }, lang);
  return autopilot ? base + AUTOPILOT_SUFFIX[lang] : base;
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

  /** Agents cochés (Claude seul par défaut). */
  agents(): AgentKind[] {
    return this.deps.agents?.() ?? ['claude'];
  }

  /** Sessions d'agent en cours dans les consoles de Tarmac pour ce projet (la plus récemment active d'abord). */
  sessions(projectId: string): ClaudeConsoleSession[] {
    const sp = this.deps.service.requireProject(projectId);
    const ids = new Set(this.appProjectsOf(sp).map((p) => p.id));
    const agents = this.agents();
    return this.deps.consoles()
      .filter((c) => agents.includes(c.kind as AgentKind) && c.status === 'running' && ids.has(c.projectId))
      .map((c) => {
        const agent = c.kind as AgentKind;
        const sid = agent === 'codex' ? c.codexSessionId ?? null : c.claudeSessionId;
        const state = this.state(c.id, sid, agent);
        return {
          terminalId: c.id,
          agent,
          name: cleanText(c.label, 120),
          title: sid ? cleanText(this.deps.sessionTitle?.(sid, agent) ?? '', 120) || null : null,
          claudeSessionId: c.claudeSessionId,
          codexSessionId: c.codexSessionId ?? null,
          appProjectId: c.projectId,
          startedAt: c.startedAt,
          lastActivityAt: c.lastActivityAt ?? null,
          state,
          available: state === 'idle',
        };
      })
      .sort((a, b) => (b.lastActivityAt ?? b.startedAt).localeCompare(a.lastActivityAt ?? a.startedAt));
  }

  /** État d'une console (voir `consoleState` / `codexConsoleState`) ; sans écran lisible : `unknown`. */
  state(terminalId: string, sessionId: string | null = null, agent: AgentKind = 'claude'): ConsoleState {
    const sc = this.deps.screen(terminalId);
    if (!sc) return 'unknown';
    const last = sc.lastOutputAt ? Date.parse(sc.lastOutputAt) : NaN;
    const quiet = Number.isNaN(last) ? Infinity : (this.deps.now ?? Date.now)() - last;
    return agentConsoleState(agent, sc.text, quiet, sessionId && this.deps.turn ? this.deps.turn(sessionId, agent) : 'none');
  }

  /**
   * Envoie la tâche à une session en cours (`terminalId`) ou à une nouvelle session (`new`) de l'agent choisi
   * (`agent`, le premier agent coché par défaut), puis la marque demandée.
   */
  async dispatch(projectId: string, taskId: string, target: DispatchTarget, agent?: AgentKind, opts: { autopilot?: boolean } = {}): Promise<DispatchResult> {
    const { service } = this.deps;
    const sp = service.requireProject(projectId);
    if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) throw new SuiviError(tr({ en: 'Invalid task ID', fr: 'Identifiant de tâche invalide' }));
    const task = service.task(projectId, taskId);
    if (!task) throw new SuiviError(tr({ en: 'Unknown task', fr: 'Tâche inconnue' }), 404);
    if (!isUntreated(task)) throw new SuiviError(tr({ en: 'This task is already handled (done, to test or archived)', fr: 'Cette tâche est déjà traitée (faite, à tester ou archivée)' }), 409, task);
    if (target !== 'new' && (typeof target !== 'string' || !TERMINAL_ID_RE.test(target))) {
      throw new SuiviError(tr({ en: 'Expected target: a session (terminalId) or "new"', fr: 'Cible attendue : une session (terminalId) ou « new »' }));
    }
    const enabled = this.agents();
    if (agent !== undefined && (typeof agent !== 'string' || !enabled.includes(agent))) {
      throw new SuiviError(tr({ en: 'Unknown or disabled agent (Settings → Agents)', fr: 'Agent inconnu ou désactivé (Réglages → Agents)' }));
    }
    const prompt = buildPrompt(task, projectId, this.deps.lang(), opts.autopilot === true);

    let terminalId: string, session: string;
    if (target === 'new') {
      const who = agent ?? enabled[0] ?? 'claude';
      const app = this.appProjectsOf(sp)[0];
      if (!app) throw new SuiviError(tr({ en: 'No project folder scanned by Tarmac for this tracker: cannot open a {agent} session', fr: 'Aucun dossier de ce suivi n’est scanné par Tarmac : impossible d’ouvrir une session {agent}' }, { agent: AGENT_LABEL[who] }), 404);
      const t = await this.deps.openSession(app.id, prompt, who);
      terminalId = t.id;
      session = cleanText(t.label, 120);
    } else {
      const s = this.sessions(projectId).find((x) => x.terminalId === target);
      if (!s || (agent && s.agent !== agent)) throw new SuiviError(tr({ en: 'This console is not a running agent session of this project', fr: 'Cette console n’est pas une session d’agent en cours de ce projet' }), 404);
      if (s.state !== 'idle') throw new SuiviError(busyMessage(s.state), 409, { state: s.state });
      this.deps.write(s.terminalId, pasteSequence(prompt));
      await (this.deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(150);
      // Une boîte de permission apparue entre-temps : pas d'Entrée (elle l'approuverait).
      const sid = s.agent === 'codex' ? s.codexSessionId : s.claudeSessionId;
      if (this.state(s.terminalId, sid, s.agent) === 'permission') throw new SuiviError(busyMessage('permission'), 409, { state: 'permission' });
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
