import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { tr } from './i18n.js';
import { AnnouncedPort } from './announcedPort.js';
import { allocatePort, isPortBusy } from './ports.js';
import { appSpawnOptions, killTree, prependPath, spawnCommand } from './platform.js';
import { state, persist } from './store.js';
import type { Project } from './scanner.js';

export type ProcStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

export interface LogLine {
  t: number;
  stream: 'out' | 'err' | 'sys';
  text: string;
}

interface Runtime {
  status: ProcStatus;
  pid: number | null;
  port: number | null;
  startedAt: string | null;
  exitCode: number | null;
  adopted: boolean;
  logs: LogLine[];
  child?: ChildProcess;
  stopRequested?: boolean;
  readyTimer?: NodeJS.Timeout;
  announced?: AnnouncedPort;
}

export interface RuntimeSummary {
  status: ProcStatus;
  pid: number | null;
  port: number | null;
  url: string | null;
  startedAt: string | null;
  exitCode: number | null;
  adopted: boolean;
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

class ProcessManager extends EventEmitter {
  private rt = new Map<string, Runtime>();
  private names = new Map<string, string>();

  constructor() {
    super();
    this.setMaxListeners(0);
    // Ré-adoption des process lancés avant un redémarrage de Tarmac.
    for (const [id, p] of Object.entries(state.processes)) {
      if (isAlive(p.pid)) {
        this.rt.set(id, {
          status: 'running', pid: p.pid, port: p.port, startedAt: p.startedAt, exitCode: null, adopted: true,
          logs: [{ t: Date.now(), stream: 'sys', text: tr({ en: 'Process re-adopted (pid {pid}) after Tarmac restarted — earlier logs unavailable.', fr: 'Process ré-adopté (pid {pid}) après redémarrage de Tarmac — logs antérieurs indisponibles.' }, { pid: p.pid }) }],
        });
      } else delete state.processes[id];
    }
    persist();
    setInterval(() => this.watchAdopted(), 5000).unref();
  }

  private get(id: string): Runtime {
    let r = this.rt.get(id);
    if (!r) {
      r = { status: 'stopped', pid: null, port: null, startedAt: null, exitCode: null, adopted: false, logs: [] };
      this.rt.set(id, r);
    }
    return r;
  }

  summary(id: string): RuntimeSummary {
    const r = this.get(id);
    return {
      status: r.status, pid: r.pid, port: r.port, startedAt: r.startedAt, exitCode: r.exitCode, adopted: r.adopted,
      url: r.port && (r.status === 'running' || r.status === 'starting') ? `http://localhost:${r.port}` : null,
    };
  }

  logs(id: string) {
    return this.get(id).logs;
  }

  private emitStatus(id: string) {
    this.emit('status', id, this.summary(id));
  }

  private log(id: string, stream: LogLine['stream'], text: string) {
    const r = this.get(id);
    const line = { t: Date.now(), stream, text };
    r.logs.push(line);
    if (r.logs.length > config.logBufferLines) r.logs.splice(0, r.logs.length - config.logBufferLines);
    this.emit('log', id, line);

    // L'app annonce un autre port que prévu (config interne prioritaire) → on suit le port réel.
    // Seule la première URL du lancement compte (les suivantes : services tiers, cf. AnnouncedPort).
    const announced = stream !== 'sys' && r.status === 'starting' ? r.announced?.take(text) : null;
    if (announced != null && announced !== r.port) {
      this.log(id, 'sys', tr({ en: 'Port announced by the app: {port} (expected {expected}).', fr: 'Port annoncé par l’app : {port} (prévu {expected}).' }, { port: String(announced), expected: String(r.port) }));
      r.port = announced;
      if (state.processes[id]) state.processes[id].port = r.port;
      persist();
    }
  }

  private usedPorts(): Set<number> {
    const s = new Set<number>();
    for (const r of this.rt.values()) if (r.port && r.status !== 'stopped' && r.status !== 'crashed') s.add(r.port);
    return s;
  }

  async start(app: Project) {
    const r = this.get(app.id);
    this.names.set(app.id, app.name);
    if (r.status === 'running' || r.status === 'starting') return this.summary(app.id);
    if (!app.serve) throw new Error(tr({ en: 'This project has no server command — use the console', fr: 'Ce projet n’a pas de commande serveur — utilise la console' }));
    const spec = app.serve;

    let port: number | null;
    if (spec.noPort) {
      port = null; // worker : pas de port HTTP
    } else if (spec.fixedPort) {
      if (await isPortBusy(spec.fixedPort)) throw new Error(tr({ en: 'Port {port} (set in the script) is already in use', fr: 'Port {port} (fixé dans le script) déjà occupé' }, { port: spec.fixedPort }));
      port = spec.fixedPort;
    } else {
      port = await allocatePort(app.id, this.usedPorts());
    }

    const sub = (v: string) => (port === null ? v : v.replaceAll('{PORT}', String(port)));
    const cmd = spec.command;
    const args = spec.args.map(sub);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...app.env,
      ...Object.fromEntries(Object.entries(spec.env).map(([k, v]) => [k, sub(v)])),
      ...(port !== null ? { PORT: String(port) } : {}),
      BROWSER: 'none',
      FORCE_COLOR: '1',
      PYTHONUNBUFFERED: '1',
    };
    prependPath(env, [...app.pathPrepend, ...(spec.pathPrepend ?? [])]);

    Object.assign(r, {
      status: 'starting', port, pid: null, exitCode: null, adopted: false, stopRequested: false,
      startedAt: new Date().toISOString(), logs: [], announced: new AnnouncedPort(),
    } satisfies Partial<Runtime>);
    this.log(app.id, 'sys', `$ ${cmd} ${args.join(' ')}   (cwd: ${app.relPath}${port !== null ? `, port ${port}` : ''})`);

