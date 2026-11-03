import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronRight, ChevronsDownUp, ChevronsUpDown, Container, Cpu, Database, ExternalLink, FolderGit2, HardDrive, Layers, Loader2, MemoryStick, Network, Play, PlugZap, RotateCw, Square } from 'lucide-react';
import { api, type DockerAction, type DockerContainer, type DockerOverview, type DockerStats } from '../api';
import { Badge, Button, Card, Empty, IconButton, cx, timeAgo, useToast } from '../ui';
import { fmtBytes, fmtDateTime, fmtNumber } from '../i18n/format';
import { useT } from '../i18n';

/** Rafraîchissement léger, seulement quand la vue est affichée (requêtes montées avec elle). */
const POLL_MS = 5_000;

const appLabel = (app: DockerOverview['engine']['app']) => (app === 'OrbStack' ? 'OrbStack' : 'Docker Desktop');
const pct = (n: number) => `${fmtNumber(n, { maximumFractionDigits: n < 10 ? 1 : 0 })} %`;

type Target = { id: string; name: string } | { group: string; name: string };

// ─── Repli des groupes (persistant, replié par défaut : l'en-tête porte le récapitulatif) ────────────────
const COLLAPSE_KEY = 'docker:collapsed';
const groupKey = (group: string | null) => group ?? '__standalone__';
function useCollapsed() {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}'); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ } }, [state]);
  return {
    isCollapsed: (key: string) => state[key] ?? true,
    toggle: (key: string) => setState((s) => ({ ...s, [key]: !(s[key] ?? true) })),
    setAll: (keys: string[], v: boolean) => setState((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, v])) })),
  };
}

/** Somme des stats des conteneurs en cours d'un groupe (null tant qu'aucune stat n'est arrivée). */
function sumStats(list: DockerStats[]) {
  if (!list.length) return null;
  const add = (f: (s: DockerStats) => number | null | undefined) => list.reduce((a, s) => a + (f(s) ?? 0), 0);
  return { cpu: add((s) => s.cpu), mem: add((s) => s.memUsed), netRx: add((s) => s.netRx), netTx: add((s) => s.netTx), blkRead: add((s) => s.blkRead), blkWrite: add((s) => s.blkWrite) };
}

