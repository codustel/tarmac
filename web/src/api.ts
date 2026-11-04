import { getLang } from './i18n/state';
import type { Loc } from './i18n/core';
export type ProcStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';
export type SyncState = 'synced' | 'ahead' | 'behind' | 'diverged' | 'no-upstream' | 'no-remote' | 'error';

export interface GitStatus {
  branch: string | null;
  remoteUrl: string | null;
  /** `github.com/owner/repo` (normalisé), null sans remote. */
  remoteKey: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: number;
  untracked: number;
  sync: SyncState;
  lastCommitAt: string | null;
  lastCommitMsg: string | null;
  fetchedAt: string | null;
  dirtyAt: string | null;
  lastPushAt: string | null;
  error?: string;
}

export interface Runtime {
  status: ProcStatus;
  pid: number | null;
  port: number | null;
  url: string | null;
  startedAt: string | null;
  exitCode: number | null;
  adopted: boolean;
}

export interface Tech {
  id: string;
  label: string;
}

export type Kind = 'web' | 'service' | 'mobile' | 'worker' | 'console' | 'other';

export interface Command {
  id: string;
  label: string;
  cmd: string;
  group?: 'run' | 'dev' | 'deps' | 'test' | 'tool';
}

export interface TerminalSession {
  id: string;
  projectId: string;
  projectName: string;
  kind: 'command' | 'shell' | 'claude' | 'codex' | 'system';
  claudeSessionId: string | null;
  /** Session Codex de la console (reprise, ou repérée après le lancement). */
  codexSessionId?: string | null;
  label: string;
  command: string | null;
  status: 'running' | 'exited';
  exitCode: number | null;
  pid: number | null;
  startedAt: string;
}

export interface Project {
  id: string;
  name: string;
  dir: string;
  root: string;
  relPath: string;
  kind: Kind;
  description: string | null;
  language: Tech;
  languages: Tech[];
  platform: Tech | null;
  framework: Tech | null;
  packageManager: string | null;
  serve: { command: string; fixedPort: number | null; scriptPort: number | null; noPort: boolean } | null;
  commands: Command[];
  defaultCommand: string | null;
  readme: string | null;
  hasVenv: boolean;
  plannedPort: number | null;
  portBusy: boolean;
  /** Serveur qui tourne hors de Tarmac (console, terminal…) sur le port de l'app. */
  external: { port: number; url: string } | null;
  repo: { relPath: string; git: GitStatus | null; onGithub: boolean; pushedAt: string | null } | null;
  supabase: { projectId: string; ports: { api?: number; db?: number; studio?: number }; relPath: string | null } | null;
  /** Dossier où lancer la CLI Supabase (contient `supabase/`, ou projet qui utilise Supabase sans dossier). */
  supabaseCli: { relPath: string; hasFolder: boolean } | null;
  /** Projet de la Todolist Claude rattaché (owner/repo), s'il existe. */
  suiviId: string | null;
  runtime: Runtime;
  terminals: TerminalSession[];
  /** Fichiers `.env*` à la racine du projet. */
  envFiles: string[];
  techName: string;
  nameSource: NameSource;
  appName: string | null;
  activityAt: string | null;
  prodUrl: { url: string; source: string; manual: boolean } | null;
  favorite: boolean;
  loose: boolean;
  synthetic: boolean;
  group: GroupInfo;
  /**
   * Sessions Claude Code dont le dossier de travail est ce projet (hors sous-projets) : `count` au total,
   * `active` en cours (Tarmac ou ailleurs), `working` dont un agent travaille.
   */
  claude: { count: number; active: number; working: number; lastAt: string | null };
  /** Même chose pour Codex, seulement si Codex est coché dans Réglages → Agents (sinon null). */
  codex?: { count: number; active: number; working: number; lastAt: string | null } | null;
  /** Fenêtre d'éditeur (VS Code, Cursor…) ouverte sur ce dossier ou un dossier parent. */
  openIn: OpenIn | null;
}

export type NameSource = 'override' | 'git' | 'product' | 'manifest' | 'title' | 'readme' | 'package' | 'folder';

export interface GroupInfo {
  id: string;
  dir: string;
  relPath: string;
  name: string;
  nameSource: NameSource;
  isRoot: boolean;
  subPath: string;
  type: 'single' | 'monorepo' | 'repo' | 'folder' | 'loose';
  monorepoTool: string | null;
  size: number;
}

