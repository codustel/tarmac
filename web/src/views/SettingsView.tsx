import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FolderPlus, KeyRound, Plus, Save, Trash2, X } from 'lucide-react';
import { api, type Settings, type SettingsPatch } from '../api';
import { Badge, Button, Card, GithubIcon, copy, cx, tildify, useToast } from '../ui';
import { ToolsCard } from './ToolsCard';
import { GhCliLogin } from './GhCliLogin';
import { ModuleIcon } from './ModuleView';
import { AgentIcon } from './Agents';
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

  // Chaque carte de réglages s'enregistre et s'annule seule (groupe), sans toucher aux autres.
  type Group = 'local' | 'github' | 'tools';
  const reset = (s: Settings, groups: Group[] = ['local', 'github', 'tools']) => {
    if (groups.includes('local')) {
      // Dossiers affichés en `~/…` (le serveur développe `~` à l'enregistrement).
      setRoots(s.roots.length ? s.roots.map((r) => tildify(r, home)) : ['']);
      setDepth(s.scanMaxDepth);
      setShowAll(s.showAllProjects);
    }
    if (groups.includes('github')) {
      setOwners(s.github.owners);
      setOwnerDraft('');
      setCloneDir(tildify(s.cloneDir, home));
      setToken('');
      setClearToken(false);
    }
    if (groups.includes('tools')) {
      setEditor(s.editor);
      setRange(s.portRange);
    }
  };
  useEffect(() => { if (q.data) reset(q.data); }, [q.data, home]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Modifications non enregistrées d'un groupe (comparées aux réglages chargés). */
  const dirty = (g: Group, s: Settings | undefined): boolean => {
    if (!s) return false;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (g === 'local') return !same(roots.filter((r) => r.trim()), s.roots.map((r) => tildify(r, home))) || depth !== s.scanMaxDepth || showAll !== s.showAllProjects;
    if (g === 'github') return !same(owners, s.github.owners) || !!ownerDraft.trim() || cloneDir !== tildify(s.cloneDir, home) || !!token || clearToken;
    return editor !== s.editor || !same(range, s.portRange);
  };

  const save = useMutation({
    mutationFn: (g: Group) => {
      const patch: SettingsPatch =
        g === 'local' ? { roots: roots.filter((r) => r.trim()), scanMaxDepth: depth, showAllProjects: showAll }
        : g === 'github' ? {
          github: { owners: ownerDraft.trim() ? [...owners, ownerDraft.trim()] : owners, ...(token ? { token } : clearToken ? { token: null } : {}) },
          cloneDir,
        }
        : { editor, portRange: range };
      return api.saveSettings(patch);
    },
    onSuccess: (s, g) => {
      qc.setQueryData(['settings'], s);
      reset(s, [g]);
      qc.invalidateQueries();
      toast('ok', t('settings.saved'));
    },
    onError: (e: Error) => toast('err', e.message),
  });
  /** Pied de carte : Annuler / Enregistrer, actifs seulement s'il y a des modifications dans ce groupe. */
  const footer = (g: Group) => {
    const d = dirty(g, q.data);
    return (
      <div className="flex items-center justify-end gap-2 px-5 py-3">
        <Button variant="ghost" disabled={!d} onClick={() => reset(q.data!, [g])}>{t('settings.cancel')}</Button>
        <Button variant="primary" icon={<Save className="size-3.5" />} disabled={!d} loading={save.isPending && save.variables === g} onClick={() => save.mutate(g)}>{t('settings.save')}</Button>
      </div>
    );
  };

  if (!q.data) return null;

  const addOwner = () => {
    const o = ownerDraft.trim().replace(/^@/, '');
    if (o && !owners.includes(o)) setOwners([...owners, o]);
    setOwnerDraft('');
  };

  return (
    <div className="max-w-4xl space-y-6">
      <ToolsCard mode="settings" />
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
                <BrowseButton start={r} home={home} onPick={(v) => setRoots(roots.map((x, j) => (j === i ? v : x)))} />
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
        {footer('local')}
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
          <div className="flex gap-2">
            <input className={cx(input, 'font-mono text-xs')} value={cloneDir} placeholder="~/Developer" onChange={(e) => setCloneDir(e.target.value)} />
            <BrowseButton start={cloneDir} home={home} onPick={setCloneDir} />
          </div>
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
        {footer('github')}
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
        {footer('tools')}
      </Card>

      {q.data && <AgentsCard settings={q.data} />}
      {q.data && <SuiviSettingsCard settings={q.data} />}
      {q.data && <ProTeasersCard settings={q.data} />}
      <ModulesCard />
    </div>
  );
}

/**
 * Section « Agents » : Claude Code et Codex (ChatGPT), l'un, l'autre ou les deux (enregistré tout de suite). Seuls
 * les agents cochés apparaissent dans Tarmac ; Claude seul = comportement d'avant Codex.
 */
