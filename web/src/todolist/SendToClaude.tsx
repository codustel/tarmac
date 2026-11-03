import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AgentKind, type SuiviDetail, type SuiviTask } from '../api';
import { AGENTS, AgentIcon, useEnabledAgents } from '../views/Agents';
import { useToast } from '../ui';
import { fmtDateTime, timeAgo, useT } from '../i18n';

/** Tâche « non traitée » : ni faite, ni à tester, ni archivée (seules celles-ci peuvent être envoyées à Claude). */
export const isUntreated = (t: SuiviTask) => !t.done && !t.toTest && !t.archived;
/** « Demandée à Claude » et pas encore traitée. */
export const isRequested = (t: SuiviTask) => isUntreated(t) && !!t.requestedAt;

/** Badge « Demandée à Claude » (date et destinataire en infobulle). */
export function RequestedBadge({ task }: { task: SuiviTask }) {
  const tr = useT();
  const multi = useEnabledAgents().includes('codex');
  if (!isRequested(task)) return null;
  const to = task.requestedTo === 'new' ? tr('todolist.requestedNew') : task.requestedTo === 'copy' || !task.requestedTo ? tr('todolist.requestedCopy') : task.requestedTo;
  return <span className="tl-badge-requested" title={tr('todolist.requestedTitle', { date: fmtDateTime(task.requestedAt!), to })}>{multi ? tr('todolist.requestedAny') : tr('todolist.requested')}</span>;
}

/**
 * Bouton « ▶ Claude » : menu des sessions Claude ouvertes dans les consoles de Tarmac pour ce projet, ou nouvelle
 * session. Un clic = un envoi (bouton désactivé pendant l'envoi, jamais de nouvel essai automatique).
 */
export function SendToClaude({ suiviId, task, large, onOpenTerminal }: {
  suiviId: string;
  task: SuiviTask;
  /** Version libellée (détail de la tâche). */
  large?: boolean;
  onOpenTerminal?: (sid: string, agent?: AgentKind) => void;
}) {
  const tr = useT();
  // Agents cochés : Claude seul = textes et menu d'avant Codex ; sinon un menu par agent.
  const agents = useEnabledAgents();
  const claudeOnly = agents.length === 1 && agents[0] === 'claude';
  const who = agents.length > 1 ? tr('todolist.send.both') : AGENTS[agents[0] ?? 'claude'].short;
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Menu en position fixe (les phases rognent leur contenu) : sous le bouton, ou au-dessus s'il manque de place.
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number }>({ right: 0 });
  const box = useRef<HTMLSpanElement>(null);
  const toggle = () => {
    if (!open && box.current) {
      const r = box.current.getBoundingClientRect();
      const right = Math.max(8, window.innerWidth - r.right);
      setPos(window.innerHeight - r.bottom < 300 && r.top > 300 ? { right, bottom: window.innerHeight - r.top + 6 } : { right, top: r.bottom + 6 });
    }
    setOpen((o) => !o);
  };
  const sessions = useQuery({ queryKey: ['suivi-sessions', suiviId], queryFn: () => api.suiviSessions(suiviId), enabled: open, staleTime: 0 });

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const scroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); window.removeEventListener('scroll', scroll, true); };
  }, [open]);

  const send = useMutation({
    mutationFn: ({ target, agent }: { target: string; agent?: AgentKind }) => api.suiviDispatch(suiviId, task.id, target, claudeOnly ? undefined : agent),
    onSuccess: (r, v) => {
      setOpen(false);
      qc.setQueryData<SuiviDetail>(['suivi', suiviId], (d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === r.task.id ? r.task : x)) });
      qc.invalidateQueries({ queryKey: ['suivi'] });
      toast('ok', r.target !== 'new' ? tr('todolist.send.sent', { session: r.session }) : claudeOnly ? tr('todolist.send.sentNew') : tr('todolist.send.sentNewOf', { agent: AGENTS[v.agent ?? agents[0]].short }));
      if (r.target === 'new') onOpenTerminal?.(r.terminalId, v.agent ?? agents[0]);
    },
    onError: (e: Error) => { toast('err', e.message); qc.invalidateQueries({ queryKey: ['suivi', suiviId] }); },
  });

  if (!isUntreated(task)) return null;
  const list = sessions.data ?? [];
  return (
    <span className="tl-send" ref={box}>
      <button type="button" className={large ? 'tl-btn tl-small' : 'tl-send-btn'} title={claudeOnly ? tr('todolist.send.title') : tr('todolist.send.titleOf', { agent: who })} aria-haspopup="menu" aria-expanded={open}
        disabled={send.isPending} onClick={toggle}>
        {send.isPending ? tr('todolist.send.sending') : claudeOnly ? (large ? tr('todolist.send.detail') : tr('todolist.send.button'))
          : large ? tr('todolist.send.detailOf', { agent: who }) : agents.length > 1 ? tr('todolist.send.buttonBoth') : tr('todolist.send.buttonOf', { agent: who })}
      </button>
      {open && (
        <div className="tl-menu" role="menu" style={pos} aria-label={tr('todolist.send.menuLabel', { num: task.num })}>
          <div className="tl-menu-head">{tr('todolist.send.menuLabel', { num: task.num })}</div>
          {sessions.isLoading && <div className="tl-menu-note">{tr('todolist.send.loading')}</div>}
          {sessions.error && <div className="tl-menu-note">{(sessions.error as Error).message}</div>}
          {sessions.isSuccess && !list.length && <div className="tl-menu-note">{claudeOnly ? tr('todolist.send.none') : tr('todolist.send.noneOf', { agent: who })}</div>}
          {list.map((s) => (
            <button key={s.terminalId} type="button" role="menuitem" disabled={send.isPending || !s.available} onClick={() => send.mutate({ target: s.terminalId, agent: s.agent })}
              title={s.available ? undefined : tr('todolist.send.unavailable')}>
              <span className="tl-menu-name">{!claudeOnly && <span className="mr-1 inline-block align-[-1px]"><AgentIcon agent={s.agent ?? 'claude'} size={11} /></span>}{s.name} <span className={`tl-state tl-state-${s.state}`}>{tr(`todolist.send.state.${s.state}`)}</span></span>
              <span className="tl-menu-sub">{[s.title, tr('todolist.send.active', { ago: timeAgo(s.lastActivityAt ?? s.startedAt) })].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {agents.map((a) => (
            <button key={a} type="button" role="menuitem" className="tl-menu-new" disabled={send.isPending} onClick={() => send.mutate({ target: 'new', agent: a })} title={tr('todolist.send.newHint')}>
              <span className="tl-menu-name">{claudeOnly ? tr('todolist.send.new') : tr('todolist.send.newAgent', { agent: AGENTS[a].short })}</span>
              <span className="tl-menu-sub">{tr('todolist.send.newHint')}</span>
            </button>
          ))}
          <div className="tl-menu-note tl-menu-foot">{claudeOnly ? tr('todolist.send.outside') : tr('todolist.send.outsideAny')}</div>
        </div>
      )}
    </span>
  );
}