/** Catalogue servi en deux langues : choisir avec `t.loc()`. */
export interface GitCommandInfo {
  id: string;
  group: Loc;
  label: string;
  description: Loc;
  preview: string;
  arg?: 'message' | 'branch' | 'optional-message' | 'name' | 'ref' | 'path';
  argLabel?: Loc;
  placeholder?: string;
  danger?: boolean;
}

export interface ClaudeSession {
  id: string;
  cwd: string;
  title: string;
  titleSource: 'custom' | 'summary' | 'prompt' | 'none';
  firstPrompt: string | null;
  gitBranch: string | null;
  createdAt: string | null;
  updatedAt: string;
  messages: number;
  sizeBytes: number;
  version: string | null;
  active: boolean;
  terminalId: string | null;
  project?: { id: string; name: string } | null;
}

/** Agent de code : Claude Code ou Codex (ChatGPT). */
export type AgentKind = 'claude' | 'codex';

/** Agent en arrière-plan d'une session (sous-agent). */
export interface BackgroundAgent { id: string; type: string | null; description: string; startedAt: string | null; lastActivityAt: string }

/** Session d'agent en cours (`/api/agents/running`), dans Tarmac ou ailleurs. */
export interface RunningAgent {
  key: string;
  agent: AgentKind;
  pid: number;
  sessionId: string | null;
  match: 'pidfile' | 'arg' | 'recent' | 'none' | 'tarmac';
  cwd: string | null;
  title: string | null;
  startedAt: string;
  lastActivityAt: string | null;
  where: 'tarmac' | 'external';
  app: string | null;
  terminalId: string | null;
  state: 'working' | 'idle';
  background: BackgroundAgent[];
  working: boolean;
  project: { id: string; name: string } | null;
}

export type TimelineType = 'commit' | 'push' | 'session' | 'task';
/** Évènement de la timeline (`/api/timeline`) ; `text` est une donnée non fiable, affichée en texte. */
export interface TimelineEvent {
  id: string;
  type: TimelineType;
  at: string;
  projectId: string | null;
  projectName: string;
  text: string;
  branch?: string | null;
  hash?: string;
  author?: string;
  remote?: string;
  commits?: number | null;
  agent?: AgentKind;
  sessionId?: string;
  task?: { suiviId: string; taskId: string; num: string; status: 'created' | 'toTest' | 'done' };
}

export interface OpenIn {
  editor: string;
  editorLabel: string;
  path: string;
  via: 'exact' | 'parent';
}

export interface AndroidCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  install: string | null;
  blockedBy: string[];
}

export interface Avd {
  name: string;
  device: string | null;
  api: string | null;
  image: string | null;
  missingImage: string | null;
  state: 'stopped' | 'starting' | 'booting' | 'ready' | 'stopping';
  serial: string | null;
  pid: number | null;
  error: string | null;
}

export interface AndroidStatus {
  sdk: string;
  sdkExists: boolean;
  checks: AndroidCheck[];
  avds: Avd[];
}

export interface DirEntry {
  name: string;
  type: 'dir' | 'file';
  size: number | null;
  link: boolean;
}

export type FileRead =
  | { kind: 'text'; content: string; mtime: number; size: number }
  | { kind: 'binary' | 'too-large'; mtime: number; size: number };

export type EnvLine = { type: 'comment'; text: string } | { type: 'entry'; key: string; value: string; line: number; disabled?: boolean };

export interface GhCliStatus {
  installed: boolean;
  loggedIn: boolean;
  user: string | null;
}

export interface Settings {
  roots: string[];
  github: { owners: string[]; tokenSet: boolean };
  portRange: { start: number; end: number };
  scanMaxDepth: number;
  editor: 'vscode' | 'cursor' | 'zed' | 'webstorm';
  showAllProjects: boolean;
  showClaudeUsage: boolean;
  showCodexUsage: boolean;
  /** Agents affichés et pris en charge (au moins un ; Claude seul par défaut). */
  agents: { claude: boolean; codex: boolean };
  cloneDir: string;
  theme: 'light' | 'dark' | 'system';
  language: 'auto' | 'fr' | 'en';
  suivi: SuiviSettings;
}

export interface SuiviSettings {
  channels: { A: boolean; B: boolean; C: boolean };
  bridgeIntervalSec: number;
  folder: string;
}

