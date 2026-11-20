import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api, type ClaudeUsageLimit } from '../api';
import { CodexIcon } from './Agents';
import { cx } from '../ui';
import { fmtDateTime, fmtNumber, fmtTime, timeAgo, useT } from '../i18n';
import { ClaudeIcon } from './ClaudeSessions';
import { peakUsage } from '../sidebarFold';
import { FoldChevron, useFold } from './SidebarFold';

/** Couleur d'une jauge selon le niveau : vert < 70 %, orange < 90 %, rouge au-delà. */
export const usageTone = (u: number) => (u < 70 ? 'green' : u < 90 ? 'orange' : 'red');
const BAR = { green: 'bg-emerald-500', orange: 'bg-amber-500', red: 'bg-red-500' } as const;
const PCT = { green: 'text-fg', orange: 'text-amber-600 dark:text-amber-400', red: 'text-red-600 dark:text-red-400' } as const;

/** Remise à zéro en petit : heure si elle tombe dans les 24 h, sinon jour abrégé et heure. */
function shortReset(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  return ms < 86_400_000 ? fmtTime(iso, { hour: '2-digit', minute: '2-digit' }) : fmtDateTime(iso, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * En-tête d'un panneau d'utilisation. Grand écran : ligne fixe (icône, titre, plan). Petit écran (`compact`) :
 * ligne cliquable qui replie ou déplie le panneau ; repliée, elle montre la plus forte jauge (ou une alerte).
 */
function UsageHeader({ icon, title, plan, peak, alert, compact, folded, onToggle }: {
  icon: ReactNode; title: string; plan?: string | null; peak: number | null; alert: boolean;
  compact: boolean; folded: boolean; onToggle: () => void;
}) {
  const t = useT();
  const planBadge = plan && <span className="ml-auto shrink-0 rounded bg-panel px-1.5 text-[10px] font-semibold text-fg ring-1 ring-line">{plan}</span>;
  if (!compact) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] leading-4">
        {icon}
        <span className="truncate font-medium text-muted">{title}</span>
        {planBadge}
      </div>
    );
  }
  return (
    <button type="button" onClick={onToggle} aria-expanded={!folded} title={folded ? t('common.fold.expand') : t('common.fold.collapse')}
      className="group flex w-full items-center gap-1.5 text-left text-[11px] leading-4">
      {icon}
      <span className="min-w-0 flex-1 truncate font-medium text-muted group-hover:text-fg">{title}</span>
      {!folded ? planBadge : alert ? <AlertTriangle className="size-3 shrink-0 text-amber-500" aria-hidden="true" /> : peak != null && (
        <span className={cx('shrink-0 font-semibold tabular-nums', PCT[usageTone(peak)])}>{fmtNumber(peak / 100, { style: 'percent' })}</span>
      )}
      <FoldChevron folded={folded} />
    </button>
  );
}

/** Classes du cadre d'un panneau : espace libre (grand écran) ou pied de la sidebar (petit écran, ligne repliée). */
const panelClass = (compact: boolean, folded: boolean) =>
  cx('usage-panel shrink-0 rounded-lg border border-line bg-panel-2/50 px-2.5', compact ? (folded ? 'py-1.5' : 'py-2') : 'mx-3 mb-3 py-2');

/**
 * Utilisation de l'abonnement Claude dans l'espace libre de la sidebar : plan, puis une jauge par limite
 * (session de 5 h si le plan en a une, semaine, limites hebdomadaires par modèle comme Fable).
 * Interrogé toutes les minutes tant que la fenêtre est visible ; masqué si le réglage est désactivé.
 * `data-rows` sert aux règles de hauteur (index.css) : le logo puis le panneau s'effacent si la place manque.
 */
