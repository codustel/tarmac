import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ModuleInfo } from '../api';
import { IconButton } from '../ui';
import { useT } from '../i18n';
import { ModuleView } from './ModuleView';

/** Vue d'un module dans une modale (Échap et clic à l'extérieur ferment) ; `params` est transmis à la vue. */
export function ModuleModal({ module, params, title, onClose }: { module: ModuleInfo | undefined; params: Record<string, string>; title: string; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    // Capture : Échap ferme la modale sans fermer aussi le panneau projet.
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</div>
          <IconButton title={t('projects.action.closeEsc')} onClick={onClose}><X className="size-4" /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4"><ModuleView module={module} params={params} /></div>
      </div>
    </div>,
    document.body,
  );
}
