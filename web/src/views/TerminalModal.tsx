import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { api, type TerminalSession } from '../api';
import { socket } from '../socket';
import { Badge, IconButton } from '../ui';
import { useT } from '../i18n';
import { TerminalView } from './TerminalView';

/**
 * Console modale pour une commande ponctuelle (connexion gh, clonage…).
 * `onExit` est appelé une fois quand la commande se termine.
 */
export function TerminalModal({ session, title, subtitle, icon, onClose, onExit }: {
  session: TerminalSession;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  onExit?: (code: number | null) => void;
}) {
  const [s, setS] = useState(session);
  const t = useT();

  useEffect(() => {
    let done = false;
    return socket.on((msg) => {
      if (msg.type !== 'terminals:all' || done) return;
      const t = (msg.sessions as TerminalSession[]).find((x) => x.id === session.id);
      if (t?.status === 'exited') {
        done = true;
        setS(t);
        onExit?.(t.exitCode);
      }
    });
  }, [session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (s.status !== 'running') api.closeTerminal(s.id).catch(() => null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onClick={close}>
      <div className="flex h-[440px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-line px-4 h-12">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-[13px]">{title}</div>
            {subtitle && <div className="truncate text-[11px] text-faint">{subtitle}</div>}
          </div>
          {s.status === 'exited' ? (
            <Badge tone={s.exitCode === 0 ? 'green' : 'red'}>{s.exitCode === 0 ? t('projects.terminal.done') : t('projects.terminal.failed', { code: String(s.exitCode) })}</Badge>
          ) : (
            <Badge tone="amber">{t('projects.terminal.running')}</Badge>
          )}
          <IconButton title={s.status === 'running' ? t('projects.terminal.hide') : t('projects.action.close')} onClick={close}><X className="size-4" /></IconButton>
        </header>
        <div className="min-h-0 flex-1 bg-[#0a0c10]">
          <TerminalView sid={s.id} active />
        </div>
      </div>
    </div>
  );
}