export function DockerView({ query, onOpenProject }: { query: string; onOpenProject: (id: string) => void }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const collapse = useCollapsed();
  const overview = useQuery({ queryKey: ['docker'], queryFn: api.docker, refetchInterval: POLL_MS });
  const ok = overview.data?.engine.status === 'ok';
  const running = overview.data?.containers.some((c) => c.state === 'running') ?? false;
  const statsQ = useQuery({ queryKey: ['docker', 'stats'], queryFn: api.dockerStats, refetchInterval: POLL_MS, enabled: ok && running });
  const stats = useMemo(() => new Map((statsQ.data ?? []).map((s) => [s.id, s])), [statsQ.data]);

  const act = useMutation({
    mutationFn: ({ target, action }: { target: Target; action: DockerAction }) =>
      'id' in target ? api.dockerAction(target.id, action) : api.dockerGroupAction(target.group, action),
    onSuccess: (_r, { target, action }) => {
      toast('ok', t(`docker.done.${action}`, { name: target.name }));
      qc.invalidateQueries({ queryKey: ['docker'] });
      qc.invalidateQueries({ queryKey: ['supabase'] });
    },
    onError: (e: Error) => toast('err', e.message),
  });
  const run = (target: Target, action: DockerAction, count = 1) => {
    if (action !== 'start') {
      const key = 'id' in target ? (`docker.confirm.${action}` as const) : (`docker.confirm.${action}Group` as const);
      if (!confirm(t(key, { name: target.name, group: target.name, count }))) return;
    }
    act.mutate({ target, action });
  };
  const pendingFor = (target: Target) => act.isPending && JSON.stringify(act.variables?.target) === JSON.stringify(target);

  const openApp = useMutation({
    mutationFn: api.dockerOpen,
    onSuccess: () => toast('ok', t('docker.opened', { app: appLabel(overview.data?.engine.app ?? null) })),
    onError: (e: Error) => toast('err', e.message),
  });

  const data = overview.data;
  if (!data) {
    return overview.error ? <Card><Empty icon={<PlugZap className="size-8" />} title={t('docker.engine.error.title')}>{(overview.error as Error).message}</Empty></Card> : null;
  }

  const openButton = data.engine.app && (
    <Button icon={<ExternalLink className="size-3.5" />} loading={openApp.isPending} onClick={() => openApp.mutate()}>
      {t('docker.open', { app: appLabel(data.engine.app) })}
    </Button>
  );

  if (data.engine.status !== 'ok') {
    const s = data.engine.status;
    return (
      <Card>
        <Empty icon={<PlugZap className="size-8" />} title={t(s === 'absent' ? 'docker.engine.absent.title' : s === 'stopped' ? 'docker.engine.stopped.title' : 'docker.engine.error.title')}>
          <div className="space-y-3">
            <div>{s === 'error' ? data.engine.error : t(s === 'absent' ? 'docker.engine.absent.hint' : 'docker.engine.stopped.hint')}</div>
            {openButton && <div>{openButton}</div>}
          </div>
        </Empty>
      </Card>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = data.containers.filter((c) => !q || [c.name, c.image, c.group ?? '', c.project?.name ?? ''].some((x) => x.toLowerCase().includes(q)));
  const groups = new Map<string | null, DockerContainer[]>();
  for (const c of visible) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  // Groupes compose d'abord (ordre du serveur), conteneurs isolés à la fin.
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === null ? 1 : 0) - (b === null ? 1 : 0));

  const live = data.containers.filter((c) => c.state === 'running');
  const allStats = live.map((c) => stats.get(c.id)).filter((s): s is DockerStats => !!s);
  const cpu = allStats.reduce((a, s) => a + (s.cpu ?? 0), 0);
  const mem = allStats.reduce((a, s) => a + s.memUsed, 0);
  const statsReady = live.length === 0 || allStats.length > 0;

  return (
    <div className="space-y-4">
      {/* Moteur et totaux */}
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-500"><Container className="size-[18px]" /></div>
          <div className="min-w-0 leading-tight">
            <div className="font-semibold truncate">{data.engine.name}</div>
            <div className="text-[11px] text-faint font-mono">Engine {data.engine.version}</div>
          </div>
        </div>
        <Total label={t('docker.totals.active')} value={`${live.length} / ${data.containers.length}`} />
        <Total label={t('docker.totals.cpu')} value={statsReady ? pct(cpu) : '…'} sub={data.engine.cpus ? t('docker.totals.cores', { count: data.engine.cpus }) : undefined} />
        <Total label={t('docker.totals.memory')} value={statsReady ? fmtBytes(mem) : '…'} sub={data.engine.memTotal ? t('docker.totals.of', { total: fmtBytes(data.engine.memTotal) }) : undefined} />
        {data.images && <Total label={t('docker.totals.images')} value={String(data.images.count)} sub={fmtBytes(data.images.size)} />}
        {data.volumes && <Total label={t('docker.totals.volumes')} value={String(data.volumes.count)} sub={data.volumes.size != null ? fmtBytes(data.volumes.size) : undefined} />}
        <div className="flex-1" />
        {data.containers.length > 0 && (
          <div className="flex items-center gap-0.5">
            <IconButton title={t('docker.expandAll')} onClick={() => collapse.setAll(ordered.map(([g]) => groupKey(g)), false)}><ChevronsUpDown className="size-4" /></IconButton>
            <IconButton title={t('docker.collapseAll')} onClick={() => collapse.setAll(ordered.map(([g]) => groupKey(g)), true)}><ChevronsDownUp className="size-4" /></IconButton>
          </div>
        )}
        {openButton}
      </Card>

      {data.containers.length === 0 ? (
        <Card>
          <Empty icon={<Container className="size-8" />} title={t('docker.empty.title')}>
            {t.node('docker.empty.hint', { cmd: <code className="font-mono">docker run</code>, compose: <code className="font-mono">docker compose up</code> })}
          </Empty>
        </Card>
      ) : visible.length === 0 ? (
        <Card><div className="px-4 py-6 text-center text-[13px] text-faint">{t('docker.noMatch')}</div></Card>
      ) : (
        ordered.map(([group, list]) => {
          const up = list.filter((c) => c.state === 'running').length;
          const target: Target = group ? { group, name: group } : { group: '', name: '' };
          const project = group ? list.find((c) => c.project)?.project ?? null : null;
          const supabase = list.some((c) => c.supabaseProject);
          const key = groupKey(group);
          // Une recherche en cours déplie tout : les conteneurs trouvés restent visibles.
          const open = !!q || !collapse.isCollapsed(key);
          const sum = sumStats(list.filter((c) => c.state === 'running').map((c) => stats.get(c.id)).filter((x): x is DockerStats => !!x));
          return (
            <Card key={key} className="overflow-hidden">
              <div className={cx('flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-4 py-2.5', open && 'border-b border-line')}>
                <button onClick={() => collapse.toggle(key)} aria-expanded={open} title={t(open ? 'docker.group.collapse' : 'docker.group.expand')}
                  className="-ml-1 flex min-w-0 items-center gap-2 rounded px-1 py-0.5 hover:bg-panel-2">
                  <ChevronRight className={cx('size-4 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
                  {supabase ? <Database className="size-4 shrink-0 text-emerald-500" /> : <Layers className="size-4 shrink-0 text-faint" />}
                  <span className="font-semibold truncate">{group ?? t('docker.group.standalone')}</span>
                </button>
                {supabase && <Badge tone="green">{t('docker.group.supabase')}</Badge>}
                {project && <ProjectLink project={project} onOpen={onOpenProject} />}
                <span className="text-[11px] text-faint tabular-nums">{t('docker.group.running', { running: up, total: list.length })}</span>
                <div className="flex-1" />
                {up > 0 && <GroupSummary sum={sum} />}
                {group && (
                  <div className="flex items-center gap-0.5">
                    {pendingFor(target) && <Loader2 className="mr-1 size-3.5 animate-spin text-faint" />}
                    {up < list.length && <IconButton title={t('docker.action.startAll')} disabled={act.isPending} onClick={() => run(target, 'start')}><Play className="size-3.5" /></IconButton>}
                    {up > 0 && <IconButton title={t('docker.action.restartAll')} disabled={act.isPending} onClick={() => run(target, 'restart', up)}><RotateCw className="size-3.5" /></IconButton>}
                    {up > 0 && <IconButton title={t('docker.action.stopAll')} disabled={act.isPending} onClick={() => run(target, 'stop', up)}><Square className="size-3.5" /></IconButton>}
                  </div>
                )}
              </div>
              {open && <div className="overflow-x-auto">
                <table className="w-full min-w-[1020px] table-fixed text-[12px]">
                  <colgroup>
                    <col />
                    <col className="w-[132px]" />
                    <col className="w-[124px]" />
                    <col className="w-[150px]" />
                    <col className="w-[64px]" />
                    <col className="w-[128px]" />
                    <col className="w-[112px]" />
                    <col className="w-[112px]" />
                    <col className="w-[76px]" />
                  </colgroup>
                  <thead>
                    <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-faint">
                      <th className="px-4 pt-2 pb-1 font-semibold">{t('docker.col.container')}</th>
                      <th className="px-2 pt-2 pb-1 font-semibold">{t('docker.col.state')}</th>
                      <th className="px-2 pt-2 pb-1 font-semibold">{t('docker.col.since')}</th>
                      <th className="px-2 pt-2 pb-1 font-semibold">{t('docker.col.ports')}</th>
                      <th className="px-2 pt-2 pb-1 font-semibold text-right">{t('docker.col.cpu')}</th>
                      <th className="px-2 pt-2 pb-1 font-semibold">{t('docker.col.memory')}</th>
                      <th className="px-2 pt-2 pb-1 font-semibold">{t('docker.col.network')}</th>
                      <th className="px-2 pt-2 pb-1 font-semibold">{t('docker.col.disk')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.map((c) => (
                      <Row key={c.id} c={c} s={stats.get(c.id)} memTotal={data.engine.memTotal} showProject={!group || (!!c.project && c.project.id !== project?.id)}
                        onOpenProject={onOpenProject} pending={pendingFor({ id: c.id, name: c.name })} busy={act.isPending}
                        onAction={(a) => run({ id: c.id, name: c.name }, a)} />
                    ))}
                  </tbody>
                </table>
              </div>}
            </Card>
          );
        })
      )}
    </div>
  );
}

/** Récapitulatif d'un groupe : CPU, mémoire, réseau (↓ reçu ↑ envoyé) et disque (↓ lu ↑ écrit) cumulés. */
function GroupSummary({ sum }: { sum: ReturnType<typeof sumStats> }) {
  const t = useT();
  const item = (icon: React.ReactNode, title: string, value: React.ReactNode) => (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap">{icon}{value}</span>
  );
  if (!sum) return <span className="text-[11px] text-faint">…</span>;
  const io = (a: number, b: number) => <><ArrowDown className="size-3 text-faint" />{fmtBytes(a)}<ArrowUp className="ml-0.5 size-3 text-faint" />{fmtBytes(b)}</>;
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] tabular-nums text-muted">
      {item(<Cpu className="size-3.5 text-faint" />, t('docker.col.cpu'), pct(sum.cpu))}
      {item(<MemoryStick className="size-3.5 text-faint" />, t('docker.col.memory'), fmtBytes(sum.mem))}
      {item(<Network className="size-3.5 text-faint" />, t('docker.net.title', { rx: fmtBytes(sum.netRx), tx: fmtBytes(sum.netTx) }), io(sum.netRx, sum.netTx))}
      {item(<HardDrive className="size-3.5 text-faint" />, t('docker.disk.title', { read: fmtBytes(sum.blkRead), write: fmtBytes(sum.blkWrite) }), io(sum.blkRead, sum.blkWrite))}
    </div>
  );
}

