import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, GitBranch, Play, Search, TriangleAlert } from 'lucide-react';
import { api, type GitCommandInfo, type Project, type TerminalSession } from '../api';
import { TechIcon } from '../icons';
import { Badge, Button, GitBadge, GithubIcon, cx, useToast } from '../ui';
import { useT } from '../i18n';

/** Catalogues proposés : git (dépôt du projet) et Supabase CLI (dossier de supabase/config.toml). */
const KINDS = {
  git: { label: 'Git', list: api.gitCommands, run: api.git, search: 'projects.menu.searchGit' },
  supabase: { label: 'Supabase', list: api.supabaseCommands, run: api.supabaseRun, search: 'projects.menu.searchSupabase' },
} as const;

/** Menu de commandes de la console (git ou Supabase) : commandes groupées, chacune avec sa description. */
export function CommandMenu({ project, kind, onStarted, variant = 'console' }: {
  project: Project;
  kind: keyof typeof KINDS;
  onStarted: (s: TerminalSession) => void;
  /** `ide` : bouton icône et menu sombre pour le panneau terminal de l'IDE. */
  variant?: 'console' | 'ide';
}) {
  const K = KINDS[kind];
  const toast = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<GitCommandInfo | null>(null);
  const [arg, setArg] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; max: number }>({ left: 0, top: 0, max: 560 });
  // Menu en position fixe, recalé dans la fenêtre (le panneau latéral est étroit) ; ouvert vers le haut
  // quand le bouton est en bas de l'écran (panneau terminal de l'IDE).
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(440, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom - 18;
    if (below < 320 && r.top > below) setPos({ left, bottom: window.innerHeight - r.top + 6, max: Math.min(560, r.top - 18) });
    else setPos({ left, top: r.bottom + 6, max: Math.min(560, below) });
  };

  const commands = useQuery({ queryKey: [`${kind}-commands`], queryFn: K.list, staleTime: Infinity });
  const branches = useQuery({ queryKey: ['git-branches', project.id], queryFn: () => api.gitBranches(project.id), enabled: open && kind === 'git' && !!project.repo });

  const run = useMutation({
    mutationFn: ({ c, a }: { c: GitCommandInfo; a?: string }) => K.run(project.id, c.id, a),
    onSuccess: (s) => {
      onStarted(s);
      setOpen(false);
      setPending(null);
      setArg('');
    },
    onError: (e: Error) => toast('err', e.message),
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (pending ? setPending(null) : setOpen(false));
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open, pending]);

  const groups = useMemo(() => {
    const f = q.trim().toLowerCase();
    // `supabase init` seulement là où il n'y a pas encore de config.
    const list = (commands.data ?? []).filter((c) => (c.id !== 'init' || kind !== 'supabase' || !project.supabase) && (!f || `${c.label} ${t.loc(c.description)} ${t.loc(c.group)}`.toLowerCase().includes(f)));
    const m = new Map<string, GitCommandInfo[]>();
    for (const c of list) {
      const g = t.loc(c.group);
      m.set(g, [...(m.get(g) ?? []), c]);
    }
    return [...m.entries()];
  }, [commands.data, q, kind, project.supabase, t]);
  const confirmRun = (c: GitCommandInfo) => confirm(t('projects.menu.confirm', { label: c.label, description: t.loc(c.description) }));

  const choose = (c: GitCommandInfo) => {
    if (c.arg) {
      setPending(c);
      setArg('');
      return;
    }
    if (c.danger && !confirmRun(c)) return;
    run.mutate({ c });
  };

  if (kind === 'git' ? !project.repo : !project.supabaseCli) return null;
  const git = project.repo?.git;
  const sb = project.supabase;
  const logo = kind === 'git' ? <GithubIcon className="size-3.5" /> : <TechIcon id="supabase" size={14} />;

  return (
    <div ref={box} className="relative">
      <div ref={btn} className="inline-flex">
      {variant === 'ide' ? (
        <button title={t('projects.menu.commands', { name: K.label })} onClick={() => { place(); setOpen((o) => !o); }} className={cx('ide-icon-btn', open && 'bg-white/10')}>
          {logo}
        </button>
      ) : (
        <Button size="sm" icon={kind === 'git' ? <GitBranch className="size-3.5" /> : logo} onClick={() => { place(); setOpen((o) => !o); }}>
          {K.label} <ChevronDown className={cx('size-3 transition-transform', open && 'rotate-180')} />
        </Button>
      )}
      </div>

      {open && (
        <div style={{ top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.max }}
          className={cx('fixed z-50 flex w-[min(440px,calc(100vw-16px))] flex-col overflow-hidden rounded-lg border border-line bg-panel text-fg shadow-2xl', variant === 'ide' && 'dark')}>
          {/* État du dépôt / de la config Supabase */}
          {kind === 'git' ? (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px]">
              <GitBranch className="size-3.5 text-faint" />
              <span className="font-mono font-medium">{git?.branch ?? '—'}</span>
              <GitBadge git={git ?? null} />
              <span className="ml-auto truncate font-mono text-faint">{project.repo?.relPath}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px]">
              <TechIcon id="supabase" size={14} />
              <span className="font-mono font-medium">{sb?.projectId ?? (project.supabaseCli?.hasFolder ? 'supabase/' : t('projects.menu.noSupabaseFolder'))}</span>
              {sb?.ports.studio && (
                <a href={`http://localhost:${sb.ports.studio}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  Studio <ExternalLink className="size-3" />
                </a>
              )}
              <span className="ml-auto truncate font-mono text-faint">{project.supabaseCli?.relPath}</span>
            </div>
          )}

          {pending ? (
            <form
              className="space-y-2.5 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (pending.danger && !confirmRun(pending)) return;
                run.mutate({ c: pending, a: arg });
              }}
            >
              <div>
                <div className="font-mono text-[12px] font-medium">{pending.label}</div>
                <div className="text-[12px] text-muted">{t.loc(pending.description)}</div>
              </div>
              <label className="block text-[11px] font-medium text-faint">{t.loc(pending.argLabel)}</label>
              <input
                autoFocus
                list={pending.arg === 'branch' ? `branches-${project.id}` : undefined}
                value={arg}
                onChange={(e) => setArg(e.target.value)}
                placeholder={pending.placeholder ?? (pending.arg === 'branch' ? t('projects.menu.branchPlaceholder') : pending.arg === 'message' ? t('projects.menu.messagePlaceholder') : '')}
                className="h-8 w-full rounded-md border border-line bg-panel-2 px-2.5 font-mono text-[12px] outline-none focus:border-accent"
              />
              {pending.arg === 'branch' && (
                <datalist id={`branches-${project.id}`}>
                  {(branches.data ?? []).map((b) => <option key={b} value={b} />)}
                </datalist>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" type="button" onClick={() => setPending(null)}>{t('projects.action.back')}</Button>
                <Button size="sm" variant={pending.danger ? 'danger' : 'primary'} type="submit" icon={<Play className="size-3 fill-current" />} loading={run.isPending}
                  disabled={pending.arg !== 'optional-message' && !arg.trim()}>
                  {t('projects.action.execute')}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="relative border-b border-line p-2">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t(K.search)}
                  className="h-8 w-full rounded-md bg-panel-2 pl-8 pr-2 text-[12px] outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto py-1">
                {groups.map(([group, cmds]) => (
                  <div key={group}>
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{group}</div>
                    {cmds.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => choose(c)}
                        disabled={run.isPending}
                        title={`$ ${c.preview}`}
                        className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left hover:bg-panel-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className={cx('font-mono text-[12px] font-medium', c.danger && 'text-red-600 dark:text-red-400')}>{c.label}</span>
                            {c.arg && c.arg !== 'optional-message' && <Badge>{t.loc(c.argLabel)}</Badge>}
                            {c.danger && <TriangleAlert className="size-3 text-red-500" />}
                          </div>
                          <div className="text-[11.5px] leading-snug text-muted">{t.loc(c.description)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
                {groups.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-faint">{t('projects.menu.none')}</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
