import { useEffect, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { LogLine, OpenIn, Project, Runtime, TerminalSession } from './api';

type Listener = (msg: any) => void;

/** WebSocket unique avec reconnexion automatique. */
class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private subs = new Map<string, number>();
  private watches = new Map<string, number>();
  connected = false;
  private connListeners = new Set<(c: boolean) => void>();

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.setConnected(true);
      for (const id of this.subs.keys()) this.send({ type: 'logs:subscribe', id });
      for (const projectId of this.watches.keys()) this.send({ type: 'ide:watch', projectId });
      this.listeners.forEach((l) => l({ type: 'reconnect' }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.listeners.forEach((l) => l(msg));
    };
    ws.onclose = () => {
      this.setConnected(false);
      setTimeout(() => this.connect(), 1500);
    };
  }

  private setConnected(c: boolean) {
    this.connected = c;
    this.connListeners.forEach((l) => l(c));
  }

  onConnection(l: (c: boolean) => void) {
    this.connListeners.add(l);
    return () => void this.connListeners.delete(l);
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  /** Changements disque d'un projet ouvert dans l'IDE (évènements `ide:fs`). */
  watchProject(projectId: string) {
    const n = (this.watches.get(projectId) ?? 0) + 1;
    this.watches.set(projectId, n);
    if (n === 1) this.send({ type: 'ide:watch', projectId });
    return () => {
      const m = (this.watches.get(projectId) ?? 1) - 1;
      if (m <= 0) {
        this.watches.delete(projectId);
        this.send({ type: 'ide:unwatch', projectId });
      } else this.watches.set(projectId, m);
    };
  }

  subscribeLogs(id: string) {
    const n = (this.subs.get(id) ?? 0) + 1;
    this.subs.set(id, n);
    if (n === 1) this.send({ type: 'logs:subscribe', id });
    return () => {
      const m = (this.subs.get(id) ?? 1) - 1;
      if (m <= 0) {
        this.subs.delete(id);
        this.send({ type: 'logs:unsubscribe', id });
      } else this.subs.set(id, m);
    };
  }
}

export const socket = new Socket();

/** Branche les évènements serveur sur le cache React Query. */
export function bindSocket(qc: QueryClient) {
  socket.connect();
  return socket.on((msg) => {
    if (msg.type === 'status') {
      qc.setQueryData<Project[]>(['projects'], (list) =>
        list?.map((p) => (p.id === msg.id ? { ...p, runtime: msg.runtime as Runtime, portBusy: false } : p)),
      );
      qc.invalidateQueries({ queryKey: ['ports'] });
    }
    if (msg.type === 'terminals') {
      qc.setQueryData<Project[]>(['projects'], (list) =>
        list?.map((p) => (p.id === msg.projectId ? { ...p, terminals: msg.sessions as TerminalSession[] } : p)),
      );
    }
    if (msg.type === 'terminals:all') {
      qc.setQueryData<TerminalSession[]>(['terminals'], msg.sessions as TerminalSession[]);
      qc.invalidateQueries({ queryKey: ['claude'] });
      qc.invalidateQueries({ queryKey: ['agents'] });
    }
    if (msg.type === 'editors') {
      const open = msg.open as Record<string, OpenIn>;
      qc.setQueryData<Project[]>(['projects'], (list) => list?.map((p) => ({ ...p, openIn: open[p.id] ?? null })));
    }
    if (msg.type === 'suivi:changed') {
      qc.invalidateQueries({ queryKey: ['suivi'] });
      qc.invalidateQueries({ queryKey: ['timeline'] });
    }
    if (msg.type === 'scan' || msg.type === 'reconnect') qc.invalidateQueries();
  });
}

export function useConnected() {
  const [c, setC] = useState(socket.connected);
  useEffect(() => {
    const off = socket.onConnection(setC);
    setC(socket.connected); // la connexion a pu s'ouvrir avant l'abonnement
    return off;
  }, []);
  return c;
}

/** Logs d'une app : historique via HTTP puis flux temps réel. */
export function useLogs(id: string | null, fetchInitial: (id: string) => Promise<LogLine[]>) {
  const [lines, setLines] = useState<LogLine[]>([]);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const buffer: LogLine[] = [];
    let loaded = false;
    const off = socket.on((msg) => {
      if (msg.type !== 'log' || msg.id !== id) return;
      if (!loaded) buffer.push(msg.line);
      else setLines((l) => (l.length > 3000 ? [...l.slice(-2500), msg.line] : [...l, msg.line]));
    });
    const unsub = socket.subscribeLogs(id);
    fetchInitial(id).then((initial) => {
      if (!alive) return;
      loaded = true;
      const last = initial.at(-1)?.t ?? 0;
      setLines([...initial, ...buffer.filter((b) => b.t > last)]);
    });
    return () => {
      alive = false;
      off();
      unsub();
      setLines([]);
    };
  }, [id, fetchInitial]);
  return [lines, setLines] as const;
}
