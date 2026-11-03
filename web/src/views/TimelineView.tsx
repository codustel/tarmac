import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpFromLine, CircleCheck, FlaskConical, GitCommitHorizontal, ListPlus, PanelRightClose } from 'lucide-react';
import { api, type TimelineEvent, type TimelineType } from '../api';
import { IconButton, cx } from '../ui';
import { fmtDate, fmtTime, useT, type TKey } from '../i18n';
import { AGENTS, AgentIcon } from './Agents';
import type { PanelTab } from './ProjectPanel';

/** Couleur (jeton CSS d'index.css) et libellé de chaque type d'évènement. */
const TYPES: Record<TimelineType, { color: string; label: TKey }> = {
  commit: { color: 'var(--act-commit)', label: 'timeline.type.commit' },
  push: { color: 'var(--act-push)', label: 'timeline.type.push' },
  session: { color: 'var(--agent-claude)', label: 'timeline.type.session' },
  task: { color: 'var(--act-task)', label: 'timeline.type.task' },
};
const ORDER: TimelineType[] = ['commit', 'push', 'session', 'task'];

const colorOf = (e: TimelineEvent) => (e.type === 'session' && e.agent ? AGENTS[e.agent].color : TYPES[e.type].color);

function TypeIcon({ e, size = 12 }: { e: Pick<TimelineEvent, 'type' | 'agent' | 'task'>; size?: number }) {
  const s = { width: size, height: size };
  if (e.type === 'commit') return <GitCommitHorizontal style={s} />;
  if (e.type === 'push') return <ArrowUpFromLine style={s} />;
  if (e.type === 'session') return <AgentIcon agent={e.agent ?? 'claude'} size={size} />;
  if (e.task?.status === 'done') return <CircleCheck style={s} />;
  if (e.task?.status === 'toTest') return <FlaskConical style={s} />;
  return <ListPlus style={s} />;
}

function useStoredSet(key: string, initial: TimelineType[]) {
  const [v, setV] = useState<Set<TimelineType>>(() => {
    try { const raw = localStorage.getItem(key); if (raw) return new Set(JSON.parse(raw)); } catch { /* stockage indisponible */ }
    return new Set(initial);
  });
  const set = (next: Set<TimelineType>) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* stockage indisponible */ }
  };
  return [v, set] as const;
}

/** Jour d'un évènement : « Aujourd'hui », « Hier », sinon la date. */
function dayLabel(iso: string, t: ReturnType<typeof useT>) {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff === 0) return t('timeline.today');
  if (diff === 1) return t('timeline.yesterday');
  return fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Timeline d'activité de tous les projets (vue Projets, volet du projet fermé) : commits, push, nouvelles
 * sessions d'agent et tâches du suivi des 7 derniers jours, groupés par jour. Textes affichés en texte brut.
 */