    const run = spawnCommand(cmd, args); // Windows : via PowerShell (npm.cmd, pnpm.cmd…)
    const child = spawn(run.file, run.args, {
      cwd: app.dir,
      ...appSpawnOptions(), // macOS : groupe de process dédié → on tue aussi les enfants (next, esbuild, uvicorn reload…)
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    r.child = child;
    r.pid = child.pid ?? null;

    const pipe = (stream: 'out' | 'err') => {
      let buf = '';
      return (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) this.log(app.id, stream, l);
      };
    };
    child.stdout!.on('data', pipe('out'));
    child.stderr!.on('data', pipe('err'));

    child.on('error', (e) => this.log(app.id, 'sys', tr({ en: 'Launch error: {error}', fr: 'Erreur de lancement : {error}' }, { error: e.message })));
    child.on('exit', (code, signal) => this.onExit(app.id, code, signal));

    if (child.pid) {
      state.processes[app.id] = { pid: child.pid, port: port ?? 0, startedAt: r.startedAt! };
      if (port !== null) state.portHistory.push({ port, appId: app.id, appName: app.name, pid: child.pid, startedAt: r.startedAt!, endedAt: null });
      persist();
    }
    this.emitStatus(app.id);
    this.waitReady(app.id);
    return this.summary(app.id);
  }

  private waitReady(id: string) {
    const r = this.get(id);
    // Worker sans port : considéré démarré s'il tourne toujours après 2 s.
    if (!r.port) {
      r.readyTimer = setTimeout(() => {
        if (r.status !== 'starting') return;
        r.status = 'running';
        this.log(id, 'sys', tr({ en: 'Worker started.', fr: 'Worker démarré.' }));
        this.emitStatus(id);
      }, 2000);
      return;
    }
    const deadline = Date.now() + 180_000;
    const tick = async () => {
      if (r.status !== 'starting') return;
      if (r.port && (await isPortBusy(r.port))) {
        r.status = 'running';
        this.log(id, 'sys', tr({ en: 'Ready on {url}', fr: 'Prêt sur {url}' }, { url: `http://localhost:${r.port}` }));
        this.emitStatus(id);
        return;
      }
      if (Date.now() > deadline) {
        this.log(id, 'sys', tr({ en: 'Still no port listening after 3 min — check the logs.', fr: 'Toujours aucun port en écoute après 3 min — vérifie les logs.' }));
        return;
      }
      r.readyTimer = setTimeout(tick, 600);
    };
    tick();
  }

  private onExit(id: string, code: number | null, signal: NodeJS.Signals | null) {
    const r = this.get(id);
    clearTimeout(r.readyTimer);
    r.exitCode = code;
    r.status = r.stopRequested || code === 0 ? 'stopped' : 'crashed';
    this.log(id, 'sys', tr({ en: 'Process exited ({status}).', fr: 'Process terminé ({status}).' }, { status: signal ?? `code ${code}` }));
    this.closeHistory(id);
    r.child = undefined;
    r.pid = null;
    this.emitStatus(id);
  }

  private closeHistory(id: string) {
    const h = [...state.portHistory].reverse().find((e) => e.appId === id && !e.endedAt);
    if (h) h.endedAt = new Date().toISOString();
    delete state.processes[id];
    persist();
  }

  async stop(id: string) {
    const r = this.get(id);
    if (!r.pid || r.status === 'stopped' || r.status === 'crashed') return this.summary(id);
    r.stopRequested = true;
    r.status = 'stopping';
    this.emitStatus(id);
    const pid = r.pid;
    const managed = !!r.child && !r.adopted; // sinon pas d'évènement `exit` à attendre
    const killGroup = (sig: 'SIGTERM' | 'SIGKILL') => killTree(pid, sig);
    killGroup('SIGTERM');

    await new Promise<void>((resolve) => {
      const t0 = Date.now();
      const check = () => {
        if (!isAlive(pid)) return resolve();
        if (Date.now() - t0 > 6000) {
          killGroup('SIGKILL');
          return resolve();
        }
        setTimeout(check, 200);
      };
      check();
    });

    // Process ré-adopté : pas d'évènement `exit`, on finalise nous-mêmes.
    if (!managed) {
      r.status = 'stopped';
      r.pid = null;
      r.adopted = false;
      this.closeHistory(id);
      this.log(id, 'sys', tr({ en: 'Process stopped.', fr: 'Process arrêté.' }));
      this.emitStatus(id);
    }
    return this.summary(id);
  }

  async restart(app: Project) {
    await this.stop(app.id);
    return this.start(app);
  }

  async stopAll() {
    await Promise.all([...this.rt.keys()].map((id) => this.stop(id)));
  }

  /** Après « Libérer les ports » : tout ce qui n'est plus vivant passe à l'arrêt. */
  reconcile() {
    for (const [id, r] of this.rt) {
      if (r.pid && !isAlive(r.pid)) {
        r.status = 'stopped';
        r.pid = null;
        this.closeHistory(id);
        this.emitStatus(id);
      }
    }
  }

  private watchAdopted() {
    for (const [id, r] of this.rt) {
      if (r.adopted && r.pid && !isAlive(r.pid)) {
        r.status = 'stopped';
        r.pid = null;
        r.adopted = false;
        this.closeHistory(id);
        this.log(id, 'sys', tr({ en: 'Re-adopted process exited.', fr: 'Process ré-adopté terminé.' }));
        this.emitStatus(id);
      }
    }
  }
}

export const processes = new ProcessManager();
