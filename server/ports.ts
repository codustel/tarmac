import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { settings } from './settings.js';
import { tr } from './i18n.js';
import { state, persist } from './store.js';

const exec = promisify(execFile);

function probe(host: string, port: number, timeout = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (busy: boolean) => {
      sock.destroy();
      resolve(busy);
    };
    sock.setTimeout(timeout, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** Un port est occupé si quelque chose écoute en IPv4 OU en IPv6 (Vite écoute souvent sur ::1 sur macOS). */
export async function isPortBusy(port: number): Promise<boolean> {
  const [v4, v6] = await Promise.all([probe('127.0.0.1', port), probe('::1', port)]);
  return v4 || v6;
}

export async function listeningPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 5000 });
    return [...new Set(stdout.split('\n').filter(Boolean).map(Number))];
  } catch {
    return []; // lsof sort en code 1 quand rien n'écoute
  }
}

async function processName(pid: number): Promise<string> {
  try {
    const { stdout } = await exec('ps', ['-o', 'comm=', '-p', String(pid)]);
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Attribue un port à une app :
 * 1. son port « collant » s'il est libre ;
 * 2. sinon le premier port libre de la plage, en évitant les ports réservés par d'autres apps.
 */
export function allocatePort(appId: string, inUse: Set<number>): Promise<number> {
  // Attributions en série : deux apps démarrées en même temps (« Start all ») ne reçoivent jamais le même port.
  const run = allocation.then(() => allocateNow(appId, inUse));
  allocation = run.catch(() => undefined);
  return run;
}
let allocation: Promise<unknown> = Promise.resolve();

async function allocateNow(appId: string, inUse: Set<number>): Promise<number> {
  const { start, end } = settings.portRange;
  const preferred = state.assignedPorts[appId];
  if (preferred && !inUse.has(preferred) && !(await isPortBusy(preferred))) return preferred;

  const reservedByOthers = new Set(
    Object.entries(state.assignedPorts)
      .filter(([id]) => id !== appId)
      .map(([, p]) => p),
  );
  for (const allowReserved of [false, true]) {
    for (let p = start; p <= end; p++) {
      if (inUse.has(p) || (!allowReserved && reservedByOthers.has(p))) continue;
      if (await isPortBusy(p)) continue;
      // Si on prend le port réservé d'une autre app, elle en recevra un nouveau à son prochain démarrage.
      for (const [id, port] of Object.entries(state.assignedPorts)) if (port === p && id !== appId) delete state.assignedPorts[id];
      state.assignedPorts[appId] = p;
      persist();
      return p;
    }
  }
  throw new Error(tr({ en: 'No free port in the range {start}-{end}', fr: 'Aucun port libre dans la plage {start}-{end}' }, { start, end }));
}

const PROTECTED = /com\.docker|docker|vpnkit|orbstack|colima|limactl|launchd|ControlCenter|rapportd/i;

export interface FreedPort {
  port: number;
  killed: Array<{ pid: number; name: string }>;
  skipped: Array<{ pid: number; name: string; reason: string }>;
}

/** Arrête ce qui écoute sur un port (serveur lancé hors de Tarmac), hors Docker et Tarmac. */
export async function killPort(port: number) {
  const killed: number[] = [];
  for (const pid of await listeningPids(port)) {
    if (pid === process.pid || PROTECTED.test(await processName(pid))) continue;
    // Groupe de process quand c'est possible (next dev, turbo… et leurs enfants).
    try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { continue; } }
    killed.push(pid);
  }
  await new Promise((r) => setTimeout(r, 2000));
  for (const pid of await listeningPids(port)) if (killed.includes(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* mort */ }
  return killed;
}

/** Tue tout ce qui écoute encore sur les ports de l'historique (hors Docker et hors Tarmac). */
export async function freeHistoryPorts(): Promise<FreedPort[]> {
  const ports = [...new Set([...state.portHistory.map((h) => h.port), ...Object.values(state.assignedPorts)])].sort(
    (a, b) => a - b,
  );
  const report: FreedPort[] = [];
  for (const port of ports) {
    const pids = await listeningPids(port);
    if (!pids.length) continue;
    const entry: FreedPort = { port, killed: [], skipped: [] };
    for (const pid of pids) {
      const name = await processName(pid);
      if (pid === process.pid) entry.skipped.push({ pid, name, reason: 'tarmac' });
      else if (PROTECTED.test(name)) entry.skipped.push({ pid, name, reason: 'protected' });
      else {
        try {
          process.kill(pid, 'SIGTERM');
          entry.killed.push({ pid, name });
        } catch (e: any) {
          entry.skipped.push({ pid, name, reason: e.code ?? 'error' });
        }
      }
    }
    report.push(entry);
  }
  // Filet de sécurité : SIGKILL pour les récalcitrants.
  await new Promise((r) => setTimeout(r, 1500));
  for (const { port } of report) for (const pid of await listeningPids(port)) {
    if (pid !== process.pid && !PROTECTED.test(await processName(pid))) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* déjà mort */ }
    }
  }
  return report;
}
