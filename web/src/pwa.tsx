import { useEffect, useState } from 'react';
import { Download, Info } from 'lucide-react';
import { cx } from './ui';
import { useT } from './i18n';

/**
 * Installation en PWA.
 * Chrome n'autorise l'installation que dans un contexte sécurisé : HTTPS, `localhost` ou `*.localhost`.
 * `http://tarmac.test` n'en est pas un → on redirige vers `http://tarmac.localhost`.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((l) => l());
});

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => null);
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
/** Dans l'app Tarmac Desktop (agent utilisateur « TarmacDesktop/<version> ») : déjà installée. */
const inDesktopApp = navigator.userAgent.includes('TarmacDesktop');

/** URL équivalente en *.localhost (contexte sécurisé). */
function secureUrl() {
  const port = location.port ? `:${location.port}` : '';
  return `http://tarmac.localhost${port}${location.pathname}${location.hash}`;
}

export function InstallButton() {
  const t = useT();
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  if (standalone() || inDesktopApp) return null;

  const base = 'flex w-full items-center gap-2 rounded-md border px-2.5 h-8 text-xs font-medium transition-colors';

  if (deferred) {
    return (
      <button
        className={cx(base, 'border-accent/40 bg-accent/10 text-fg hover:bg-accent/15')}
        onClick={async () => {
          await deferred!.prompt();
          await deferred!.userChoice;
          deferred = null;
          force((n) => n + 1);
        }}
      >
        <Download className="size-3.5 text-accent" /> {t('common.pwa.install')}
      </button>
    );
  }

  return (
    <div className="relative">
      <button className={cx(base, 'border-line text-muted hover:text-fg')} onClick={() => setHelp((h) => !h)}>
        <Download className="size-3.5" /> {t('common.pwa.install')}
      </button>
      {help && (
        <div className="absolute bottom-10 left-0 z-30 w-72 rounded-lg border border-line bg-panel p-3 text-[12px] leading-relaxed shadow-xl">
          <div className="mb-1.5 flex items-center gap-1.5 font-semibold"><Info className="size-3.5 text-accent" />{t('common.pwa.title')}</div>
          {!window.isSecureContext ? (
            t.node('common.pwa.insecure', {
              link: <a className="text-accent hover:underline" href={secureUrl()}>{t('common.pwa.open', { url: secureUrl().replace(/\/?#.*$/, '').replace('http://', '') })}</a>,
            })
          ) : isSafari ? (
            t.node('common.pwa.safari', { menu: <b>{t('common.pwa.safariMenu')}</b> })
          ) : (
            <>
              {t.node('common.pwa.chrome', { icon: <b>{t('common.pwa.chromeIcon')}</b>, menu: <b>{t('common.pwa.chromeMenu')}</b> })}
              <br />{t('common.pwa.others')}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Nouvelle version servie (après `pnpm build` + redémarrage) : rechargement automatique si la fenêtre
 * est en arrière-plan, sinon bandeau « Recharger ». Les consoles et serveurs continuent côté serveur,
 * rien n'est perdu au rechargement.
 */
export function UpdateBanner({ serverBuild }: { serverBuild: string | null | undefined }) {
  const t = useT();
  const outdated = !!serverBuild && serverBuild !== __BUILD_ID__;
  useEffect(() => {
    if (!outdated) return;
    const reloadIfHidden = () => document.visibilityState === 'hidden' && location.reload();
    reloadIfHidden();
    document.addEventListener('visibilitychange', reloadIfHidden);
    return () => document.removeEventListener('visibilitychange', reloadIfHidden);
  }, [outdated]);
  if (!outdated) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-accent/40 bg-panel px-4 py-2.5 text-[13px] shadow-2xl">
      <span className="size-2 rounded-full bg-accent animate-pulse" />
      {t('common.pwa.update')}
      <button onClick={() => location.reload()} className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90">
        {t('common.pwa.reload')}
      </button>
    </div>
  );
}
