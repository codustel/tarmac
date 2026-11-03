/**
 * Différences macOS / Linux ↔ Windows du serveur (brief 7.6). Sous Windows, les consoles et les commandes
 * passent par PowerShell 7 (`pwsh`) s'il est installé, sinon Windows PowerShell 5.1. Les fonctions pures
 * prennent la plateforme ou le shell en paramètre : elles se testent des deux côtés sur n'importe quelle machine.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { tr } from './i18n.js';

const exec = promisify(execFile);

export const isWindows = (platform: NodeJS.Platform = process.platform) => platform === 'win32';

// ─── Shell ──────────────────────────────────────────────────────────────────
export interface Shell {
  kind: 'posix' | 'pwsh' | 'powershell';
  file: string;
}

export function detectShell(platform: NodeJS.Platform = process.platform, env = process.env, hasPwsh = pwshInstalled): Shell {
  if (!isWindows(platform)) return { kind: 'posix', file: env.SHELL || '/bin/zsh' };
  return hasPwsh() ? { kind: 'pwsh', file: 'pwsh.exe' } : { kind: 'powershell', file: 'powershell.exe' };
}

function pwshInstalled(): boolean {
  try {
    execFileSync('where.exe', ['pwsh'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

let current: Shell | null = null;
/** Shell des consoles et des commandes (détecté une fois). */
export const shell = (): Shell => (current ??= detectShell());

/** Nom court affiché pour une console interactive (`zsh`, `pwsh`, `powershell`). */
export const shellLabel = (sh: Shell = shell()) => (sh.kind === 'posix' ? path.basename(sh.file) : sh.kind);

/** Arguments d'une console interactive. */
export const interactiveArgs = (sh: Shell = shell()) => (sh.kind === 'posix' ? ['-i'] : ['-NoLogo']);

/**
 * Arguments pour exécuter une ligne de commande. Shell non-login sous macOS (`-c`) pour garder le PATH de
 * Tarmac intact ; sous Windows `-NoProfile` pour la même raison, et `-EncodedCommand` (UTF-16LE en base64) :
 * aucun guillemet à échapper sur la ligne de commande de Windows.
 */
export function commandArgs(script: string, sh: Shell = shell()): string[] {
  if (sh.kind === 'posix') return ['-c', script];
  return ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

/** Échappe un argument pour le shell : `'…'`, avec `'\''` en sh et `''` en PowerShell (qui traite aussi ‘ ’ ‚ ‛ comme des apostrophes). */
export function quote(s: string, sh: Shell = shell()): string {
  if (sh.kind === 'posix') return `'${s.replace(/'/g, `'\\''`)}'`;
  // Windows PowerShell 5.1 transmet mal les `"` aux programmes natifs (argument coupé en deux, voire option
  // en plus) : échappement de la ligne de commande Windows (`\"`, barres obliques inverses doublées devant).
  if (sh.kind === 'powershell') s = nativeEscape51(s);
  return `'${s.replace(/['‘’‚‛]/g, '$&$&')}'`;
}

/**
 * Windows PowerShell 5.1 décide seul d'entourer un argument de guillemets, en comptant ses `"` (même échappés) :
 * aucun échappement ne passe à coup sûr un `"` à un programme (vérifié dans la VM : `x" --amend "y` y devient
 * trois arguments). Refus clair plutôt qu'un argument coupé ; PowerShell 7 n'a pas ce défaut.
 */
function nativeEscape51(s: string): string {
  if (s.includes('"')) throw Object.assign(new Error(tr({
    en: 'Windows PowerShell 5.1 cannot pass double quotes (") to a program safely: remove them, or install PowerShell 7 (winget install Microsoft.PowerShell) and restart Tarmac',
    fr: 'Windows PowerShell 5.1 ne transmet pas sans risque les guillemets doubles (") à un programme : retirez-les, ou installez PowerShell 7 (winget install Microsoft.PowerShell) et relancez Tarmac',
  })), { statusCode: 400 });
  // Argument mis entre guillemets par PowerShell (espace) : les `\` finaux ne doivent pas échapper le `"` ajouté.
  return /\s/.test(s) ? s.replace(/(\\+)$/, '$1$1') : s;
}

/** Enchaîne des commandes, chacune seulement si la précédente a réussi (`&&`, absent de Windows PowerShell 5.1). */
export function chain(commands: string[], sh: Shell = shell()): string {
  if (sh.kind !== 'powershell') return commands.join(' && ');
  return commands.reduceRight((rest, c) => `${c}; if ($?) { ${rest} }`);
}

/** Ligne de commande qui lance un programme avec ses arguments (`npm.cmd`, `.ps1`… résolus par PowerShell). */
export function commandLine(file: string, args: string[], sh: Shell = shell()): string {
  if (sh.kind === 'posix') return [file, ...args].map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : quote(a, sh))).join(' ');
  return ['&', ...[file, ...args].map((a) => quote(a, sh))].join(' ');
}

