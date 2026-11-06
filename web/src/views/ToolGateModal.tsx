import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Badge, Button, IconButton, useToast } from '../ui';
import { useT } from '../i18n';
import { TerminalView } from './TerminalView';
import { TOOL_NAMES, XCODE_MAX_MS, gateAction, isXcodeInstall, xcodeWait } from '../tools/logic';
import { gate } from '../tools/gate';
import { useAfterInstall, useToolJob } from '../tools/useToolJob';

const METHODS = ['brew', 'npm', 'winget', 'official', 'xcode'] as const;

/** Garde au premier appel : propose d'installer (puis de connecter) l'outil manquant, puis relance l'action en attente. */
export function ToolGateModal() {
  const req = useSyncExternalStore(gate.subscribe, gate.current);
  return req ? <Gate key={`${req.tool}:${req.state}`} req={req} /> : null;
}

function Gate({ req }: { req: NonNullable<ReturnType<typeof gate.current>> }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const name = TOOL_NAMES[req.tool] ?? req.tool;
  const [loginNext, setLoginNext] = useState(false);
  // Git par xcode : la console fermée ne prouve rien, on attend que l'outil soit prêt (relevé toutes les 5 s).
  const [xcodeUntil, setXcodeUntil] = useState(0);
  const xcodeStarted = useRef(false);
  const action = gateAction(req);
  const loginOnly = action === 'login';
  const afterInstall = useAfterInstall();

  const { job, busy, start, closeConsole, proceed } = useToolJob({
    onSuccess: async (cur) => {
      if (isXcodeInstall(cur.id, cur.kind, req.installMethod)) { xcodeStarted.current = true; setXcodeUntil(Date.now() + XCODE_MAX_MS); return; }
      if (cur.kind === 'install') await afterInstall(cur.id);
      await qc.invalidateQueries({ queryKey: ['tools'] });
    },
    onDone: async (cur, ok) => {
      if (!ok) { gate.resolve(false); return; }
      if (xcodeStarted.current) return;
      if (cur.kind === 'install') {
        const state = await api.tools().then((l) => l.find((x) => x.id === cur.id)?.state).catch(() => undefined);
        if (state === 'logged-out') { setLoginNext(true); return; }
      }
      gate.resolve(true);
    },
    onAbort: () => gate.resolve(false),
    onStartError: (_id, e) => { toast('err', e.message); gate.resolve(false); },
  });

  useEffect(() => {
    if (!xcodeUntil) return;
    const timer = setInterval(() => {
      api.tools().then(async (l) => {
        const d = xcodeWait(l.find((x) => x.id === req.tool)?.state, Date.now(), xcodeUntil);
        if (d === 'wait') return;
        clearInterval(timer);
        if (d === 'timeout') { gate.resolve(false); return; }
        await afterInstall(req.tool);
        await qc.invalidateQueries({ queryKey: ['tools'] });
        gate.resolve(true);
      }).catch(() => null);
    }, 5000);
    return () => clearInterval(timer);
  }, [xcodeUntil, req.tool]);

  // Une seule demande à la fois ; si elle change sous nos pieds, l'état de connexion repart de zéro.
  useEffect(() => { setLoginNext(false); }, [req.tool]);

  const method = METHODS.find((m) => m === req.installMethod);
  const question = loginNext ? t('tools.gate.loginAfter', { name })
    : loginOnly ? t('tools.gate.login', { name })
    : action === 'doc' ? t('tools.gate.noInstall', { name })
    : method ? t('tools.gate.install', { name, method: t(`tools.gate.method.${method}` as 'tools.gate.method.brew') })
    : t('tools.gate.installAny', { name });
  const confirmLabel = loginNext || loginOnly ? t('tools.login') : t('tools.gate.installBtn');
  const confirm = () => void start(req.tool, loginNext || loginOnly ? 'login' : 'install');

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6 backdrop-blur-sm">
      {job ? (
        <div className="flex h-[480px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
          <header className="flex items-center gap-2 border-b border-line px-4 h-12">
            <div className="flex-1 font-semibold text-[13px]">{job.kind === 'install' ? t('tools.installing', { name }) : t('tools.consoleLogin', { name })}</div>
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
      ) : xcodeUntil ? (
        <div role="dialog" className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-panel p-5 shadow-2xl">
          <div className="text-[13px] font-medium">{t('tools.xcodeWaiting')}</div>
          <div className="flex justify-end"><Button variant="ghost" onClick={() => gate.resolve(false)}>{t('tools.gate.cancel')}</Button></div>
        </div>
      ) : (
        <div role="dialog" className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-panel p-5 shadow-2xl">
          <div className="text-[13px] font-medium">{question}</div>
          {action === 'install' && !loginNext && (req.tool === 'claude' || req.tool === 'codex') && (
            <div className="text-[12px] text-muted">{t('tools.integration.note')}</div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => gate.resolve(false)}>{t('tools.gate.cancel')}</Button>
            {action === 'doc' && !loginNext ? (
              <Button variant="primary" icon={<ExternalLink className="size-3.5" />} onClick={() => { window.open(req.docUrl, '_blank', 'noopener'); gate.resolve(false); }}>
                {t('tools.gate.openDoc')}
              </Button>
            ) : (
              <Button variant="primary" loading={busy === req.tool} onClick={confirm}>{confirmLabel}</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
