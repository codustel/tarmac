import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Home, Laptop, Loader2, Monitor, Play, RotateCw, Smartphone, Tablet, TriangleAlert } from 'lucide-react';
import { api, type Project } from '../api';
import { Button, Empty, IconButton, cx, useToast } from '../ui';
import { useT, type TKey } from '../i18n';

type Device = 'desktop' | 'laptop' | 'tablet' | 'mobile';
const DEVICES: Record<Device, { label: TKey; width: number | null; icon: React.ReactNode }> = {
  desktop: { label: 'projects.browser.device.desktop', width: null, icon: <Monitor className="size-3.5" /> },
  laptop: { label: 'projects.browser.device.laptop', width: 1280, icon: <Laptop className="size-3.5" /> },
  tablet: { label: 'projects.browser.device.tablet', width: 768, icon: <Tablet className="size-3.5" /> },
  mobile: { label: 'projects.browser.device.mobile', width: 390, icon: <Smartphone className="size-3.5" /> },
};

const storeKey = (id: string) => `browser:${id}`;
const load = (id: string): { path: string; device: Device } => {
  try { return { path: '/', device: 'desktop', ...JSON.parse(localStorage.getItem(storeKey(id)) ?? '{}') }; } catch { return { path: '/', device: 'desktop' }; }
};

/**
 * Navigateur interne du panneau projet : la page du projet lancé dans un cadre (le Chromium de la PWA).
 * Le cadre est d'une autre origine : pas d'accès à son historique ni à son adresse courante, d'où
 * « Recharger » et « Accueil » plutôt que précédent / suivant.
 */
