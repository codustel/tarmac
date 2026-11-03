import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ExternalLink, GitBranch, History, MessageSquare, Play, Plus, Radio, RefreshCw, Search, SquareTerminal, X } from 'lucide-react';
import { api, type ClaudeSession, type Project, type TerminalSession } from '../api';
import { TechIcon } from '../icons';
import { Badge, Button, Card, Empty, IconButton, cx, timeAgo, useToast } from '../ui';
import { useT } from '../i18n';
import { TerminalView } from './TerminalView';
import { AgentLed, RunningAgentRow, agentsUnder, useRunningAgents } from './Agents';

export const ClaudeIcon = ({ size = 14, className }: { size?: number; className?: string }) => (
  <TechIcon id="claude" label="Claude" size={size} className={className} />
);

/** Ligne de session Claude (liste d'un projet ou liste globale). */
export function SessionRow({ s, projectId, onOpenTab, showProject }: {
  s: ClaudeSession;
  projectId: string;
  onOpenTab: (sid: string) => void;
  showProject?: boolean;
}) {
  const tr = useT();
  const toast = useToast();
  const resume = useMutation({
    mutationFn: () => api.openClaude(projectId, s.id),
    onSuccess: (t) => onOpenTab(t.id),
    onError: (e: Error) => toast('err', e.message),
  });
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-panel-2/50">
      <div className="relative grid size-7 shrink-0 place-items-center rounded-md border border-line bg-panel">
        <ClaudeIcon size={13} />
        {(s.active || s.terminalId) && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-panel" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cx('truncate font-medium', s.titleSource === 'prompt' && 'font-normal italic text-muted')} title={s.firstPrompt ?? s.title}>{s.title}</span>
          {s.terminalId ? <Badge tone="green">{tr('claude.row.openHere')}</Badge> : s.active ? <Badge tone="green" title={tr('claude.row.activeTitle')}>{tr('claude.row.active')}</Badge> : null}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-faint">
          {showProject && s.project && <span className="font-medium text-muted">{s.project.name}</span>}
          <span title={s.updatedAt}>{timeAgo(s.updatedAt)}</span>
          <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" />{s.messages}</span>
          {s.gitBranch && <span className="inline-flex items-center gap-0.5 font-mono"><GitBranch className="size-3" />{s.gitBranch}</span>}
          <span className="truncate font-mono opacity-70">{s.id.slice(0, 8)}</span>
        </div>
      </div>
      {s.terminalId ? (
        <Button size="sm" icon={<SquareTerminal className="size-3.5" />} onClick={() => onOpenTab(s.terminalId!)}>{tr('claude.row.show')}</Button>
      ) : (
        <Button
          size="sm"
          title={s.active ? tr('claude.row.resumeActiveTitle') : 'claude --resume … --remote-control'}
          icon={<History className="size-3.5" />}
          loading={resume.isPending}
          onClick={() => resume.mutate()}
          className="opacity-70 group-hover:opacity-100"
        >
          {tr('claude.row.resume')}
        </Button>
      )}
    </div>
  );
}

