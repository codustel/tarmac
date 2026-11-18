import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eraser } from 'lucide-react';
import { api } from '../api';
import { Button } from '../ui';
import { useT } from '../i18n';
import { PRO_FEATURES, proButtonMode } from '../pro/features';
import { ProBadge, ProUpsellModal } from '../pro/ProUpsellModal';
import { ModuleModal } from './ModuleModal';

type Agent = 'claude' | 'codex';
const isMac = () => /Mac/.test(navigator.userAgent);

/** Fenêtre du module `leftovers` ; `projectDir` limite la liste à un projet (et propose de choisir l'agent). */
export function LeftoversModal({ agent = 'claude', projectDir, onClose }: { agent?: Agent; projectDir?: string; onClose: () => void }) {
  const t = useT();
  const modules = useQuery({ queryKey: ['modules'], queryFn: api.modules, staleTime: Infinity });
  const params: Record<string, string> = { agent, chooseAgent: projectDir ? '1' : '0' };
  if (projectDir) params.projectDir = projectDir;
  return <ModuleModal module={modules.data?.find((m) => m.id === 'leftovers')} params={params} title={t('leftovers.title')} onClose={onClose} />;
}

/**
 * Bouton « Restes » : avec le module Pro `leftovers`, ouvre sa fenêtre (avec le nombre de restes) ; sans lui, une
 * pastille Pro ouvre la proposition. Masqué hors Mac et quand le module dit ne pas être pris en charge.
 */
export function LeftoversButton({ agent, projectDir }: { agent?: Agent; projectDir?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const modules = useQuery({ queryKey: ['modules'], queryFn: api.modules, staleTime: Infinity });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const mode = modules.data ? proButtonMode(modules.data, 'leftovers', !!settings.data?.hideProTeasers) : 'none';
  const summary = useQuery({
    queryKey: ['leftovers-summary'],
    enabled: mode === 'toggle' && isMac(),
    refetchInterval: 30_000,
    queryFn: async (): Promise<{ supported: boolean; leftovers: { claude: number; codex: number } }> => {
      const r = await fetch('/api/modules/leftovers/summary');
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });

  if (!isMac() || mode === 'none') return null;
  if (mode === 'pro') {
    return (
      <>
        <Button size="sm" variant="ghost" icon={<Eraser className="size-3.5" />} onClick={() => setOpen(true)}>
          {t('leftovers.button')}<ProBadge />
        </Button>
        {open && <ProUpsellModal feature={PRO_FEATURES.find((f) => f.id === 'leftovers')!} onClose={() => setOpen(false)} />}
      </>
    );
  }
  if (!summary.data?.supported) return null;
  const l = summary.data.leftovers;
  const count = agent ? l[agent] : l.claude + l.codex;
  return (
    <>
      <Button size="sm" icon={<Eraser className="size-3.5" />} title={t('leftovers.hint', { count })} onClick={() => setOpen(true)}>
        {t('leftovers.button')}
        {count > 0 && <span className="rounded bg-amber-500/15 px-1 text-[10px] tabular-nums text-amber-600 dark:text-amber-400">{count}</span>}
      </Button>
      {open && <LeftoversModal agent={agent} projectDir={projectDir} onClose={() => setOpen(false)} />}
    </>
  );
}
