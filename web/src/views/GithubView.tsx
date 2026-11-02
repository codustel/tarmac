import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, Download, ExternalLink, GitFork, KeyRound, Lock } from 'lucide-react';
import { TechIcon, githubLangId } from '../icons';
import { api, type GithubRepo, type GithubResponse, type TerminalSession } from '../api';
import { TerminalModal } from './TerminalModal';
import { GhCliLogin } from './GhCliLogin';
import { Badge, Button, Card, Empty, GitBadge, GithubIcon, IconButton, VsCodeIcon, copy, tildify, timeAgo, useToast } from '../ui';
import { useT } from '../i18n';

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{title} · {count}</h3>
      <Card className="divide-y divide-line overflow-hidden">{children}</Card>
    </section>
  );
}

export function GithubView({ data, error, query }: { data: GithubResponse | undefined; error: Error | null; query: string }) {
  const toast = useToast();
  const t = useT();
  if (error) {
    return (
      <Card>
        <Empty icon={<GithubIcon className="size-8" />} title={t('github.error')}>
          <div className="space-y-3">
            <div>{error.message}</div>
            <div className="flex justify-center"><GhCliLogin /></div>
          </div>
        </Empty>
      </Card>
    );
  }
  if (!data) return null;
  if (!data.configured) {
    return (
      <Card>
        <Empty icon={<KeyRound className="size-8" />} title={t('github.notConfigured.title')}>
          <div className="space-y-3">
            <div>{t.node('github.notConfigured.hint', { gh: <code className="font-mono">gh</code>, settings: <a href="#settings" className="text-accent hover:underline">{t('github.notConfigured.settings')}</a> })}</div>
            <div className="flex justify-center"><GhCliLogin /></div>
          </div>
        </Empty>
      </Card>
    );
  }

  const q = query.toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const remoteOnly = data.remoteOnly.filter((r) => match(`${r.fullName} ${r.description ?? ''} ${r.language ?? ''}`));
  const cloned = data.cloned.filter((r) => match(`${r.fullName} ${r.local.relPath}`));
  const outOfSync = cloned.filter((r) => r.local.git.sync !== 'synced' || r.local.git.changes + r.local.git.untracked > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          [t('github.stats.repos'), data.remoteOnly.length + data.cloned.length],
          [t('github.stats.cloned'), data.cloned.length],
          [t('github.stats.remoteOnly'), data.remoteOnly.length],
          [t('github.stats.outOfSync'), outOfSync.length],
        ].map(([l, v]) => (
          <Card key={l} className="px-4 py-3">
            <div className="text-[11px] text-faint">{l}</div>
            <div className="text-xl font-semibold tabular-nums">{v}</div>
          </Card>
        ))}
      </div>

      {data.owners.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {t('github.owners.label')}
          {data.owners.map((o) => <Badge key={o}><GithubIcon className="size-3" />{o}</Badge>)}
          <a href="#settings" className="text-accent hover:underline">{t('github.owners.edit')}</a>
        </div>
      )}

      <Section title={t('github.section.cloned')} count={cloned.length}>
        {cloned.map((r) => (
          <div key={r.fullName} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-4 px-4 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-medium truncate"><TechIcon id={githubLangId(r.language)} label={r.language ?? '—'} size={13} />{r.fullName}</div>
              <div className="font-mono text-[11px] text-faint truncate">{r.local.relPath}</div>
            </div>
            <div className="text-[11px] text-muted"><span className="font-mono">{r.local.git.branch}</span></div>
            <div><GitBadge git={r.local.git} /></div>
            <div className="flex items-center gap-0.5">
              <IconButton title={t('github.openVsCode')} onClick={() => api.open(r.local.dir, 'editor').catch((e) => toast('err', e.message))}><VsCodeIcon className="size-3.5" /></IconButton>
              <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-fg"><ExternalLink className="size-4" /></a>
            </div>
          </div>
        ))}
        {cloned.length === 0 && <div className="px-4 py-6 text-center text-muted">{t('github.noClone')}</div>}
      </Section>

      <Section title={t('github.section.remoteOnly')} count={remoteOnly.length}>
        {remoteOnly.map((r) => (
          <div key={r.fullName} className="group grid grid-cols-[minmax(0,2fr)_110px_120px_auto] items-center gap-4 px-4 py-2 hover:bg-panel-2/40">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium truncate">{r.fullName}</span>
                {r.private && <Lock className="size-3 text-faint" />}
                {r.fork && <GitFork className="size-3 text-faint" />}
                {r.archived && <Badge><Archive className="size-3" />{t('github.archived')}</Badge>}
              </div>
              {r.description && <div className="text-[11px] text-faint truncate">{r.description}</div>}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted">{r.language && <TechIcon id={githubLangId(r.language)} label={r.language} size={12} />}{r.language ?? '—'}</div>
            <div className="text-[11px] text-faint" title={r.pushedAt}>{timeAgo(r.pushedAt)}</div>
            <div className="flex items-center gap-1">
              <CloneButton repo={r} />
              <IconButton title={t('github.copyClone')} onClick={() => copy(`git clone ${r.sshUrl}`, toast, t('github.cloneCopied'))}><Copy className="size-3.5" /></IconButton>
              <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-fg"><ExternalLink className="size-4" /></a>
            </div>
          </div>
        ))}
      </Section>

      {data.localOnly.length > 0 && (
        <Section title={t('github.section.localOnly')} count={data.localOnly.length}>
          {data.localOnly.map((r) => (
            <div key={r.relPath} className="flex items-center gap-3 px-4 py-2.5">
              <span className="font-mono text-xs flex-1 truncate">{r.relPath}</span>
              <GitBadge git={r.git} />
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

/** Clone le repo dans le dossier de clonage (premier dossier scanné par défaut), progression dans une console. */
function CloneButton({ repo }: { repo: GithubRepo }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const [session, setSession] = useState<TerminalSession | null>(null);
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: 60_000 });
  const dest = settings.data ? `${tildify(settings.data.cloneDir, meta.data?.home)}/${repo.name}` : repo.name;

  const clone = useMutation({
    mutationFn: () => api.clone(repo.fullName),
    onSuccess: setSession,
    onError: (e: Error) => toast('err', e.message),
  });

  return (
    <>
      <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} loading={clone.isPending} title={t('github.clone.title', { dest })} onClick={() => clone.mutate()}>
        {t('github.clone.button')}
      </Button>
      {session && (
        <TerminalModal
          session={session}
          title={t('github.clone.modalTitle', { repo: repo.fullName })}
          subtitle={`→ ${dest}`}
          icon={<GithubIcon className="size-4" />}
          onClose={() => setSession(null)}
          onExit={(code) => {
            if (code === 0) {
              toast('ok', t('github.clone.done', { name: repo.name, dest }));
              // Le serveur relance le scan ; on rafraîchit GitHub et Projets.
              setTimeout(() => qc.invalidateQueries(), 1500);
            }
          }}
        />
      )}
    </>
  );
}