export interface SettingsPatch {
  roots?: string[];
  github?: { owners?: string[]; token?: string | null };
  portRange?: { start: number; end: number };
  scanMaxDepth?: number;
  editor?: Settings['editor'];
  showAllProjects?: boolean;
  showClaudeUsage?: boolean;
  showCodexUsage?: boolean;
  agents?: { claude?: boolean; codex?: boolean };
  cloneDir?: string;
  theme?: Settings['theme'];
  language?: Settings['language'];
  suivi?: { channels?: Partial<SuiviSettings['channels']>; bridgeIntervalSec?: number; folder?: string };
}

/** Utilisation de l'abonnement Claude (`/api/claude/usage`). */
export interface ClaudeUsageLimit { id: string; kind: 'session' | 'week' | 'model'; label: string | null; utilization: number; resetsAt: string | null }
/** Utilisation du plan ChatGPT pour Codex (`/api/codex/usage`), lue dans les transcripts locaux de Codex. */
export interface CodexUsage { status: 'ok' | 'disabled' | 'none' | 'error'; plan: string | null; limits: ClaudeUsageLimit[]; fetchedAt: string | null }
export interface ClaudeUsage {
  status: 'ok' | 'disabled' | 'not-connected' | 'expired' | 'error';
  plan: string | null;
  limits: ClaudeUsageLimit[];
  fetchedAt: string | null;
  error?: string;
}

// ─── Todolist Claude (suivi de projets) ─────────────────────────────────────
export type SuiviWho = 'toi' | 'ensemble' | 'claude';
export interface SuiviSource { kind: 'session' | 'commit' | 'quote'; ref: string; at?: string | null }
export interface SuiviTask {
  id: string; order: number; phase: number; phaseTitle: string; num: string; title: string; who: SuiviWho;
  minutes: number; why: string; steps: string[]; check: string; done: boolean; doneAt: string | null; note: string;
  toTest: boolean; tested: boolean; testedAt: string | null; testNote: string; rev: number; updatedAt: string | null; updatedBy: 'artifact' | 'tarmac' | 'claude' | null;
  createdAt: string | null; parent: string | null; sources: SuiviSource[]; archived: boolean;
  /** « Demandée à Claude » : date et destinataire (nom de session, `new`, `copy`) ; vidés une fois traitée. */
  requestedAt?: string | null; requestedTo?: string;
}
/** Session Claude en cours dans une console de Tarmac, pour un projet de suivi (« Envoyer à Claude »). */
export interface SuiviClaudeSession {
  terminalId: string; agent?: AgentKind; name: string; title: string | null; claudeSessionId: string | null; codexSessionId?: string | null; appProjectId: string; startedAt: string; lastActivityAt: string | null;
  /** Lu sur l'écran de la console (et le transcript) : seule une session `idle` (invite vide) peut recevoir une tâche. */
  state: 'idle' | 'busy' | 'permission' | 'unknown'; available: boolean;
}
export interface SuiviDispatchResult { ok: true; target: 'new' | 'session'; terminalId: string; session: string; prompt: string; task: SuiviTask }
export interface SuiviThemeVariant {
  bg: string; surface: string; surface2: string; line: string; fg: string; muted: string; primary: string; primarySoft: string; primaryText: string;
}
export interface SuiviTheme { brand: string; primary: string; fonts: { display: string; body: string; mono: string }; dark: SuiviThemeVariant; light: SuiviThemeVariant }
export interface SuiviCounts {
  total: number; done: number; remaining: number; toTest: number; requested?: number; pct: number; minutesLeft: number;
  next: { id: string; num: string; title: string; who: SuiviWho } | null; lastActivity: string | null;
}
export interface SuiviSync { channel: 'A' | 'B' | 'C' | 'file'; at: string; result: string; marker: string | null }
export interface SuiviProject {
  projectId: string; name: string; brand: string; title: string; subtitle: string; artifactUrl: string | null;
  theme: SuiviTheme; paths: string[]; copyFile: string; createdAt: string; updatedAt: string;
}
export interface SuiviProjectSummary extends SuiviProject { counts: SuiviCounts; syncs: SuiviSync[] }
export interface SuiviDetail { project: SuiviProject; tasks: SuiviTask[]; counts: SuiviCounts; syncs: SuiviSync[] }
export interface SuiviSyncJob { id: string; projectId: string; state: 'running' | 'done' | 'error'; startedAt: string; endedAt: string | null; message: string; fromArtifact: number | null; toArtifact: number | null }
export interface SuiviJournalEntry { seq: number; taskId: string; rev: number; field: string; before: unknown; after: unknown; origin: string; lost: boolean; at: string }

export interface Readme {
  path: string;
  format: 'md' | 'rst' | 'txt';
  content: string;
}

