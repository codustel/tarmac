import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Boxes, ChevronRight, Loader2, ChevronsDownUp, ChevronsUpDown, Code2, Database, ExternalLink, FolderOpen, Layers, Lock, Package,
  Pencil, Play, RotateCw, ScrollText, Square, TerminalSquare, TriangleAlert,
} from 'lucide-react';
import { api, type NameSource, type Project, type ProcStatus } from '../api';
import { TechChip, TechIcon } from '../icons';
import { Badge, Button, Card, Empty, GitBadge, GithubIcon, IconButton, StatusDot, VsCodeIcon, cx, statusMeta, timeAgo, useToast } from '../ui';
import { compareText, useT, type TKey } from '../i18n';
import { openInIde } from '../ide/store';
import { EnvModal } from './EnvModal';
import { STATUS_KEY, hasBrowser, type PanelTab } from './ProjectPanel';
import { ClaudeIcon } from './ClaudeSessions';
import { AgentIcon, AgentLed, CodexIcon, useAgentSummary, useEnabledAgents, useRunningAgents } from './Agents';
import type { RunningAgent } from '../api';
import { Globe, KeyRound, Plus, Smartphone, Star } from 'lucide-react';

type KindFilter = 'all' | 'favorites' | 'web' | 'console' | 'running' | 'editor';
type SortKey = 'modified' | 'commit' | 'push' | 'name';
type GhFilter = 'all' | 'github' | 'synced' | 'tosync' | 'local';

const maxDate = (xs: Array<string | null | undefined>) => xs.filter(Boolean).sort().at(-1) ?? null;
/** Dates d'un projet dev (toutes apps confondues). */
function groupDates(all: Project[]) {
  return {
    modified: maxDate(all.flatMap((p) => [p.activityAt, p.repo?.git?.dirtyAt, p.repo?.git?.lastCommitAt])),
    commit: maxDate(all.map((p) => p.repo?.git?.lastCommitAt)),
    push: maxDate(all.map((p) => p.repo?.pushedAt)),
  };
}
const dirty = (p: Project) => !!p.repo?.git && p.repo.git.changes + p.repo.git.untracked > 0;
function ghMatch(all: Project[], f: GhFilter) {
  if (f === 'all') return true;
  const repos = all.filter((p) => p.repo?.git);
  const onGh = repos.filter((p) => p.repo!.onGithub);
  if (f === 'local') return onGh.length === 0;
  if (!onGh.length) return false;
  const synced = onGh.every((p) => p.repo!.git!.sync === 'synced' && !dirty(p));
  return f === 'github' || (f === 'synced' ? synced : !synced);
}

function useStored<T extends string>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => (localStorage.getItem(key) as T) || initial);
  useEffect(() => { try { localStorage.setItem(key, v); } catch { /* indisponible */ } }, [key, v]);
  return [v, setV] as const;
}

const isServing = (p: Project) => p.runtime.status === 'running' || p.runtime.status === 'starting' || !!p.external;
const consoleRunning = (p: Project) => p.terminals.some((t) => t.status === 'running');
export const isActive = (p: Project) => isServing(p) || consoleRunning(p);
const displayStatus = (p: Project): ProcStatus => (p.serve ? p.runtime.status : consoleRunning(p) ? 'running' : 'stopped');

const SOURCE_LABEL: Record<NameSource, TKey> = {
  override: 'projects.source.override',
  git: 'projects.source.git',
  product: 'projects.source.product',
  manifest: 'projects.source.manifest',
  title: 'projects.source.title',
  readme: 'projects.source.readme',
  package: 'projects.source.package',
  folder: 'projects.source.folder',
};

/** Libellé du rôle d'une sous-app (Kind). */
const KIND_KEY: Record<Project['kind'], TKey> = {
  web: 'projects.kind.web',
  service: 'projects.kind.service',
  mobile: 'projects.kind.mobile',
  worker: 'projects.kind.worker',
  console: 'projects.kind.console',
  other: 'projects.kind.other',
};

const FILTER_LABEL: Record<KindFilter, [TKey, TKey]> = {
  all: ['projects.filter.all', 'projects.filter.allHint'],
  favorites: ['projects.filter.favorites', 'projects.filter.favoritesHint'],
  web: ['projects.filter.web', 'projects.filter.webHint'],
  console: ['projects.filter.console', 'projects.filter.consoleHint'],
  running: ['projects.filter.running', 'projects.filter.runningHint'],
  editor: ['projects.filter.editor', 'projects.filter.editorHint'],
};

interface Group {
  id: string;
  root: Project;
  children: Project[];
  all: Project[];
}

// ─── Repli des groupes (persistant) ─────────────────────────────────────────
const COLLAPSE_KEY = 'collapsedGroups';
function useCollapsed() {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}'); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ } }, [state]);
  // Par défaut : groupes dépliés, sauf « Divers ».
  const isCollapsed = (id: string) => state[id] ?? id === '__divers__';
  return { isCollapsed, set: (id: string, v: boolean) => setState((s) => ({ ...s, [id]: v })), setAll: (ids: string[], v: boolean) => setState((s) => ({ ...s, ...Object.fromEntries(ids.map((i) => [i, v])) })) };
}

