import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isWindows, windowsProcesses } from './platform.js';

const exec = promisify(execFile);

/**
 * Process d'agents de code en cours sur la machine : Claude Code et Codex (ChatGPT).
 *
 * Sources, de la plus précise à la moins précise :
 * - `~/.claude/sessions/<pid>.json` : écrit par Claude Code pour chaque process interactif (sessionId, cwd,
 *   début, `entrypoint` = cli / claude-desktop / claude-vscode…, `status` = busy / idle) ; Codex n'a pas
 *   d'équivalent ;
 * - `ps` (pid, parent, durée, exécutable, arguments) : `--resume <id>` / `--session-id <id>` (Claude),
 *   `resume <id>` (Codex), et les apps parentes (premier ancêtre dont l'exécutable est dans un `.app`) ;
 * - `lsof -d cwd` : dossier de travail du process.
 * Tout est en lecture seule ; rien n'est envoyé aux process.
 */
export type AgentKind = 'claude' | 'codex';
export const AGENT_KINDS: AgentKind[] = ['claude', 'codex'];

export interface PsRow { pid: number; ppid: number; etimeSec: number; comm: string; args: string }

/** Fichier `sessions/<pid>.json` de Claude Code (champs utiles seulement). */
export interface PidFile {
  pid: number;
  sessionId: string | null;
  cwd: string | null;
  startedAt: string | null;
  entrypoint: string | null;
  status: 'busy' | 'idle' | null;
  updatedAt: string | null;
  name: string | null;
}

export interface AgentProc {
  agent: AgentKind;
  pid: number;
  ppid: number;
  cwd: string | null;
  args: string;
  startedAt: string;
  /** Pids des ancêtres, du parent vers la racine. */
  ancestors: number[];
  /** App parente (« Terminal », « VS Code », « Claude »…), si on la trouve sans effort. */
  app: string | null;
  pidFile: PidFile | null;
}

/** Durée `ps -o etime` (`[[jj-]hh:]mm:ss`) en secondes. */
export function parseEtime(s: string): number {
  const m = s.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/**
 * Lignes de `ps -axo pid=,ppid=,etime=,comm=` et de `ps -axo pid=,args=` (deux appels : l'exécutable peut
 * contenir des espaces, « Application Support »).
 */
export function parsePs(commOut: string, argsOut: string): PsRow[] {
  const args = new Map<number, string>();
  for (const l of argsOut.split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(.*)$/);
    if (m) args.set(Number(m[1]), m[2]);
  }
  return commOut.split('\n').flatMap((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) return [];
    const pid = Number(m[1]);
    return [{ pid, ppid: Number(m[2]), etimeSec: parseEtime(m[3]), comm: m[4], args: args.get(pid) ?? m[4] }];
  });
}

/** Options et sous-commandes `claude` qui ne sont pas des sessions (aide, version, hôte natif Chrome, MCP…). */
const NOT_A_SESSION_FLAG = /\s(--help|-h|--version|-v|--chrome-native-host)(\s|$)/;
const NOT_A_SESSION_CMD = new Set(['mcp', 'doctor', 'update', 'install', 'setup-token', 'config', 'migrate-installer', 'plugin']);

