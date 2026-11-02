import { useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQueries } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, ListChecks, Search, Star } from 'lucide-react';
import { api, type Project, type SuiviProjectSummary, type SuiviTask } from '../api';
import { Board, WHO, fmtMin, isToTest, useAppDark } from '../todolist/Board';
import { compareText, useT } from '../i18n';
import { Badge, Button, Card, Empty, cx, timeAgo, useToast } from '../ui';

type Sort = 'activity' | 'progress' | 'name';
type StatusFilter = 'all' | 'todo' | 'totest' | 'done';
type WhoFilter = 'all' | 'toi' | 'ensemble' | 'claude';

/** Couleur primaire du projet (variante claire ou sombre selon le thème de Tarmac). */
const primaryOf = (p: SuiviProjectSummary, dark: boolean) => (dark ? p.theme.dark : p.theme.light);

/** Vue globale : une carte par projet, « À tester » et « Prochaines étapes » tous projets confondus. */
export function TodolistView({ summaries, projects, query, onOpenTask, onOpenTerminal }: {
  summaries: SuiviProjectSummary[] | undefined;
  projects: Project[];
  query: string;
  /** Ouvre l'onglet Todolist Claude du projet, tâche dépliée si `taskId`. */
  onOpenTask: (suiviId: string, taskId?: string) => boolean;
  onOpenTerminal: (sid: string) => void;
}) {
  const tr = useT();
  const dark = useAppDark();
  const toast = useToast();
  const [sort, setSort] = useState<Sort>('activity');
  const [projectF, setProjectF] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [who, setWho] = useState<WhoFilter>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [search, setSearch] = useState('');
  const text = (search || query).trim().toLowerCase();
  // Suivi sans projet scanné (dossier sans package.json…) : affiché ici plutôt que dans le panneau d'un projet.
  const [inline, setInline] = useState<{ id: string; task?: string } | null>(null);
  const open = (id: string, task?: string) => { if (!onOpenTask(id, task)) setInline({ id, task }); };

  const list = summaries ?? [];
  const details = useQueries({ queries: list.map((p) => ({ queryKey: ['suivi', p.projectId], queryFn: () => api.suivi(p.projectId) })) });
  const tasksOf = (id: string) => details[list.findIndex((p) => p.projectId === id)]?.data?.tasks ?? [];
  const isFav = (p: SuiviProjectSummary) => projects.some((x) => x.favorite && p.paths.includes(x.dir));

  const shownProjects = useMemo(() => {
    const ps = list.filter((p) => (projectF === 'all' || p.projectId === projectF) && (!favOnly || isFav(p)));
    const act = (p: SuiviProjectSummary) => p.counts.lastActivity ?? p.updatedAt;
    return ps.sort((a, b) => (sort === 'name' ? compareText(a.name, b.name) : sort === 'progress' ? b.counts.pct - a.counts.pct : act(b).localeCompare(act(a))));
  }, [list, projectF, favOnly, sort, projects, tr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recherche et filtres de tâches : liste à plat, tous projets.
  const taskFilterOn = !!text || status !== 'all' || who !== 'all';
  const matches = (t: SuiviTask) =>
    (status === 'all' || (status === 'totest' ? isToTest(t) : status === 'todo' ? !t.done && !isToTest(t) : t.done)) &&
    (who === 'all' || t.who === who) &&
    (!text || [t.title, t.why, t.note, ...t.steps].join('\n').toLowerCase().includes(text));
  const found = taskFilterOn ? shownProjects.flatMap((p) => tasksOf(p.projectId).filter(matches).map((t) => ({ p, t }))) : [];
  const toTest = shownProjects.flatMap((p) => tasksOf(p.projectId).filter(isToTest).map((t) => ({ p, t })));
  const nexts = shownProjects.filter((p) => p.counts.next).map((p) => ({ p, n: p.counts.next! }));

  // D4 : projets avec au moins une session Claude et sans Todolist.
  const withoutTodolist = projects.filter((x) => !x.suiviId && x.claude.count > 0)
    .sort((a, b) => (b.claude.lastAt ?? '').localeCompare(a.claude.lastAt ?? ''));
  const init = useMutation({
    mutationFn: (id: string) => api.openClaude(id, undefined, '/suivi init'),
    onSuccess: (s) => onOpenTerminal(s.id),
    onError: (e: Error) => toast('err', e.message),
  });

  const TaskLine = ({ p, t }: { p: SuiviProjectSummary; t: SuiviTask }) => {
    const c = primaryOf(p, dark);
    return (
      <button type="button" onClick={() => open(p.projectId, t.id)} className="flex w-full items-start gap-2.5 px-4 py-2 text-left hover:bg-panel-2">
        <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold" style={{ background: c.primarySoft, color: c.primaryText }}>{t.num}</span>
        <span className="min-w-0 flex-1">
          <span className={cx('line-clamp-2 text-[13px]', t.done && 'text-faint line-through')}>{t.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span className="font-semibold" style={{ color: c.primary }}>{p.name}</span>
            <span>{WHO[t.who] ? tr(WHO[t.who]) : t.who}</span>
            {t.minutes > 0 && <span>{fmtMin(t.minutes)}</span>}
            {isToTest(t) && <Badge tone="amber">{tr('todolist.status.totest')}</Badge>}
          </span>
        </span>
      </button>
    );
  };

  if (!summaries) return <div className="p-8 text-sm text-muted">{tr('todolist.view.loading')}</div>;
  if (inline) {
    return (
      <div className="min-h-full">
        <div className="px-6 pt-4">
          <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={() => setInline(null)}>{tr('todolist.view.allProjects')}</Button>
        </div>
        <Board suiviId={inline.id} focusTaskId={inline.task} onOpenTerminal={onOpenTerminal} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto text-[13px] text-muted">{tr('todolist.view.count', { count: list.length })}</div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('todolist.view.search')}
            className="h-8 w-64 rounded-md border border-line bg-panel pl-8 pr-2 text-xs outline-none focus:border-accent" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={projectF} onChange={(e) => setProjectF(e.target.value)} className="h-7 rounded-md border border-line bg-panel px-2 outline-none">
          <option value="all">{tr('todolist.view.allProjects')}</option>
          {list.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-7 rounded-md border border-line bg-panel px-2 outline-none">
          <option value="all">{tr('todolist.view.allStatuses')}</option>
          {(['todo', 'totest', 'done'] as const).map((v) => <option key={v} value={v}>{tr(`todolist.status.${v}`)}</option>)}
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value as WhoFilter)} className="h-7 rounded-md border border-line bg-panel px-2 outline-none">
          {(['all', 'toi', 'ensemble', 'claude'] as const).map((v) => <option key={v} value={v}>{tr(`todolist.who.${v}`)}</option>)}
        </select>
        <button type="button" onClick={() => setFavOnly(!favOnly)} className={cx('inline-flex h-7 items-center gap-1 rounded-md border px-2', favOnly ? 'border-amber-400 text-amber-500' : 'border-line text-muted')}>
          <Star className={cx('size-3.5', favOnly && 'fill-current')} /> {tr('todolist.view.favorites')}
        </button>
        <div className="ml-auto flex items-center gap-1 text-muted">
          {tr('todolist.view.sort')}
          {([['activity', 'todolist.view.sortActivity'], ['progress', 'todolist.view.sortProgress'], ['name', 'todolist.view.sortName']] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setSort(v)} className={cx('rounded px-2 py-1', sort === v ? 'bg-panel-2 text-fg' : 'hover:text-fg')}>{tr(l)}</button>
          ))}
        </div>
      </div>

      {taskFilterOn && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2 text-[12px] font-semibold text-muted">{tr('todolist.view.found', { count: found.length })}</div>
          <div className="max-h-[420px] overflow-auto py-1">
            {found.slice(0, 300).map(({ p, t }) => <TaskLine key={p.projectId + t.id} p={p} t={t} />)}
            {found.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-faint">{tr('todolist.view.noMatch')}</div>}
          </div>
        </Card>
      )}

      {list.length === 0 ? (
        <Empty icon={<ListChecks className="size-8" />} title={tr('todolist.view.emptyTitle')}>
          {tr.node('todolist.view.emptyHint', { cmd: <code>/suivi init</code> })}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shownProjects.map((p) => {
            const c = primaryOf(p, dark);
            const last = [...p.syncs].sort((a, b) => b.at.localeCompare(a.at))[0];
            return (
              <div key={p.projectId} role="button" tabIndex={0} onClick={() => open(p.projectId)} onKeyDown={(e) => e.key === 'Enter' && open(p.projectId)}
                className="cursor-pointer overflow-hidden rounded-xl border border-line bg-panel shadow-xs transition-shadow hover:shadow-md"
                style={{ borderTop: `4px solid ${c.primary}` } as CSSProperties}>
                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-extrabold tracking-[.25em]" style={{ color: c.primary }}>{p.brand}</span>
                    {isFav(p) && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
                    {p.artifactUrl && (
                      <a href={p.artifactUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg" title={tr('todolist.view.openArtifactTitle')}>
                        {tr('todolist.view.artifact')} <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-2xl font-bold tabular-nums">{p.counts.pct} %</span>
                    <span className="text-[12px] text-muted tabular-nums">{tr('todolist.view.doneOf', { done: p.counts.done, total: p.counts.total })}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full" style={{ width: `${p.counts.pct}%`, background: c.primary }} /></div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {p.counts.toTest > 0 && <Badge tone="amber">{tr('todolist.toTestCount', { n: p.counts.toTest })}</Badge>}
                    <Badge>{tr('todolist.view.left', { time: fmtMin(p.counts.minutesLeft) || tr('todolist.time.min', { n: 0 }) })}</Badge>
                  </div>
                  {p.counts.next && (
                    <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: c.primarySoft }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: c.primaryText }}>{tr('todolist.next')}</div>
                      <div className="line-clamp-2 font-medium">{p.counts.next.num} · {p.counts.next.title}</div>
                    </div>
                  )}
                  <div className="flex justify-between text-[11px] text-faint">
                    <span>{p.counts.lastActivity ? tr('todolist.view.activity', { ago: timeAgo(p.counts.lastActivity) }) : tr('todolist.view.noActivity')}</span>
                    <span title={last?.result}>{last ? tr('todolist.view.synced', { ago: timeAgo(last.at) }) : tr('todolist.view.neverSynced')}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {list.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">{tr('todolist.status.totest')} <span className="text-muted">· {toTest.length}</span></div>
            <div className="max-h-[360px] overflow-auto py-1">
              {toTest.map(({ p, t }) => <TaskLine key={p.projectId + t.id} p={p} t={t} />)}
              {toTest.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-faint">{tr('todolist.view.nothingToTest')}</div>}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">{tr('todolist.view.nextSteps')}</div>
            <div className="py-1">
              {nexts.map(({ p, n }) => {
                const t = tasksOf(p.projectId).find((x) => x.id === n.id);
                return t ? <TaskLine key={p.projectId} p={p} t={t} /> : null;
              })}
            </div>
          </Card>
        </div>
      )}

      {withoutTodolist.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">{tr('todolist.view.withoutTitle')} <span className="text-muted">{tr('todolist.view.withoutSub')}</span></div>
          <div className="divide-y divide-line">
            {withoutTodolist.map((x) => (
              <div key={x.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
                <span className="text-[11px] text-muted">{tr('todolist.view.sessions', { count: x.claude.count })}{x.claude.lastAt ? ` · ${timeAgo(x.claude.lastAt)}` : ''}</span>
                <Button size="sm" icon={<ListChecks className="size-3.5" />} loading={init.isPending && init.variables === x.id} onClick={() => init.mutate(x.id)}>{tr('todolist.view.create')}</Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
