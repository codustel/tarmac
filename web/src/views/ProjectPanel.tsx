import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BookOpen, Code2, ExternalLink, Globe, ListChecks, Play, ScrollText, Skull, SquareTerminal, TerminalSquare, X } from 'lucide-react';
import { api, type ProcStatus, type Project, type TerminalSession } from '../api';
import { TechIcon } from '../icons';
import { Badge, Button, Empty, IconButton, StatusDot, VsCodeIcon, cx, statusMeta, useToast } from '../ui';
import { useT, type TKey } from '../i18n';
import { openInIde } from '../ide/store';
import { LogsView } from './LogsView';
import { ReadmeView } from './ReadmeView';
import { TerminalView } from './TerminalView';
import { ClaudeIcon, ProjectClaudeTab } from './ClaudeSessions';
import { CodexIcon, useEnabledAgents } from './Agents';
import type { AgentKind } from '../api';
import { CommandMenu } from './CommandMenu';
import { Board } from '../todolist/Board';
import { BrowserView } from './BrowserView';

export type PanelTab = 'logs' | 'browser' | 'console' | 'readme' | 'claude' | 'codex' | 'todolist';

export const defaultTab = (p: Project): PanelTab => (p.serve ? 'logs' : 'console');

/** Projet web (serveur avec un port) : il a un onglet Navigateur interne. */
export const hasBrowser = (p: Project) => !!p.serve && !p.serve.noPort;

/** Libellé traduit de chaque statut de process. */
export const STATUS_KEY: Record<ProcStatus, TKey> = {
  running: 'projects.status.running',
  starting: 'projects.status.starting',
  stopping: 'projects.status.stopping',
  stopped: 'projects.status.stopped',
  crashed: 'projects.status.crashed',
};