function Total({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold tabular-nums">{value}</span>
        {sub && <span className="text-[11px] text-faint">{sub}</span>}
      </div>
    </div>
  );
}

function ProjectLink({ project, onOpen }: { project: { id: string; name: string }; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <button onClick={() => onOpen(project.id)} title={t('docker.project.open', { name: project.name })}
      className="inline-flex h-5 max-w-[220px] items-center gap-1 rounded border border-sky-500/20 bg-sky-500/10 px-1.5 text-[11px] font-medium text-sky-700 hover:bg-sky-500/20 dark:text-sky-400">
      <FolderGit2 className="size-3 shrink-0" /><span className="truncate">{project.name}</span>
    </button>
  );
}

function StateBadge({ c }: { c: DockerContainer }) {
  const t = useT();
  const s = c.state;
  const tone = s === 'running' ? 'green' : s === 'restarting' || s === 'paused' ? 'amber' : s === 'dead' || (s === 'exited' && c.exitCode) ? 'red' : 'neutral';
  const label = s === 'exited' && c.exitCode ? t('docker.state.exitedCode', { code: c.exitCode })
    : (['running', 'exited', 'restarting', 'paused', 'created', 'dead'] as const).includes(s as never) ? t(`docker.state.${s as 'running'}`) : s;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge tone={tone} title={c.status}>{label}</Badge>
      {c.health && (
        <span title={t('docker.health.title', { health: t(`docker.health.${c.health}`) })}
          className={cx('text-[10px] font-medium', c.health === 'healthy' ? 'text-emerald-600 dark:text-emerald-400' : c.health === 'unhealthy' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
          {t(`docker.health.${c.health}`)}
        </span>
      )}
    </div>
  );
}

function Row({ c, s, memTotal, showProject, onOpenProject, pending, busy, onAction }: {
  c: DockerContainer; s: DockerStats | undefined; memTotal: number | null; showProject: boolean; onOpenProject: (id: string) => void;
  pending: boolean; busy: boolean; onAction: (a: DockerAction) => void;
}) {
  const t = useT();
  const on = c.state === 'running';
  const dash = <span className="text-faint">—</span>;
  const wait = <span className="text-faint">…</span>;
  // Sans limite, le moteur renvoie la mémoire de sa VM : affichée telle quelle, avec une infobulle.
  const noLimit = !!s && !!memTotal && s.memLimit >= memTotal;
  return (
    <tr className={cx('align-middle', !on && 'text-muted')}>
      <td className="px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cx('size-1.5 shrink-0 rounded-full', on ? 'bg-emerald-500' : c.state === 'exited' && c.exitCode ? 'bg-red-500' : 'bg-faint')} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium text-fg" title={c.name}>{c.name}</span>
              {showProject && c.project && <ProjectLink project={c.project} onOpen={onOpenProject} />}
            </div>
            <div className="truncate font-mono text-[11px] text-faint" title={c.image}>{c.image}</div>
          </div>
        </div>
      </td>
      <td className="px-2 py-2"><StateBadge c={c} /></td>
      <td className="whitespace-nowrap truncate px-2 py-2 text-faint" title={c.since ? fmtDateTime(c.since) : undefined}>{c.since ? timeAgo(c.since) : '—'}</td>
      <td className="px-2 py-2">
        {c.ports.length ? (
          <div className="flex flex-wrap gap-1">
            {c.ports.map((p) => p.http ? (
              <a key={`${p.public}/${p.type}`} href={`http://localhost:${p.public}`} target="_blank" rel="noreferrer"
                title={`${t('docker.port.open', { port: p.public })}\n${t('docker.port.map', { public: p.public, private: p.private, type: p.type })}`}
                className="inline-flex h-5 items-center gap-0.5 rounded bg-accent/10 px-1.5 font-mono text-[11px] text-accent hover:bg-accent/20">
                :{p.public}<ExternalLink className="size-2.5" />
              </a>
            ) : (
              <span key={`${p.public}/${p.type}`} title={t('docker.port.map', { public: p.public, private: p.private, type: p.type })}
                className="inline-flex h-5 items-center rounded bg-panel-2 px-1.5 font-mono text-[11px] text-muted">:{p.public}</span>
            ))}
          </div>
        ) : dash}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{!on ? dash : !s ? wait : s.cpu == null ? wait : pct(s.cpu)}</td>
      <td className="px-2 py-2 tabular-nums">
        {!on ? dash : !s ? wait : (
          <div title={noLimit ? t('docker.mem.noLimit') : undefined}>
            <div className="flex items-baseline gap-1 whitespace-nowrap">
              <span>{fmtBytes(s.memUsed)}</span>
              {s.memLimit > 0 && <span className="text-[10px] text-faint">/ {fmtBytes(s.memLimit)}</span>}
            </div>
            {s.memLimit > 0 && (
              <div className="mt-1 h-1 w-full max-w-[96px] overflow-hidden rounded bg-panel-2">
                <div className={cx('h-full rounded', s.memUsed / s.memLimit > 0.85 ? 'bg-red-500' : 'bg-sky-500')} style={{ width: `${Math.min(100, (s.memUsed / s.memLimit) * 100)}%` }} />
              </div>
            )}
          </div>
        )}
      </td>
      <td className="px-2 py-2 tabular-nums">
        {!on ? dash : !s ? wait : s.netRx == null ? dash : (
          <IO a={s.netRx} b={s.netTx ?? 0} title={t('docker.net.title', { rx: fmtBytes(s.netRx), tx: fmtBytes(s.netTx ?? 0) })} />
        )}
      </td>
      <td className="px-2 py-2 tabular-nums">
        {!on ? dash : !s ? wait : s.blkRead == null ? dash : (
          <IO a={s.blkRead} b={s.blkWrite ?? 0} title={t('docker.disk.title', { read: fmtBytes(s.blkRead), write: fmtBytes(s.blkWrite ?? 0) })} />
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-end gap-0.5">
          {pending && <Loader2 className="size-3.5 animate-spin text-faint" />}
          {on ? (
            <>
              <IconButton title={t('docker.action.restart')} disabled={busy} onClick={() => onAction('restart')}><RotateCw className="size-3.5" /></IconButton>
              <IconButton title={t('docker.action.stop')} disabled={busy} onClick={() => onAction('stop')}><Square className="size-3.5" /></IconButton>
            </>
          ) : (
            <IconButton title={t('docker.action.start')} disabled={busy} onClick={() => onAction('start')}><Play className="size-3.5" /></IconButton>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Entrées / sorties cumulées : ↓ reçu ou lu, ↑ envoyé ou écrit. */
function IO({ a, b, title }: { a: number; b: number; title: string }) {
  return (
    <div title={title} className="space-y-0.5 text-[11px] leading-tight">
      <div className="flex items-center gap-1 whitespace-nowrap"><ArrowDown className="size-3 text-faint" />{fmtBytes(a)}</div>
      <div className="flex items-center gap-1 whitespace-nowrap"><ArrowUp className="size-3 text-faint" />{fmtBytes(b)}</div>
    </div>
  );
}