/** Arguments d'une ligne de commande, guillemets respectés (chemins Windows avec espaces : `"C:\Program Files\…"`). */
export function splitArgs(args: string): string[] {
  return [...args.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}
/** Exécutable ou script : `\` → `/`, `.exe` retiré (seulement pour les deux premiers arguments, pas un prompt). */
const normExe = (s: string) => s.replace(/\\/g, '/').replace(/\.exe$/i, '');

/** Lanceur npm de Claude Code sous Windows : `node …\node_modules\@anthropic-ai\claude-code\cli.js`. */
const CLAUDE_NPM_CLI = /\/node_modules\/@anthropic-ai\/claude-code\/cli\.m?js$/;

/** Process Claude Code : exécutable `claude`, ou script `claude` lancé par un interpréteur (`node …/claude`). */
export function isClaudeProcess(comm: string, args: string): boolean {
  const tokens = splitArgs(args);
  const [t0, t1] = [normExe(tokens[0] ?? ''), normExe(tokens[1] ?? '')];
  const byInterpreter = /(^|\/)(node|bun|deno)$/.test(t0) && (/(^|\/)claude$/.test(t1) || CLAUDE_NPM_CLI.test(t1));
  const isClaude = path.posix.basename(normExe(comm)) === 'claude' || /(^|\/)claude$/.test(t0) || byInterpreter;
  if (!isClaude) return false;
  const first = tokens[byInterpreter ? 2 : 1] ?? '';
  return !NOT_A_SESSION_CMD.has(first) && !NOT_A_SESSION_FLAG.test(` ${args}`);
}

/**
 * Sous-commandes et options `codex` qui ne sont pas des sessions (doc « Command line options » :
 * developers.openai.com/codex/cli/reference). `exec` (non interactif) et `resume` restent des sessions.
 */
const CODEX_NOT_A_SESSION_CMD = new Set([
  'mcp', 'mcp-server', 'login', 'logout', 'completion', 'debug', 'apply', 'a', 'sandbox', 'app-server', 'app',
  'remote-control', 'cloud', 'features', 'help', 'delete', 'archive', 'update', 'doctor',
]);
const CODEX_NOT_A_SESSION_FLAG = /\s(--help|-h|--version|-V)(\s|$)/;

/**
 * Process Codex : exécutable `codex` (binaire natif, Homebrew), ou lanceur npm `node …/codex(.js)`. Le binaire
 * natif lancé par le lanceur npm est un descendant d'un process Codex : `agentProcsFrom` l'écarte.
 */
export function isCodexProcess(comm: string, args: string): boolean {
  const tokens = splitArgs(args);
  const [t0, t1] = [normExe(tokens[0] ?? ''), normExe(tokens[1] ?? '')];
  const byInterpreter = /(^|\/)(node|bun|deno)$/.test(t0) && /(^|\/)codex(\.js)?$/.test(t1);
  const isCodex = path.posix.basename(normExe(comm)) === 'codex' || /(^|\/)codex$/.test(t0) || byInterpreter;
  if (!isCodex) return false;
  const first = tokens[byInterpreter ? 2 : 1] ?? '';
  return !CODEX_NOT_A_SESSION_CMD.has(first) && !CODEX_NOT_A_SESSION_FLAG.test(` ${args}`);
}

/** Agent d'un process, ou null. */
export function agentOf(comm: string, args: string): AgentKind | null {
  if (isClaudeProcess(comm, args)) return 'claude';
  if (isCodexProcess(comm, args)) return 'codex';
  return null;
}

const SESSION_ID = /^[0-9a-f][0-9a-f-]{7,63}$/i;

/** Session demandée par les arguments : `--resume <id>` / `-r <id>` / `--session-id <id>`. */
export function sessionFromArgs(args: string): string | null {
  const m = args.match(/(?:^|\s)(?:--resume|-r|--session-id)(?:=|\s+)['"]?([0-9a-fA-F-]{8,64})/);
  return m && SESSION_ID.test(m[1]) ? m[1] : null;
}

/** Session Codex demandée par les arguments : `codex resume <id>` (ou `codex exec resume <id>`). */
export function codexSessionFromArgs(args: string): string | null {
  const m = args.match(/(?:^|\s)resume\s+['"]?([0-9a-fA-F-]{8,64})/);
  return m && SESSION_ID.test(m[1]) ? m[1] : null;
}

/** Session demandée par les arguments, selon l'agent (absent = Claude). */
export const sessionFromArgsOf = (agent: AgentKind | undefined, args: string) =>
  agent === 'codex' ? codexSessionFromArgs(args) : sessionFromArgs(args);

const APP_ALIASES: Record<string, string> = {
  'Visual Studio Code': 'VS Code', Code: 'VS Code', 'Code - Insiders': 'VS Code Insiders', iTerm: 'iTerm2', iTerm2: 'iTerm2',
};

/** App d'un exécutable (`/Applications/Foo.app/Contents/MacOS/foo` → « Foo »), ou null. */
export function appOfComm(comm: string): string | null {
  const m = comm.match(/\/([^/]+)\.app\//);
  return m ? APP_ALIASES[m[1]] ?? m[1] : null;
}

/** App déduite du point d'entrée déclaré par Claude Code. */
export function appOfEntrypoint(entrypoint: string | null): string | null {
  switch (entrypoint) {
    case 'claude-desktop': return 'Claude';
    case 'claude-vscode': return 'VS Code';
    case 'sdk-ts': case 'sdk-py': case 'sdk-cli': return 'SDK';
    default: return null;
  }
}

/** Ancêtres d'un pid (parent d'abord), bornés. */
export function ancestorsOf(pid: number, byPid: Map<number, PsRow>): number[] {
  const out: number[] = [];
  let cur = byPid.get(pid);
  while (cur && cur.ppid > 1 && out.length < 32 && !out.includes(cur.ppid)) {
    out.push(cur.ppid);
    cur = byPid.get(cur.ppid);
  }
  return out;
}

/** Fichier `sessions/<pid>.json` → champs utiles (null si illisible). */
export function parsePidFile(txt: string): PidFile | null {
  try {
    const j = JSON.parse(txt);
    if (typeof j?.pid !== 'number') return null;
    const iso = (v: unknown) => (typeof v === 'number' && v > 0 ? new Date(v).toISOString() : typeof v === 'string' ? v : null);
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return {
      pid: j.pid,
      sessionId: str(j.sessionId) && SESSION_ID.test(j.sessionId) ? j.sessionId : null,
      cwd: str(j.cwd),
      startedAt: iso(j.startedAt),
      entrypoint: str(j.entrypoint),
      status: j.status === 'busy' || j.status === 'idle' ? j.status : null,
      updatedAt: iso(j.statusUpdatedAt ?? j.updatedAt),
      name: str(j.name),
    };
  } catch {
    return null;
  }
}

export function readPidFiles(claudeDir: string): Map<number, PidFile> {
  const out = new Map<number, PidFile>();
  const dir = path.join(claudeDir, 'sessions');
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)); } catch { return out; }
  for (const f of files) {
    try {
      const p = parsePidFile(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (p && String(p.pid) === f.slice(0, -5)) out.set(p.pid, p);
    } catch { /* fichier en cours d'écriture */ }
  }
  return out;
}

/**
 * Process d'agents à partir des sorties brutes (testable) : process des agents demandés (`kinds`, Claude seul par
 * défaut) qui ne sont pas eux-mêmes lancés par un autre process d'agent (outils internes, binaire natif de Codex
 * sous son lanceur npm), avec ancêtres, app parente et fichier de session (Claude seulement).
 */
export function agentProcsFrom(rows: PsRow[], cwds: Map<number, string>, pidFiles: Map<number, PidFile>, opts: { now?: number; appFromAncestors?: boolean; kinds?: AgentKind[] } = {}): AgentProc[] {
  const now = opts.now ?? Date.now();
  const kinds = opts.kinds ?? ['claude'];
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const found = rows.flatMap((r) => {
    const agent = agentOf(r.comm, r.args);
    return agent && kinds.includes(agent) ? [{ r, agent }] : [];
  });
  const agentPids = new Set(found.map((x) => x.r.pid));
  return found.flatMap(({ r, agent }) => {
    const ancestors = ancestorsOf(r.pid, byPid);
    if (ancestors.some((a) => agentPids.has(a))) return [];
    const pidFile = agent === 'claude' ? pidFiles.get(r.pid) ?? null : null;
    let app = appOfEntrypoint(pidFile?.entrypoint ?? null);
    if (!app && opts.appFromAncestors !== false) {
      for (const a of ancestors) {
        const name = appOfComm(byPid.get(a)?.comm ?? '');
        if (name) { app = name; break; }
      }
    }
    return [{
      agent,
      pid: r.pid,
      ppid: r.ppid,
      cwd: cwds.get(r.pid) ?? pidFile?.cwd ?? null,
      args: r.args,
      startedAt: pidFile?.startedAt ?? new Date(Math.floor((now - r.etimeSec * 1000) / 1000) * 1000).toISOString(),
      ancestors,
      app,
      pidFile,
    }];
  });
}

/** `lsof -Fpn` → pid → cwd. */
export function parseLsofCwd(out: string): Map<number, string> {
  const m = new Map<number, string>();
  let pid = 0;
  for (const l of out.split('\n')) {
    if (l.startsWith('p')) pid = Number(l.slice(1));
    else if (l.startsWith('n/') && pid) m.set(pid, l.slice(1));
  }
  return m;
}

export interface ScanOptions {
  claudeDir: string;
  /** Agents cherchés (Claude seul par défaut). */
  kinds?: AgentKind[];
  /** Mode démo : seuls les process dont le dossier est dans ce HOME (factice) sont gardés, sans app parente. */
  onlyUnder?: string | null;
  /** Âge maximal du cache (2,5 s par défaut). */
  maxAgeMs?: number;
  /** Relance l'erreur si `ps` échoue au lieu de renvoyer une liste vide (qui ferait croire qu'aucun agent ne tourne). */
  strict?: boolean;
}

/** Cache et lecture en cours, par jeu d'options (Claude et Codex sont lus à part). */
const caches = new Map<string, { at: number; procs: AgentProc[] }>();
const inflights = new Map<string, Promise<AgentProc[]>>();

/** Process d'agents en cours (cache de 2,5 s, une seule lecture à la fois par jeu d'options). */
export async function scanAgentProcs(opts: ScanOptions): Promise<AgentProc[]> {
  const kinds = opts.kinds ?? ['claude'];
  const key = `${opts.claudeDir}|${opts.onlyUnder ?? ''}|${kinds.join(',')}|${opts.strict ? 'strict' : ''}`;
  const cache = caches.get(key);
  if (cache && Date.now() - cache.at < (opts.maxAgeMs ?? 2500)) return cache.procs;
  const running = inflights.get(key);
  if (running) return running;
  const inflight = (async () => {
    let rows: PsRow[] = [];
    try {
      // Windows : Get-CimInstance, sans dossier de travail (Claude le donne par sessions/<pid>.json ;
      // un Codex sans dossier reste « projet inconnu »).
      if (isWindows()) rows = await windowsProcesses();
      else {
        const [a, b] = await Promise.all([
          exec('ps', ['-axo', 'pid=,ppid=,etime=,comm='], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }),
          exec('ps', ['-axo', 'pid=,args='], { timeout: 5000, maxBuffer: 32 * 1024 * 1024 }),
        ]);
        rows = parsePs(a.stdout, b.stdout);
      }
    } catch (e) { if (opts.strict) throw e; return []; }
    const candidates = rows.filter((r) => { const a = agentOf(r.comm, r.args); return !!a && kinds.includes(a); });
    let cwds = new Map<number, string>();
    if (candidates.length && !isWindows()) {
      try {
        const { stdout } = await exec('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', candidates.map((r) => r.pid).join(',')], { timeout: 5000 });
        cwds = parseLsofCwd(stdout);
      } catch (e: any) {
        cwds = parseLsofCwd(String(e?.stdout ?? '')); // lsof sort en erreur si un pid vient de disparaître
      }
    }
    let procs = agentProcsFrom(rows, cwds, kinds.includes('claude') ? readPidFiles(opts.claudeDir) : new Map(), { appFromAncestors: !opts.onlyUnder, kinds });
    if (opts.onlyUnder) {
      const root = opts.onlyUnder;
      procs = procs.filter((p) => p.cwd && (p.cwd === root || p.cwd.startsWith(root + path.sep)));
    }
    caches.set(key, { at: Date.now(), procs });
    return procs;
  })().finally(() => inflights.delete(key));
  inflights.set(key, inflight);
  return inflight;
}

export type AttachMatch = 'pidfile' | 'arg' | 'recent' | 'none';

/**
 * Rattache chaque process à une session **du même agent** (`agent` absent = Claude), du plus précis au moins
 * précis :
 * 1. fichier `sessions/<pid>.json` (sessionId écrit par Claude Code) ;
 * 2. arguments `--resume` / `--session-id` (Claude), `resume <id>` (Codex) ;
 * 3. sinon, dans le même dossier, le transcript le plus récent pas encore attribué et écrit depuis le début du
 *    process (les process les plus récents choisissent en premier). Aucun transcript écrit depuis : session
 *    inconnue (process qui vient de démarrer), plutôt qu'une ancienne session prise à tort.
 */
export function attachSessions(
  procs: Array<Pick<AgentProc, 'pid' | 'cwd' | 'args' | 'startedAt' | 'pidFile'> & { agent?: AgentKind }>,
  transcripts: Array<{ id: string; cwd: string; updatedAt: string; agent?: AgentKind }>,
): Map<number, { sessionId: string | null; match: AttachMatch }> {
  const out = new Map<number, { sessionId: string | null; match: AttachMatch }>();
  const claimed = new Set<string>();
  for (const p of procs) {
    const id = p.pidFile?.sessionId ?? null;
    if (id) { out.set(p.pid, { sessionId: id, match: 'pidfile' }); claimed.add(id); }
  }
  for (const p of procs) {
    if (out.has(p.pid)) continue;
    const id = sessionFromArgsOf(p.agent, p.args);
    if (id && !claimed.has(id)) { out.set(p.pid, { sessionId: id, match: 'arg' }); claimed.add(id); }
  }
  const rest = procs.filter((p) => !out.has(p.pid)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const p of rest) {
    const since = Date.parse(p.startedAt) - 5000;
    const t = transcripts
      .filter((s) => s.cwd === p.cwd && (s.agent ?? 'claude') === (p.agent ?? 'claude') && !claimed.has(s.id) && Date.parse(s.updatedAt) >= since)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (t) { out.set(p.pid, { sessionId: t.id, match: 'recent' }); claimed.add(t.id); }
    else out.set(p.pid, { sessionId: null, match: 'none' });
  }
  return out;
}
