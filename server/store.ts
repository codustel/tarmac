import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface PortHistoryEntry {
  port: number;
  appId: string;
  appName: string;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface PersistedProcess {
  pid: number;
  port: number;
  startedAt: string;
}

interface State {
  /** Port « collant » par app : réattribué à chaque démarrage tant qu'il est libre. */
  assignedPorts: Record<string, number>;
  portHistory: PortHistoryEntry[];
  /** Process lancés par Tarmac, pour les ré-adopter après un redémarrage de Tarmac. */
  processes: Record<string, PersistedProcess>;
}

const FILE = path.join(config.dataDir, 'state.json');
const MAX_HISTORY = 500;

function load(): State {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { assignedPorts: {}, portHistory: [], processes: {}, ...raw };
  } catch {
    return { assignedPorts: {}, portHistory: [], processes: {} };
  }
}

export const state: State = load();

let timer: NodeJS.Timeout | null = null;
export function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    state.portHistory = state.portHistory.slice(-MAX_HISTORY);
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE); // écriture atomique
  }, 200);
}

export function flushSync() {
  if (timer) clearTimeout(timer);
  timer = null;
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}
