import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, Play, RotateCcw, Smartphone, Square, TerminalSquare, X, XCircle } from 'lucide-react';
import { api, type AndroidStatus, type Avd, type TerminalSession } from '../api';
import { socket } from '../socket';
import { Badge, Button, Card, Empty, IconButton, copy, cx, useToast } from '../ui';
import { useT, type TKey } from '../i18n';
import { TerminalView } from './TerminalView';

const stateMeta: Record<Avd['state'], { label: TKey; tone: 'neutral' | 'amber' | 'blue' | 'green' }> = {
  stopped: { label: 'android.state.stopped', tone: 'neutral' },
  starting: { label: 'android.state.starting', tone: 'amber' },
  booting: { label: 'android.state.booting', tone: 'blue' },
  ready: { label: 'android.state.ready', tone: 'green' },
  stopping: { label: 'android.state.stopping', tone: 'amber' },
};

/** Onglet Android : diagnostic de l'outillage (avec commandes d'installation) et émulateurs existants. */
export function AndroidView({ data }: { data: AndroidStatus | undefined }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [session, setSession] = useState<TerminalSession | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['android'] });

  const install = useMutation({
    mutationFn: api.androidInstall,
    onSuccess: setSession,
    onError: (e: Error) => toast('err', e.message),
  });
  const action = useMutation({
    mutationFn: ({ name, op }: { name: string; op: 'start' | 'cold' | 'stop' }) => (op === 'stop' ? api.avdStop(name) : api.avdStart(name, op === 'cold')),
    onSettled: refresh,
    onError: (e: Error) => toast('err', e.message),
  });

  // Fin d'une installation : nouveau diagnostic.
  useEffect(() => {
    if (!session) return;
    return socket.on((msg) => {
      if (msg.type !== 'terminals' || msg.projectId !== '__android__') return;
      const s = (msg.sessions as TerminalSession[]).find((x) => x.id === session.id);
      if (s?.status === 'exited') {
        setSession((cur) => (cur ? { ...cur, status: 'exited', exitCode: s.exitCode } : cur));
        refresh();
      }
    });
  }, [session?.id]);

  const close = () => {
    if (session) api.closeTerminal(session.id).catch(() => null);
    setSession(null);
    refresh();
  };

  if (!data) return null;
  const label = (id: string) => data.checks.find((c) => c.id === id)?.label ?? id;
  const missing = data.checks.filter((c) => !c.ok);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-[13px] font-semibold">{t('android.tools.title')}</h2>
          {missing.length === 0
            ? <Badge tone="green"><CheckCircle2 className="size-3" />{t('android.tools.allReady')}</Badge>
            : <Badge tone="amber">{t('android.tools.missing', { count: missing.length })}</Badge>}
          <span className="ml-auto font-mono text-[11px] text-faint">{t('android.tools.sdk', { path: data.sdk })}</span>
        </div>
        <Card className="divide-y divide-line">
          {data.checks.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
              {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <XCircle className="size-4 shrink-0 text-amber-500" />}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{c.label}</div>
                <div className="truncate font-mono text-[11px] text-faint" title={c.detail}>{c.detail}</div>
              </div>
              {c.install && (
                <div className="flex w-full items-center gap-1.5 pl-7 sm:w-auto sm:pl-0">
                  <button
                    onClick={() => copy(c.install!, toast, t('android.tools.copied'))}
                    title={c.install}
                    className="inline-flex max-w-[360px] items-center gap-1 truncate rounded-md border border-line bg-panel-2 px-2 h-7 font-mono text-[11px] text-muted hover:text-fg"
                  >
                    <span className="truncate">{c.install}</span><Copy className="size-3 shrink-0" />
                  </button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<TerminalSquare className="size-3.5" />}
                    disabled={c.blockedBy.length > 0}
                    title={c.blockedBy.length ? t('android.tools.installFirst', { list: c.blockedBy.map(label).join(', ') }) : undefined}
                    loading={install.isPending && install.variables === c.id}
                    onClick={() => install.mutate(c.id)}
                  >
                    {t('android.tools.install')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold">{t('android.avds.title')}</h2>
        {data.avds.length === 0 ? (
          <Card>
            <Empty icon={<Smartphone className="size-8" />} title={t('android.avds.emptyTitle')}>
              {t('android.avds.emptyHint', { label: label('avd') })}
            </Empty>
          </Card>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
            {data.avds.map((a) => {
              const m = stateMeta[a.state];
              const busy = action.isPending && action.variables?.name === a.name;
              const canStart = !!data.checks.find((c) => c.id === 'emulator')?.ok && !a.missingImage;
              return (
                <Card key={a.name} className="flex flex-col">
                  <div className="flex items-start gap-3 p-4">
                    <div className={cx('grid size-9 shrink-0 place-items-center rounded-lg', a.state === 'ready' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-panel-2 text-faint')}>
                      <Smartphone className="size-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{a.name.replaceAll('_', ' ')}</span>
                        <Badge tone={m.tone}>{t(m.label)}</Badge>
                      </div>
                      <div className="mt-0.5 text-[11px] text-faint">
                        {[a.api && `API ${a.api}`, a.image, a.device, a.serial].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>

                  {a.missingImage && (
                    <div className="mx-4 mb-3 flex items-center gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      <span className="flex-1">{t.node('android.avds.missingImage', { image: <span className="font-mono">{a.missingImage}</span> })}</span>
                      <Button size="sm" onClick={() => install.mutate(`image:${a.missingImage}`)}>{t('android.tools.install')}</Button>
                    </div>
                  )}
                  {a.error && (
                    <pre className="mx-4 mb-3 whitespace-pre-wrap rounded-md bg-red-500/10 px-2.5 py-1.5 font-mono text-[11px] text-red-700 dark:text-red-400">{a.error}</pre>
                  )}

                  <div className="mt-auto flex items-center gap-1.5 border-t border-line px-4 py-2.5">
                    {a.state === 'stopped' ? (
                      <>
                        <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} loading={busy && action.variables?.op === 'start'} disabled={!canStart} onClick={() => action.mutate({ name: a.name, op: 'start' })}>
                          {t('android.avds.start')}
                        </Button>
                        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} loading={busy && action.variables?.op === 'cold'} disabled={!canStart}
                          title={t('android.avds.coldTitle')}
                          onClick={() => action.mutate({ name: a.name, op: 'cold' })}>
                          {t('android.avds.cold')}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="danger" icon={<Square className="size-3.5" />} loading={busy || a.state === 'stopping'} onClick={() => action.mutate({ name: a.name, op: 'stop' })}>
                        {t('android.avds.stop')}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {session && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onClick={close}>
          <div className="flex h-[480px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex h-12 items-center gap-2 border-b border-line px-4">
              <Smartphone className="size-4" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{session.label}</div>
                <div className="truncate font-mono text-[11px] text-faint">{session.command}</div>
              </div>
              {session.status === 'exited' && (
                <Badge tone={session.exitCode === 0 ? 'green' : 'red'}>{session.exitCode === 0 ? t('android.install.done') : t('android.install.failed', { code: String(session.exitCode) })}</Badge>
              )}
              <IconButton title={t('android.install.close')} onClick={close}><X className="size-4" /></IconButton>
            </header>
            <div className="min-h-0 flex-1 bg-[#0a0c10]">
              <TerminalView sid={session.id} active />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
