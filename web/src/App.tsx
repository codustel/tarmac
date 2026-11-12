import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, Boxes, Code2, Container, Database, FolderTree, Languages, ListChecks, Monitor, Moon, Network, RefreshCw, Search, Settings2, Smartphone, Sun } from 'lucide-react';
import { api } from './api';
import { useConnected } from './socket';
import { Button, GithubIcon, Kbd, copy, cx, tildify, timeAgo, useToast } from './ui';
import { ProjectsView, isActive } from './views/ProjectsView';
import { ProjectPanel, defaultTab, hasBrowser, type PanelTab } from './views/ProjectPanel';
import { navAlerts } from './tools/logic';
import { SupabaseView } from './views/SupabaseView';
import { DockerView } from './views/DockerView';
import { GithubView } from './views/GithubView';
import { PortsView } from './views/PortsView';
import { AndroidView } from './views/AndroidView';
import { SettingsView } from './views/SettingsView';
import { ModuleIcon, ModuleView } from './views/ModuleView';
import { TodolistView } from './views/TodolistView';
import { ClaudeIcon, ClaudeSessionsView, StandaloneTerminal } from './views/ClaudeSessions';
import { ClaudeUsagePanel, CodexUsagePanel } from './views/ClaudeUsagePanel';
import { TimelineView } from './views/TimelineView';
import { AgentLed, CodexIcon, useEnabledAgents, useRunningAgents } from './views/Agents';
import type { AgentKind } from './api';
import { LicenseModal } from './views/LicenseModal';
import { ToolsWelcome } from './views/ToolsWelcome';
import { ToolGateModal } from './views/ToolGateModal';
import { PRO_FEATURES, lockedProFeatures, type ProFeature } from './pro/features';
import { ProBadge, ProUpsellModal } from './pro/ProUpsellModal';
import { InstallButton, UpdateBanner } from './pwa';
import { onIdeOpen } from './ide/store';

/** Version affichée en bas de la barre latérale : celle de Tarmac Desktop dans l'app, sinon celle du cœur. */
const appVersion = (core?: string) => navigator.userAgent.match(/TarmacDesktop\/([\w.-]+)/)?.[1] ?? core;
import { useLanguageSetting, useT, type TKey } from './i18n';

// Monaco est lourd : chargé seulement à la première ouverture de l'IDE.
const IdeView = lazy(() => import('./ide/IdeView'));

type CoreTab = 'projects' | 'ide' | 'todolist' | 'claude' | 'codex' | 'supabase' | 'docker' | 'github' | 'ports' | 'android' | 'settings';
/** Onglet du cœur, ou vue d'un module (`#m/<id>`, docs/extensions.md). */
type Tab = CoreTab | `m/${string}`;
type Theme = 'light' | 'dark' | 'system';
const TABS: CoreTab[] = ['projects', 'ide', 'todolist', 'claude', 'codex', 'supabase', 'docker', 'github', 'ports', 'android', 'settings'];

/** Titre et sous-titre de chaque onglet : clés common.title.<tab> / common.sub.<tab>. */
const TITLES = Object.fromEntries(TABS.map((t) => [t, [`common.title.${t}`, `common.sub.${t}`]])) as Record<CoreTab, [TKey, TKey]>;

/** Timeline : affichée d'office à partir de cette largeur de fenêtre (sidebar + liste compacte + ~300 px). */
const TIMELINE_AUTO_MIN = 1280;
type TimelinePref = 'auto' | 'shown' | 'hidden';

