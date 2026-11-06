import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, LogIn, RefreshCw, X } from 'lucide-react';
import { api, type IntegrationResult, type ToolStatus } from '../api';
import { Badge, Button, Card, IconButton } from '../ui';
import { useT } from '../i18n';
import { TerminalView } from './TerminalView';
import { MANAGED_ORDER, TOOL_NAMES, XCODE_MAX_MS, canInstall, installCheckbox, installQueue, isXcodeInstall, showOfficialLink, type ManagedId } from '../tools/logic';
import { useAfterInstall, useToolJob } from '../tools/useToolJob';

const TONE = { absent: 'amber', 'logged-out': 'amber', ready: 'green', stopped: 'neutral', unknown: 'neutral' } as const;

/** Carte « Outils » : état, installation, connexion et mise à jour des outils fournis (écran d'accueil et Réglages). */
export function ToolsCard({ mode, onDone }: { mode: 'welcome' | 'settings'; onDone?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [xcodeUntil, setXcodeUntil] = useState(0);
  const q = useQuery({
    queryKey: ['tools'],
    queryFn: api.tools,
    staleTime: 10_000,
    refetchInterval: () => (xcodeUntil > Date.now() ? 5000 : false),
  });
  const tools = q.data;
  const [checked, setChecked] = useState<Set<ManagedId>>(new Set());
  const initChecked = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [integrations, setIntegrations] = useState<Record<string, IntegrationResult>>({});
  const afterInstall = useAfterInstall();
  const toolsRef = useRef<ToolStatus[] | undefined>(tools);
  toolsRef.current = tools;

  // Cases cochées par défaut pour les outils gérés absents (une seule fois).
  useEffect(() => {
    if (!tools || initChecked.current) return;
    initChecked.current = true;
    setChecked(new Set(tools.filter(canInstall).map((x) => x.id as ManagedId)));
  }, [tools]);

  // Git par xcode : la fenêtre macOS est ouverte, on rafraîchit jusqu'à `ready` (au plus 15 min).
  const xcodeWaiting = !!tools && tools.find((x) => x.id === 'git')?.state === 'absent' && xcodeUntil > Date.now();
  useEffect(() => {
    if (xcodeUntil && tools?.find((x) => x.id === 'git')?.state === 'ready') setXcodeUntil(0);
  }, [tools, xcodeUntil]);

  const { job, busy, start, proceed, closeConsole } = useToolJob({
    onFailed: (cur, exitCode) => {
      setErrors((e) => ({ ...e, [cur.id]: t('tools.failed', { code: String(exitCode) }) }));
      qc.invalidateQueries({ queryKey: ['tools'] });
    },
    onSuccess: async (cur) => {
      const xcode = isXcodeInstall(cur.id, cur.kind, toolsRef.current?.find((x) => x.id === 'git')?.installMethod);
      if (xcode) setXcodeUntil(Date.now() + XCODE_MAX_MS);
      else if (cur.kind === 'install') {
        const integration = await afterInstall(cur.id);
        if (integration) setIntegrations((x) => ({ ...x, [cur.id]: integration }));
      }
      await qc.invalidateQueries({ queryKey: ['tools'] });
      if (cur.id === 'gh') qc.invalidateQueries({ queryKey: ['ghcli'] });
    },
    onDone: (cur) => { if (cur.kind === 'install' && mode === 'welcome') onDone?.(); },
    onAbort: () => { qc.invalidateQueries({ queryKey: ['tools'] }); },
    onStart: (id) => setErrors((e) => ({ ...e, [id]: '' })),
    onStartError: (id, e) => setErrors((x) => ({ ...x, [id]: e.message })),
  });

  const queue = tools ? installQueue(tools, checked) : [];
  const installSelection = () => {
    const [first, ...rest] = queue;
    if (first) void start(first, 'install', rest);
  };
  const toggle = (id: ManagedId) => setChecked((c) => {
    const n = new Set(c);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const consoleTitle = job
    ? job.kind === 'install' ? t('tools.installing', { name: TOOL_NAMES[job.id] }) : job.kind === 'login' ? t('tools.consoleLogin', { name: TOOL_NAMES[job.id] }) : t('tools.consoleUpdate', { name: TOOL_NAMES[job.id] })
    : '';

  return (
    <>
      <Card className="divide-y divide-line">
        <div className="px-5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{t('tools.title')}</div>
          {mode === 'welcome' && <div className="mt-1 text-[12px] font-medium text-fg">{t('tools.welcome.recommended')}</div>}
        </div>
        {!tools ? (
          <div className="px-5 py-4 text-xs text-muted">{t('tools.checking')}</div>
        ) : (
          tools.map((x) => {
            const managedId = MANAGED_ORDER.find((m) => m === x.id);
            const err = errors[x.id];
            const box = installCheckbox(x, mode);
            const integration = integrations[x.id];
            return (
              <div key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                {managedId && box !== 'none' ? (
                  <input
                    type="checkbox"
                    aria-label={TOOL_NAMES[x.id]}
                    className="size-4 accent-current"
                    checked={box === 'active' && checked.has(managedId)}
                    disabled={box !== 'active' || !!job}
                    onChange={() => toggle(managedId)}
                  />
                ) : <span className="size-4" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold">{TOOL_NAMES[x.id]}</span>
                    <Badge tone={TONE[x.state]}>{x.state === 'ready' && <CheckCircle2 className="size-3" />}{t(`tools.state.${x.state}` as 'tools.state.ready')}</Badge>
                    {x.version && <span className="font-mono text-[11px] text-faint">{x.version}</span>}
                    {x.managed && x.state !== 'absent' && x.method === null && <span className="text-[11px] text-faint">{t('tools.external')}</span>}
                  </div>
                  <div className="text-[12px] text-muted">{t(`tools.role.${x.id}` as 'tools.role.git')}</div>
                  {x.id === 'git' && xcodeWaiting && <div className="text-[11px] text-faint">{t('tools.xcodeWaiting')}</div>}
                  {(x.id === 'claude' || x.id === 'codex') && canInstall(x) && <div className="text-[11px] text-faint">{t('tools.integration.note')}</div>}
                  {x.managed && showOfficialLink(x) && <div className="text-[11px] text-faint">{t('tools.noInstall')}</div>}
                  {integration && (
                    <div className={`text-[11px] ${integration.ok ? 'text-faint' : 'text-red-500'}`}>
                      {integration.ok ? t('tools.integration.done') : t('tools.integration.failed', { error: integration.error ?? '' })}
                      {integration.output && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-muted">{t('tools.integration.details')}</summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-panel-2 p-2 font-mono text-[10px] text-muted">{integration.output}</pre>
                        </details>
                      )}
                    </div>
                  )}
                  {err && <div className="text-[11px] text-red-500">{err}</div>}
                </div>
                {showOfficialLink(x) && (
                  <a href={x.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
                    {t('tools.doc')} <ExternalLink className="size-3" />
                  </a>
                )}
                {x.state === 'logged-out' && (
                  <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} loading={busy === x.id} disabled={!!job} onClick={() => start(x.id, 'login')}>{t('tools.login')}</Button>
                )}
                {x.updatable && (
                  <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy === x.id} disabled={!!job} title={x.latest ? t('tools.updateTo', { version: x.latest }) : undefined} onClick={() => start(x.id, 'update')}>{t('tools.update')}</Button>
                )}
                {err && managedId && canInstall(x) && (
                  <Button size="sm" disabled={!!job} loading={busy === x.id} onClick={() => start(x.id, 'install')}>{t('tools.retry')}</Button>
                )}
              </div>
            );
          })
        )}
        {mode === 'welcome' && tools && (
          <div className="flex justify-end gap-2 px-5 py-3">
            <Button variant="ghost" onClick={onDone}>{t('tools.welcome.later')}</Button>
            <Button variant="primary" disabled={!queue.length || !!job} loading={!!job && job.kind === 'install'} onClick={installSelection}>{t('tools.installSelection')}</Button>
          </div>
        )}
        {mode === 'settings' && tools && queue.length > 0 && (
          <div className="flex justify-end px-5 py-3">
            <Button variant="primary" disabled={!!job} onClick={installSelection}>{t('tools.installSelection')}</Button>
          </div>
        )}
      </Card>

      {job && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="flex h-[480px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
            <header className="flex items-center gap-2 border-b border-line px-4 h-12">
              <div className="flex-1 font-semibold text-[13px]">{consoleTitle}</div>
              {job.session.status === 'exited' && (
                <Badge tone={job.session.exitCode === 0 ? 'green' : 'red'}>{job.session.exitCode === 0 ? t('tools.consoleDone') : t('tools.failed', { code: String(job.session.exitCode) })}</Badge>
              )}
              {job.paused && <Button size="sm" variant="primary" onClick={() => void proceed(job)}>{t('tools.continue')}</Button>}
              <IconButton title={t('tools.consoleClose')} onClick={closeConsole}><X className="size-4" /></IconButton>
            </header>
            <div className="min-h-0 flex-1 bg-[#0a0c10]">
              <TerminalView sid={job.session.id} active />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
