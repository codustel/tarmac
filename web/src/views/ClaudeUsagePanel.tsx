import { useQuery } from '@tanstack/react-query';
import { api, type ClaudeUsageLimit } from '../api';
import { cx } from '../ui';
import { fmtDateTime, fmtNumber, fmtTime, timeAgo, useT } from '../i18n';
import { ClaudeIcon } from './ClaudeSessions';

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
 * Utilisation de l'abonnement Claude dans l'espace libre de la sidebar : plan, puis une jauge par limite
 * (session de 5 h si le plan en a une, semaine, limites hebdomadaires par modèle comme Fable).
 * Interrogé toutes les minutes tant que la fenêtre est visible ; masqué si le réglage est désactivé.
 * `data-rows` sert aux règles de hauteur (index.css) : le logo puis le panneau s'effacent si la place manque.
 */
export function ClaudeUsagePanel() {
  const t = useT();
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
      className="usage-panel mx-3 mb-3 shrink-0 rounded-lg border border-line bg-panel-2/50 px-2.5 py-2"
      title={ok && u.fetchedAt ? t('claude.usage.source', { when: timeAgo(u.fetchedAt) }) : undefined}
    >
      <div className="flex items-center gap-1.5 text-[11px] leading-4">
        <ClaudeIcon size={12} className="shrink-0" />
        <span className="truncate font-medium text-muted">{t('claude.usage.title')}</span>
        {u.plan && <span className="ml-auto shrink-0 rounded bg-panel px-1.5 text-[10px] font-semibold text-fg ring-1 ring-line">{u.plan}</span>}
      </div>
      {ok ? (
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