function AgentsCard({ settings }: { settings: Settings }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => api.saveSettings(patch),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      // Listes, LED, timeline, usage : tout dépend des agents cochés.
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast('err', e.message),
  });
  const a = settings.agents ?? { claude: true, codex: false };
  const rows = [
    ['claude', 'settings.agents.claude', 'settings.agents.claudeHint'],
    ['codex', 'settings.agents.codex', 'settings.agents.codexHint'],
  ] as const;
  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('settings.agents.title')}</div>
      <Field title={t('settings.agents.title')} hint={t('settings.agents.sub')}>
        <div className="space-y-2">
          {rows.map(([k, label, hint]) => {
            const last = a[k] && !a[k === 'claude' ? 'codex' : 'claude'];
            return (
              <label key={k} className={cx('flex items-start gap-2 text-[13px]', last ? 'cursor-not-allowed' : 'cursor-pointer')} title={last ? t('settings.agents.atLeastOne') : undefined}>
                <input type="checkbox" className="mt-0.5" checked={a[k]} disabled={save.isPending || last}
                  onChange={(e) => save.mutate({ agents: { [k]: e.target.checked } })} />
                <span className="inline-flex items-start gap-1.5">
                  <span className="mt-0.5"><AgentIcon agent={k} size={13} /></span>
                  <span><span className="font-medium">{t(label)}</span><span className="block text-[12px] text-muted">{t(hint)}</span></span>
                </span>
              </label>
            );
          })}
          {a.codex && (
            <p className="text-[12px] text-muted">
              {t.node('settings.agents.setup', { cmd: <code className="rounded bg-panel-2 px-1 font-mono text-[11px]">tarmac setup --with-codex</code> })}
            </p>
          )}
        </div>
      </Field>
      {a.codex && (
        <Field title={t('codex.usage.title')} hint={t('settings.codexUsageHint')}>
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={settings.showCodexUsage !== false} disabled={save.isPending}
              onChange={(e) => save.mutate({ showCodexUsage: e.target.checked })} className="size-4 accent-[var(--accent)]" />
            {t('settings.codexUsage')}
          </label>
        </Field>
      )}
    </Card>
  );
}

/** Interrupteur « Masquer les fonctionnalités Pro » (7.16) : visible aussi sans module Pro. */
function ProTeasersCard({ settings }: { settings: Settings }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => api.saveSettings(patch),
    onSuccess: (s) => qc.setQueryData(['settings'], s),
    onError: (e: Error) => toast('err', e.message),
  });
  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('pro.settings.title')}</div>
      <Field title={t('pro.settings.hide')} hint={t('pro.settings.hint')}>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" checked={!!settings.hideProTeasers} disabled={save.isPending}
            onChange={(e) => save.mutate({ hideProTeasers: e.target.checked })} className="size-4 accent-[var(--accent)]" />
          {t('pro.settings.hide')}
        </label>
      </Field>
    </Card>
  );
}

/** Modules chargés (`TARMAC_MODULES`) : affichée seulement s'il y en a. */
function ModulesCard() {
  const t = useT();
  const modules = useQuery({ queryKey: ['modules'], queryFn: api.modules, staleTime: Infinity });
  if (!modules.data?.length) return null;
  const tone = { loaded: 'green', ignored: 'amber', error: 'red' } as const;
  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('settings.modules.title')}</div>
      <Field title={t('settings.modules.title')} hint={t('settings.modules.hint')}>
        <ul className="space-y-2">
          {modules.data.map((m) => (
            <li key={m.dir} className="flex items-start gap-2 text-[13px]">
              <ModuleIcon svg={m.icon} className="mt-0.5 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.loc(m.name)}</span>
                  {m.version && <span className="font-mono text-[11px] text-faint">{m.version}</span>}
                  <Badge tone={tone[m.status]}>{t(`settings.modules.${m.status}`)}</Badge>
                </div>
                <div className="truncate font-mono text-[11px] text-faint" title={m.dir}>{m.dir}</div>
                {m.error && <div className="text-[12px] text-red-600 dark:text-red-400">{m.error}</div>}
              </div>
            </li>
          ))}
        </ul>
      </Field>
    </Card>
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
      <ClaudeUsageField />
    </Card>
  );
}

/** Affichage de l'utilisation Claude dans la sidebar : enregistré tout de suite. */
function ClaudeUsageField() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const save = useMutation({
    mutationFn: (on: boolean) => api.saveSettings({ showClaudeUsage: on }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      qc.invalidateQueries({ queryKey: ['claude-usage'] });
    },
    onError: (e: Error) => toast('err', e.message),
  });
  if (!q.data) return null;
  return (
    <Field title={t('settings.claudeUsage')} hint={t('settings.claudeUsageHint')}>
      <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" checked={q.data.showClaudeUsage !== false} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        {t('settings.claudeUsageShow')}
      </label>
    </Field>
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

/** « … » : ouvre la fenêtre « Choisir un dossier » de macOS (via le service) et renvoie le chemin choisi. */
function BrowseButton({ start, home, onPick }: { start: string; home?: string; onPick: (path: string) => void }) {
  const t = useT();
  const toast = useToast();
  const pick = useMutation({
    mutationFn: () => api.pickFolder(start || undefined),
    onSuccess: (r) => { if (r.path) onPick(tildify(r.path, home)); },
    onError: (e: Error) => toast('err', e.message),
  });
  return (
    <button type="button" title={t('settings.browse')} aria-label={t('settings.browse')} disabled={pick.isPending} onClick={() => pick.mutate()}
      className="grid h-8 w-9 shrink-0 place-items-center rounded-md border border-line font-semibold text-muted hover:border-accent hover:text-fg disabled:opacity-50">
      {pick.isPending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : '…'}
    </button>
  );
}