/** Onglet « Claude » du panneau projet : sessions associées + nouvelle session. */
export function ProjectClaudeTab({ project, onOpenTab }: { project: Project; onOpenTab: (sid: string) => void }) {
  const tr = useT();
  const toast = useToast();
  const [q, setQ] = useState('');
  const sessions = useQuery({ queryKey: ['claude', project.id], queryFn: () => api.claudeSessions(project.id), refetchInterval: 15_000 });
  const start = useMutation({
    mutationFn: () => api.openClaude(project.id),
    onSuccess: (t) => onOpenTab(t.id),
    onError: (e: Error) => toast('err', e.message),
  });
  const list = (sessions.data ?? []).filter((s) => !q || `${s.title} ${s.firstPrompt ?? ''} ${s.gitBranch ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const agents = useRunningAgents();
  const running = agentsUnder(agents.data, project.dir);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} loading={start.isPending} onClick={() => start.mutate()}>
          {tr('claude.tab.new')}
        </Button>
        <span className="inline-flex items-center gap-1 text-[11px] text-faint" title={tr('claude.tab.remoteTitle')}>
          <Radio className="size-3" />Remote Control
        </span>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('claude.filter')} className="h-7 w-40 rounded-md border border-line bg-panel pl-6 pr-2 text-xs outline-none focus:border-accent" />
        </div>
        <IconButton title={tr('claude.refresh')} onClick={() => api.claudeSessions(project.id, true).then(() => sessions.refetch())}><RefreshCw className="size-3.5" /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Agents en cours dans ce projet (Tarmac ou ailleurs) : détail ouvert par le badge de la liste des projets. */}
        {running.length > 0 && (
          <section className="border-b border-line bg-emerald-500/[0.04]">
            <h3 className="flex items-center gap-2 px-4 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <AgentLed working={running.some((a) => a.working)} />{tr('agents.project.title')}<span className="tabular-nums text-faint">{running.length}</span>
            </h3>
            <div className="divide-y divide-line/70">
              {running.map((a) => <RunningAgentRow key={a.key} a={a} onShowTerminal={onOpenTab} showProject={a.project?.id !== project.id} />)}
            </div>
          </section>
        )}
        {sessions.isLoading ? (
          <div className="p-6 text-muted">{tr('claude.loading')}</div>
        ) : list.length === 0 ? (
          <Empty icon={<ClaudeIcon size={28} />} title={q ? tr('claude.tab.noMatch') : tr('claude.tab.none')}>
            {tr('claude.tab.noneHint')}
          </Empty>
        ) : (
          <div className="divide-y divide-line">
            {list.map((s) => <SessionRow key={s.id} s={s} projectId={project.id} onOpenTab={onOpenTab} />)}
          </div>
        )}
      </div>
      <div className="border-t border-line px-4 py-2 text-[11px] text-faint">
        {tr.node('claude.tab.footer', {
          count: sessions.data?.length ?? 0,
          dir: <span className="font-mono">~/.claude/projects</span>,
          period: <span title={tr('claude.tab.retentionTitle')}>{tr('claude.tab.retention')}</span>,
        })}
      </div>
    </div>
  );
}

/** Page « Sessions Claude » : onglets des sessions ouvertes depuis Tarmac + historique global. */
export function ClaudeSessionsView({ terminals, activeId, onActive, projects }: {
  terminals: TerminalSession[];
  activeId: string | null;
  onActive: (sid: string | null) => void;
  projects: Project[];
}) {
  const tr = useT();
  const toast = useToast();
  const tabs = terminals.filter((t) => t.kind === 'claude');
  const current = tabs.find((t) => t.id === activeId) ?? tabs.at(-1) ?? null;
  const all = useQuery({ queryKey: ['claude', 'all'], queryFn: api.allClaudeSessions, refetchInterval: 15_000 });
  const [q, setQ] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const history = useMemo(
    () => (all.data ?? []).filter((s) => s.project && (!q || `${s.title} ${s.project.name} ${s.gitBranch ?? ''}`.toLowerCase().includes(q.toLowerCase()))),
    [all.data, q],
  );
  const agents = useRunningAgents();
  const outside = (agents.data ?? []).filter((a) => a.where === 'external');
  const [outsideOpen, setOutsideOpen] = useState(() => { try { return localStorage.getItem('claude:outside') !== 'closed'; } catch { return true; } });
  const toggleOutside = () => {
    setOutsideOpen((v) => { try { localStorage.setItem('claude:outside', v ? 'closed' : 'open'); } catch { /* stockage indisponible */ } return !v; });
  };

  const close = (t: TerminalSession) => {
    if (t.status === 'running' && !confirm(tr('claude.view.closeConfirm', { label: t.label }))) return;
    api.closeTerminal(t.id).catch((e) => toast('err', e.message));
    if (t.id === current?.id) onActive(tabs.filter((x) => x.id !== t.id).at(-1)?.id ?? null);
  };

  return (
    <div className="flex h-[calc(100vh-56px-48px)] min-h-[420px] flex-col gap-3">
      {/* Barre d'onglets */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg border border-line bg-panel p-1">
          {tabs.length === 0 && <span className="px-2 text-xs text-faint">{tr('claude.view.noTabs')}</span>}
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => { onActive(t.id); setShowHistory(false); }}
              className={cx(
                'group inline-flex h-8 max-w-64 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs',
                current?.id === t.id && !showHistory ? 'bg-panel-2 text-fg shadow-xs' : 'text-muted hover:bg-panel-2/60 hover:text-fg',
              )}
            >
              <span className={cx('size-1.5 shrink-0 rounded-full', t.status === 'running' ? 'bg-emerald-500' : 'bg-faint')} />
              <span className="truncate font-medium">{t.projectName || t.label}</span>
              <button title={tr('claude.close')} onClick={(e) => { e.stopPropagation(); close(t); }} className="text-faint opacity-0 hover:text-fg group-hover:opacity-100">
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <Button icon={<History className="size-3.5" />} variant={showHistory ? 'primary' : 'default'} onClick={() => setShowHistory((v) => !v)}>
          {tr('claude.view.history')}{all.data ? ` · ${all.data.length}` : ''}
        </Button>
      </div>

      {/* Sessions en cours hors Tarmac (terminal, app Claude, IDE) avec leurs agents en arrière-plan. */}
      {outside.length > 0 && !showHistory && (
        <Card className="shrink-0 overflow-hidden">
          <button onClick={toggleOutside} aria-expanded={outsideOpen} className="flex w-full items-center gap-2 px-4 h-9 text-left hover:bg-panel-2/50">
            {outsideOpen ? <ChevronDown className="size-3.5 text-faint" /> : <ChevronRight className="size-3.5 text-faint" />}
            <AgentLed working={outside.some((a) => a.working)} title={outside.some((a) => a.working) ? tr('agents.ledWorking') : tr('agents.ledIdle')} />
            <span className="font-medium">{tr('agents.outside.title')}</span>
            <span className="text-[11px] tabular-nums text-faint">{outside.length}</span>
            <span className="ml-2 hidden truncate text-[11px] text-faint lg:inline">{tr('agents.outside.sub')}</span>
          </button>
          {outsideOpen && (
            <div className="max-h-[42vh] divide-y divide-line overflow-auto border-t border-line">
              {outside.map((a) => <RunningAgentRow key={a.key} a={a} />)}
            </div>
          )}
        </Card>
      )}

      {showHistory ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <span className="font-medium">{tr('claude.view.allTitle')}</span>
            <span className="text-[11px] text-faint">{tr('claude.view.allSub')}</span>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('claude.filter')} className="h-7 w-56 rounded-md border border-line bg-panel pl-6 pr-2 text-xs outline-none focus:border-accent" />
            </div>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-line overflow-auto">
            {history.map((s) => (
              <SessionRow key={s.id} s={s} projectId={s.project!.id} showProject onOpenTab={(sid) => { onActive(sid); setShowHistory(false); }} />
            ))}
            {history.length === 0 && <Empty icon={<ClaudeIcon size={28} />} title={tr('claude.view.noSession')} />}
          </div>
        </Card>
      ) : current ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 h-10 shrink-0">
            <ClaudeIcon />
            <span className="truncate font-medium">{current.projectName}</span>
            <span className="truncate font-mono text-[11px] text-faint">{current.command}</span>
            <div className="ml-auto flex items-center gap-1">
              {current.status === 'exited' && (
                <Button size="sm" icon={<Play className="size-3" />} onClick={() => {
                  const p = projects.find((x) => x.id === current.projectId);
                  if (p && current.claudeSessionId) api.openClaude(p.id, current.claudeSessionId).then((t) => onActive(t.id)).catch((e) => toast('err', e.message));
                }}>{tr('claude.view.relaunch')}</Button>
              )}
              <a href={`#term/${current.id}`} target="_blank" rel="noreferrer" title={tr('claude.view.openInBrowserTab')} className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-fg">
                <ExternalLink className="size-4" />
              </a>
              <IconButton title={tr('claude.close')} onClick={() => close(current)}><X className="size-4" /></IconButton>
            </div>
          </div>
          <div className="min-h-0 flex-1 bg-[#0a0c10]">
            {/* Tous les terminaux restent montés : le changement d'onglet est instantané et sans perte. */}
            {tabs.map((t) => <TerminalView key={t.id} sid={t.id} active={t.id === current.id} />)}
          </div>
        </Card>
      ) : (
        <Card className="grid flex-1 place-items-center">
          <Empty icon={<ClaudeIcon size={32} />} title={tr('claude.view.emptyTitle')}>
            {tr.node('claude.view.emptyHint', {
              claude: <b>Claude</b>,
              newSession: <b>{tr('claude.tab.new')}</b>,
              history: <button className="text-accent hover:underline" onClick={() => setShowHistory(true)}>{tr('claude.view.historyLink')}</button>,
            })}{' '}
            {tr('claude.view.emptyRemote')}
          </Empty>
        </Card>
      )}
    </div>
  );
}

/** Vue plein écran d'une console (#term/<id>) pour l'ouvrir dans un onglet séparé du navigateur. */
export function StandaloneTerminal({ sid, terminals }: { sid: string; terminals: TerminalSession[] }) {
  const tr = useT();
  const t = terminals.find((x) => x.id === sid);
  if (t) document.title = `${t.projectName || t.label} — Tarmac`;
  return (
    <div className="flex h-full flex-col bg-[#0a0c10]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 h-9 text-xs text-zinc-300">
        {t?.kind === 'claude' ? <ClaudeIcon /> : <SquareTerminal className="size-3.5" />}
        <span className="font-medium">{t?.projectName || t?.label || sid}</span>
        <span className={cx('size-1.5 rounded-full', t?.status === 'running' ? 'bg-emerald-500' : 'bg-zinc-500')} />
        <a href="/#claude" className="ml-auto text-zinc-500 hover:text-zinc-200">Tarmac</a>
      </div>
      <div className="min-h-0 flex-1">{t ? <TerminalView sid={sid} active /> : <div className="p-6 text-zinc-500">{tr('claude.standalone.notFound')}</div>}</div>
    </div>
  );
}
