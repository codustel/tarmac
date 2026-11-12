import { sessionOutcome } from './logic';

interface Deps {
  /** Abonnement aux évènements de consoles de `__system__` ; la liste des sessions est transmise à `cb`. */
  subscribe: (cb: (list: { id: string; status: string; exitCode: number | null }[]) => void) => () => void;
  /** Relevé de secours de toutes les consoles. */
  list: () => Promise<{ id: string; status: string; exitCode: number | null }[]>;
  pollMs?: number;
}

/**
 * Détection de fin d'une console (comme `useToolJob`) : évènement socket + relevé toutes les 2 s.
 * `onExit` est appelé une seule fois ; absente d'un évènement socket → on ne conclut pas, absente du relevé → code null.
 */
export function watchExit(sid: string, onExit: (exitCode: number | null) => void, deps: Deps): () => void {
  let done = false;
  const conclude = (code: number | null) => {
    if (done) return;
    done = true;
    stop();
    onExit(code);
  };
  const check = (list: { id: string; status: string; exitCode: number | null }[], gone: boolean) => {
    const o = sessionOutcome(list, sid);
    if (o.done && (gone || list.some((x) => x.id === sid))) conclude(o.exitCode);
  };
  const off = deps.subscribe((l) => check(l, false));
  const timer = setInterval(() => { deps.list().then((l) => check(l, true)).catch(() => null); }, deps.pollMs ?? 2000);
  function stop() { off(); clearInterval(timer); }
  return () => { done = true; stop(); };
}