export interface LogLine {
  t: number;
  stream: 'out' | 'err' | 'sys';
  text: string;
}

export interface Meta {
  buildId: string | null;
  /** Version du cœur (package.json). */
  version?: string;
  machine: string;
  ips: Array<{ iface: string; address: string }>;
  /** Dossier personnel du serveur (affichage `~/…`). */
  home?: string;
  roots: string[];
  terminals: boolean;
  portRange: { start: number; end: number };
  hostname: string;
  docker: string | null;
  scannedAt: string;
  scanDurationMs: number;
  lastFetchAt: string | null;
  scanning: boolean;
  fetching: boolean;
}

export interface SupabaseInstance {
  projectId: string;
  status: 'running' | 'partial' | 'stopped';
  running: number;
  total: number;
  urls: { studio?: string; api?: string; mail?: string };
  dbUrl?: string;
  services: Array<{ name: string; state: string; status: string; image: string }>;
  localPath: string | null;
  localDir: string | null;
  apps: Array<{ id: string; name: string }>;
}

export interface SupabaseResponse {
  docker: 'ok' | 'unavailable';
  error?: string;
  instances: SupabaseInstance[];
  notCreated: Array<{ projectId: string; localPath: string; localDir: string; ports: { api?: number; db?: number; studio?: number } }>;
}

export interface DockerPort { private: number; public: number; type: string; http: boolean }
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health: 'healthy' | 'unhealthy' | 'starting' | null;
  exitCode: number | null;
  createdAt: string;
  since: string | null;
  ports: DockerPort[];
  group: string | null;
  service: string | null;
  workingDir: string | null;
  supabaseProject: string | null;
  project: { id: string; name: string } | null;
}
export interface DockerStats {
  id: string;
  cpu: number | null;
  memUsed: number;
  memLimit: number;
  netRx: number | null;
  netTx: number | null;
  blkRead: number | null;
  blkWrite: number | null;
  pids: number | null;
}
export interface DockerOverview {
  engine: {
    status: 'ok' | 'absent' | 'stopped' | 'error';
    error?: string;
    name: string | null;
    version: string | null;
    cpus: number | null;
    memTotal: number | null;
    app: 'Docker' | 'OrbStack' | null;
  };
  containers: DockerContainer[];
  images: { count: number; size: number } | null;
  volumes: { count: number; size: number | null } | null;
}
export type DockerAction = 'start' | 'stop' | 'restart';

export interface GithubRepo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  defaultBranch: string;
  pushedAt: string;
  htmlUrl: string;
  sshUrl: string;
}

export interface GithubResponse {
  configured: boolean;
  login: string | null;
  owners: string[];
  fetchedAt: string;
  remoteOnly: GithubRepo[];
  cloned: Array<GithubRepo & { local: { relPath: string; dir: string; git: GitStatus } }>;
  localOnly: Array<{ relPath: string; dir: string; git: GitStatus | null }>;
}

export interface PortsResponse {
  range: { start: number; end: number };
  assigned: Array<{ appId: string; port: number; appName: string }>;
  history: Array<{ port: number; appId: string; appName: string; pid: number | null; startedAt: string; endedAt: string | null }>;
}

export interface FreeReport {
  report: Array<{ port: number; killed: Array<{ pid: number; name: string }>; skipped: Array<{ pid: number; name: string; reason: string }> }>;
}

// ─── Source Control (IDE) ───
export type ScmCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '!';
export interface ScmChange { path: string; orig?: string; code: ScmCode }
export interface ScmStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  conflicts: ScmChange[];
  staged: ScmChange[];
  changes: ScmChange[];
  counts: { conflicts: number; staged: number; changes: number };
}
export interface ScmCommit { hash: string; parents: string[]; author: string; date: number; refs: string[]; subject: string; flow?: 'out' | 'in' }
export interface ScmGraphRow { col: number; top: Array<[number, number]>; bottom: Array<[number, number]> }
export interface ScmLog { upstream: string | null; commits: ScmCommit[]; graph: ScmGraphRow[] }
export type ScmAction = 'stage' | 'unstage' | 'discard' | 'stageAll' | 'unstageAll' | 'discardAll' | 'commit' | 'push' | 'pull' | 'sync' | 'fetch';

