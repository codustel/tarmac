import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronRight, SquareTerminal } from 'lucide-react';
import { api, type AgentKind, type RunningAgent } from '../api';
import { Button, cx, tildify, timeAgo } from '../ui';
import { useT } from '../i18n';
import { TechIcon } from '../icons';

/**
 * Agents en cours, partout : LED commune, icône et couleur par agent, liste détaillée (où, état, agents en
 * arrière-plan). Indépendant de l'agent : un nouvel agent (Codex, tâche 7.7) ajoute son entrée à AGENTS.
 */
export const AGENTS: Record<AgentKind, { label: string; color: string }> = {
  claude: { label: 'Claude Code', color: 'var(--agent-claude)' },
};

export function AgentIcon({ agent, size = 13 }: { agent: AgentKind; size?: number }) {
  return agent === 'claude' ? <TechIcon id="claude" label="Claude" size={size} /> : <Bot style={{ width: size, height: size }} />;
}

/** Agents en cours sur la machine (rafraîchis toutes les 4 s, partagés par toutes les vues). */
export function useRunningAgents() {
  return useQuery({ queryKey: ['agents', 'running'], queryFn: api.runningAgents, refetchInterval: 4_000 });
}

/** Agents dont le dossier est `dir` ou un de ses sous-dossiers. */
export const agentsUnder = (list: RunningAgent[] | undefined, dir: string) =>
  (list ?? []).filter((a) => a.cwd && (a.cwd === dir || a.cwd.startsWith(dir + '/')));

/**
 * LED d'activité : clignote quand un agent travaille (tour en cours ou agent en arrière-plan actif), fixe sinon ;
 * fixe aussi avec `prefers-reduced-motion` (index.css).
 */
export function AgentLed({ working, size = 7, className, title }: { working: boolean; size?: number; className?: string; title?: string }) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      data-working={working ? 'true' : 'false'}
      className={cx('agent-led shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Ligne d'un agent en cours : session, projet, où, état, depuis quand, agents en arrière-plan (dépliables). */
export function RunningAgentRow({ a, onShowTerminal, showProject = true }: { a: RunningAgent; onShowTerminal?: (sid: string) => void; showProject?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: 60_000 });
  const where = a.where === 'tarmac' ? t('agents.where.tarmac') : a.app ? t('agents.where.app', { app: a.app }) : t('agents.where.elsewhere');
  const detail = a.background.length > 0 || !!a.sessionId;
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button onClick={() => detail && setOpen((v) => !v)} className={cx('grid size-5 shrink-0 place-items-center text-faint', detail ? 'hover:text-fg' : 'invisible')}
          aria-label={open ? t('agents.hideDetail') : t('agents.showDetail')} title={open ? t('agents.hideDetail') : t('agents.showDetail')}>
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <div className="relative grid size-7 shrink-0 place-items-center rounded-md border border-line bg-panel">
          <AgentIcon agent={a.agent} />
          <AgentLed working={a.working} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-panel" title={a.working ? t('agents.state.working') : t('agents.state.idle')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cx('truncate font-medium', !a.title && 'italic text-muted')}>{a.title || t('agents.untitled')}</span>
            <span className={cx('shrink-0 rounded px-1.5 text-[10px] font-semibold', a.working ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-panel-2 text-muted')}>
              {a.state === 'working' ? t('agents.state.working') : a.background.length ? t('agents.state.background') : t('agents.state.idle')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
            {showProject && <span className="font-medium text-muted">{a.project?.name ?? a.cwd?.split('/').pop() ?? '—'}</span>}
            <span>{where}</span>
            <span title={a.startedAt}>{t('agents.started', { when: timeAgo(a.startedAt) })}</span>
            {a.lastActivityAt && <span title={a.lastActivityAt}>{t('agents.lastActivity', { when: timeAgo(a.lastActivityAt) })}</span>}
            {a.background.length > 0 && <span className="text-emerald-700 dark:text-emerald-400">{t('agents.backgroundCount', { count: a.background.length })}</span>}
          </div>
        </div>
        {a.terminalId && onShowTerminal && (
          <Button size="sm" icon={<SquareTerminal className="size-3.5" />} onClick={() => onShowTerminal(a.terminalId!)}>{t('claude.row.show')}</Button>
        )}
      </div>
      {open && (
        <div className="mt-2 ml-8 space-y-1.5 rounded-md border border-line bg-panel-2/40 px-3 py-2 text-[11px]">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-muted">
            <span className="text-faint">{t('agents.detail.agent')}</span><span>{AGENTS[a.agent].label}</span>
            <span className="text-faint">{t('agents.detail.where')}</span><span>{where}</span>
            {a.cwd && <><span className="text-faint">{t('agents.detail.folder')}</span><span className="truncate font-mono" title={tildify(a.cwd, meta.data?.home)}>{tildify(a.cwd, meta.data?.home)}</span></>}
            {a.sessionId && <><span className="text-faint">{t('agents.detail.session')}</span><span className="font-mono">{a.sessionId.slice(0, 8)} · {t(`agents.match.${a.match}`)}</span></>}
            <span className="text-faint">{t('agents.detail.pid')}</span><span className="font-mono">{a.pid}</span>
          </div>
          {a.background.length > 0 && (
            <div className="space-y-1 border-t border-line pt-1.5">
              <div className="font-medium text-muted">{t('agents.detail.background')}</div>
              {a.background.map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <AgentLed working size={6} />
                  <span className="min-w-0 flex-1 truncate text-fg" title={b.description}>{b.description || b.id}</span>
                  {b.type && <span className="shrink-0 font-mono text-faint">{b.type}</span>}
                  <span className="shrink-0 text-faint" title={b.lastActivityAt}>{timeAgo(b.lastActivityAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Résumé pour une infobulle : « 2 sessions en cours · 1 au travail ». */
export function useAgentSummary(list: RunningAgent[]) {
  const t = useT();
  return useMemo(() => {
    const working = list.filter((a) => a.working).length;
    return t('agents.summary', { count: list.length }) + (working ? t('agents.summaryWorking', { count: working }) : '');
  }, [list, t]);
}
