import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { socket } from '../socket';

const THEME = {
  background: '#0a0c10',
  foreground: '#d4d4d8',
  cursor: '#818cf8',
  selectionBackground: '#818cf855',
  black: '#1f2430', red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', magenta: '#e879f9', cyan: '#22d3ee', white: '#e5e7eb',
  brightBlack: '#6b7280', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde047', brightBlue: '#93c5fd', brightMagenta: '#f0abfc', brightCyan: '#67e8f9', brightWhite: '#ffffff',
};

/** Terminal xterm.js branché sur une session PTY du serveur (relecture du tampon + flux live). */
export function TerminalView({ sid, active, background }: { sid: string; active: boolean; background?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
      theme: background ? { ...THEME, background } : THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;

    const sendSize = () => {
      try { fit.fit(); } catch { return; }
      socket.send({ type: 'term:resize', sid, cols: term.cols, rows: term.rows });
    };

    const off = socket.on((msg) => {
      if (msg.sid !== sid) {
        if (msg.type === 'reconnect') {
          term.reset();
          socket.send({ type: 'term:attach', sid });
        }
        return;
      }
      if (msg.type === 'term:replay') {
        term.reset();
        term.write(msg.data);
      } else if (msg.type === 'term:data') term.write(msg.data);
    });
    const input = term.onData((data) => socket.send({ type: 'term:input', sid, data }));

    socket.send({ type: 'term:attach', sid });
    requestAnimationFrame(sendSize);
    const ro = new ResizeObserver(() => sendSize());
    ro.observe(host.current!);

    return () => {
      ro.disconnect();
      input.dispose();
      off();
      socket.send({ type: 'term:detach', sid });
      term.dispose();
    };
  }, [sid]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* masqué */ }
      termRef.current?.focus();
    });
  }, [active]);

  return <div ref={host} className="h-full w-full px-2 py-1.5" style={{ display: active ? 'block' : 'none' }} />;
}