/** Module chargé par le serveur (`TARMAC_MODULES`) ; voir docs/extensions.md. */
export interface ModuleInfo {
  id: string;
  name: string | Loc;
  version: string;
  dir: string;
  icon: string | null;
  webUrl: string | null;
  status: 'loaded' | 'ignored' | 'error';
  error: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    // Langue des textes produits par le serveur (erreurs, journaux…).
    headers: { 'X-Tarmac-Lang': getLang(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  return data as T;
}

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  meta: () => request<Meta>('/api/meta'),
  modules: () => request<ModuleInfo[]>('/api/modules'),
  projects: () => request<Project[]>('/api/projects'),
  logs: (id: string) => request<LogLine[]>(`/api/projects/${id}/logs`),
  action: (id: string, action: 'start' | 'stop' | 'restart') => request<Runtime>(`/api/projects/${id}/${action}`, { method: 'POST' }),
  claudeSessions: (id: string, force = false) => request<ClaudeSession[]>(`/api/projects/${id}/claude-sessions${force ? '?force=1' : ''}`),
  allClaudeSessions: () => request<ClaudeSession[]>('/api/claude/sessions'),
  runningAgents: () => request<RunningAgent[]>('/api/agents/running'),
  timeline: () => request<{ events: TimelineEvent[]; days: number }>('/api/timeline'),
  openClaude: (id: string, resume?: string, prompt?: string) => request<TerminalSession>(`/api/projects/${id}/claude`, json({ resume, prompt, cols: 140, rows: 40 })),
  codexSessions: (id: string, force = false) => request<ClaudeSession[]>(`/api/projects/${id}/codex-sessions${force ? '?force=1' : ''}`),
  allCodexSessions: () => request<ClaudeSession[]>('/api/codex/sessions'),
  openCodex: (id: string, resume?: string, prompt?: string) => request<TerminalSession>(`/api/projects/${id}/codex`, json({ resume, prompt, cols: 140, rows: 40 })),
  frameCheck: (id: string) => request<{ url: string | null; frameable: boolean; reason: string | null; pending?: boolean }>(`/api/projects/${id}/frame-check`),
  suiviProjects: () => request<SuiviProjectSummary[]>('/api/suivi/projects'),
  suivi: (projectId: string) => request<SuiviDetail>(`/api/suivi/projects/${encodeURIComponent(projectId)}`),
  suiviPatch: (projectId: string, taskId: string, baseRev: number, changes: Partial<Pick<SuiviTask, 'done' | 'doneAt' | 'note' | 'toTest' | 'tested' | 'testedAt'>>) =>
    request<SuiviTask>(`/api/suivi/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, json({ baseRev, changes }, 'PATCH')),
  suiviSessions: (projectId: string) => request<SuiviClaudeSession[]>(`/api/suivi/projects/${encodeURIComponent(projectId)}/sessions`),
  suiviDispatch: (projectId: string, taskId: string, target: string, agent?: AgentKind) =>
    request<SuiviDispatchResult>(`/api/suivi/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/dispatch`, json(agent ? { target, agent } : { target })),
  suiviHistory: (projectId: string, taskId: string) => request<SuiviJournalEntry[]>(`/api/suivi/projects/${encodeURIComponent(projectId)}/history/${encodeURIComponent(taskId)}`),
  suiviExportUrl: (projectId: string) => `/api/suivi/projects/${encodeURIComponent(projectId)}/export`,
  terminals: () => request<TerminalSession[]>('/api/terminals'),
  gitBranches: (id: string) => request<string[]>(`/api/projects/${id}/git/branches`),
  gitCommands: () => request<GitCommandInfo[]>('/api/git/commands'),
  supabaseCommands: () => request<GitCommandInfo[]>('/api/supabase/commands'),
  supabaseRun: (id: string, command: string, arg?: string) => request<TerminalSession>(`/api/projects/${id}/supabase`, json({ command, arg, cols: 120, rows: 30 })),
  git: (id: string, command: string, arg?: string) => request<TerminalSession>(`/api/projects/${id}/git`, json({ command, arg, cols: 120, rows: 30 })),
  setFavorite: (id: string, on: boolean) => request(`/api/projects/${id}/favorite`, json({ on }, 'PUT')),
  setUrl: (id: string, url: string) => request(`/api/projects/${id}/url`, json({ url }, 'PUT')),
  rename: (id: string, name: string) => request(`/api/projects/${id}/name`, json({ name }, 'PUT')),
  readme: (id: string) => request<Readme>(`/api/projects/${id}/readme`),
  assetUrl: (id: string, path: string) => `/api/projects/${id}/asset?path=${encodeURIComponent(path)}`,
  openTerminal: (id: string, body: { commandId?: string; shell?: boolean; cols?: number; rows?: number }) =>
    request<TerminalSession>(`/api/projects/${id}/terminals`, json(body)),
  killTerminal: (sid: string) => request(`/api/terminals/${sid}/kill`, { method: 'POST' }),
  closeTerminal: (sid: string) => request(`/api/terminals/${sid}`, { method: 'DELETE' }),
  supabase: () => request<SupabaseResponse>('/api/supabase'),
  docker: () => request<DockerOverview>('/api/docker'),
  dockerStats: () => request<DockerStats[]>('/api/docker/stats'),
  dockerAction: (id: string, action: DockerAction) => request<{ ok: true; ids: string[] }>(`/api/docker/containers/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
  dockerGroupAction: (group: string, action: DockerAction) => request<{ ok: true; ids: string[] }>(`/api/docker/groups/${encodeURIComponent(group)}/${action}`, { method: 'POST' }),
  dockerOpen: () => request<{ ok: true; app: string }>('/api/docker/open', { method: 'POST' }),
  github: (force = false) => request<GithubResponse>(`/api/github${force ? '?force=1' : ''}`),
  ports: () => request<PortsResponse>('/api/ports'),
  freePorts: () => request<FreeReport>('/api/ports/free', { method: 'POST' }),
  scan: () => request('/api/scan', { method: 'POST' }),
  fetchGit: () => request('/api/git/fetch', { method: 'POST' }),
  settings: () => request<Settings>('/api/settings'),
  claudeUsage: () => request<ClaudeUsage>('/api/claude/usage'),
  codexUsage: () => request<CodexUsage>('/api/codex/usage'),
  clone: (fullName: string) => request<TerminalSession>('/api/github/clone', json({ fullName, cols: 110, rows: 22 })),
  ghCli: () => request<GhCliStatus>('/api/github/cli'),
  ghLogin: (cols?: number, rows?: number) => request<TerminalSession>('/api/github/cli/login', json({ cols, rows })),
  android: () => request<AndroidStatus>('/api/android'),
  androidInstall: (id: string) => request<TerminalSession>('/api/android/install', json({ id, cols: 110, rows: 26 })),
  avdStart: (name: string, cold = false) => request(`/api/android/avds/${encodeURIComponent(name)}/start`, json({ cold })),
  avdStop: (name: string) => request(`/api/android/avds/${encodeURIComponent(name)}/stop`, { method: 'POST' }),
  runAndroid: (id: string) => request<TerminalSession>(`/api/projects/${id}/android`, json({ cols: 120, rows: 32 })),
  fsList: (id: string, path: string) => request<DirEntry[]>(`/api/projects/${id}/fs/list?path=${encodeURIComponent(path)}`),
  fsRead: (id: string, path: string) => request<FileRead>(`/api/projects/${id}/fs/file?path=${encodeURIComponent(path)}`),
  fsStat: (id: string, path: string) => request<{ mtime: number; size: number }>(`/api/projects/${id}/fs/stat?path=${encodeURIComponent(path)}`),
  fsWrite: (id: string, path: string, content: string, mtime: number | null, force = false) =>
    request<{ mtime: number; size: number }>(`/api/projects/${id}/fs/file`, json({ path, content, mtime, force }, 'PUT')),
  scm: (id: string) => request<ScmStatus>(`/api/projects/${id}/scm`),
  scmLog: (id: string) => request<ScmLog>(`/api/projects/${id}/scm/log`),
  scmShow: (id: string, path: string, from: 'HEAD' | 'INDEX') =>
    request<{ kind: 'text'; content: string } | { kind: 'binary' }>(`/api/projects/${id}/scm/show?path=${encodeURIComponent(path)}&from=${from}`),
  scmAction: (id: string, action: ScmAction, body: { paths?: string[]; message?: string; amend?: boolean; push?: boolean } = {}) =>
    request<{ ok: true }>(`/api/projects/${id}/scm/${action}`, json(body)),
  fsRawUrl: (id: string, path: string) => `/api/projects/${id}/fs/raw?path=${encodeURIComponent(path)}`,
  env: (id: string, file: string) => request<{ files: string[]; lines: EnvLine[] }>(`/api/projects/${id}/env?file=${encodeURIComponent(file)}`),
  saveSettings: (patch: SettingsPatch) => request<Settings>('/api/settings', json(patch, 'PUT')),
  pickFolder: (start?: string) => request<{ path: string | null }>('/api/pick-folder', json({ start })),
  open: (dir: string, withApp: 'finder' | 'editor' | 'terminal') => request('/api/open', json({ dir, with: withApp })),
};
