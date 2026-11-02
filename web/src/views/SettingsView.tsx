import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FolderPlus, KeyRound, Plus, Save, Trash2, X } from 'lucide-react';
import { api, type Settings, type SettingsPatch } from '../api';
import { Badge, Button, Card, GithubIcon, copy, cx, tildify, useToast } from '../ui';
import { GhCliLogin } from './GhCliLogin';
import { fmtDateTime, useLanguageSetting, useT, type LanguageSetting } from '../i18n';

const input = 'h-8 w-full rounded-md border border-line bg-panel px-2.5 text-[13px] outline-none placeholder:text-faint focus:border-accent';

function Field({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-2 px-5 py-4 md:grid-cols-[260px_1fr]">
      <div>
        <div className="font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsView() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: 60_000 });
  const home = meta.data?.home;

  const [roots, setRoots] = useState<string[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [ownerDraft, setOwnerDraft] = useState('');
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [editor, setEditor] = useState<Settings['editor']>('vscode');
  const [range, setRange] = useState({ start: 4100, end: 4999 });
  const [depth, setDepth] = useState(6);
  const [showAll, setShowAll] = useState(false);
  const [cloneDir, setCloneDir] = useState('');

  const reset = (s: Settings) => {
    // Dossiers affichés en `~/…` (le serveur développe `~` à l'enregistrement).
    setRoots(s.roots.length ? s.roots.map((r) => tildify(r, home)) : ['']);
    setOwners(s.github.owners);
    setEditor(s.editor);
    setRange(s.portRange);
    setDepth(s.scanMaxDepth);
    setShowAll(s.showAllProjects);
    setCloneDir(tildify(s.cloneDir, home));
    setToken('');
    setClearToken(false);
  };
  useEffect(() => { if (q.data) reset(q.data); }, [q.data, home]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => {
      const patch: SettingsPatch = {
        roots: roots.filter((r) => r.trim()),
        github: { owners: ownerDraft.trim() ? [...owners, ownerDraft.trim()] : owners, ...(token ? { token } : clearToken ? { token: null } : {}) },
        editor,
        portRange: range,
        scanMaxDepth: depth,
        showAllProjects: showAll,
        cloneDir,
      };
      return api.saveSettings(patch);
    },
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      setOwnerDraft('');
      qc.invalidateQueries();
      toast('ok', t('settings.saved'));
    },
    onError: (e: Error) => toast('err', e.message),
  });

  if (!q.data) return null;

  const addOwner = () => {
    const o = ownerDraft.trim().replace(/^@/, '');
    if (o && !owners.includes(o)) setOwners([...owners, o]);
    setOwnerDraft('');
  };

  return (
    <div className="max-w-4xl space-y-6">
      <LanguageCard />
      <Card className="divide-y divide-line">
        <div className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('settings.local')}</div>
        <Field
          title={t('settings.roots')}
          hint={t.node('settings.rootsHint', { tilde: <span className="font-mono">~</span> })}
        >
          <div className="space-y-2">
            {roots.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={cx(input, 'font-mono text-xs')}
                  value={r}
                  placeholder="~/Developer"
                  onChange={(e) => setRoots(roots.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <button
                  title={t('settings.remove')}
                  disabled={roots.length === 1}
                  onClick={() => setRoots(roots.filter((_, j) => j !== i))}
                  className="grid size-8 shrink-0 place-items-center rounded-md border border-line text-muted hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => setRoots([...roots, ''])}>{t('settings.addFolder')}</Button>
          </div>
        </Field>
        <Field
          title={t('settings.shown')}
          hint={t('settings.shownHint')}
        >
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            {t('settings.showAll')}
          </label>
        </Field>
        <Field title={t('settings.depth')} hint={t('settings.depthHint')}>
          <input type="number" min={1} max={12} className={cx(input, 'w-24')} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
        </Field>
      </Card>

      <Card className="divide-y divide-line">
        <div className="flex items-center gap-2 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-faint"><GithubIcon className="size-3.5" /> GitHub</div>
        <Field
          title={t('settings.owners')}
          hint={t('settings.ownersHint')}
        >
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel p-1.5 focus-within:border-accent">
            {owners.map((o) => (
              <span key={o} className="inline-flex h-6 items-center gap-1 rounded bg-panel-2 pl-2 pr-1 text-xs font-medium">
                <GithubIcon className="size-3 text-muted" />{o}
                <button onClick={() => setOwners(owners.filter((x) => x !== o))} className="text-faint hover:text-fg"><X className="size-3" /></button>
              </span>
            ))}
            <input
              value={ownerDraft}
              onChange={(e) => setOwnerDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addOwner(); }
                if (e.key === 'Backspace' && !ownerDraft) setOwners(owners.slice(0, -1));
              }}
              placeholder={owners.length ? t('settings.ownersAdd') : t('settings.ownersPlaceholder')}
              className="h-6 min-w-32 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-faint"
            />
            {ownerDraft && <button onClick={addOwner} className="grid size-6 place-items-center rounded text-muted hover:text-fg"><Plus className="size-3.5" /></button>}
          </div>
        </Field>
        <Field
          title={t('settings.gh')}
          hint={t('settings.ghHint')}
        >
          <GhCliLogin />
        </Field>
        <Field title={t('settings.cloneDir')} hint={t('settings.cloneDirHint')}>
          <input className={cx(input, 'font-mono text-xs')} value={cloneDir} placeholder="~/Developer" onChange={(e) => setCloneDir(e.target.value)} />
        </Field>
        <Field
          title={t('settings.token')}
          hint={t.node('settings.tokenHint', { env: <span className="font-mono">GITHUB_TOKEN</span>, gh: <span className="font-mono">gh</span>, contents: <em>Contents</em>, metadata: <em>Metadata</em> })}
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input
                type="password"
                autoComplete="off"
                className={cx(input, 'pl-8 font-mono text-xs')}
                value={token}
                onChange={(e) => { setToken(e.target.value); setClearToken(false); }}
                placeholder={q.data.github.tokenSet && !clearToken ? t('settings.tokenSaved') : 'github_pat_…'}
              />
            </div>
            {q.data.github.tokenSet && !clearToken && <Badge tone="green"><Check className="size-3" />{t('settings.tokenSet')}</Badge>}
            {q.data.github.tokenSet && (
              <Button size="sm" variant="ghost" onClick={() => { setClearToken(!clearToken); setToken(''); }}>{clearToken ? t('settings.cancel') : t('settings.delete')}</Button>
            )}
          </div>
        </Field>
      </Card>

      <Card className="divide-y divide-line">
        <div className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('settings.run')}</div>
        <Field title={t('settings.editor')} hint={t('settings.editorHint')}>
          <select className={cx(input, 'w-56')} value={editor} onChange={(e) => setEditor(e.target.value as Settings['editor'])}>
            <option value="vscode">Visual Studio Code</option>
            <option value="cursor">Cursor</option>
            <option value="zed">Zed</option>
            <option value="webstorm">WebStorm</option>
          </select>
        </Field>
        <Field title={t('settings.ports')} hint={t('settings.portsHint')}>
          <div className="flex items-center gap-2">
            <input type="number" className={cx(input, 'w-28 font-mono')} value={range.start} onChange={(e) => setRange({ ...range, start: Number(e.target.value) })} />
            <span className="text-faint">→</span>
            <input type="number" className={cx(input, 'w-28 font-mono')} value={range.end} onChange={(e) => setRange({ ...range, end: Number(e.target.value) })} />
          </div>
        </Field>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => reset(q.data!)}>{t('settings.cancel')}</Button>
        <Button variant="primary" icon={<Save className="size-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>{t('settings.save')}</Button>
      </div>

      {q.data && <SuiviSettingsCard settings={q.data} />}
    </div>
  );
}