function useWide(min: number) {
  const [wide, setWide] = useState(() => window.innerWidth >= min);
  useEffect(() => {
    const mq = matchMedia(`(min-width: ${min}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [min]);
  return wide;
}

const tabFromHash = (): Tab => {
  const h = location.hash.slice(1);
  if (/^m\/[a-z][a-z0-9-]{1,39}$/.test(h)) return h as Tab;
  return TABS.includes(h as CoreTab) ? (h as CoreTab) : 'projects';
};

/**
 * Thème : localStorage pour l'affichage immédiat (script dans index.html), et réglages serveur pour la
 * persistance — le localStorage est propre à chaque adresse (tarmac.test, tarmac.localhost, :7777, PWA).
 */
function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) ?? 'system');
  const server = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  useEffect(() => {
    if (server.data?.theme && server.data.theme !== theme) setThemeState(server.data.theme);
  }, [server.data?.theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTheme = (t: Theme) => {
    setThemeState(t);
    api.saveSettings({ theme: t }).catch(() => null);
  };
  useEffect(() => {
    try { localStorage.setItem('theme', theme); } catch { /* stockage indisponible */ }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return [theme, setTheme] as const;
}

export default function App() {
  // Console seule dans un onglet du navigateur : #term/<id>
  const [termRoute, setTermRoute] = useState(() => location.hash.match(/^#term\/(\w+)/)?.[1] ?? null);
  useEffect(() => {
    const on = () => setTermRoute(location.hash.match(/^#term\/(\w+)/)?.[1] ?? null);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const terminalsQ = useQuery({ queryKey: ['terminals'], queryFn: api.terminals });
  if (termRoute) return <StandaloneTerminal sid={termRoute} terminals={terminalsQ.data ?? []} />;
  return <Main terminals={terminalsQ.data ?? []} />;
}

function Main({ terminals }: { terminals: import('./api').TerminalSession[] }) {
  const [claudeTab, setClaudeTab] = useState<string | null>(null);
  const [codexTab, setCodexTab] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  // IDE : projets ouverts (persistés), monté à la première visite puis gardé en mémoire.
  const [ideTabs, setIdeTabs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ide:tabs') ?? '[]'); } catch { return []; } });
  const [ideActive, setIdeActive] = useState<string | null>(() => localStorage.getItem('ide:active'));
  const [idePinned, setIdePinned] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ide:pinned') ?? '[]'); } catch { return []; } });
  const [ideMounted, setIdeMounted] = useState(tab === 'ide');
  useEffect(() => { if (tab === 'ide') setIdeMounted(true); }, [tab]);
  useEffect(() => {
    localStorage.setItem('ide:tabs', JSON.stringify(ideTabs));
    localStorage.setItem('ide:pinned', JSON.stringify(idePinned));
    if (ideActive) localStorage.setItem('ide:active', ideActive); else localStorage.removeItem('ide:active');
  }, [ideTabs, ideActive, idePinned]);
  useEffect(() => onIdeOpen((id) => {
    setIdeTabs((t) => (t.includes(id) ? t : [...t, id]));
    setIdeActive(id);
    setTab('ide');
  }), []);
  const closeIde = useCallback((ids: string[]) => {
    setIdeTabs((t) => {
      const next = t.filter((x) => !ids.includes(x));
      setIdeActive((a) => (a && ids.includes(a) ? next.at(-1) ?? null : a));
      return next;
    });
    setIdePinned((p) => p.filter((x) => !ids.includes(x)));
  }, []);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ id: string; tab: PanelTab } | null>(null);
  const [todoFocus, setTodoFocus] = useState<string | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const agents = useRunningAgents();
  const enabledAgents = useEnabledAgents();
  const runningOf = (k: AgentKind) => (agents.data ?? []).filter((a) => a.agent === k);
  /** Ouvre la console d'une session d'agent dans sa page (Sessions Claude ou Sessions Codex). */
  const openAgentTab = useCallback((sid: string, agent?: AgentKind) => {
    const kind = agent ?? (terminals.find((x) => x.id === sid)?.kind === 'codex' ? 'codex' : 'claude');
    if (kind === 'codex') { setCodexTab(sid); setTab('codex'); } else { setClaudeTab(sid); setTab('claude'); }
  }, [terminals]);
  const wide = useWide(TIMELINE_AUTO_MIN);
  const [timelinePref, setTimelinePrefState] = useState<TimelinePref>(() => {
    try { return (localStorage.getItem('timeline:pref') as TimelinePref) || 'auto'; } catch { return 'auto'; }
  });
  const setTimelinePref = (v: TimelinePref) => {
    setTimelinePrefState(v);
    try { localStorage.setItem('timeline:pref', v); } catch { /* stockage indisponible */ }
  };
  const suivi = useQuery({ queryKey: ['suivi', 'projects'], queryFn: api.suiviProjects });
  const [theme, setTheme] = useTheme();
  const t = useT();
  const [language, setLanguage] = useLanguageSetting();
  const searchRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const connected = useConnected();

  useEffect(() => { if (location.hash.slice(1) !== tab) location.hash = tab; }, [tab]);
  useEffect(() => {
    const onHash = () => { if (!location.hash.startsWith('#term/')) setTab(tabFromHash()); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && location.hash !== '#ide' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '') && !(e.target as HTMLElement).closest('.xterm')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, refetchInterval: 15_000 });
  // Chargés au démarrage du serveur seulement : pas de rafraîchissement.
  const modules = useQuery({ queryKey: ['modules'], queryFn: api.modules, staleTime: Infinity });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects, refetchInterval: 30_000 });
  const supabase = useQuery({ queryKey: ['supabase'], queryFn: api.supabase, refetchInterval: 10_000 });
  const github = useQuery({ queryKey: ['github'], queryFn: () => api.github(), staleTime: 5 * 60_000, retry: false });
  const ports = useQuery({ queryKey: ['ports'], queryFn: api.ports });
  const android = useQuery({
    queryKey: ['android'],
    queryFn: api.android,
    refetchInterval: (q) => (q.state.data?.avds.some((a) => a.state !== 'stopped' && a.state !== 'ready') ? 2_000 : 10_000),
  });

  const refresh = useMutation({
    mutationFn: async () => {
      await api.scan();
      await api.fetchGit();
      await api.github(true).catch(() => null); // GitHub optionnel
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast('ok', t('common.refreshDone'));
    },
    onError: (e: Error) => toast('err', e.message),
  });

  const list = projects.data ?? [];
  // Premier scan pas encore terminé (liste pas encore reçue, aucun scan abouti, ou scan en cours sans projet connu) :
  // message d'attente au lieu de « Aucun projet détecté ». Dossiers affichés avec ~.
  const firstScan = !meta.isError && !projects.isError && list.length === 0
    && (!projects.data || !meta.data?.scannedAt || !!meta.data?.scanning)
    ? (meta.data?.roots ?? []).map((r) => tildify(r, meta.data?.home)) : null;
  const selectedProject = selected ? list.find((p) => p.id === selected.id) : undefined;
  // Onglet du panneau gardé d'un projet à l'autre (le panneau se rabat sur Console si le projet ne l'a pas).
  const lastTab = useRef<PanelTab | null>(null);
  useEffect(() => { if (selected) lastTab.current = selected.tab; }, [selected]);
  const openProject = useCallback((id: string, panelTab?: PanelTab) => {
    const p = projects.data?.find((x) => x.id === id);
    if (p) setSelected({ id, tab: panelTab ?? lastTab.current ?? defaultTab(p) });
  }, [projects.data]);
  const closePanel = useCallback(() => setSelected(null), []);
  /** Vue globale → onglet Todolist Claude du projet (le projet scanné à la racine du dépôt de préférence). */
  /** false si aucun projet scanné ne porte ce suivi : la vue globale l'affiche alors elle-même. */
  const openTodo = useCallback((suiviId: string, taskId?: string) => {
    const sp = suivi.data?.find((x) => x.projectId === suiviId);
    const candidates = (projects.data ?? []).filter((p) => p.suiviId === suiviId);
    const p = candidates.find((x) => sp?.paths.includes(x.dir)) ?? candidates[0];
    if (!p) return false;
    setTodoFocus(taskId ?? null);
    setSelected({ id: p.id, tab: 'todolist' });
    setTab('projects');
    return true;
  }, [suivi.data, projects.data]);

  const toolsQ = useQuery({ queryKey: ['tools'], queryFn: api.tools, staleTime: 10_000, refetchInterval: 60_000 });
  const alerts = navAlerts(toolsQ.data ?? []);
  const nav: Array<{ id: Tab; label: string; icon: React.ReactNode; count?: number; live?: number; led?: boolean | null; alert?: boolean }> = [
    { id: 'projects', label: t('common.nav.projects'), icon: <Boxes className="size-4" />, count: projects.data ? new Set(list.filter((p) => !p.loose).map((p) => p.group.id)).size : undefined, live: list.filter(isActive).length },
    { id: 'ide', label: t('common.nav.ide'), icon: <Code2 className="size-4" />, count: ideTabs.length || undefined },
    { id: 'todolist', label: t('common.nav.todolist'), icon: <ListChecks className="size-4" />, count: suivi.data ? suivi.data.reduce((a, p) => a + p.counts.toTest, 0) || undefined : undefined },
    // Une entrée par agent coché (Réglages → Agents) ; LED : sessions de cet agent en cours, partout.
    ...enabledAgents.map((k) => ({
      id: k as Tab,
      label: t(k === 'codex' ? 'common.nav.codex' : 'common.nav.claude'),
      icon: k === 'codex' ? <CodexIcon size={15} /> : <ClaudeIcon size={15} />,
      count: terminals.filter((x) => x.kind === k).length || undefined,
      alert: alerts[k],
      live: terminals.filter((x) => x.kind === k && x.status === 'running').length,
      led: runningOf(k).length ? runningOf(k).some((a) => a.working) : null,
    })),
    // Pas de compteur : la vue Docker n'interroge le moteur que lorsqu'elle est affichée. Docker avant Supabase (Supabase en dépend).
    { id: 'docker', label: t('common.nav.docker'), icon: <Container className="size-4" />, alert: alerts.docker },
    { id: 'supabase', label: t('common.nav.supabase'), icon: <Database className="size-4" />, count: supabase.data?.instances.length, live: supabase.data?.instances.filter((i) => i.status !== 'stopped').length, alert: alerts.supabase },
    { id: 'github', label: t('common.nav.github'), icon: <GithubIcon className="size-4" />, count: github.data?.remoteOnly.length, alert: alerts.github },
    { id: 'ports', label: t('common.nav.ports'), icon: <Network className="size-4" />, count: ports.data?.assigned.length },
    { id: 'android', label: t('common.nav.android'), icon: <Smartphone className="size-4" />, count: android.data?.avds.length, live: android.data?.avds.filter((a) => a.state !== 'stopped').length },
    ...(modules.data ?? []).filter((m) => m.status === 'loaded' && m.webUrl)
      .map((m) => ({ id: `m/${m.id}` as Tab, label: t.loc(m.name), icon: <ModuleIcon svg={m.icon} /> })),
  ];
  const isModuleTab = tab.startsWith('m/');
  const timelineSlot = tab === 'projects' && !selectedProject;
  const timelineOpen = timelinePref === 'shown' || (timelinePref === 'auto' && wide);
  const moduleTab = modules.data?.find((m) => `m/${m.id}` === tab);
  const [title, subtitle] = isModuleTab
    ? [t.loc(moduleTab?.name ?? tab.slice(2)), moduleTab ? t('common.moduleSub', { version: moduleTab.version }) : '']
    : [t(TITLES[tab as CoreTab][0]), t(TITLES[tab as CoreTab][1])];

  // Fonctionnalités Pro verrouillées (7.16) : section « Pro » de la barre latérale, fenêtre au clic.
  const [proFeature, setProFeature] = useState<ProFeature | null>(null);
  const proSettings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const proLocked = lockedProFeatures(PRO_FEATURES, modules.data ?? [], { isDesktop: /TarmacDesktop/.test(navigator.userAgent), hidden: !!proSettings.data?.hideProTeasers });

  const NavButton = ({ n }: { n: (typeof nav)[number] }) => (
    <button
      onClick={() => setTab(n.id)}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 h-8 text-[13px] transition-colors',
        tab === n.id ? 'bg-panel-2 text-fg font-medium' : 'text-muted hover:text-fg hover:bg-panel-2/60',
      )}
    >
      <span className="relative grid shrink-0 place-items-center">
        {n.icon}
        {n.led != null && <AgentLed working={n.led} size={6} className="absolute -right-1 -top-0.5 ring-2 ring-panel" title={n.led ? t('agents.ledWorking') : t('agents.ledIdle')} />}
      </span>
      <span className="flex-1 text-left">{n.label}</span>
      {!!n.live && <span className="rounded bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{n.live}</span>}
      {n.count != null && <span className="text-[11px] text-faint tabular-nums">{n.count}</span>}
      {n.alert && <AlertTriangle className="size-3.5 shrink-0 text-amber-500" aria-label={t('tools.nav.alert')} />}
    </button>
  );

  return (
    <div className="flex h-full">
      <UpdateBanner serverBuild={meta.data?.buildId} />
      {/* ─── Sidebar ─── */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2.5 px-4 py-2.5 min-h-14 border-b border-line">
          <img src="/tarmac-mark-light.svg" className="size-8 dark:hidden" alt="Tarmac" />
          <img src="/tarmac-mark-dark.svg" className="size-8 hidden dark:block" alt="Tarmac" />
          <div className="min-w-0 leading-tight">
            <div className="font-semibold tracking-tight">Tarmac</div>
            <div className="truncate text-[11px] text-muted" title={meta.data?.hostname}>{meta.data?.machine ?? '…'}</div>
            {meta.data?.ips[0] && (
              <button
                title={t('common.copyIp', { ips: meta.data.ips.map((i) => `${i.iface}: ${i.address}`).join(' · ') })}
                onClick={() => copy(meta.data!.ips[0].address, toast, t('common.ipCopied'))}
                className="font-mono text-[11px] text-faint hover:text-fg"
              >
                {meta.data.ips[0].address}
              </button>
            )}
          </div>
        </div>
        <nav className="shrink-0 p-2 space-y-0.5">
          {nav.map((n) => <NavButton key={n.id} n={n} />)}
          {proLocked.length > 0 && (
            <div className="pt-2" data-testid="pro-section">
              <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{t('pro.section')}</div>
              {proLocked.map((f) => (
                <button key={f.id} onClick={() => setProFeature(f)} data-testid={`pro-${f.id}`}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 h-8 text-[13px] text-muted/70 transition-colors hover:bg-panel-2/60 hover:text-muted">
                  <f.icon className="size-4 shrink-0" />
                  <span className="flex-1 text-left">{t.loc(f.name)}</span>
                  <ProBadge />
                </button>
              ))}
            </div>
          )}
          <div className="my-2 border-t border-line" />
          <NavButton n={{ id: 'settings', label: t('common.nav.settings'), icon: <Settings2 className="size-4" /> }} />
        </nav>
        {/* Espace libre : utilisation Claude au-dessus du logo discret. Quand la fenêtre est trop basse, le logo
            puis le panneau s'effacent (règles de hauteur dans index.css) : rien ne déborde ni ne défile. */}
        <div className="sidebar-free min-h-0 flex-1 overflow-hidden">
          <div className="sidebar-free-inner flex h-full flex-col justify-end">
            {enabledAgents.includes('claude') && <ClaudeUsagePanel />}
            {enabledAgents.includes('codex') && <CodexUsagePanel />}
            <div className="sidebar-logo flex shrink-0 justify-center px-6" aria-hidden="true">
              <img src="/tarmac-logo-light.svg" alt="" draggable={false} className="mb-4 w-[116px] select-none opacity-35 dark:hidden" />
              <img src="/tarmac-logo-dark.svg" alt="" draggable={false} className="mb-4 hidden w-[116px] select-none opacity-30 dark:block" />
            </div>
          </div>
        </div>
        <div className="border-t border-line p-3 space-y-3">
          <div className="space-y-1 text-[11px] text-faint">
            {meta.data?.roots.map((r) => (
              <div key={r} className="flex items-center gap-1.5 truncate" title={r}><FolderTree className="size-3 shrink-0" /><span className="font-mono truncate">{tildify(r, meta.data?.home)}</span></div>
            ))}
            <div>{t('common.lastScan', { scan: timeAgo(meta.data?.scannedAt), fetch: timeAgo(meta.data?.lastFetchAt) })}</div>
            <div className="flex items-center gap-1.5">
              <span className={cx('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-amber-500')} />
              {connected ? t('common.connected') : t('common.connecting')}
            </div>
          </div>
          <InstallButton />
          <div className="grid grid-cols-2 gap-2">
            <div className="grid grid-cols-3 rounded-md border border-line p-0.5">
              {([['light', Sun], ['system', Monitor], ['dark', Moon]] as const).map(([th, Icon]) => (
                <button key={th} title={t(`common.theme.${th}`)} aria-label={t(`common.theme.${th}`)} onClick={() => setTheme(th)}
                  className={cx('grid h-6 place-items-center rounded', theme === th ? 'bg-panel-2 text-fg' : 'text-faint hover:text-fg')}>
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 rounded-md border border-line p-0.5">
              {(['auto', 'en', 'fr'] as const).map((l) => (
                <button key={l} title={l === 'auto' ? t('common.lang.auto', { lang: t(`common.lang.${t.lang}`) }) : t(`common.lang.${l}`)}
                  aria-label={l === 'auto' ? t('common.lang.auto', { lang: t(`common.lang.${t.lang}`) }) : t(`common.lang.${l}`)}
                  onClick={() => setLanguage(l)}
                  className={cx('grid h-6 place-items-center rounded text-[10px] font-semibold', language === l ? 'bg-panel-2 text-fg' : 'text-faint hover:text-fg')}>
                  {l === 'auto' ? <Languages className="size-3.5" /> : l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="text-center text-[10px] leading-relaxed text-faint">
            <button onClick={() => setLicenseOpen(true)} title={t('common.licenseOpen')} className="hover:text-fg hover:underline">{t('common.license')}</button>
            {appVersion(meta.data?.version) && <span title={t('common.version')}> · {appVersion(meta.data?.version)}</span>}
            <br />© 2026 Ismaël Belaaouad · Codustel<br />
            <a href="https://www.linkedin.com/in/codustel/" target="_blank" rel="noreferrer" className="hover:text-fg">LinkedIn</a>
            {' · '}
            <a href="https://x.com/ismael_b_ai" target="_blank" rel="noreferrer" className="hover:text-fg">X</a>
          </div>
        </div>
      </aside>
      <ToolsWelcome />
      <ToolGateModal />
      {proFeature && <ProUpsellModal feature={proFeature} onClose={() => setProFeature(null)} />}
      {licenseOpen && <LicenseModal onClose={() => setLicenseOpen(false)} />}

      {/* ─── Contenu ─── */}
      <div className="flex min-w-0 flex-1">
        <main className={cx('min-w-0 flex-1 overflow-auto', tab === 'ide' && 'hidden')}>
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/80 backdrop-blur px-6 h-14">
            <div className="min-w-0 flex-1">
              <h1 className="font-semibold text-[15px] leading-tight">{title}</h1>
              <p className="text-[11px] text-faint truncate">{subtitle}</p>
            </div>
            {tab !== 'settings' && !isModuleTab && (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('common.search')}
                    className="h-8 w-56 rounded-md border border-line bg-panel pl-8 pr-8 text-[13px] outline-none placeholder:text-faint focus:border-accent"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2"><Kbd>/</Kbd></span>
                </div>
                <Button icon={<RefreshCw className={cx('size-3.5', refresh.isPending && 'animate-spin')} />} disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                  {t('common.refresh')}
                </Button>
              </>
            )}
          </header>

          <div className={cx('p-6', timelineSlot ? 'flex items-start gap-5' : 'max-w-[1400px]')}>
            <div className={cx(timelineSlot && 'min-w-0 max-w-[1400px] flex-1')}>
            {tab === 'projects' && <ProjectsView projects={list} query={query} onOpen={openProject} selectedId={selected?.id ?? null} scanning={firstScan} />}
            {tab === 'claude' && <ClaudeSessionsView terminals={terminals} activeId={claudeTab} onActive={setClaudeTab} projects={list} />}
            {tab === 'codex' && <ClaudeSessionsView agent="codex" terminals={terminals} activeId={codexTab} onActive={setCodexTab} projects={list} />}
            {tab === 'supabase' && <SupabaseView data={supabase.data} query={query} />}
            {tab === 'docker' && <DockerView query={query} onOpenProject={(id) => { openProject(id); setTab('projects'); }} />}
            {tab === 'github' && <GithubView data={github.data} error={github.error} query={query} />}
            {tab === 'ports' && <PortsView data={ports.data} apps={list} />}
            {tab === 'android' && <AndroidView data={android.data} />}
            {tab === 'todolist' && (
              <TodolistView summaries={suivi.data} projects={list} query={query} onOpenTask={openTodo}
                onOpenTerminal={openAgentTab} />
            )}
            {tab === 'settings' && <SettingsView />}
            {isModuleTab && modules.data && <ModuleView module={moduleTab} />}
            </div>
            {/* Timeline d'activité : espace libre à droite de la liste des projets, volet du projet fermé. */}
            {timelineSlot && (timelineOpen ? (
              <aside className="sticky top-20 w-[clamp(300px,22vw,440px)] shrink-0">
                <TimelineView onOpenProject={openProject} onHide={() => setTimelinePref('hidden')} />
              </aside>
            ) : (
              <button onClick={() => setTimelinePref('shown')} title={t('timeline.showTitle')}
                className="sticky top-20 flex w-8 shrink-0 flex-col items-center gap-2 rounded-lg border border-line bg-panel py-3 text-muted hover:text-fg">
                <Activity className="size-4" />
                <span className="text-[11px] font-medium [writing-mode:vertical-rl]">{t('timeline.show')}</span>
              </button>
            ))}
          </div>
        </main>

        {ideMounted && (
          <div className={cx('h-screen min-w-0 flex-1', tab !== 'ide' && 'hidden')}>
            <Suspense fallback={<div className="grid h-full place-items-center text-[13px] text-faint">{t('common.loadingEditor')}</div>}>
              <IdeView projects={projects.data ?? []} tabs={ideTabs} pinned={idePinned} active={ideActive} onActive={setIdeActive} onClose={closeIde} onTabs={setIdeTabs} onPinned={setIdePinned} />
            </Suspense>
          </div>
        )}

        {selectedProject && tab === 'projects' && (
          <div className="w-[46%] min-w-[440px] max-w-[820px] shrink-0">
            <ProjectPanel project={selectedProject} webApps={list.filter((p) => p.group.id === selectedProject.group.id && hasBrowser(p))} tab={selected!.tab} todoFocus={todoFocus} onTab={(pt) => setSelected({ id: selectedProject.id, tab: pt })} onClose={closePanel} onOpenClaudeTab={openAgentTab} />
          </div>
        )}
      </div>
    </div>
  );
}