export function TimelineView({ onOpenProject, onHide }: { onOpenProject: (id: string, tab?: PanelTab) => void; onHide: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ['timeline'], queryFn: api.timeline, refetchInterval: 60_000 });
  const [shown, setShown] = useStoredSet('timeline:types', ORDER);
  const events = q.data?.events ?? [];
  const counts = useMemo(() => Object.fromEntries(ORDER.map((k) => [k, events.filter((e) => e.type === k).length])) as Record<TimelineType, number>, [events]);
  const days = useMemo(() => {
    const out: Array<{ label: string; items: TimelineEvent[] }> = [];
    for (const e of events) {
      if (!shown.has(e.type)) continue;
      const label = dayLabel(e.at, t);
      if (out.at(-1)?.label !== label) out.push({ label, items: [] });
      out.at(-1)!.items.push(e);
    }
    return out;
  }, [events, shown, t]);

  const toggle = (k: TimelineType) => {
    const next = new Set(shown);
    if (next.has(k) && next.size > 1) next.delete(k); else next.add(k);
    setShown(next);
  };

  return (
    <section aria-label={t('timeline.title')} className="flex max-h-[calc(100vh-56px-48px)] min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <header className="shrink-0 space-y-2 border-b border-line px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold leading-tight">{t('timeline.title')}</h2>
            <p className="text-[11px] text-faint">{t('timeline.sub', { days: q.data?.days ?? 7 })}</p>
          </div>
          <IconButton title={t('timeline.hide')} onClick={onHide}><PanelRightClose className="size-4" /></IconButton>
        </div>
        {/* Légende = filtres par type */}
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('timeline.filters')}>
          {ORDER.map((k) => {
            const on = shown.has(k);
            return (
              <button key={k} onClick={() => toggle(k)} aria-pressed={on} title={t(on ? 'timeline.filterHide' : 'timeline.filterShow', { type: t(TYPES[k].label) })}
                className={cx('inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors', on ? 'border-line bg-panel-2 text-fg' : 'border-dashed border-line text-faint line-through decoration-faint/60')}>
                <span className="grid size-3.5 place-items-center" style={{ color: TYPES[k].color }}><TypeIcon e={{ type: k, agent: 'claude' }} size={11} /></span>
                {t(TYPES[k].label)}
                <span className="tabular-nums text-faint">{counts[k]}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {q.isLoading ? (
          <p className="py-6 text-center text-[12px] text-faint">{t('timeline.loading')}</p>
        ) : q.isError ? (
          <p className="py-6 text-center text-[12px] text-faint">{t('timeline.error')}</p>
        ) : days.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-faint">{t('timeline.empty')}</p>
        ) : (
          days.map((d) => (
            <div key={d.label} className="mb-2">
              <h3 className="sticky top-0 z-[1] -mx-3 bg-panel/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted backdrop-blur first-letter:uppercase">{d.label}</h3>
              <ol className="relative ml-[50px] border-l border-line">
                {d.items.map((e) => <Entry key={e.id} e={e} onOpenProject={onOpenProject} />)}
              </ol>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Entry({ e, onOpenProject }: { e: TimelineEvent; onOpenProject: (id: string, tab?: PanelTab) => void }) {
  const t = useT();
  const color = colorOf(e);
  const tab: PanelTab | undefined = e.type === 'session' ? 'claude' : e.type === 'task' ? 'todolist' : undefined;
  let meta: string;
  switch (e.type) {
    case 'commit': meta = [e.hash, e.branch, e.author].filter(Boolean).join(' · '); break;
    case 'push': meta = `${e.remote ?? 'origin'}/${e.branch ?? ''}` + (e.commits != null ? ` · ${t('timeline.commits', { count: e.commits })}` : ''); break;
    case 'session': meta = (e.agent ? AGENTS[e.agent].label : '') + (e.branch ? ` · ${e.branch}` : ''); break;
    default: meta = `${e.task?.num ?? ''} · ${t(`timeline.task.${e.task?.status ?? 'created'}`)}`;
  }
  const text = e.type === 'push' ? t('timeline.pushed', { branch: e.branch ?? '' }) : e.text || t('timeline.untitled');
  return (
    <li className="relative py-1.5 pl-4">
      <time dateTime={e.at} title={new Date(e.at).toLocaleString()} className="absolute -left-[50px] top-[7px] w-[34px] text-right font-mono text-[10.5px] tabular-nums text-faint">
        {fmtTime(e.at, { hour: '2-digit', minute: '2-digit', hour12: false })}
      </time>
      <span className="absolute -left-[9px] top-[5px] grid size-[17px] place-items-center rounded-full border bg-panel" style={{ color, borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}>
        <TypeIcon e={e} size={10} />
      </span>
      <div className="min-w-0">
        {e.projectId ? (
          <button onClick={() => onOpenProject(e.projectId!, tab)} title={t('timeline.openProject', { name: e.projectName })}
            className="max-w-full truncate text-left text-[12px] font-medium text-fg hover:text-accent hover:underline">
            {e.projectName}
          </button>
        ) : (
          <span className="block truncate text-[12px] font-medium text-muted">{e.projectName}</span>
        )}
        <p className="line-clamp-2 break-words text-[12px] leading-snug text-muted" title={e.text}>{text}</p>
        <p className="truncate font-mono text-[10.5px] text-faint" title={meta}>
          <span className="sr-only">{t(TYPES[e.type].label)} · </span>{meta}
        </p>
      </div>
    </li>
  );
}
