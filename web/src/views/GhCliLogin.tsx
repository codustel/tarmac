import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, ExternalLink, LogIn, RefreshCw, X } from 'lucide-react';
import { api, type TerminalSession } from '../api';
import { socket } from '../socket';
import { Badge, Button, GithubIcon, IconButton, useToast } from '../ui';
import { useT } from '../i18n';
import { TerminalView } from './TerminalView';
import { gate } from '../tools/gate';
import { gateAction } from '../tools/logic';

/** État de la CLI `gh` + bouton de connexion (flux navigateur dans une console intégrée). */
export function GhCliLogin({ compact }: { compact?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const status = useQuery({ queryKey: ['ghcli'], queryFn: api.ghCli, staleTime: 30_000 });
  const [session, setSession] = useState<TerminalSession | null>(null);
  // gh absent : installation par Tarmac (garde du premier appel), moyen d'installation lu dans l'état des outils.
  const absent = status.data?.installed === false;
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.tools, staleTime: 10_000, enabled: absent });
  const ghTool = tools.data?.find((x) => x.id === 'gh');
  const ghReq = { tool: 'gh', state: 'absent', installMethod: ghTool ? ghTool.installMethod : undefined, docUrl: ghTool?.docUrl };
  const install = async () => {
    if (!(await gate.ask(ghReq))) return;
    qc.invalidateQueries({ queryKey: ['ghcli'] });
    qc.invalidateQueries({ queryKey: ['github'] });
  };

  const login = useMutation({
    mutationFn: () => api.ghLogin(100, 24),
    onSuccess: setSession,
    onError: (e: Error) => toast('err', e.message),
  });

  // Fin de `gh auth login` : on rafraîchit l'état et la liste GitHub.
  useEffect(() => {
    if (!session) return;
    return socket.on((msg) => {
      if (msg.type !== 'terminals' || msg.projectId !== '__system__') return;
      const s = (msg.sessions as TerminalSession[]).find((x) => x.id === session.id);
      if (s?.status === 'exited') {
        setSession((cur) => (cur ? { ...cur, status: 'exited', exitCode: s.exitCode } : cur));
        qc.invalidateQueries({ queryKey: ['ghcli'] });
        qc.invalidateQueries({ queryKey: ['github'] });
        if (s.exitCode === 0) toast('ok', t('github.gh.connectedToast'));
      }
    });
  }, [session?.id, qc, toast, t]);

  const close = () => {
    if (session) api.closeTerminal(session.id).catch(() => null);
    setSession(null);
  };

  const st = status.data;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!st ? (
          <span className="text-muted text-xs">{t('github.gh.checking')}</span>
        ) : !st.installed ? (
          <>
            <Badge tone="amber">{t('github.gh.notInstalled')}</Badge>
            {gateAction(ghReq) === 'doc' ? (
              <a href={ghReq.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
                {t('tools.gate.openDoc')} <ExternalLink className="size-3" />
              </a>
            ) : (
              <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} onClick={() => void install()}>{t('tools.gate.installBtn')}</Button>
            )}
          </>
        ) : st.loggedIn ? (
          <>
            <Badge tone="green"><CheckCircle2 className="size-3" />{st.user ? t('github.gh.connectedAs', { user: st.user }) : t('github.gh.connected')}</Badge>
            {!compact && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={login.isPending} onClick={() => login.mutate()}>{t('github.gh.switchAccount')}</Button>}
          </>
        ) : (
          <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} loading={login.isPending} onClick={() => login.mutate()}>
            {t('github.gh.connect')}
          </Button>
        )}
      </div>

      {session && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onClick={close}>
          <div className="flex h-[480px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center gap-2 border-b border-line px-4 h-12">
              <GithubIcon className="size-4" />
              <div className="flex-1">
                <div className="font-semibold text-[13px]">{t('github.gh.loginTitle')}</div>
                <div className="text-[11px] text-faint">{t('github.gh.loginHint')}</div>
              </div>
              {session.status === 'exited' && (
                <Badge tone={session.exitCode === 0 ? 'green' : 'red'}>{session.exitCode === 0 ? t('github.gh.done') : t('github.gh.failed', { code: String(session.exitCode) })}</Badge>
              )}
              <IconButton title={t('github.gh.close')} onClick={close}><X className="size-4" /></IconButton>
            </header>
            <div className="min-h-0 flex-1 bg-[#0a0c10]">
              <TerminalView sid={session.id} active />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
