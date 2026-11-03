import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Scale, X } from 'lucide-react';
import { IconButton } from '../ui';
import { useT } from '../i18n';
// Texte exact du fichier LICENSE du dépôt, inclus au build (aucune copie à tenir à jour).
import licenseText from '../../../LICENSE?raw';

export function LicenseModal({ onClose }: { onClose: () => void }) {
  const t = useT();

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="license-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <Scale className="size-4 text-accent" />
          <div id="license-title" className="min-w-0 flex-1 text-[13px] font-semibold">{t('common.licenseTitle')}</div>
          <IconButton title={t('projects.action.closeEsc')} onClick={onClose}><X className="size-4" /></IconButton>
        </header>
        <pre className="overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-[12px] leading-relaxed text-muted">{licenseText.trim()}</pre>
      </div>
    </div>,
    document.body,
  );
}