const CHANNELS = [
  ['A', 'settings.suivi.channelA', 'settings.suivi.channelAHint'],
  ['B', 'settings.suivi.channelB', 'settings.suivi.channelBHint'],
  ['C', 'settings.suivi.channelC', 'settings.suivi.channelCHint'],
] as const;

/** Langue de l'interface : enregistrée tout de suite (comme le thème). */
function LanguageCard() {
  const t = useT();
  const [setting, setSetting] = useLanguageSetting();
  const auto = t.lang === 'fr' ? 'Français' : 'English';
  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('settings.interface')}</div>
      <Field title={t('settings.language')} hint={t('settings.languageHint')}>
        <select className={cx(input, 'w-56')} value={setting} onChange={(e) => setSetting(e.target.value as LanguageSetting)}>
          <option value="auto">{t('settings.languageAuto', { lang: auto })}</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </Field>
    </Card>
  );
}

/** Section « Suivi » (Todolist Claude) : canaux, pont MCP, dossier, dernières synchronisations. */
function SuiviSettingsCard({ settings }: { settings: Settings }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [channels, setChannels] = useState(settings.suivi.channels);
  const [interval, setIntervalSec] = useState(settings.suivi.bridgeIntervalSec);
  const [folder, setFolder] = useState(settings.suivi.folder);
  const projects = useQuery({ queryKey: ['suivi', 'projects'], queryFn: api.suiviProjects });
  const save = useMutation({
    mutationFn: () => api.saveSettings({ suivi: { channels, bridgeIntervalSec: interval, folder } }),
    onSuccess: (s) => { qc.setQueryData(['settings'], s); toast('ok', t('settings.suivi.saved')); },
    onError: (e: Error) => toast('err', e.message),
  });

  const fmt = (iso?: string) => (iso ? fmtDateTime(iso, { dateStyle: 'short', timeStyle: 'short' }) : '—');

  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('settings.suivi.title')}</div>
      <Field title={t('settings.suivi.channels')} hint={t('settings.suivi.channelsHint')}>
        <div className="space-y-2">
          {CHANNELS.map(([k, label, hint]) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5" checked={channels[k]} onChange={(e) => setChannels({ ...channels, [k]: e.target.checked })} />
              <span><span className="font-medium">{t(label)}</span><span className="block text-[12px] text-muted">{t(hint)}</span></span>
            </label>
          ))}
        </div>
      </Field>
      <Field title={t('settings.suivi.interval')} hint={t('settings.suivi.intervalHint')}>
        <div className="flex items-center gap-2">
          <input type="number" min={10} max={600} className={cx(input, 'w-24 font-mono')} value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))} />
          <span className="text-[12px] text-muted">{t('settings.suivi.seconds')}</span>
        </div>
      </Field>
      <Field title={t('settings.suivi.folder')} hint={t('settings.suivi.folderHint')}>
        <input className={cx(input, 'w-48 font-mono')} value={folder} onChange={(e) => setFolder(e.target.value)} />
      </Field>
      <Field title={t('settings.suivi.syncs')} hint={t('settings.suivi.syncsHint')}>
        <div className="overflow-hidden rounded-md border border-line text-[12px]">
          <table className="w-full">
            <thead className="bg-panel-2 text-left text-faint">
              <tr><th className="px-2 py-1 font-medium">{t('settings.suivi.project')}</th>{(['A', 'B', 'C', 'file'] as const).map((c) => <th key={c} className="px-2 py-1 font-medium">{c === 'file' ? t('settings.suivi.file') : c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(projects.data ?? []).map((p) => (
                <tr key={p.projectId}>
                  <td className="px-2 py-1 font-medium">{p.name}</td>
                  {(['A', 'B', 'C', 'file'] as const).map((c) => {
                    const s = p.syncs.find((x) => x.channel === c);
                    return <td key={c} className="px-2 py-1 font-mono text-muted" title={s?.result}>{fmt(s?.at)}</td>;
                  })}
                </tr>
              ))}
              {projects.data?.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-faint">{t('settings.suivi.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Field>
      <div className="flex items-center justify-end gap-2 px-5 py-3">
        {/* La db des artefacts n'est lisible que depuis Claude desktop : commande à coller dans une session. */}
        <Button variant="ghost" onClick={() => copy('/suivi sync --all', toast, t('settings.suivi.resyncCopied'))}>{t('settings.suivi.resyncAll')}</Button>
        <Button variant="primary" icon={<Save className="size-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>{t('settings.save')}</Button>
      </div>
    </Card>
  );
}
