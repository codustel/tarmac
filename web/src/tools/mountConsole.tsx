import { createRoot } from 'react-dom/client';
import { api } from '../api';
import { socket } from '../socket';
import { TerminalView } from '../views/TerminalView';
import { watchExit } from './watchExit';
import type { ModuleWebContext } from '../../../server/modules/api';

/**
 * `ctx.mountConsole` des modules : la même vue de console que l'écran Outils (TerminalView), avec la détection de
 * fin de `useToolJob` (évènement socket sur `__system__` + relevé toutes les 2 s). Renvoie le démontage.
 */
export const mountConsole: ModuleWebContext['mountConsole'] = (el, sessionId, opts) => {
  const root = createRoot(el);
  root.render(
    <div className="h-72 overflow-hidden rounded-md border border-line">
      <TerminalView sid={sessionId} active />
    </div>,
  );
  const stop = watchExit(sessionId, (code) => opts?.onExit?.(code), {
    subscribe: (cb) => socket.on((msg) => {
      if (msg.type === 'terminals' && msg.projectId === '__system__') cb(msg.sessions as { id: string; status: string; exitCode: number | null }[]);
    }),
    list: () => api.terminals(),
  });
  return () => { stop(); root.unmount(); };
};