export function ProjectPanel({ project, webApps = [], tab: wanted, onTab, onClose, onOpenClaudeTab, todoFocus }: {
  project: Project;
  /** Applis web du même projet (racine de monorepo et ses apps) : cibles du navigateur interne. */
  webApps?: Project[]; tab: PanelTab; onTab: (t: PanelTab) => void; onClose: () => void; onOpenClaudeTab: (sid: string, agent?: AgentKind) => void;
  /** Tâche à déplier dans l'onglet Todolist Claude (clic depuis la vue globale). */
  todoFocus?: string | null;
}) {
  const rt = project.runtime;
  const agents = useEnabledAgents();
  const hiddenAgentTab = (wanted === 'claude' || wanted === 'codex') && !agents.includes(wanted);
  const tab: PanelTab = (wanted === 'logs' && !project.serve) || (wanted === 'browser' && !webApps.length) || (wanted === 'readme' && !project.readme) || hiddenAgentTab ? 'console' : wanted;
  const toast = useToast();
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('.xterm') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs: Array<{ id: PanelTab; label: string; icon: React.ReactNode; badge?: number; hidden?: boolean }> = [
    { id: 'logs', label: t('projects.panel.tabs.logs'), icon: <ScrollText className="size-3.5" />, hidden: !project.serve },
    { id: 'browser', label: t('projects.panel.tabs.browser'), icon: <Globe className="size-3.5" />, hidden: !webApps.length },
    { id: 'console', label: t('projects.panel.tabs.console'), icon: <TerminalSquare className="size-3.5" />, badge: project.terminals.filter((t) => t.status === 'running').length },
    { id: 'claude', label: t('projects.panel.tabs.claude'), icon: <ClaudeIcon size={13} />, badge: project.claude.active || undefined, hidden: !agents.includes('claude') },
    { id: 'codex', label: t('codex.tab.label'), icon: <CodexIcon size={13} />, badge: project.codex?.active || undefined, hidden: !agents.includes('codex') },
    { id: 'readme', label: t('projects.panel.tabs.readme'), icon: <BookOpen className="size-3.5" />, hidden: !project.readme },
    { id: 'todolist', label: t('projects.panel.tabs.todolist'), icon: <ListChecks className="size-3.5" /> },
  ];

  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-line bg-panel">
      <header className="flex items-center gap-2.5 border-b border-line px-4 h-14 shrink-0">
        <TechIcon id={project.framework?.id ?? project.language.id} label={project.framework?.label ?? project.language.label} size={20} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{project.name}</span>
            {project.openIn && <Badge tone={project.openIn.via === 'exact' ? 'blue' : 'neutral'} title={project.openIn.path}><Code2 className="size-3" />{project.openIn.editorLabel}</Badge>}
            {project.serve && rt.status !== 'stopped' && <Badge tone={statusMeta[rt.status].tone}><StatusDot status={rt.status} />{t(STATUS_KEY[rt.status])}</Badge>}
          </div>
          <div className="font-mono text-[11px] text-faint truncate">{project.relPath}</div>
        </div>
        {rt.url && rt.status === 'running' && (
          <a href={rt.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-mono text-accent hover:underline">
            {rt.url.replace('http://', '')} <ExternalLink className="size-3" />
          </a>
        )}
        <IconButton title={t('projects.action.openVsCode')} onClick={() => api.open(project.dir, 'editor').catch((e) => toast('err', e.message))}><VsCodeIcon className="size-3.5" /></IconButton>
        <IconButton title={t('projects.action.openIde')} onClick={() => openInIde(project.id)}><Code2 className="size-4" /></IconButton>
        <IconButton title={t('projects.action.closeEsc')} onClick={onClose}><X className="size-4" /></IconButton>
      </header>

      {/* Onglets : défilent horizontalement quand le panneau est étroit, sans élargir la page. */}
      <nav className="ide-scroll flex shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-3">
        {tabs.filter((t) => !t.hidden).map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={cx(
              'relative inline-flex shrink-0 items-center gap-1.5 h-9 px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
              tab === t.id ? 'text-fg after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent' : 'text-muted hover:text-fg',
            )}
          >
            {t.icon}{t.label}
            {!!t.badge && <span className="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-600 dark:text-emerald-400">{t.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1">
        {tab === 'logs' && project.serve && <LogsView app={project} />}
        {tab === 'browser' && webApps.length > 0 && <BrowserView project={project} apps={webApps} />}
        {tab === 'console' && <ConsoleTab project={project} />}
        {tab === 'readme' && <ReadmeView project={project} />}
        {tab === 'claude' && <ProjectClaudeTab project={project} onOpenTab={(sid) => onOpenClaudeTab(sid, 'claude')} />}
        {tab === 'codex' && <ProjectClaudeTab agent="codex" project={project} onOpenTab={(sid) => onOpenClaudeTab(sid, 'codex')} />}
        {tab === 'todolist' && (
          <div className="h-full overflow-auto">
            {project.suiviId
              ? <Board suiviId={project.suiviId} appProjectId={project.id} focusTaskId={todoFocus} onOpenTerminal={onOpenClaudeTab} />
              : <CreateTodolist project={project} onOpenTab={onOpenClaudeTab} />}
          </div>
        )}
      </div>
    </aside>
  );
}

const GROUP_LABEL: Record<string, TKey> = {
  run: 'projects.panel.cmdGroup.run', dev: 'projects.panel.cmdGroup.dev', test: 'projects.panel.cmdGroup.test',
  deps: 'projects.panel.cmdGroup.deps', tool: 'projects.panel.cmdGroup.tool',
};

function ConsoleTab({ project }: { project: Project }) {
  const toast = useToast();
  const t = useT();
  const sessions = project.terminals;
  const [active, setActive] = useState<string | null>(sessions.at(-1)?.id ?? null);
  const [commandId, setCommandId] = useState(project.defaultCommand ?? project.commands[0]?.id ?? '');

  // Session ouverte ailleurs (ex. bouton Android de la liste) → on l'affiche.
  const known = useRef(new Set(sessions.map((s) => s.id)));
  useEffect(() => {
    const fresh = sessions.filter((s) => !known.current.has(s.id));
    for (const s of sessions) known.current.add(s.id);
    if (fresh.length) setActive(fresh.at(-1)!.id);
  }, [sessions]);

  // Session active supprimée → on bascule sur la dernière restante.
  useEffect(() => {
    if (!sessions.some((s) => s.id === active)) setActive(sessions.at(-1)?.id ?? null);
  }, [sessions, active]);

  const open = useMutation({
    mutationFn: (body: { commandId?: string; shell?: boolean }) => api.openTerminal(project.id, body),
    onSuccess: (s) => setActive(s.id),
    onError: (e: Error) => toast('err', e.message),
  });

  const groups = Object.entries(
    project.commands.reduce<Record<string, typeof project.commands>>((acc, c) => ((acc[c.group ?? 'dev'] ??= []).push(c), acc), {}),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 shrink-0">
        {project.commands.length > 0 && (
          <>
            <select
              value={commandId}
              onChange={(e) => setCommandId(e.target.value)}
              className="h-7 max-w-[240px] rounded-md border border-line bg-panel-2 px-2 text-xs outline-none focus:border-accent"
            >
              {groups.map(([g, cmds]) => (
                <optgroup key={g} label={GROUP_LABEL[g] ? t(GROUP_LABEL[g]) : g}>
                  {cmds.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
              ))}
            </select>
            <Button size="sm" variant="primary" icon={<Play className="size-3 fill-current" />} loading={open.isPending && !open.variables?.shell} onClick={() => open.mutate({ commandId })}>
              {t('projects.action.execute')}
            </Button>
          </>
        )}
        <Button size="sm" icon={<SquareTerminal className="size-3.5" />} loading={open.isPending && !!open.variables?.shell} onClick={() => open.mutate({ shell: true })}>
          {t('projects.panel.shell')}{project.hasVenv ? ' (venv)' : ''}
        </Button>
        <CommandMenu project={project} kind="git" onStarted={(s) => setActive(s.id)} />
        <CommandMenu project={project} kind="supabase" onStarted={(s) => setActive(s.id)} />
        {project.commands.find((c) => c.id === commandId) && (
          <span className="ml-1 truncate font-mono text-[11px] text-faint" title={project.commands.find((c) => c.id === commandId)!.cmd}>
            $ {project.commands.find((c) => c.id === commandId)!.cmd}
          </span>
        )}
      </div>

      {sessions.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-[#0a0c10] px-2 py-1 shrink-0">
          {sessions.map((s) => <SessionChip key={s.id} s={s} active={s.id === active} onSelect={() => setActive(s.id)} />)}
        </div>
      )}

      <div className="min-h-0 flex-1 bg-[#0a0c10]">
        {sessions.length === 0 ? (
          <div className="h-full grid place-items-center">
            <Empty icon={<TerminalSquare className="size-8" />} title={t('projects.panel.noConsole')}>
              {t.node('projects.panel.noConsoleHint', { path: <span className="font-mono">{project.relPath}</span> })}
            </Empty>
          </div>
        ) : (
          sessions.map((s) => <TerminalView key={s.id} sid={s.id} active={s.id === active} />)
        )}
      </div>
    </div>
  );
}

function SessionChip({ s, active, onSelect }: { s: TerminalSession; active: boolean; onSelect: () => void }) {
  const toast = useToast();
  const t = useT();
  const running = s.status === 'running';
  return (
    <div
      onClick={onSelect}
      className={cx(
        'group inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 h-6 text-[11px] font-mono',
        active ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5',
      )}
    >
      <span className={cx('size-1.5 rounded-full', running ? 'bg-emerald-400' : s.exitCode === 0 ? 'bg-zinc-500' : 'bg-red-400')} />
      <span className="max-w-40 truncate">{s.label}</span>
      {!running && s.exitCode !== 0 && s.exitCode !== null && <span className="text-red-400">({s.exitCode})</span>}
      {running && (
        <button title={t('projects.panel.kill')} onClick={(e) => (e.stopPropagation(), api.killTerminal(s.id).catch((err) => toast('err', err.message)))} className="opacity-0 group-hover:opacity-100 hover:text-red-400">
          <Skull className="size-3" />
        </button>
      )}
      <button title={t('projects.action.close')} onClick={(e) => (e.stopPropagation(), api.closeTerminal(s.id).catch((err) => toast('err', err.message)))} className="opacity-60 hover:opacity-100 hover:text-zinc-100">
        <X className="size-3" />
      </button>
    </div>
  );
}

/** Projet sans suivi : une session Claude avec `/suivi init` crée la Todolist (thème, artefact, import des sessions). */
function CreateTodolist({ project, onOpenTab }: { project: Project; onOpenTab: (sid: string, agent?: AgentKind) => void }) {
  const toast = useToast();
  const t = useT();
  // Claude décoché : la Todolist est créée par Codex (skill $suivi).
  const viaCodex = !useEnabledAgents().includes('claude');
  const init = useMutation({
    mutationFn: () => (viaCodex ? api.openCodex(project.id, undefined, '$suivi init') : api.openClaude(project.id, undefined, '/suivi init')),
    onSuccess: (s) => onOpenTab(s.id, viaCodex ? 'codex' : 'claude'),
    onError: (e: Error) => toast('err', e.message),
  });
  return (
    <div className="grid h-full place-items-center p-6">
      <Empty icon={<ListChecks className="size-8" />} title={t('projects.panel.todo.none')}>
        <p className="mb-3">
          {t.node('projects.panel.todo.intro', {
            name: <b>{project.name}</b>,
            source: project.claude.count ? t('projects.panel.todo.fromSessions', { count: project.claude.count }) : t('projects.panel.todo.fromNext'),
          })}
        </p>
        <Button variant="primary" icon={<ListChecks className="size-3.5" />} loading={init.isPending} onClick={() => init.mutate()}>
          {t('projects.panel.todo.create')}
        </Button>
      </Empty>
    </div>
  );
}
