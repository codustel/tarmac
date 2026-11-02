import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, KeyRound, Search, X } from 'lucide-react';
import { api, type EnvLine, type Project } from '../api';
import { Badge, Button, IconButton, copy, cx, useToast } from '../ui';
import { useT } from '../i18n';

/** `CLÉ=valeur`, avec guillemets quand la valeur l'exige (espaces, #, guillemets, retours à la ligne). */
const pair = (key: string, value: string) =>
  /[\s#"'`\\]/.test(value) ? `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"` : `${key}=${value}`;

/** Variables des fichiers `.env*` à la racine d'un projet : valeurs masquées, affichage et copie. */
export function EnvModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const toast = useToast();
  const t = useT();
  const [file, setFile] = useState(project.envFiles[0] ?? '.env');
  const [shown, setShown] = useState<Set<number>>(new Set()); // n° de ligne (une clé peut être en double)
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const env = useQuery({ queryKey: ['env', project.id, file], queryFn: () => api.env(project.id, file), staleTime: 0 });

  useEffect(() => {
    // Capture : Échap ferme la modale sans fermer aussi le panneau projet.
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  // Changement de fichier : tout est de nouveau masqué.
  useEffect(() => { setShown(new Set()); setAll(false); }, [file]);

  const files = env.data?.files ?? project.envFiles;
  const entries = (env.data?.lines ?? []).filter((l): l is Extract<EnvLine, { type: 'entry' }> => l.type === 'entry' && !l.disabled);
  const lines = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const src = env.data?.lines ?? [];
    if (!needle) return src;
    return src.filter((l) => l.type === 'entry' && l.key.toLowerCase().includes(needle));
  }, [env.data, q]);

  const isShown = (k: number) => all || shown.has(k);
  const toggle = (k: number) => setShown((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  // Portail : la modale est souvent ouverte depuis une ligne semi-transparente (opacité héritée).
  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <KeyRound className="size-4 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{t('projects.env.title', { name: project.name })}</div>
            <div className="truncate font-mono text-[11px] text-faint">{project.relPath}/{file}</div>
          </div>
          <Badge>{t('projects.env.count', { count: entries.length })}</Badge>
          <IconButton title={t('projects.action.closeEsc')} onClick={onClose}><X className="size-4" /></IconButton>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          {files.length > 1 && (
            <div className="flex rounded-md bg-panel-2 p-0.5">
              {files.map((f) => (
                <button
                  key={f}
                  onClick={() => setFile(f)}
                  className={cx('h-6 rounded px-2 font-mono text-[11px] transition-colors', f === file ? 'bg-panel text-fg shadow-xs' : 'text-muted hover:text-fg')}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('projects.env.filter')}
              className="h-7 w-48 rounded-md border border-line bg-panel pl-7 pr-2 text-xs outline-none placeholder:text-faint focus:border-accent"
            />
          </div>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" icon={all ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} onClick={() => { setAll(!all); setShown(new Set()); }}>
            {all ? t('projects.env.hideAll') : t('projects.env.showAll')}
          </Button>
          <Button size="sm" icon={<Copy className="size-3.5" />} disabled={!entries.length}
            onClick={() => copy(entries.map((e) => pair(e.key, e.value)).join('\n') + '\n', toast, t('projects.env.copiedAll', { count: entries.length }))}>
            {t('projects.env.copyAll')}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {env.isLoading && <div className="px-4 py-6 text-center text-xs text-faint">{t('projects.env.reading')}</div>}
          {env.error && <div className="px-4 py-6 text-center text-xs text-red-500">{(env.error as Error).message}</div>}
          {env.data && entries.length === 0 && <div className="px-4 py-6 text-center text-xs text-faint">{t('projects.env.empty', { file })}</div>}
          {lines.map((l, i) =>
            l.type === 'comment' ? (
              <div key={i} className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">{l.text}</div>
            ) : (
              <div key={i} className="group flex items-center gap-3 px-4 py-1 hover:bg-panel-2/60">
                <button
                  title={t('projects.env.copyKey')}
                  onClick={() => copy(l.key, toast, t('projects.env.keyCopied', { key: l.key }))}
                  className={cx('w-[38%] shrink-0 truncate text-left font-mono text-xs font-medium hover:text-accent', l.disabled && 'text-faint line-through')}
                >
                  {l.key}
                </button>
                {l.disabled && <Badge title={t('projects.env.commentedHint')}>{t('projects.env.commented')}</Badge>}
                <div className="min-w-0 flex-1 font-mono text-xs">
                  {l.value === '' ? (
                    <span className="italic text-faint">{t('projects.env.emptyValue')}</span>
                  ) : isShown(l.line) ? (
                    <span className="select-text whitespace-pre-wrap break-all">{l.value}</span>
                  ) : (
                    <span className="select-none tracking-widest text-faint">••••••••••••</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center">
                  <IconButton title={isShown(l.line) ? t('projects.env.hideValue') : t('projects.env.showValue')} disabled={l.value === '' || all} onClick={() => toggle(l.line)}>
                    {isShown(l.line) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </IconButton>
                  <IconButton title={t('projects.env.copyValue')} disabled={l.value === ''} onClick={() => copy(l.value, toast, t('projects.env.valueCopied', { key: l.key }))}>
                    <Copy className="size-3.5" />
                  </IconButton>
                  <button
                    title={t('projects.env.copyPair', { key: l.key })}
                    onClick={() => copy(pair(l.key, l.value), toast, t('projects.env.pairCopied', { key: l.key }))}
                    className="inline-flex h-7 items-center rounded-md px-1.5 font-mono text-[11px] text-muted hover:bg-panel-2 hover:text-fg"
                  >
                    K=V
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