/**
 * Programme et arguments à donner à `spawn` pour une commande d'app détectée. macOS : tels quels. Windows :
 * via PowerShell, seul moyen de lancer `npm`, `pnpm`… (des `.cmd`, refusés par `spawn` sans shell) ; un
 * script `sh -c` (script npm au port réécrit) devient une commande PowerShell.
 */
export function spawnCommand(command: string, args: string[], sh: Shell = shell()): { file: string; args: string[] } {
  if (sh.kind === 'posix') return { file: command, args };
  const script = command === '/bin/sh' && args[0] === '-c' ? args.slice(1).join(' ') : commandLine(command, args, sh);
  return { file: sh.file, args: commandArgs(script, sh) };
}

/** Ajoute des dossiers en tête du PATH (clé `Path` sous Windows : une seule variante gardée, sinon conflit). */
export function prependPath(env: Record<string, string | undefined>, dirs: string[], platform: NodeJS.Platform = process.platform) {
  if (!dirs.length) return;
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
  const key = isWindows(platform) ? keys[0] ?? 'Path' : 'PATH';
  const cur = env[key];
  for (const k of keys) delete env[k];
  env[key] = [...dirs, ...(cur ? [cur] : [])].join(isWindows(platform) ? ';' : ':');
}

/** Le programme est-il dans le PATH ? */
export async function hasCommand(name: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    if (isWindows()) await exec('where.exe', [name], { env, timeout: 3000, windowsHide: true });
    else await exec('/bin/sh', ['-c', `command -v ${quote(name, { kind: 'posix', file: '/bin/sh' })}`], { env, timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Python ─────────────────────────────────────────────────────────────────
/** Dossier des exécutables d'un environnement virtuel, et commande Python (`python3` n'existe pas sous Windows). */
export const VENV_BIN = isWindows() ? 'Scripts' : 'bin';
export const PYTHON = isWindows() ? 'python' : 'python3';

// ─── Process et ports ───────────────────────────────────────────────────────
/** PIDs qui écoutent sur le port TCP dans une sortie de `netstat -ano` (état non lu : il est traduit selon la langue). */
export function parseNetstat(out: string, port: number): number[] {
  const pids = new Set<number>();
  for (const line of out.split(/\r?\n/)) {
    const [proto, local, foreign, ...rest] = line.trim().split(/\s+/);
    if (!/^TCP/i.test(proto ?? '') || !local?.endsWith(`:${port}`) || !/:0$/.test(foreign ?? '')) continue;
    const pid = Number(rest.at(-1));
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Nom d'image dans une sortie de `tasklist /FO CSV /NH` (une ligne d'information sinon). */
export function parseTasklist(out: string): string {
  return out.trim().match(/^"([^"]*)"/)?.[1] ?? '';
}

export async function listeningPids(port: number): Promise<number[]> {
  try {
    if (isWindows()) {
      const { stdout } = await exec('netstat', ['-ano', '-p', 'TCP'], { timeout: 5000, windowsHide: true });
      const { stdout: v6 } = await exec('netstat', ['-ano', '-p', 'TCPv6'], { timeout: 5000, windowsHide: true });
      return [...new Set([...parseNetstat(stdout, port), ...parseNetstat(v6, port)])];
    }
    const { stdout } = await exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 5000 });
    return [...new Set(stdout.split('\n').filter(Boolean).map(Number))];
  } catch {
    return []; // lsof sort en code 1 quand rien n'écoute
  }
}

export async function processName(pid: number): Promise<string> {
  try {
    if (isWindows()) {
      const { stdout } = await exec('tasklist', ['/FO', 'CSV', '/NH', '/FI', `PID eq ${pid}`], { timeout: 5000, windowsHide: true });
      return parseTasklist(stdout);
    }
    const { stdout } = await exec('ps', ['-o', 'comm=', '-p', String(pid)]);
    return stdout.trim();
  } catch {
    return '';
  }
}

/** Process de la machine, au format des lignes `ps` d'agentProcs (`comm` = nom d'image sous Windows). */
export interface ProcessRow { pid: number; ppid: number; etimeSec: number; comm: string; args: string }

export const CIM_PROCESSES = 'Get-CimInstance Win32_Process | ForEach-Object { '
  + '$e = if ($_.CreationDate) { [int]((Get-Date) - $_.CreationDate).TotalSeconds } else { 0 }; '
  + '"$($_.ProcessId)`t$($_.ParentProcessId)`t$e`t$($_.Name)`t$($_.CommandLine -replace \'[\\r\\n\\t]+\', \' \')" }';

/** Lignes `pid⇥ppid⇥âge⇥nom⇥ligne de commande` produites par `CIM_PROCESSES`. */
export function parseCimProcesses(out: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of out.split(/\r?\n/)) {
    const [pid, ppid, etime, comm, ...rest] = line.split('\t');
    if (!(Number(pid) > 0) || comm === undefined) continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid) || 0, etimeSec: Number(etime) || 0, comm, args: rest.join('\t').trim() });
  }
  return rows;
}

