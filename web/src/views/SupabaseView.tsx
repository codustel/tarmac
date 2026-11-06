import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Copy, Database, ExternalLink, FolderGit2, Mail, PlugZap, Server } from 'lucide-react';
import { api } from '../api';
import type { SupabaseResponse } from '../api';
import { Badge, Card, Empty, IconButton, VsCodeIcon, copy, cx, useToast } from '../ui';
import { useT } from '../i18n';
import { ToolMissing } from './ToolMissing';

const tone = { running: 'green', partial: 'amber', stopped: 'neutral' } as const;
const label = { running: 'supabase.status.running', partial: 'supabase.status.partial', stopped: 'supabase.status.stopped' } as const;

function LinkBtn({ href, icon, children, primary }: { href?: string; icon: React.ReactNode; children: React.ReactNode; primary?: boolean }) {
  return (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!href}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
        primary ? 'bg-accent text-accent-fg hover:opacity-90' : 'border border-line bg-panel hover:bg-panel-2',
        !href && 'opacity-40 pointer-events-none',
      )}
    >
      {icon}{children}
    </a>
  );
}

export function SupabaseView({ data, query }: { data: SupabaseResponse | undefined; query: string }) {
  const toast = useToast();
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.tools, staleTime: 10_000 });
  if (tools.data?.find((x) => x.id === 'supabase')?.state === 'absent') return <ToolMissing tool="supabase" />;
  if (!data) return null;

  if (data.docker === 'unavailable') {
    return (
      <Card>
        <Empty icon={<PlugZap className="size-8" />} title={t('supabase.docker.title')}>
          {t('supabase.docker.hint', { error: data.error ?? '' })}
          {tools.data?.find((x) => x.id === 'docker')?.state === 'absent' && <div className="mt-2 font-medium">{t('tools.missing.dockerRequired')}</div>}
        </Empty>
      </Card>
    );
  }

  const q = query.toLowerCase();
  const instances = data.instances.filter((i) => !q || `${i.projectId} ${i.localPath ?? ''}`.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      {instances.length === 0 ? (
        <Card>
          <Empty icon={<Database className="size-8" />} title={t('supabase.empty.title')}>
            {t.node('supabase.empty.hint', { cmd: <code className="font-mono">supabase start</code> })}
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
          {instances.map((i) => (
            <Card key={i.projectId} className="flex flex-col">
              <div className="flex items-start gap-3 p-4">
                <div className={cx('grid size-9 shrink-0 place-items-center rounded-lg', i.status === 'running' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-panel-2 text-faint')}>
                  <Database className="size-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{i.projectId}</span>
                    <Badge tone={tone[i.status]}>{t(label[i.status])}</Badge>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-faint">
                    <FolderGit2 className="size-3" />
                    <span className="font-mono truncate">{i.localPath ?? t('supabase.instance.noLocal')}</span>
                  </div>
                </div>
                <span className="text-[11px] text-faint tabular-nums">{i.running}/{i.total}</span>
              </div>

              {i.apps.length > 0 && (
                <div className="flex flex-wrap gap-1 px-4 -mt-1 pb-3">
                  {i.apps.map((a) => <Badge key={a.id} tone="blue">{a.name}</Badge>)}
                </div>
              )}

              <div className="mt-auto flex items-center gap-1.5 border-t border-line px-4 py-2.5">
                <LinkBtn primary href={i.status !== 'stopped' ? i.urls.studio : undefined} icon={<ExternalLink className="size-3.5" />}>Studio</LinkBtn>
                <LinkBtn href={i.status !== 'stopped' ? i.urls.mail : undefined} icon={<Mail className="size-3.5" />}>{t('supabase.instance.mails')}</LinkBtn>
                {i.urls.api && (
                  <button onClick={() => copy(i.urls.api!, toast, t('supabase.instance.apiCopied'))} className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-mono text-[11px] text-muted hover:bg-panel-2" title={t('supabase.instance.copyApi')}>
                    <Server className="size-3" />{i.urls.api.replace('http://127.0.0.1', '')}
                  </button>
                )}
                <div className="flex-1" />
                {i.localDir && <IconButton title={t('supabase.instance.openVsCode')} onClick={() => api.open(i.localDir!, 'editor').catch((e) => toast('err', e.message))}><VsCodeIcon className="size-3" /></IconButton>}
                {i.dbUrl && <IconButton title={t('supabase.instance.copyDb')} onClick={() => copy(i.dbUrl!, toast, t('supabase.instance.dbCopied'))}><Copy className="size-3.5" /></IconButton>}
                <IconButton title={t('supabase.instance.services')} onClick={() => setOpen(open === i.projectId ? null : i.projectId)}>
                  <ChevronDown className={cx('size-4 transition-transform', open === i.projectId && 'rotate-180')} />
                </IconButton>
              </div>

              {open === i.projectId && (
                <div className="border-t border-line px-4 py-2">
                  {i.services.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 py-1 text-xs">
                      <span className={cx('size-1.5 rounded-full', s.state === 'running' ? 'bg-emerald-500' : 'bg-faint')} />
                      <span className="font-medium w-28 truncate">{s.name}</span>
                      <span className="text-faint truncate flex-1">{s.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {data.notCreated.length > 0 && (
        <section>
          <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('supabase.notCreated.title', { count: data.notCreated.length })}</h3>
          <Card className="divide-y divide-line">
            {data.notCreated.map((n) => (
              <div key={n.projectId + n.localPath} className="flex items-center gap-3 px-4 py-2.5">
                <Database className="size-4 text-faint" />
                <span className="font-medium">{n.projectId}</span>
                <span className="font-mono text-[11px] text-faint truncate flex-1">{n.localPath}</span>
                {n.ports.studio && <span className="font-mono text-[11px] text-faint">studio :{n.ports.studio}</span>}
                <IconButton title={t('supabase.notCreated.copyStart')} onClick={() => copy(`cd "${n.localDir}" && supabase start`, toast, t('supabase.notCreated.copied'))}>
                  <Copy className="size-3.5" />
                </IconButton>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