export function BrowserView({ project: owner, apps }: { project: Project; apps: Project[] }) {
  const toast = useToast();
  const t = useT();
  // Appli affichée : le projet lui-même s'il est web, sinon une appli web de son groupe (monorepo), au choix.
  const pickKey = `browser-target:${owner.id}`;
  const [picked, setPicked] = useState<string | null>(() => { try { return localStorage.getItem(pickKey); } catch { return null; } });
  const webFirst = (a: Project) => (/web|front|site|app/i.test(a.techName ?? a.name) ? 0 : 1);
  const ranked = [...apps].sort((a, b) => Number(b.runtime.status === 'running') - Number(a.runtime.status === 'running') || webFirst(a) - webFirst(b));
  const project = apps.find((a) => a.id === picked) ?? apps.find((a) => a.id === owner.id) ?? ranked[0];
  const choose = (id: string) => { setPicked(id); try { localStorage.setItem(pickKey, id); } catch { /* stockage indisponible */ } };
  const rt = project.runtime;
  const base = rt.status === 'running' ? rt.url : null;
  const saved = load(project.id);
  const [path, setPath] = useState(saved.path);
  const [draft, setDraft] = useState(saved.path);
  const [device, setDevice] = useState<Device>(saved.device);
  useEffect(() => {
    const v = load(project.id);
    setPath(v.path); setDraft(v.path); setDevice(v.device);
  }, [project.id]);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    try { localStorage.setItem(storeKey(project.id), JSON.stringify({ path, device })); } catch { /* stockage indisponible */ }
  }, [project.id, path, device]);

  // Vérifie une fois par URL que le projet accepte d'être affiché dans un cadre.
  const check = useQuery({ queryKey: ['frame-check', project.id, base], queryFn: () => api.frameCheck(project.id), enabled: !!base, staleTime: 60_000 });

  const start = useMutation({
    mutationFn: () => api.action(project.id, 'start'),
    onError: (e: Error) => toast('err', e.message),
  });

  const src = base ? new URL(path || '/', base).toString() : null;
  useEffect(() => { setLoading(true); }, [src, nonce]);

  const go = (p: string) => {
    const clean = p.trim() || '/';
    // Chemin local au projet seulement (pas d'autre site dans le cadre).
    let next = clean;
    try {
      const u = new URL(clean, base ?? 'http://localhost');
      next = base && u.origin === new URL(base).origin ? u.pathname + u.search + u.hash : clean.startsWith('/') ? clean : `/${clean}`;
    } catch { next = clean.startsWith('/') ? clean : `/${clean}`; }
    setPath(next);
    setDraft(next);
    setNonce((n) => n + 1);
  };

  const selector = apps.length > 1 && (
    <select id={`browser-app-${owner.id}`} value={project.id} onChange={(e) => choose(e.target.value)} title={t('projects.browser.app')}
      className="h-7 max-w-[160px] shrink-0 rounded-md border border-line bg-panel-2 px-1.5 text-xs outline-none focus:border-accent">
      {ranked.map((a) => <option key={a.id} value={a.id}>{a.techName ?? a.name}{a.runtime.status === 'running' ? ' ●' : ''}</option>)}
    </select>
  );

  if (!base) {
    const starting = rt.status === 'starting' || start.isPending;
    return (
      <div className="flex h-full flex-col">
      {selector && <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 text-xs text-muted">{selector}</div>}
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <Empty icon={starting ? <Loader2 className="size-8 animate-spin" /> : <Monitor className="size-8" />} title={starting ? t('projects.browser.starting', { name: project.techName ?? project.name }) : t('projects.browser.stopped', { name: project.techName ?? project.name })}>
          {starting ? (
            <p>{t('projects.browser.startingHint')}</p>
          ) : (
            <Button variant="primary" icon={<Play className="size-3 fill-current" />} onClick={() => start.mutate()}>{t('projects.action.start')}</Button>
          )}
        </Empty>
      </div>
      </div>
    );
  }

  const width = DEVICES[device].width;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        {selector}
        <IconButton title={t('projects.browser.reload')} onClick={() => setNonce((n) => n + 1)}>
          <RotateCw className={cx('size-3.5', loading && 'animate-spin')} />
        </IconButton>
        <IconButton title={t('projects.browser.home')} onClick={() => go('/')}><Home className="size-3.5" /></IconButton>
        <form className="flex min-w-0 flex-1 items-center rounded-md border border-line bg-panel-2 focus-within:border-accent"
          onSubmit={(e) => { e.preventDefault(); go(draft); }}>
          <span className="shrink-0 pl-2 font-mono text-[11px] text-faint">{base.replace(/\/$/, '')}</span>
          <input id={`browser-path-${project.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
            className="h-7 min-w-0 flex-1 bg-transparent pr-2 font-mono text-[12px] outline-none" aria-label={t('projects.browser.path')} />
        </form>
        <div className="flex rounded-md bg-panel-2 p-0.5">
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <button key={d} type="button" title={t(DEVICES[d].label)} onClick={() => setDevice(d)}
              className={cx('grid h-6 w-7 place-items-center rounded', device === d ? 'bg-panel text-fg shadow-xs' : 'text-muted hover:text-fg')}>
              {DEVICES[d].icon}
            </button>
          ))}
        </div>
        <IconButton title={t('projects.browser.openExternal')} onClick={() => window.open(src!, '_blank', 'noopener')}><ExternalLink className="size-3.5" /></IconButton>
      </div>

      {check.data && !check.data.frameable ? (
        <div className="grid flex-1 place-items-center p-6">
          <Empty icon={<TriangleAlert className="size-8 text-amber-500" />} title={t('projects.browser.cannotFrame')}>
            <p className="mb-3">{check.data.reason}</p>
            <Button icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(src!, '_blank', 'noopener')}>{t('projects.browser.openExternal')}</Button>
          </Empty>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-[repeating-conic-gradient(var(--panel-2)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
          <div className="mx-auto h-full bg-white" style={{ width: width ? `${width}px` : '100%', maxWidth: width ? undefined : '100%' }}>
            <iframe
              key={`${src}#${nonce}`}
              ref={frame}
              src={src!}
              title={t('projects.browser.preview', { name: project.name })}
              onLoad={() => setLoading(false)}
              allow="clipboard-read; clipboard-write; fullscreen; camera; microphone; geolocation"
              className="block h-full w-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