/**
 * Panneau projet ouvert : lignes compactes quelle que soit la largeur (colonnes techno, Git et port masquées,
 * nom et badges sur une ligne, actions à droite sur la même ligne).
 */
const CompactRows = createContext(false);
/** Agents en cours par projet (id), pour les badges des lignes. */
const RunningByProject = createContext<Map<string, RunningAgent[]>>(new Map());

export function ProjectsView({ projects, query, onOpen, selectedId, scanning }: {
  projects: Project[];
  /** Premier scan des dossiers en cours (aucun projet encore connu) : dossiers parcourus, pour le message d'attente. */
  scanning?: string[] | null;
  query: string;
  onOpen: (id: string, tab?: PanelTab) => void;
  selectedId: string | null;
}) {
  const t = useT();
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useStored<SortKey>('sortProjects', 'modified');
  const [gh, setGh] = useStored<GhFilter>('ghFilter', 'all');
  const [langs, setLangs] = useState<Set<string>>(new Set());
  const collapse = useCollapsed();
  const agents = useRunningAgents();
  const runningByProject = useMemo(() => {
    const m = new Map<string, RunningAgent[]>();
    for (const a of agents.data ?? []) if (a.project) m.set(a.project.id, [...(m.get(a.project.id) ?? []), a]);
    return m;
  }, [agents.data]);

  const matches = (p: Project) => {
    const q = query.trim().toLowerCase();
    if (kind === 'web' && !p.serve) return false;
    if (kind === 'console' && (p.serve || p.synthetic)) return false;
    if (kind === 'running' && !isActive(p)) return false;
    if (kind === 'editor' && !p.openIn) return false;
    if (kind === 'favorites' && !groupFav(p)) return false;
    if (langs.size && !p.languages.some((l) => langs.has(l.id))) return false;
    return !q || `${p.name} ${p.techName} ${p.group.name} ${p.relPath} ${p.language.label} ${p.framework?.label ?? ''} ${p.description ?? ''}`.toLowerCase().includes(q);
  };
  // Favori : marqué sur la racine du projet → s'applique à toutes ses apps.
  const favGroups = new Set(projects.filter((p) => p.favorite).map((p) => p.group.id));
  const groupFav = (p: Project) => p.favorite || favGroups.has(p.group.id);
  const filtering = kind !== 'all' || langs.size > 0 || query.trim() !== '' || gh !== 'all';

  const { groups, loose } = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of projects) map.set(p.group.id, [...(map.get(p.group.id) ?? []), p]);
    const groups: Group[] = [];
    let loose: Project[] = [];
    for (const [id, all] of map) {
      if (id === '__divers__') { loose = all; continue; }
      const root = all.find((p) => p.group.isRoot) ?? all[0];
      groups.push({ id, root, children: all.filter((p) => p !== root), all });
    }
    return { groups, loose };
  }, [projects]);

  const visibleGroups = groups
    .filter((g) => ghMatch(g.all, gh))
    .map((g) => ({ ...g, children: g.children.filter(matches), rootMatch: matches(g.root), dates: groupDates(g.all) }))
    .filter((g) => g.rootMatch || g.children.length > 0)
    .sort((a, b) => {
      if (sort === 'name') return compareText(a.root.group.name, b.root.group.name);
      const k = sort === 'modified' ? 'modified' : sort;
      return (b.dates[k] ?? '').localeCompare(a.dates[k] ?? '') || compareText(a.root.group.name, b.root.group.name);
    });
  const visibleLoose = loose.filter((p) => matches(p) && ghMatch([p], gh));

  const realProjects = projects.filter((p) => p.group.id !== '__divers__');
  const languages = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const p of realProjects) if (!p.synthetic) {
      const e = m.get(p.language.id) ?? { label: p.language.label, n: 0 };
      e.n++;
      m.set(p.language.id, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts: Record<KindFilter, number> = {
    all: groups.length,
    favorites: groups.filter((g) => g.root.favorite).length + loose.filter((p) => p.favorite).length,
    web: realProjects.filter((p) => p.serve).length,
    console: realProjects.filter((p) => !p.serve && !p.synthetic).length,
    running: realProjects.filter(isActive).length,
    editor: groups.filter((g) => g.all.some((p) => p.openIn)).length,
  };
  return (
    <CompactRows.Provider value={selectedId !== null}>
    <RunningByProject.Provider value={runningByProject}>
    <div className="@container space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-md border border-line bg-panel p-0.5">
          {(Object.keys(FILTER_LABEL) as KindFilter[]).map((f) => (
            <button
              key={f}
              title={t(FILTER_LABEL[f][1])}
              onClick={() => setKind(f)}
              className={cx('h-7 px-3 rounded text-xs font-medium transition-colors', kind === f ? 'bg-panel-2 text-fg shadow-xs' : 'text-muted hover:text-fg')}
            >
              {f === 'editor' && <VsCodeIcon className="mr-1 inline size-2.5 -mt-px" />}
              {f === 'favorites' && <Star className={cx('mr-1 inline size-3 -mt-px', counts.favorites > 0 && 'fill-amber-400 text-amber-400')} />}
              {t(FILTER_LABEL[f][0])}
              <span className="ml-1.5 text-faint tabular-nums">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {languages.map(([id, { label, n }]) => {
            const on = langs.has(id);
            return (
              <button
                key={id}
                title={label}
                onClick={() => setLangs((s) => { const x = new Set(s); on ? x.delete(id) : x.add(id); return x; })}
                className={cx('inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors', on ? 'border-accent bg-accent/10 text-fg' : 'border-line bg-panel text-muted hover:text-fg')}
              >
                <TechIcon id={id} label={label} size={13} />
                <span className="tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <select value={gh} onChange={(e) => setGh(e.target.value as GhFilter)} title={t('projects.gh.title')}
            className={cx('h-7 rounded-md border bg-panel px-2 text-xs outline-none focus:border-accent', gh !== 'all' ? 'border-accent text-fg' : 'border-line text-muted')}>
            <option value="all">{t('projects.gh.all')}</option>
            <option value="github">{t('projects.gh.github')}</option>
            <option value="synced">{t('projects.gh.synced')}</option>
            <option value="tosync">{t('projects.gh.tosync')}</option>
            <option value="local">{t('projects.gh.local')}</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title={t('projects.sort.title')}
            className="h-7 rounded-md border border-line bg-panel px-2 text-xs text-muted outline-none focus:border-accent">
            <option value="modified">{t('projects.sort.modified')}</option>
            <option value="commit">{t('projects.sort.commit')}</option>
            <option value="push">{t('projects.sort.push')}</option>
            <option value="name">{t('projects.sort.name')}</option>
          </select>
          <IconButton title={t('projects.expandAll')} onClick={() => collapse.setAll(groups.map((g) => g.id), false)}><ChevronsUpDown className="size-4" /></IconButton>
          <IconButton title={t('projects.collapseAll')} onClick={() => collapse.setAll(groups.map((g) => g.id), true)}><ChevronsDownUp className="size-4" /></IconButton>
        </div>
      </div>

      {scanning && projects.length === 0 ? (
        <Card>
          <Empty icon={<Loader2 className="size-8 animate-spin" />} title={t('projects.empty.scanning')}>
            {scanning.length ? t('projects.empty.scanningHint', { roots: scanning.join(', ') }) : t('projects.empty.scanningHintShort')}
          </Empty>
        </Card>
      ) : visibleGroups.length === 0 && visibleLoose.length === 0 ? (
        <Card>
          <Empty icon={<Boxes className="size-8" />} title={projects.length ? t('projects.empty.noResult') : t('projects.empty.none')}>
            {projects.length ? t('projects.empty.noResultHint') : t('projects.empty.noneHint')}
          </Empty>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {visibleGroups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              sort={sort}
              open={filtering || !collapse.isCollapsed(g.id)}
              onToggle={() => collapse.set(g.id, !collapse.isCollapsed(g.id))}
              onOpen={onOpen}
              selectedId={selectedId}
            />
          ))}

          {visibleLoose.length > 0 && (
            <LooseGroup
              items={visibleLoose}
              open={filtering || !collapse.isCollapsed('__divers__')}
              onToggle={() => collapse.set('__divers__', !collapse.isCollapsed('__divers__'))}
              onOpen={onOpen}
              selectedId={selectedId}
            />
          )}
        </div>
      )}
    </div>
    </RunningByProject.Provider>
    </CompactRows.Provider>
  );
}

/**
 * URL affichée sur l'en-tête : celle du projet, sinon (même dépôt : monorepo) celle de son app web.
 * Un dossier de « projets liés » (dépôts séparés) n'hérite pas de l'URL d'un de ses projets.
 */
function headerUrl(group: Group): Project['prodUrl'] {
  if (group.root.prodUrl) return group.root.prodUrl;
  if (group.root.group.type === 'folder') return null;
  return group.all.find((p) => p.prodUrl && p.kind === 'web')?.prodUrl ?? group.all.find((p) => p.prodUrl)?.prodUrl ?? null;
}

// ─── Carte d'un projet dev ───────────────────────────────────────────────────
function GroupCard({ group, open, onToggle, onOpen, selectedId, sort }: {
  group: Group & { rootMatch: boolean; dates: ReturnType<typeof groupDates> };
  sort: SortKey;
  open: boolean;
  onToggle: () => void;
  onOpen: (id: string, tab?: PanelTab) => void;
  selectedId: string | null;
}) {
  const t = useT();
  const { root } = group;
  const info = root.group;
  const apps = group.all.filter((p) => !p.synthetic).length;
  const active = group.all.filter(isActive).length;
  const hasChildren = group.children.length > 0 || info.size > 1;

  // Stack agrégée (langages + frameworks des apps du groupe)
  const stack = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of group.all) {
      if (p.synthetic) continue;
      if (p.framework) seen.set(p.framework.id, p.framework.label);
      seen.set(p.language.id, p.language.label);
    }
    return [...seen.entries()];
  }, [group.all]);

  const typeBadge =
    info.type === 'monorepo' ? <Badge tone="violet" title={info.monorepoTool ? t('projects.group.monorepoTool', { tool: info.monorepoTool }) : t('projects.group.monorepoHint')}><Layers className="size-3" />Monorepo{info.monorepoTool ? ` · ${info.monorepoTool}` : ''}</Badge>
      : info.type === 'repo' ? <Badge tone="violet" title={t('projects.group.repoHint')}><Layers className="size-3" />{t('projects.group.repoApps', { count: apps })}</Badge>
        : info.type === 'folder' ? <Badge title={t('projects.group.folderHint')}><Package className="size-3" />{t('projects.group.folderProjects', { count: apps })}</Badge>
          : null;

  return (
    <Card className="overflow-hidden">
      {/* En-tête = racine du projet */}
      <ProjectRow
        p={root}
        header
        expandable={hasChildren}
        open={open}
        onToggle={onToggle}
        onOpen={onOpen}
        selected={selectedId === root.id}
        badges={<>{typeBadge}{active > 0 && hasChildren && <Badge tone="green">{t('projects.group.activeCount', { count: active })}</Badge>}</>}
        agentProjects={group.all.map((x) => x.id)}
        stack={stack}
        dates={group.dates}
        sort={sort}
        url={headerUrl(group)}
        groupApps={root.serve ? undefined : group.children.filter((c) => c.serve)}
      />

      {hasChildren && open && group.children.length > 0 && (
        <div className="border-t border-line bg-panel-2/30">
          {group.children.map((c, i) => (
            <div key={c.id} className={cx('relative', i > 0 && 'border-t border-line/70')}>
              {/* Trait de rattachement */}
              <span className="pointer-events-none absolute left-[27px] top-0 h-full w-px bg-line" style={i === group.children.length - 1 ? { height: '50%' } : undefined} />
              <span className="pointer-events-none absolute left-[27px] top-1/2 h-px w-3 bg-line" />
              <ProjectRow p={c} child groupName={info.name} onOpen={onOpen} selected={selectedId === c.id}
                url={c.prodUrl && c.prodUrl.url !== headerUrl(group)?.url ? c.prodUrl : null} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function LooseGroup({ items, open, onToggle, onOpen, selectedId }: {
  items: Project[];
  open: boolean;
  onToggle: () => void;
  onOpen: (id: string, tab?: PanelTab) => void;
  selectedId: string | null;
}) {
  const t = useT();
  return (
    <Card className="overflow-hidden border-dashed">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel-2/50">
        <ChevronRight className={cx('size-4 text-faint transition-transform', open && 'rotate-90')} />
        <div className="grid size-8 place-items-center rounded-lg border border-dashed border-line text-faint"><Boxes className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t('projects.loose.title')} <span className="font-normal text-faint">· {items.length}</span></div>
          <div className="text-[11px] text-faint">{t('projects.loose.hint')}</div>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-line/70 border-t border-line">
          {items.map((p) => <ProjectRow key={p.id} p={p} loose onOpen={onOpen} selected={selectedId === p.id} />)}
        </div>
      )}
    </Card>
  );
}

// ─── Ligne projet (en-tête de groupe, sous-app ou élément divers) ──────────
/** Projet Expo / React Native : lançable sur l'émulateur Android. */
const isAndroidApp = (p: Project) => p.kind === 'mobile' || p.framework?.id === 'expo' || p.framework?.id === 'react-native';

function ProjectRow({ p, header, child, loose, expandable, open, onToggle, onOpen, selected, badges, stack, groupName, agentProjects, dates, sort, url = p.prodUrl, groupApps }: {
  p: Project;
  header?: boolean;
  child?: boolean;
  loose?: boolean;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onOpen: (id: string, tab?: PanelTab) => void;
  selected: boolean;
  badges?: React.ReactNode;
  stack?: Array<[string, string]>;
  groupName?: string;
  /** Projets dont les agents en cours sont comptés (en-tête de groupe : toutes les apps du groupe). */
  agentProjects?: string[];
  dates?: ReturnType<typeof groupDates>;
  sort?: SortKey;
  /** URL de prod affichée (en-tête : celle du projet ou de son app web). */
  url?: Project['prodUrl'];
  /** En-tête de monorepo : apps à démarrer / arrêter ensemble. */
  groupApps?: Project[];
}) {
  const compact = useContext(CompactRows);
  const runningByProject = useContext(RunningByProject);
  const running = (agentProjects ?? [p.id]).flatMap((id) => runningByProject.get(id) ?? []);
  const runningSummary = useAgentSummary(running);
  const agentsOn = useEnabledAgents();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const [envOpen, setEnvOpen] = useState(false);
  const android = useMutation({
    mutationFn: () => api.runAndroid(p.id),
    onSuccess: () => onOpen(p.id, 'console'),
    onError: (e: Error) => toast('err', e.message),
  });
  const rt = p.runtime;
  const status = displayStatus(p);
  const serving = isServing(p);
  const busy = rt.status === 'starting' || rt.status === 'stopping';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const action = useMutation({
    mutationFn: (a: 'start' | 'stop' | 'restart') => api.action(p.id, a),
    onSuccess: (runtime, a) => {
      qc.setQueryData<Project[]>(['projects'], (l) => l?.map((x) => (x.id === p.id ? { ...x, runtime } : x)));
      // Démarrage d'un projet web : la page s'ouvre dans le navigateur interne du panneau.
      if (a !== 'stop') onOpen(p.id, hasBrowser(p) ? 'browser' : 'logs');
    },
    onError: (e: Error) => toast('err', t('projects.errorFor', { name: p.name, message: e.message })),
  });
  const run = useMutation({
    mutationFn: () => api.openTerminal(p.id, { commandId: p.defaultCommand ?? undefined }),
    onSuccess: () => onOpen(p.id, 'console'),
    onError: (e: Error) => toast('err', e.message),
  });
  const rename = useMutation({
    mutationFn: (name: string) => api.rename(p.id, name),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e: Error) => toast('err', e.message),
  });

  const open_ = (w: 'finder' | 'editor') => api.open(p.dir, w).catch((e) => toast('err', e.message));
  const port = p.external?.port ?? rt.port ?? p.plannedPort;
  const defaultCmd = p.commands.find((c) => c.id === p.defaultCommand);
  // Lien GitHub : sur l'en-tête, ou sur une sous-app qui a son propre dépôt (projets liés). Ouvre la branche
  // seulement si elle est poussée (upstream « origin/<branche> ») ; sinon la page du dépôt, pour éviter une 404.
  const key = p.repo?.git?.remoteKey;
  const upstream = p.repo?.git?.upstream;
  const remoteBranch = upstream?.includes('/') ? upstream.slice(upstream.indexOf('/') + 1) : null;
  const githubUrl = key?.startsWith('github.com/') && (!child || p.repo!.relPath !== p.group.relPath)
    ? `https://${key}${remoteBranch && !['main', 'master'].includes(remoteBranch) ? `/tree/${remoteBranch}` : ''}`
    : null;

  // Titre : en-tête = nom de l'app ; sous-app = son propre nom s'il diffère du projet, sinon son nom technique.
  const title = child && p.name === groupName ? p.techName : p.name;
  const subtitle = child ? p.group.subPath : p.relPath;
  const iconTech = header && p.synthetic ? null : p.framework ?? p.language;
  const roleBadge = child ? t(p.kind === 'console' && p.language.id === 'python' ? 'projects.kind.python' : KIND_KEY[p.kind]) : null;

  return (
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button,a,input')) return;
        onOpen(p.id);
      }}
      className={cx(
        'group grid cursor-pointer items-center gap-x-4 gap-y-2 transition-colors',
        // Étroit (panneau ouvert, petite fenêtre) : actions sous l'identité ; moyen : 2 colonnes ; large : 5 colonnes.
        compact ? 'grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_auto] @5xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_64px_420px]',
        header ? 'px-3 py-3' : child ? 'py-2.5 pl-11 pr-3' : 'px-4 py-2.5',
        selected ? 'bg-accent/5' : 'hover:bg-panel-2/50',
      )}
    >
      {/* Identité */}
      <div className="flex min-w-0 items-center gap-2.5">
        {header && (
          <button data-toggle onClick={onToggle} disabled={!expandable} title={open ? t('projects.row.collapse') : t('projects.row.expand')} className={cx('grid size-6 shrink-0 place-items-center rounded text-faint hover:bg-panel-2 hover:text-fg', !expandable && 'invisible')}>
            <ChevronRight className={cx('size-4 transition-transform', open && 'rotate-90')} />
          </button>
        )}
        <div className={cx('relative grid shrink-0 place-items-center rounded-lg border border-line bg-panel', header ? 'size-9' : 'size-7')}>
          {iconTech ? <TechIcon id={iconTech.id} label={iconTech.label} size={header ? 18 : 14} /> : <Layers className="size-4 text-muted" />}
          {(p.serve || consoleRunning(p)) && <span className="absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-panel"><StatusDot status={status} /></span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {(header || loose) && <FavoriteStar p={p} />}
            {editing ? (
              <form onSubmit={(e) => { e.preventDefault(); rename.mutate(draft); }} className="flex items-center gap-1">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
                  onBlur={() => !rename.isPending && setEditing(false)}
                  placeholder={p.techName}
                  className="h-6 w-48 rounded border border-accent bg-panel px-1.5 text-[13px] font-semibold outline-none"
                />
                <span className="text-[10px] text-faint">{t('projects.row.renameHint')}</span>
              </form>
            ) : (
              <span className={cx('truncate font-semibold', header && 'text-[14px]')} title={t('projects.row.nameTitle', { source: t(SOURCE_LABEL[p.nameSource]) }) + (p.techName !== p.name ? t('projects.row.techName', { name: p.techName }) : '')}>
                {title}
              </span>
            )}
            {!editing && (header || loose) && (
              <button title={t('projects.row.rename')} onClick={() => { setDraft(p.nameSource === 'override' ? p.name : ''); setEditing(true); }} className="text-faint opacity-0 group-hover:opacity-100 hover:text-fg">
                <Pencil className="size-3" />
              </button>
            )}
            {roleBadge && <Badge>{roleBadge}</Badge>}
            {badges}
            {p.external && (
              <Badge tone="blue" title={t('projects.row.externalHint', { port: p.external.port })}>
                {t('projects.row.external')}
              </Badge>
            )}
            {p.serve && rt.status !== 'stopped' && <Badge tone={statusMeta[rt.status].tone}>{t(STATUS_KEY[rt.status])}{rt.status === 'crashed' && rt.exitCode != null ? ` (${rt.exitCode})` : ''}</Badge>}
            {!p.serve && consoleRunning(p) && <Badge tone="green">{t('projects.row.consoleActive')}</Badge>}
            {rt.adopted && <Badge title={t('projects.row.adoptedHint')}>{t('projects.row.adopted')}</Badge>}
            {p.openIn && (!child || p.openIn.via === 'exact') && <EditorBadge openIn={p.openIn} />}
            {(url || header || loose) && <UrlChip p={p} url={url ?? null} />}
            {/* Sessions d'agent en cours (Tarmac ou ailleurs) ; rien quand aucune. Clic → détail dans le volet. */}
            {/* Un badge par agent (icône de l'agent) : Claude seul = un seul badge, comme avant. */}
            {(['claude', 'codex'] as const).map((k) => {
              const mine = running.filter((a) => a.agent === k);
              return mine.length > 0 && (
                <button
                  key={k}
                  onClick={() => onOpen(p.id, k)}
                  title={runningSummary + t('projects.row.claudeOpenDetail')}
                className="inline-flex h-5 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                >
                  <AgentLed working={mine.some((a) => a.working)} size={6} />
                  <AgentIcon agent={k} size={11} />{mine.length}
                </button>
              );
            })}
          </div>
          <div className="truncate font-mono text-[11px] text-faint" title={p.description ?? p.dir}>
            {(header || child) && p.appName && <span className="text-muted" title={t('projects.row.appNameHint')}>{t('projects.row.appName', { name: p.appName })}</span>}
            {subtitle}
            <span className={cx(!compact && '@5xl:hidden')}>{port && p.serve ? ` · :${port}` : ''}</span>
          </div>
        </div>
      </div>

      {/* Stack */}
      <div className={cx('hidden min-w-0 flex-wrap items-center gap-1', !compact && '@5xl:flex')}>
        {stack ? (
          stack.slice(0, 4).map(([id, label]) => <TechChip key={id} id={id} label={label} />)
        ) : (
          <>
            {p.framework ? <TechChip id={p.framework.id} label={p.framework.label} /> : <TechChip id={p.language.id} label={p.language.label} />}
            {p.platform && p.platform.id !== p.language.id && <span title={p.platform.label}><TechIcon id={p.platform.id} label={p.platform.label} size={13} /></span>}
          </>
        )}
        {header && p.supabase && (
          <Badge tone="green" title={t('projects.row.supabase', { id: p.supabase.projectId })}><Database className="size-3" />{p.supabase.projectId}</Badge>
        )}
      </div>

      {/* Git : au niveau du projet (en-tête) uniquement */}
      <div className={cx('hidden min-w-0 flex-col gap-0.5', !compact && '@5xl:flex')}>
        {header || loose ? (
          p.repo?.git ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5"><GitBadge git={p.repo.git} /></div>
              <span className="truncate text-[11px] text-faint" title={t('projects.row.lastCommit', { message: p.repo.git.lastCommitMsg ?? '—' })}>
                <span className="font-mono">{p.repo.git.branch}</span>
                {dates ? (
                  <>
                    {' · '}<span className={cx(sort === 'modified' && 'text-muted')}>{t('projects.row.modified', { when: timeAgo(dates.modified) })}</span>
                    {sort === 'commit' && <> · <span className="text-muted">{t('projects.row.commit', { when: timeAgo(dates.commit) })}</span></>}
                    {sort === 'push' && <> · <span className="text-muted">{t('projects.row.push', { when: timeAgo(dates.push) })}</span></>}
                  </>
                ) : <> · {t('projects.row.commit', { when: timeAgo(p.repo.git.lastCommitAt) })}</>}
              </span>
            </>
          ) : <span className="text-[11px] text-faint">{t('projects.row.noGit')}{dates?.modified ? ` · ${t('projects.row.modified', { when: timeAgo(dates.modified) })}` : ''}</span>
        ) : p.repo && p.repo.relPath !== p.group.relPath && p.repo.git ? (
          <GitBadge git={p.repo.git} />
        ) : null}
      </div>

      {/* Port */}
      <div className={cx('hidden items-center gap-1 font-mono text-xs tabular-nums', !compact && '@5xl:flex')}>
        {p.serve ? (
          <>
            {p.serve.noPort ? <span className="text-faint" title={t('projects.row.noPort')}>—</span>
              : port ? <span className={cx(serving ? 'text-fg' : 'text-faint')}>:{port}</span> : <span className="text-faint">{t('projects.row.autoPort')}</span>}
            {p.serve.fixedPort && <span title={t('projects.row.fixedPort')}><Lock className="size-3 text-faint" /></span>}
            {p.portBusy && <span title={t('projects.row.portBusy')}><TriangleAlert className="size-3.5 text-amber-500" /></span>}
          </>
        ) : null}
      </div>

      {/* Actions */}
      <div className={cx('flex flex-wrap items-center justify-start gap-1 @3xl:flex-nowrap @3xl:justify-end @3xl:pl-0', header ? 'pl-[80px]' : 'pl-[38px]')}>
        <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100">
          {!child && <IconButton title={t('projects.action.openFinder')} onClick={() => open_('finder')}><FolderOpen className="size-4" /></IconButton>}
          {githubUrl && (
            <a href={githubUrl} target="_blank" rel="noreferrer" title={t('projects.action.openGithub', { url: githubUrl.replace('https://', '') })}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel-2 hover:text-fg">
              <GithubIcon className="size-4" />
            </a>
          )}
          <IconButton title={t('projects.action.openVsCode')} onClick={() => open_('editor')}><VsCodeIcon className="size-3.5" /></IconButton>
          <IconButton title={t('projects.action.openIde')} onClick={() => openInIde(p.id)}><Code2 className="size-4" /></IconButton>
          {p.readme && <IconButton title={t('projects.action.readme')} onClick={() => onOpen(p.id, 'readme')}><BookOpen className="size-4" /></IconButton>}
          {p.envFiles.length > 0 && (
            <IconButton title={t('projects.action.env', { files: p.envFiles.join(', ') })} onClick={() => setEnvOpen(true)}><KeyRound className="size-4" /></IconButton>
          )}
          <IconButton title={t('projects.action.console')} onClick={() => onOpen(p.id, 'console')}><TerminalSquare className="size-4" /></IconButton>
          {envOpen && <EnvModal project={p} onClose={() => setEnvOpen(false)} />}
          {isAndroidApp(p) && (
            <IconButton title={t('projects.action.android')} disabled={android.isPending} onClick={() => android.mutate()}>
              <Smartphone className="size-4" />
            </IconButton>
          )}
          {agentsOn.includes('claude') && (
            <IconButton title={t('projects.action.claude')} onClick={() => onOpen(p.id, 'claude')}>
              <ClaudeIcon size={15} />
            </IconButton>
          )}
          {agentsOn.includes('codex') && (
            <IconButton title={t('projects.action.codex')} onClick={() => onOpen(p.id, 'codex')}>
              <CodexIcon size={15} />
            </IconButton>
          )}
          {p.serve && <IconButton title={t('projects.action.logs')} onClick={() => onOpen(p.id, 'logs')}><ScrollText className="size-4" /></IconButton>}
        </div>

        {groupApps && groupApps.length > 0 ? (
          <GroupRunButton apps={groupApps} onStarted={() => onOpen(p.id, 'browser')} />
        ) : p.serve ? (
          serving || rt.status === 'stopping' ? (
            <>
              {!p.external && <IconButton title={t('projects.action.restart')} disabled={busy || action.isPending} onClick={() => action.mutate('restart')}><RotateCw className="size-4" /></IconButton>}
              <Button size="sm" icon={<Square className="size-3 fill-current" />} loading={rt.status === 'stopping' || (action.isPending && action.variables === 'stop')} onClick={() => action.mutate('stop')}
                title={p.external ? t('projects.action.stopExternal', { port: p.external.port }) : undefined}>{t('projects.action.stop')}</Button>
              {!p.serve.noPort && <a
                href={p.external?.url ?? rt.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!p.external && rt.status !== 'running'}
                className={cx('inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2 text-xs font-medium text-accent-fg hover:opacity-90', !p.external && rt.status !== 'running' && 'pointer-events-none opacity-50')}
              >
                <ExternalLink className="size-3.5" /> {t('projects.action.open')}
              </a>}
            </>
          ) : (
            <Button size="sm" variant="primary" icon={<Play className="size-3 fill-current" />} loading={action.isPending} onClick={() => action.mutate('start')} className="w-[84px]">{t('projects.action.start')}</Button>
          )
        ) : defaultCmd ? (
          <Button size="sm" variant="primary" title={`$ ${defaultCmd.cmd}`} icon={<Play className="size-3 fill-current" />} loading={run.isPending} onClick={() => run.mutate()} className="w-[84px]">{t('projects.action.run')}</Button>
        ) : header && p.synthetic ? (
          <span className="w-[84px]" />
        ) : (
          <Button size="sm" icon={<TerminalSquare className="size-3.5" />} onClick={() => onOpen(p.id, 'console')} className="w-[84px]">{t('projects.action.console')}</Button>
        )}
      </div>
    </div>
  );
}

/** Projet ouvert dans VS Code (ou Cursor…) : direct, ou via un dossier parent (racine du repo). */
function EditorBadge({ openIn }: { openIn: NonNullable<Project['openIn']> }) {
  const t = useT();
  const title = openIn.via === 'exact' ? t('projects.editor.openIn', { editor: openIn.editorLabel }) : t('projects.editor.openInVia', { editor: openIn.editorLabel, path: openIn.path });
  return (
    <span title={title} className={cx('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 text-[11px] font-medium', openIn.via === 'exact' ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-line bg-panel-2 text-muted')}>
      {openIn.editor.startsWith('vscode') ? <VsCodeIcon className="size-2.5" /> : <TechIcon id={openIn.editor} label={openIn.editorLabel} size={11} />}
      {openIn.editorLabel}{openIn.via === 'parent' && ' ↑'}
    </span>
  );
}

/** URL de production : lien cliquable (détectée dans .env ou saisie) + édition. */
function UrlChip({ p, url }: { p: Project; url: Project['prodUrl'] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const t = useT();
  // L'URL affichée peut venir d'une app du groupe : on édite celle du projet qui la porte.
  const save = useMutation({
    mutationFn: (v: string) => api.setUrl(p.id, v),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e: Error) => toast('err', e.message),
  });

  if (editing) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(draft); }} className="inline-flex items-center gap-1">
        <Globe className="size-3 text-faint" />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          onBlur={() => !save.isPending && setEditing(false)}
          placeholder={t('projects.url.placeholder')}
          className="h-5 w-52 rounded border border-accent bg-panel px-1.5 font-mono text-[11px] outline-none"
        />
        <span className="text-[10px] text-faint">{t('projects.url.hint')}</span>
      </form>
    );
  }
  if (!url) {
    return (
      <button title={t('projects.url.add')} onClick={() => { setDraft(''); setEditing(true); }}
        className="inline-flex h-5 items-center gap-0.5 rounded border border-dashed border-line px-1 text-[11px] text-faint opacity-0 hover:text-fg group-hover:opacity-100">
        <Plus className="size-3" /><Globe className="size-3" />
      </button>
    );
  }
  const host = url.url.replace(/^https?:\/\//, '');
  return (
    <span className="inline-flex h-5 max-w-full items-center overflow-hidden whitespace-nowrap rounded border border-sky-500/30 bg-sky-500/5 text-[11px]">
      <a href={url.url} target="_blank" rel="noreferrer" title={t('projects.url.production', { source: url.manual ? t('projects.url.manual') : url.source })} className="inline-flex items-center gap-1 px-1.5 font-medium text-sky-700 hover:underline dark:text-sky-300">
        <Globe className="size-3" />{host}
      </a>
      <button title={t('projects.url.edit')} onClick={() => { setDraft(url.manual ? url.url : ''); setEditing(true); }}
        className="hidden h-full border-l border-sky-500/20 px-1 text-faint hover:text-fg group-hover:inline-flex group-hover:items-center">
        <Pencil className="size-2.5" />
      </button>
    </span>
  );
}

function FavoriteStar({ p }: { p: Project }) {
  const qc = useQueryClient();
  const t = useT();
  const toggle = useMutation({
    mutationFn: (on: boolean) => api.setFavorite(p.id, on),
    onMutate: (on) => qc.setQueryData<Project[]>(['projects'], (l) => l?.map((x) => (x.id === p.id ? { ...x, favorite: on } : x))),
    onError: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
  return (
    <button
      title={p.favorite ? t('projects.fav.remove') : t('projects.fav.add')}
      onClick={() => toggle.mutate(!p.favorite)}
      className={cx('-ml-0.5 grid size-5 place-items-center rounded transition-opacity hover:bg-panel-2', p.favorite ? 'text-amber-400' : 'text-faint opacity-0 group-hover:opacity-100')}
    >
      <Star className={cx('size-3.5', p.favorite && 'fill-current')} />
    </button>
  );
}

/** Monorepo : démarre chaque app comme serveur géré (port de la plage, Ouvrir / Arrêter par app). */
function GroupRunButton({ apps, onStarted }: { apps: Project[]; onStarted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const running = apps.filter(isServing);
  const all = useMutation({
    mutationFn: async (a: 'start' | 'stop') => {
      const targets = a === 'start' ? apps.filter((x) => !isServing(x)) : running;
      const res = await Promise.allSettled(targets.map((x) => api.action(x.id, a)));
      const failed = res.flatMap((r, i) => (r.status === 'rejected' ? [t('projects.errorFor', { name: targets[i].techName, message: (r.reason as Error).message })] : []));
      if (failed.length) throw new Error(failed.join(' · '));
    },
    // Démarrage du groupe : ses applis web s'affichent dans le navigateur interne du panneau.
    onSuccess: (_r, a) => { if (a === 'start' && apps.some(hasBrowser)) onStarted(); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['projects'] }),
    onError: (e: Error) => toast('err', e.message),
  });
  const names = apps.map((a) => a.techName).join(', ');
  return running.length ? (
    <Button size="sm" icon={<Square className="size-3 fill-current" />} loading={all.isPending} onClick={() => all.mutate('stop')} title={t('projects.groupRun.stopTitle', { names: running.map((a) => a.techName).join(', ') })}>
      {t('projects.groupRun.stop')}
    </Button>
  ) : (
    <Button size="sm" variant="primary" icon={<Play className="size-3 fill-current" />} loading={all.isPending} onClick={() => all.mutate('start')} title={t('projects.groupRun.startTitle', { names })}>
      {t('projects.groupRun.start')}
    </Button>
  );
}
