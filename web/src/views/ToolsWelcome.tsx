import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useT } from '../i18n';
import { shouldShowWelcome } from '../tools/logic';
import { ToolsCard } from './ToolsCard';

/** Écran d'accueil : propose d'installer les outils gérés manquants, une seule fois (« Plus tard » ou fin = vu). */
export function ToolsWelcome() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.tools, staleTime: 10_000 });
  const [open, setOpen] = useState<boolean | null>(null);

  // Décidé une fois, à la première réponse : l'installation ne doit pas faire disparaître l'écran en cours de route.
  if (open === null && settings.data && tools.data) setOpen(shouldShowWelcome(tools.data, settings.data.toolsWelcomeSeen));
  if (!open) return null;

  const done = () => {
    setOpen(false);
    api.saveSettings({ toolsWelcomeSeen: true }).then(() => qc.invalidateQueries({ queryKey: ['settings'] })).catch(() => null);
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/50 p-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl space-y-3">
        <div className="rounded-lg border border-line bg-panel px-5 py-4">
          <div className="text-base font-semibold">{t('tools.welcome.title')}</div>
          <div className="text-[13px] text-muted">{t('tools.welcome.intro')}</div>
        </div>
        <ToolsCard mode="welcome" onDone={done} />
      </div>
    </div>
  );
}