export function ClaudeUsagePanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [folded, toggle] = useFold('claude-usage', compact);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const enabled = settings.data?.showClaudeUsage !== false && !!settings.data;
  const q = useQuery({ queryKey: ['claude-usage'], queryFn: api.claudeUsage, enabled, refetchInterval: 60_000, staleTime: 55_000, retry: false });
  const u = q.data;
  if (!enabled || !u || u.status === 'disabled') return null;

  const label = (l: ClaudeUsageLimit) => (l.kind === 'session' ? t('claude.usage.session') : l.kind === 'week' ? t('claude.usage.week') : l.label ?? '');
  const ok = u.status === 'ok';
  const limits = u.limits.slice(0, 5); // au plus 5 jauges (règles de hauteur de index.css)
  const rows = ok ? Math.max(1, limits.length) : 1;
  return (
    <div
      data-rows={rows}
      className={panelClass(compact, folded)}
      title={ok && u.fetchedAt ? t('claude.usage.source', { when: timeAgo(u.fetchedAt) }) : undefined}
    >
      <UsageHeader icon={<ClaudeIcon size={12} className="shrink-0" />} title={t('claude.usage.title')} plan={u.plan}
        peak={ok ? peakUsage(limits) : null} alert={!ok} compact={compact} folded={folded} onToggle={toggle} />
      {folded ? null : ok ? (
        <div className="mt-1.5 space-y-1.5">
          {limits.map((l) => {
            const tone = usageTone(l.utilization);
            const reset = l.resetsAt ? t('claude.usage.resets', { when: fmtDateTime(l.resetsAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }) : undefined;
            return (
              <div key={l.id} title={reset}>
                <div className="flex items-baseline gap-1.5 text-[11px] leading-4">
                  <span className="truncate text-muted">{label(l)}</span>
                  {l.resetsAt && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-faint">↻ {shortReset(l.resetsAt)}</span>}
                  <span className={cx('w-9 shrink-0 text-right font-semibold tabular-nums', !l.resetsAt && 'ml-auto', PCT[tone])}>
                    {fmtNumber(Math.floor(l.utilization) / 100, { style: 'percent' })}
                  </span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-line" role="meter" aria-label={label(l)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(l.utilization)}>
                  <div className={cx('h-full rounded-full', BAR[tone])} style={{ width: `${Math.min(100, Math.max(2, l.utilization))}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-1 text-[11px] leading-snug text-faint">
          {u.status === 'error' ? t('claude.usage.error') : (
            <span title={u.status === 'expired' ? t('claude.usage.expired') : t('claude.usage.notConnected')}>{t('claude.usage.reconnect')}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Place du panneau Codex dans l'espace libre de la sidebar : les règles de hauteur d'index.css comptent un seul
 * panneau. Avec deux panneaux, si l'ensemble dépasse, le logo s'efface d'abord, puis le panneau Codex (celui de
 * Claude suit alors ses propres règles). Rien ne déborde ni ne défile.
 */
function useSidebarFit() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const free = ref.current?.closest('.sidebar-free') as HTMLElement | null;
    const inner = free?.firstElementChild as HTMLElement | null;
    if (!free || !inner) return;
    const used = () => [...inner.children].reduce((h, c) => {
      const el = c as HTMLElement;
      if (getComputedStyle(el).display === 'none') return h;
      const s = getComputedStyle(el);
      return h + el.getBoundingClientRect().height + parseFloat(s.marginTop) + parseFloat(s.marginBottom);
    }, 0);
    const fit = () => {
      for (const level of ['0', '1', '2']) {
        inner.dataset.codexFit = level;
        if (used() <= free.clientHeight + 1) return;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(free);
    return () => { ro.disconnect(); delete inner.dataset.codexFit; };
  });
  return ref;
}

/**
 * Utilisation du plan ChatGPT pour Codex, sous celle de Claude, seulement si Codex est coché (Réglages → Agents) :
 * plan, fenêtres d'usage (5 h, semaine) en %, remise à zéro. Source : dernières limites que Codex a enregistrées
 * dans ses transcripts locaux (`/api/codex/usage`, aucun jeton lu ni appel réseau) ; rien n'est deviné.
 */
export function CodexUsagePanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const fitRef = useSidebarFit();
  const [folded, toggle] = useFold('codex-usage', compact);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const enabled = !!settings.data?.agents?.codex && settings.data?.showCodexUsage !== false;
  const q = useQuery({ queryKey: ['codex-usage'], queryFn: api.codexUsage, enabled, refetchInterval: 60_000, staleTime: 55_000, retry: false });
  const u = q.data;
  if (!enabled || !u || u.status === 'disabled') return null;
  const label = (l: ClaudeUsageLimit) => (l.kind === 'session' ? t('codex.usage.session') : l.kind === 'week' ? t('codex.usage.week') : l.label ?? '');
  const limits = u.limits.slice(0, 3);
  const ok = u.status === 'ok' && limits.length > 0;
  return (
    <div
      ref={fitRef}
      data-agent="codex"
      data-rows={ok ? limits.length : 1}
      className={panelClass(compact, folded)}
      title={u.status === 'ok' && u.fetchedAt ? t('codex.usage.source', { when: timeAgo(u.fetchedAt) }) : u.status === 'none' ? t('codex.usage.noneTitle') : undefined}
    >
      <UsageHeader icon={<CodexIcon size={12} className="shrink-0" />} title={t('codex.usage.title')} plan={u.plan}
        peak={ok ? peakUsage(limits) : null} alert={u.status === 'error'} compact={compact} folded={folded} onToggle={toggle} />
      {folded ? null : ok ? (
        <div className="mt-1.5 space-y-1.5">
          {limits.map((l) => {
            const tone = usageTone(l.utilization);
            const reset = l.resetsAt ? t('claude.usage.resets', { when: fmtDateTime(l.resetsAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }) : undefined;
            return (
              <div key={l.id} title={reset}>
                <div className="flex items-baseline gap-1.5 text-[11px] leading-4">
                  <span className="truncate text-muted">{label(l)}</span>
                  {l.resetsAt && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-faint">↻ {shortReset(l.resetsAt)}</span>}
                  <span className={cx('w-9 shrink-0 text-right font-semibold tabular-nums', !l.resetsAt && 'ml-auto', PCT[tone])}>
                    {fmtNumber(Math.floor(l.utilization) / 100, { style: 'percent' })}
                  </span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-line" role="meter" aria-label={label(l)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(l.utilization)}>
                  <div className={cx('h-full rounded-full', BAR[tone])} style={{ width: `${Math.min(100, Math.max(2, l.utilization))}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-1 text-[11px] leading-snug text-faint">
          {u.status === 'error' ? t('codex.usage.error') : u.status === 'ok' ? t('codex.usage.allReset') : t('codex.usage.none')}
        </div>
      )}
    </div>
  );
}
