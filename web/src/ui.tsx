import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { GitStatus, ProcStatus } from './api';
import { translateNow, useT } from './i18n';

export const cx = clsx;

/** Chemin affiché avec `~` : dossier personnel du serveur s'il est connu, sinon /Users/<nom> ou /home/<nom>. */
export const tildify = (p: string, home?: string) =>
  home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p.replace(/^\/(Users|home)\/[^/]+/, '~');

// ─── Button ────────────────────────────────────────────────────────────────
type Variant = 'default' | 'primary' | 'ghost' | 'danger';
export function Button({
  variant = 'default', size = 'md', loading, icon, children, className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
        variant === 'default' && 'border border-line bg-panel hover:bg-panel-2 text-fg shadow-xs',
        variant === 'primary' && 'bg-accent text-accent-fg hover:opacity-90 shadow-xs',
        variant === 'ghost' && 'text-muted hover:text-fg hover:bg-panel-2',
        variant === 'danger' && 'border border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/5 hover:bg-red-500/10',
        className,
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ title, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button
      {...props}
      title={title}
      aria-label={title}
      className={cx(
        'inline-flex size-7 items-center justify-center rounded-md text-muted hover:text-fg hover:bg-panel-2 transition-colors',
        'disabled:opacity-40 disabled:pointer-events-none',
        props.className,
      )}
    >
      {children}
    </button>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────
type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';
const tones: Record<Tone, string> = {
  neutral: 'bg-panel-2 text-muted border-line',
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  red: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20',
};
export function Badge({ tone = 'neutral', children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded border px-1.5 h-5 text-[11px] font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

// ─── Statut process ────────────────────────────────────────────────────────
// Libellés traduits par les vues (clés projects.status.*).
export const statusMeta: Record<ProcStatus, { dot: string; tone: Tone }> = {
  running: { dot: 'bg-emerald-500', tone: 'green' },
  starting: { dot: 'bg-amber-400 animate-pulse', tone: 'amber' },
  stopping: { dot: 'bg-amber-400 animate-pulse', tone: 'amber' },
  stopped: { dot: 'bg-faint/60', tone: 'neutral' },
  crashed: { dot: 'bg-red-500', tone: 'red' },
};

export function StatusDot({ status }: { status: ProcStatus }) {
  const m = statusMeta[status];
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      {status === 'running' && <span className="absolute inset-0 rounded-full bg-emerald-500/40 animate-ping" />}
      <span className={cx('relative inline-flex size-2.5 rounded-full', m.dot)} />
    </span>
  );
}

// ─── Git ───────────────────────────────────────────────────────────────────
export function GitBadge({ git }: { git: GitStatus | null | undefined }) {
  const t = useT();
  if (!git) return <Badge>—</Badge>;
  const dirty = git.changes + git.untracked;
  const main = (() => {
    switch (git.sync) {
      case 'synced': return <Badge tone="green" title={t('common.git.syncedTitle', { upstream: git.upstream ?? '' })}>{t('common.git.synced')}</Badge>;
      case 'ahead': return <Badge tone="blue" title={t('common.git.aheadTitle', { count: git.ahead })}>{t('common.git.ahead', { count: git.ahead })}</Badge>;
      case 'behind': return <Badge tone="amber" title={t('common.git.behindTitle', { count: git.behind })}>{t('common.git.behind', { count: git.behind })}</Badge>;
      case 'diverged': return <Badge tone="red" title={t('common.git.divergedTitle')}>{t('common.git.diverged', { ahead: git.ahead, behind: git.behind })}</Badge>;
      case 'no-upstream': return <Badge tone="violet" title={t('common.git.noUpstreamTitle')}>{t('common.git.noUpstream')}</Badge>;
      case 'no-remote': return <Badge title={t('common.git.noRemoteTitle')}>{t('common.git.noRemote')}</Badge>;
      default: return <Badge tone="red" title={git.error}>{t('common.git.error')}</Badge>;
    }
  })();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {main}
      {dirty > 0 && (
        <Badge tone="amber" title={t('common.git.dirtyTitle', { changes: git.changes, untracked: git.untracked })}>
          {t('common.git.dirty', { count: dirty })}
        </Badge>
      )}
    </span>
  );
}

// ─── Divers ────────────────────────────────────────────────────────────────
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg border border-line bg-panel', className)}>{children}</div>;
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-2">
      <div className="text-faint mb-1">{icon}</div>
      <div className="font-medium">{title}</div>
      {children && <div className="text-muted max-w-md">{children}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1 text-[10px] font-mono text-muted">{children}</kbd>;
}

/** Date relative dans la langue active (voir i18n/format.ts). */
export { timeAgo } from './i18n/format';

// ─── Toasts ────────────────────────────────────────────────────────────────
type Toast = { id: number; kind: 'ok' | 'err'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2.5 shadow-lg animate-in">
            {t.kind === 'ok' ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-px" /> : <XCircle className="size-4 text-red-500 shrink-0 mt-px" />}
            <span className="text-[13px] leading-snug">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** `navigator.clipboard` n'existe qu'en contexte sécurisé : http://tarmac.test n'en est pas un → fallback. */
export async function copy(text: string, toast: ReturnType<typeof useToast>, label = translateNow('common.copied')) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  };
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { /* API refusée (focus, permission) → repli */ }
  if (!ok) {
    try { ok = fallback(); } catch { ok = false; }
  }
  toast(ok ? 'ok' : 'err', ok ? label : translateNow('common.copyFailed'));
}

/** Lucide ne fournit plus les logos de marque. */
export function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/** Logo de VS Code (Simple Icons, CC0). */
export function VsCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  );
}
