import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, PlugZap, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { TOOL_NAMES } from '../tools/logic';
import { Button, Card, Empty, copy, useToast } from '../ui';
import { useT } from '../i18n';

/** Commande officielle d'installation affichée (jamais lancée d'ici) ; Docker : lien officiel seulement. */
const installCommand = (tool: 'docker' | 'supabase'): string | null =>
  tool === 'supabase' ? (/Win/i.test(navigator.userAgent) ? 'scoop install supabase' : 'brew install supabase/tap/supabase') : null;

/** Encadré d'une vue Docker ou Supabase dont l'outil manque : ce qui manque, comment l'installer, revérifier. */
export function ToolMissing({ tool }: { tool: 'docker' | 'supabase' }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.tools, staleTime: 10_000 });
  const docUrl = tools.data?.find((x) => x.id === tool)?.docUrl;
  const dockerState = tools.data?.find((x) => x.id === 'docker')?.state;
  const dockerMissing = tool === 'supabase' && (dockerState === 'absent' || dockerState === 'stopped');
  const cmd = installCommand(tool);
  const recheck = useQuery({ queryKey: ['tools', 'recheck'], queryFn: api.toolsFresh, enabled: false });
  const onRecheck = async () => {
    const r = await recheck.refetch();
    if (r.data) qc.setQueryData(['tools'], r.data);
    await qc.invalidateQueries({ queryKey: [tool] });
  };
  return (
    <Card>
      <Empty icon={<PlugZap className="size-8" />} title={t(`tools.missing.${tool}.title`)}>
        <div className="space-y-3">
          <div>{t(`tools.missing.${tool}.hint`)}</div>
          {dockerMissing && <div className="font-medium">{t('tools.missing.dockerRequired')}</div>}
          {cmd && (
            <div className="space-y-1">
              <div className="text-xs text-muted">{t('tools.missing.install')} ({TOOL_NAMES[tool]})</div>
              <button onClick={() => copy(cmd, toast)} title={cmd} className="rounded border border-line bg-panel-2 px-2 py-1 font-mono text-xs hover:bg-panel">{cmd}</button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {docUrl && (
              <a href={docUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-xs font-medium hover:bg-panel-2">
                <ExternalLink className="size-3.5" />{t('tools.missing.docs')}
              </a>
            )}
            <Button icon={<RefreshCw className="size-3.5" />} loading={recheck.isFetching} onClick={onRecheck}>{t('tools.missing.recheck')}</Button>
          </div>
        </div>
      </Empty>
    </Card>
  );
}
