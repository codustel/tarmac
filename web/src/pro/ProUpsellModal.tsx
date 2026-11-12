import { useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { useT } from '../i18n';
import { Button } from '../ui';
import { PRO_FEATURES, pricingUrl, type ProFeature } from './features';

/** Pastille « Pro » : petite capsule à la couleur d'accent du thème (lisible en clair et en sombre). */
export function ProBadge() {
  const t = useT();
  return <span className="rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">{t('pro.badge')}</span>;
}

/** Fenêtre de proposition : une fonctionnalité Pro verrouillée, la liste du Pro, lien vers les tarifs. */
export function ProUpsellModal({ feature, onClose }: { feature: ProFeature; onClose: () => void }) {
  const t = useT();
  const Icon = feature.icon;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t.loc(feature.name)} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <Icon className="size-5 text-accent" />
          <h2 className="text-[15px] font-semibold">{t.loc(feature.name)}</h2>
          <ProBadge />
        </div>
        <p className="mt-3 text-[13px] text-muted">{t.loc(feature.pitch)}</p>
        <div className="mt-4 text-[12px] font-medium text-faint">{t('pro.also')}</div>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {PRO_FEATURES.filter((f) => f.id !== feature.id).map((f) => (
            <li key={f.id} className="rounded border border-line bg-panel-2 px-2 py-0.5 text-[12px]">{t.loc(f.name)}</li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>{t('pro.later')}</Button>
          <a href={pricingUrl(t.lang)} target="_blank" rel="noreferrer" onClick={onClose}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg shadow-xs hover:opacity-90">
            {t('pro.upgrade')} <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
