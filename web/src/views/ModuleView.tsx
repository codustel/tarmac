import { useEffect, useRef, useState } from 'react';
import type { ModuleInfo } from '../api';
import type { ModuleWebContext, MountModule } from '../../../server/modules/api';
import { cx } from '../ui';
import { useT } from '../i18n';
import { mountConsole } from '../tools/mountConsole';

const currentTheme = (): 'light' | 'dark' => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

/** Icône SVG d'un module, dessinée en `currentColor` (masque CSS : le SVG n'est jamais inséré dans la page). */
export function ModuleIcon({ svg, className }: { svg: string | null; className?: string }) {
  if (!svg) return <span className={cx('size-4 rounded-sm border border-current opacity-60', className)} />;
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / contain no-repeat`;
  return <span className={cx('size-4 shrink-0 bg-current', className)} style={{ mask, WebkitMask: mask }} />;
}

/** Vue d'un module : charge son module ES (`webUrl`) et appelle `mount(el, ctx)` ; remontée au changement de langue. */
export function ModuleView({ module }: { module: ModuleInfo | undefined }) {
  const t = useT();
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | string>('loading');

  useEffect(() => {
    if (!module?.webUrl || module.status !== 'loaded' || !el.current) return;
    const target = el.current;
    const id = module.id;
    let cleanup: void | (() => void);
    let cancelled = false;
    setState('loading');
    const ctx: ModuleWebContext = {
      id,
      lang: t.lang,
      theme: currentTheme,
      onThemeChange(cb) {
        const obs = new MutationObserver(() => cb(currentTheme()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
      },
      mountConsole,
      api: (p, init) => fetch(`/api/modules/${id}${p.startsWith('/') ? p : `/${p}`}`, {
        ...init,
        headers: { 'X-Tarmac-Lang': t.lang, ...(init?.headers as Record<string, string> | undefined) },
      }),
    };
    import(/* @vite-ignore */ module.webUrl)
      .then((m: { mount?: MountModule }) => {
        if (cancelled) return;
        if (typeof m.mount !== 'function') throw new Error('mount() is not exported');
        cleanup = m.mount(target, ctx);
        setState('ready');
      })
      .catch((e: Error) => !cancelled && setState(e.message));
    return () => {
      cancelled = true;
      try { cleanup?.(); } finally { target.replaceChildren(); }
    };
  }, [module?.id, module?.webUrl, module?.status, t.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!module) return <p className="text-[13px] text-muted">{t('common.moduleNotFound')}</p>;
  if (module.status !== 'loaded') return <p className="text-[13px] text-red-600 dark:text-red-400">{t('common.moduleUnavailable', { error: module.error ?? module.status })}</p>;
  return (
    <>
      {state === 'loading' && <p className="text-[13px] text-faint">{t('common.moduleLoading')}</p>}
      {state !== 'loading' && state !== 'ready' && <p className="text-[13px] text-red-600 dark:text-red-400">{t('common.moduleUnavailable', { error: state })}</p>}
      <div ref={el} />
    </>
  );
}
