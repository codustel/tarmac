import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Zap } from 'lucide-react';
import { api, type FreeReport, type PortsResponse, type Project } from '../api';
import { Badge, Button, Card, StatusDot, timeAgo, useToast } from '../ui';
import { useT, type TKey } from '../i18n';

/** Raisons d'épargner un process : le serveur envoie un texte français fixe ou un code d'erreur. */
const REASON_KEY: Record<string, TKey> = { 'process protégé': 'projects.ports.reason.protected', protected: 'projects.ports.reason.protected', erreur: 'projects.ports.reason.error', error: 'projects.ports.reason.error' };

export function PortsView({ data, apps }: { data: PortsResponse | undefined; apps: Project[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<FreeReport['report'] | null>(null);

  const free = useMutation({
    mutationFn: api.freePorts,
    onSuccess: (r) => {
      setReport(r.report);
      setConfirm(false);
      const killed = r.report.reduce((n, p) => n + p.killed.length, 0);
      toast('ok', t('projects.ports.freed', { count: killed }));
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast('err', e.message),
  });

  if (!data) return null;
  const byId = new Map(apps.map((a) => [a.id, a]));
  const active = apps.filter((a) => a.runtime.port && (a.runtime.status === 'running' || a.runtime.status === 'starting'));

  return (
    <div className="space-y-6">
      <Card className="flex flex-col sm:flex-row sm:items-center gap-4 p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-500"><ShieldAlert className="size-5" /></div>
        <div className="flex-1">
          <div className="font-semibold">{t('projects.ports.freeAllTitle')}</div>
          <div className="text-muted">
            {t('projects.ports.freeAllHint', { count: new Set(data.history.map((h) => h.port)).size })}
          </div>
        </div>
        {confirm ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>{t('projects.action.cancel')}</Button>
            <Button variant="danger" loading={free.isPending} icon={<Zap className="size-3.5" />} onClick={() => free.mutate()}>{t('projects.action.confirm')}</Button>
          </div>
        ) : (
          <Button variant="danger" icon={<Zap className="size-3.5" />} onClick={() => setConfirm(true)}>{t('projects.ports.free')}</Button>
        )}
      </Card>

      {report && (
        <Card className="p-4 text-xs">
          <div className="font-semibold mb-2">{t('projects.ports.lastCleanup')}</div>
          {report.length === 0 ? <div className="text-muted">{t('projects.ports.nothingLeft')}</div> : report.map((r) => (
            <div key={r.port} className="flex flex-wrap gap-2 py-0.5 font-mono">
              <span className="w-14">:{r.port}</span>
              {r.killed.map((k) => <Badge key={k.pid} tone="red">{t('projects.ports.killed', { name: k.name, pid: k.pid })}</Badge>)}
              {r.skipped.map((k) => <Badge key={k.pid}>{t('projects.ports.spared', { name: k.name, reason: REASON_KEY[k.reason] ? t(REASON_KEY[k.reason]) : k.reason })}</Badge>)}
            </div>
          ))}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section>
          <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
            {t('projects.ports.assigned', { start: data.range.start, end: data.range.end })}
          </h3>
          <Card className="divide-y divide-line">
            {[...data.assigned].sort((a, b) => a.port - b.port).map((p) => {
              const app = byId.get(p.appId);
              return (
                <div key={p.appId} className="flex items-center gap-3 px-4 py-2">
                  <span className="font-mono text-xs w-12 tabular-nums">:{p.port}</span>
                  {app && <StatusDot status={app.runtime.status} />}
                  <span className="flex-1 truncate">{p.appName}</span>
                  {active.some((a) => a.runtime.port === p.port) && <Badge tone="green">{t('projects.ports.active')}</Badge>}
                </div>
              );
            })}
            {data.assigned.length === 0 && <div className="px-4 py-6 text-center text-muted">{t('projects.ports.noneAssigned')}</div>}
          </Card>
        </section>

        <section>
          <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('projects.ports.history', { count: data.history.length })}</h3>
          <Card className="max-h-[480px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel text-faint text-left">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">{t('projects.ports.col.port')}</th>
                  <th className="px-2 py-2 font-medium">{t('projects.ports.col.app')}</th>
                  <th className="px-2 py-2 font-medium">{t('projects.ports.col.pid')}</th>
                  <th className="px-2 py-2 font-medium">{t('projects.ports.col.started')}</th>
                  <th className="px-4 py-2 font-medium">{t('projects.ports.col.ended')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.history.map((h, i) => (
                  <tr key={i}>
                    <td className="px-4 py-1.5 font-mono tabular-nums">:{h.port}</td>
                    <td className="px-2 py-1.5 truncate max-w-40">{h.appName}</td>
                    <td className="px-2 py-1.5 font-mono text-faint">{h.pid ?? '—'}</td>
                    <td className="px-2 py-1.5 text-muted">{timeAgo(h.startedAt)}</td>
                    <td className="px-4 py-1.5">{h.endedAt ? <span className="text-faint">{timeAgo(h.endedAt)}</span> : <Badge tone="green">{t('projects.ports.open')}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      </div>
    </div>
  );
}