/**
 * Windows : tous les process avec leur ligne de commande (`Get-CimInstance`, ~1 s). Le dossier de travail
 * d'un autre process n'est pas lisible sous Windows : les appelants n'ont pas de `cwd` (projet inconnu).
 */
export async function windowsProcesses(): Promise<ProcessRow[]> {
  const sh = shell();
  const { stdout } = await exec(sh.file, commandArgs(CIM_PROCESSES, sh), { timeout: 15000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return parseCimProcesses(stdout);
}

/**
 * Arrête un process et ses enfants. macOS : signal au groupe (process lancés `detached`), sinon au process.
 * Windows : `taskkill /T` (arbre), `/F` pour SIGKILL. Faux si le process n'existe plus.
 */
export function killTree(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM', platform: NodeJS.Platform = process.platform): boolean {
  if (isWindows(platform)) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { stdio: 'ignore', timeout: 5000, windowsHide: true });
      return true;
    } catch {
      // Sans /F, taskkill échoue sur les programmes en console (ils ignorent WM_CLOSE) : arrêt forcé.
      if (signal === 'SIGKILL') return false;
      return killTree(pid, 'SIGKILL', platform);
    }
  }
  try { process.kill(-pid, signal); return true; } catch { /* pas un groupe */ }
  try { process.kill(pid, signal); return true; } catch { return false; }
}

/**
 * Options de `spawn` pour une app lancée par Tarmac. macOS : groupe de process dédié (on tue aussi les
 * enfants, et l'app survit à Tarmac). Windows : pas de `detached` (il retire la console : chaque enfant en
 * ouvrirait une visible) ; l'app s'arrête avec Tarmac.
 */
export const appSpawnOptions = (platform: NodeJS.Platform = process.platform) =>
  isWindows(platform) ? { windowsHide: true } : { detached: true };

/** Commande à suggérer quand le port de Tarmac est déjà pris. */
export const portOwnerHint = (port: number, platform: NodeJS.Platform = process.platform) =>
  isWindows(platform) ? `netstat -ano | findstr :${port}` : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;

// ─── Ouvrir dans les apps de la machine ─────────────────────────────────────
/** Montre un dossier, ou un fichier sélectionné, dans le Finder / l'Explorateur. */
export async function reveal(target: string, isFile: boolean) {
  if (!isWindows()) return void (await exec('open', isFile ? ['-R', target] : [target]));
  // L'Explorateur sort en code 1 même quand tout va bien : on ne l'attend pas.
  detach('explorer.exe', [isFile ? `/select,"${target}"` : `"${target}"`], { windowsVerbatimArguments: true });
}

/** Ouvre un terminal dans le dossier : Terminal sous macOS, Windows Terminal (sinon une console PowerShell). */
export async function openTerminal(dir: string) {
  if (!isWindows()) return void (await exec('open', ['-a', 'Terminal', dir]));
  // `;` sépare les commandes de wt : échappé (`\;`).
  if (await hasCommand('wt')) return detach('wt.exe', ['-d', dir.replace(/;/g, '\\;')]);
  const sh = shell();
  detach(sh.file, commandArgs(`Start-Process ${quote(sh.file, sh)} -ArgumentList '-NoLogo' -WorkingDirectory ${quote(dir, sh)}`, sh));
}

/** Ouvre une cible dans un éditeur : l'app sous macOS (`open -a`), sa CLI sinon (`code.cmd` passe par PowerShell). */
export async function openWithEditor(editor: { app: string; cli: string }, target: string) {
  if (!isWindows()) return void (await exec('open', ['-a', editor.app, target]).catch(() => exec(editor.cli, [target])));
  // La CLI des éditeurs est un `.cmd` (code.cmd…) : cmd.exe interprète & | < > ^ % ! " même dans un argument.
  if (CMD_META.test(target)) throw new Error(`Unsupported character in path for the editor command line: ${target}`);
  const sh = shell();
  await exec(sh.file, commandArgs(commandLine(editor.cli, [target], sh), sh), { timeout: 15000, windowsHide: true });
}

const CMD_META = /[&|<>^%!"]/;

function detach(file: string, args: string[], opts: { windowsVerbatimArguments?: boolean } = {}) {
  const child = spawn(file, args, { ...opts, detached: true, stdio: 'ignore' });
  child.on('error', () => { /* app absente : rien à montrer */ });
  child.unref();
}
