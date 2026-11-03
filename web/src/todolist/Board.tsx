import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AgentKind, type SuiviDetail, type SuiviJournalEntry, type SuiviTask, type SuiviTheme } from '../api';
import { copy, useToast } from '../ui';
import { fmtDate, fmtDateTime, translateNow, useT, type TKey } from '../i18n';
import { RequestedBadge, SendToClaude } from './SendToClaude';

/** Date courte d'une tâche (« 3 nov. »), avec l'année si ce n'est pas l'année en cours. */
const fmtShortDate = (d: string) =>
  fmtDate(d, new Date(d).getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });

/** Libellés « qui » (clés traduites au rendu). */
export const WHO: Record<string, TKey> = { toi: 'todolist.who.toi', ensemble: 'todolist.who.ensemble', claude: 'todolist.who.claude' };
const FIELDS = ['created', 'done', 'tested', 'testedAt', 'testNote', 'doneAt', 'note', 'toTest', 'title', 'archived',
  'order', 'phase', 'who', 'minutes', 'why', 'steps', 'check', 'sources', 'requestedAt', 'requestedTo'] as const;
const FIELD = Object.fromEntries(FIELDS.map((f) => [f, `todolist.field.${f}`])) as Record<string, TKey>;
const ORIGIN: Record<string, TKey> = { tarmac: 'todolist.origin.tarmac', 'app-manager': 'todolist.origin.tarmac', artifact: 'todolist.origin.artifact', claude: 'todolist.origin.claude' };

export const fmtMin = (m: number) => {
  if (!m) return '';
  if (m < 60) return translateNow('todolist.time.min', { n: m });
  const h = Math.floor(m / 60);
  return m % 60 ? translateNow('todolist.time.hm', { h, m: String(m % 60).padStart(2, '0') }) : translateNow('todolist.time.h', { h });
};
/** « À tester » : traitée mais pas encore validée ; une tâche cochée n'est plus à tester. */
export const isToTest = (t: SuiviTask) => t.toTest && !t.done;

/** Texte avec `code` entre backticks (même rendu que l'artefact). */
function Rich({ text }: { text: string }) {
  return <>{text.split(/`([^`]+)`/g).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}</>;
}

/** Suit la classe `.dark` de Tarmac (thème clair / sombre / système). */
export function useAppDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);
  return dark;
}

/** Jetons du thème du projet en variables CSS, et polices Google Fonts du projet. */
export function useThemeVars(theme: SuiviTheme | undefined, dark: boolean): CSSProperties {
  useEffect(() => {
    if (!theme) return;
    const fams = [...new Set([theme.fonts.display, theme.fonts.body, theme.fonts.mono])].filter((f) => /^[A-Za-z0-9 ]+$/.test(f));
    const href = `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700;800`).join('&')}&display=swap`;
    if (document.querySelector(`link[data-tl-fonts="${href}"]`)) return;
    const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
    l.dataset.tlFonts = href;
    document.head.appendChild(l);
  }, [theme]);
  if (!theme) return {};
  const v = dark ? theme.dark : theme.light;
  return {
    '--tl-bg': v.bg, '--tl-surface': v.surface, '--tl-surface2': v.surface2, '--tl-line': v.line, '--tl-fg': v.fg, '--tl-muted': v.muted,
    '--tl-primary': v.primary, '--tl-primarySoft': v.primarySoft, '--tl-primaryText': v.primaryText,
    '--tl-display': `'${theme.fonts.display}'`, '--tl-body': `'${theme.fonts.body}'`, '--tl-mono': `'${theme.fonts.mono}'`,
  } as CSSProperties;
}

type StatusFilter = 'all' | 'todo' | 'totest' | 'done';
type WhoFilter = 'all' | 'toi' | 'ensemble' | 'claude';

/**
 * Todolist Claude d'un projet : même présentation et mêmes règles que l'artefact de suivi.
 * On y coche et on y annote ; ajouter ou retirer une tâche passe par Claude (D7).
 */
export function Board({ suiviId, appProjectId, focusTaskId, onOpenTerminal }: {
  suiviId: string;
  /** Projet scanné (pour ouvrir une session Claude). */
  appProjectId?: string;
  focusTaskId?: string | null;
  /** Une session Claude vient d'être ouverte dans ce terminal. */
  onOpenTerminal?: (sid: string, agent?: AgentKind) => void;
}) {
  const tr = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const dark = useAppDark();
  const q = useQuery({ queryKey: ['suivi', suiviId], queryFn: () => api.suivi(suiviId) });
  const vars = useThemeVars(q.data?.project.theme, dark);

  const uiKey = `tl:ui:${suiviId}`;
  const [openPhases, setOpenPhases] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(uiKey) ?? '{}').openPhases ?? []); } catch { return new Set(); }
  });
  const savePhases = (s: Set<number>) => { setOpenPhases(s); try { localStorage.setItem(uiKey, JSON.stringify({ openPhases: [...s] })); } catch { /* stockage indisponible */ } };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusFilter>('all');
  const [who, setWho] = useState<WhoFilter>('all');
  const [history, setHistory] = useState<Record<string, SuiviJournalEntry[] | 'loading'>>({});

  // Tâche demandée depuis la vue globale : dépliée, phase ouverte, mise à l'écran.
  useEffect(() => {
    const t = focusTaskId && q.data?.tasks.find((x) => x.id === focusTaskId);
    if (!t) return;
    setOpen((s) => new Set(s).add(t.id));
    setOpenPhases((s) => new Set(s).add(t.phase));
    setStatus('all');
    setWho('all');
    setTimeout(() => document.getElementById(`tl-task-${suiviId}-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }, [focusTaskId, q.data, suiviId]);

  const patch = useMutation({
    mutationFn: ({ t, changes }: { t: SuiviTask; changes: Parameters<typeof api.suiviPatch>[3] }) => api.suiviPatch(suiviId, t.id, t.rev, changes),
    onSuccess: (task) => {
      qc.setQueryData<SuiviDetail>(['suivi', suiviId], (d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === task.id ? task : x)) });
      qc.invalidateQueries({ queryKey: ['suivi'] });
    },
    onError: (e: Error & { status?: number }) => {
      toast('err', e.status === 409 ? tr('todolist.board.conflict') : e.message);
      qc.invalidateQueries({ queryKey: ['suivi', suiviId] });
    },
  });

  // La db d'un artefact n'est lisible que par sa page ou par une session de Claude desktop (pas par le CLI
  // que Tarmac peut lancer) : le bouton prépare la commande à coller dans une session Claude desktop.
  const [syncHelp, setSyncHelp] = useState(false);
  const syncCmd = `/suivi sync ${suiviId}`;

  const claude = useMutation({
    mutationFn: (prompt?: string) => api.openClaude(appProjectId!, undefined, prompt),
    onSuccess: (s) => onOpenTerminal?.(s.id),
    onError: (e: Error) => toast('err', e.message),
  });

  const tasks = q.data?.tasks ?? [];
  const phases = useMemo(() => {
    const m = new Map<number, { title: string; items: SuiviTask[] }>();
    for (const t of tasks) {
      if (!m.has(t.phase)) m.set(t.phase, { title: t.phaseTitle, items: [] });
      m.get(t.phase)!.items.push(t);
    }
    return [...m.entries()];
  }, [tasks]);

  if (q.isLoading) return <div className="p-6 text-sm text-muted">{tr('todolist.board.loading')}</div>;
  if (q.error || !q.data) return <div className="p-6 text-sm text-red-500">{(q.error as Error)?.message ?? tr('todolist.board.notFound')}</div>;
  const { project, counts, syncs } = q.data;
  const nxt = counts.next && tasks.find((t) => t.id === counts.next!.id);
  // « À faire » : pas faite et pas en attente de test (même règle que l'artefact).
  const statusOk = (t: SuiviTask) => status === 'all' || (status === 'totest' ? isToTest(t) : status === 'todo' ? !t.done && !isToTest(t) : t.done);
  const vis = (t: SuiviTask) => statusOk(t) && (who === 'all' || t.who === who);
  const filtered = status !== 'all' || who !== 'all';
  const shownCount = tasks.filter(vis).length;
  const lastSync = [...syncs].sort((a, b) => b.at.localeCompare(a.at))[0];
  const ghRepo = /^[\w.-]+\/[\w.-]+$/.test(project.projectId) ? project.projectId : null;

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const showNext = () => {
    if (!nxt) return;
    setOpen((s) => new Set(s).add(nxt.id));
    savePhases(new Set(openPhases).add(nxt.phase));
    setTimeout(() => document.getElementById(`tl-task-${suiviId}-${nxt.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const loadHistory = async (id: string) => {
    if (history[id]) return setHistory(({ [id]: _, ...rest }) => rest);
    setHistory((h) => ({ ...h, [id]: 'loading' }));
    try { setHistory({ ...history, [id]: await api.suiviHistory(suiviId, id) }); } catch (e: any) { toast('err', e.message); setHistory(({ [id]: _, ...rest }) => rest); }
  };
  const openSession = async (sessionId: string) => {
    if (!appProjectId) return;
    try { onOpenTerminal?.((await api.openClaude(appProjectId, sessionId)).id); } catch (e: any) { toast('err', e.message); }
  };

  return (
    <div className={`tl ${dark ? 'tl-dark' : 'tl-light'} min-h-full`} style={vars}>
      <div className="tl-wrap">
        <header>
          <div className="tl-brand">{project.brand}</div>
          <h1>{project.title}</h1>
          {project.subtitle && <p className="tl-sub">{project.subtitle}</p>}
          <div className="tl-actions">
            {project.artifactUrl && <a className="tl-btn tl-ghost tl-small" href={project.artifactUrl} target="_blank" rel="noreferrer">{tr('todolist.board.openArtifact')}</a>}
            <a className="tl-btn tl-ghost tl-small" href={api.suiviExportUrl(suiviId)} download={project.copyFile}>⬇ JSON</a>
            <button className="tl-btn tl-ghost tl-small" type="button" disabled={!project.artifactUrl}
              onClick={() => { copy(syncCmd, toast, tr('todolist.board.syncCopied')); setSyncHelp(true); }}
              title={tr('todolist.board.syncTitle')}>
              {tr('todolist.board.sync')}
            </button>
            {appProjectId && (
              <>
                <button className="tl-btn tl-small" type="button" disabled={claude.isPending} onClick={() => claude.mutate(undefined)} title={tr('todolist.board.askClaudeTitle')}>{tr('todolist.board.askClaude')}</button>
              </>
            )}
          </div>
        </header>

        <section className="tl-summary" aria-label={tr('todolist.board.progressLabel')}>
          <div>
            <div className="tl-big">{counts.pct} %</div>
            <div className="tl-meta">{counts.total ? tr('todolist.board.count', { count: counts.done, total: counts.total }) : tr('todolist.board.none')}</div>
            {counts.total > 0 && (
              <button className="tl-tcount" type="button" title={tr('todolist.board.toTestTitle')} onClick={() => setStatus('totest')}>{tr('todolist.toTestCount', { n: counts.toTest })}</button>
            )}
          </div>
          <div className="tl-meta" style={{ textAlign: 'right' }}>{counts.total ? tr('todolist.board.left', { time: fmtMin(counts.minutesLeft) || tr('todolist.time.min', { n: 0 }) }) : ''}</div>
          <div className="tl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={counts.pct}><i style={{ width: `${counts.pct}%` }} /></div>
          <div className="tl-sync">
            {syncHelp && (
              <span style={{ flexBasis: '100%' }}>
                {tr.node('todolist.board.syncHelp', { cmd: <code>{syncCmd}</code> })}{' '}
                <button type="button" className="tl-link" onClick={() => setSyncHelp(false)}>{tr('todolist.board.ok')}</button>
              </span>
            )}
            <span>{lastSync
              ? tr('todolist.board.lastSync', { channel: lastSync.channel === 'file' ? tr('todolist.board.channelFile') : tr('todolist.board.channel', { name: lastSync.channel }), date: fmtDateTime(lastSync.at) })
              : tr('todolist.board.neverSynced')}</span>
            <span>{tr.node('todolist.board.copy', { file: <code>Todolist/{project.copyFile}</code> })}</span>
          </div>
        </section>

        {nxt && (
          <section className="tl-next" aria-live="polite">
            <div className="tl-lbl">{tr('todolist.next')}</div>
            <div className="tl-t">{nxt.num} · {nxt.title}</div>
            <button className="tl-btn" type="button" style={{ alignSelf: 'flex-start' }} onClick={showNext}>{tr('todolist.board.showSteps')}</button>
          </section>
        )}

        <div className="tl-filters" role="group" aria-label={tr('todolist.board.filtersLabel')}>
          {(['all', 'todo', 'totest', 'done'] as const).map((v) => (
            <button key={v} className={`tl-chip${v === 'totest' ? ' tl-chip-totest' : ''}`} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}>{tr(`todolist.status.${v}`)}</button>
          ))}
          <span style={{ width: 8 }} />
          {(['all', 'toi', 'ensemble', 'claude'] as const).map((v) => (
            <button key={v} className="tl-chip" type="button" aria-pressed={who === v} onClick={() => setWho(v)}>{tr(`todolist.who.${v}`)}</button>
          ))}
        </div>

        <div>
          {filtered && (
            <div className="tl-status" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
              <span>{tr('todolist.board.filterBanner', { count: shownCount, total: counts.total })}</span>
              <button className="tl-btn" type="button" onClick={() => { setStatus('all'); setWho('all'); }}>{tr('todolist.board.showAll')}</button>
            </div>
          )}
          {counts.total === 0 && <div className="tl-empty">{tr('todolist.board.empty')}</div>}
          {phases.map(([p, ph]) => {
            const pd = ph.items.filter((t) => t.done).length;
            const shown = ph.items.filter(vis);
            if (!shown.length) return null;
            const isOpen = openPhases.has(p) || (!!nxt && nxt.phase === p && !openPhases.size) || status === 'totest';
            return (
              <details key={p} className={`tl-phase${pd === ph.items.length ? ' tl-complete' : ''}`} open={isOpen}
                onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== openPhases.has(p)) { const n = new Set(openPhases); if (o) n.add(p); else n.delete(p); savePhases(n); } }}>
                <summary>
                  <span className="tl-pnum">{p}</span>
                  <span className="tl-ptitle">{ph.title}</span>
                  <span className="tl-pcount">{pd}/{ph.items.length}{pd === ph.items.length ? ` ${tr('todolist.board.phaseComplete')}` : ''}</span>
                </summary>
                <div className="tl-tasks">
                  {shown.map((t) => {
                    const o = open.has(t.id);
                    const h = history[t.id];
                    return (
                      <div key={t.id} id={`tl-task-${suiviId}-${t.id}`} className={`tl-task${t.done ? ' tl-done' : ''}${focusTaskId === t.id ? ' tl-focus' : ''}`}>
                        <div className="tl-row">
                          <input type="checkbox" checked={t.done} disabled={patch.isPending} aria-label={tr('todolist.board.markDone', { num: t.num })}
                            onChange={(e) => patch.mutate({ t, changes: { done: e.target.checked } })} />
                          <span className="tl-num">{t.num}</span>
                          <button className="tl-ttl" type="button" aria-expanded={o} onClick={() => toggle(t.id)}>{t.title}</button>
                          <span className="tl-tags">
                            {isToTest(t) ? (
                              <button type="button" className="tl-badge-totest" disabled={patch.isPending} title={tr('todolist.board.toTestBadgeTitle')}
                                onClick={() => patch.mutate({ t, changes: { toTest: false, tested: true, testedAt: new Date().toISOString() } })}>{tr('todolist.status.totest')}</button>
                            ) : t.tested ? (
                              <button type="button" className="tl-badge-tested" disabled={patch.isPending} title={t.testedAt ? tr('todolist.board.testedOnTitle', { date: fmtDate(t.testedAt, {}) }) : tr('todolist.board.testedTitle')}
                                onClick={() => patch.mutate({ t, changes: { toTest: true, tested: false, testedAt: null } })}>{tr('todolist.board.tested')}</button>
                            ) : null}
                            <RequestedBadge task={t} />
                            <SendToClaude suiviId={suiviId} task={t} onOpenTerminal={onOpenTerminal} />
                            <span className={`tl-pill tl-who-${t.who}`}>{WHO[t.who] ? tr(WHO[t.who]) : t.who}</span>
                            {t.createdAt && <span className="tl-created" title={tr('todolist.board.createdOn', { date: fmtDateTime(t.createdAt) })}>{fmtShortDate(t.createdAt)}</span>}
                            <span className="tl-time">{fmtMin(t.minutes)}</span>
                          </span>
                        </div>
                        {o && (
                          <div className="tl-detail">
                            <div><SendToClaude suiviId={suiviId} task={t} large onOpenTerminal={onOpenTerminal} /></div>
                            {t.why && <p className="tl-why">{tr.node('todolist.board.why', { text: <Rich text={t.why} /> })}</p>}
                            {t.steps.length > 0 && <ol>{t.steps.map((s, i) => <li key={i}><Rich text={s} /></li>)}</ol>}
                            {t.check && <div className="tl-check"><b>{tr('todolist.board.check')}</b><span><Rich text={t.check} /></span></div>}
                            <label className="tl-note">
                              {tr('todolist.board.note')}
                              <textarea defaultValue={t.note} key={`${t.id}-${t.rev}`} placeholder={tr('todolist.board.notePlaceholder')}
                                onBlur={(e) => { if (e.target.value !== t.note) patch.mutate({ t, changes: { note: e.target.value } }); }} />
                            </label>
                            {t.done && t.doneAt && <span className="tl-doneat">{tr('todolist.board.doneAt', { date: fmtDateTime(t.doneAt) })}</span>}
                            {t.tested && t.testedAt && <span className="tl-doneat">{tr('todolist.board.testedAt', { date: fmtDateTime(t.testedAt) })}</span>}
                            {t.testNote && <p className="tl-why">{tr.node('todolist.board.testNote', { text: <Rich text={t.testNote} /> })}</p>}
                            {t.sources.length > 0 && (
                              <div className="tl-sources">
                                <b>{tr('todolist.board.sources')}</b>
                                {t.sources.map((s, i) => (
                                  <span key={i}>
                                    {s.kind === 'session' ? (
                                      <>{tr('todolist.board.session')} <button type="button" disabled={!appProjectId} onClick={() => openSession(s.ref)} title={tr('todolist.board.openSessionTitle')}>{s.ref.slice(0, 8)}</button></>
                                    ) : s.kind === 'commit' ? (
                                      <>{tr('todolist.board.commit')} {ghRepo ? <a href={`https://github.com/${ghRepo}/commit/${s.ref}`} target="_blank" rel="noreferrer">{s.ref.slice(0, 7)}</a> : <code>{s.ref.slice(0, 7)}</code>}</>
                                    ) : (
                                      <>{tr('todolist.board.quote', { text: s.ref })}</>
                                    )}
                                    {s.at && ` · ${fmtDateTime(s.at)}`}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div>
                              <button className="tl-link" type="button" onClick={() => loadHistory(t.id)}>{h ? tr('todolist.board.hideHistory') : tr('todolist.board.showHistory')}</button>
                              {h === 'loading' && <span className="tl-meta"> · {tr('todolist.board.historyLoading')}</span>}
                              {Array.isArray(h) && (
                                <ul className="tl-history" style={{ marginTop: 6 }}>
                                  {h.map((e) => (
                                    <li key={e.seq}>
                                      {fmtDateTime(e.at)} · {ORIGIN[e.origin] ? tr(ORIGIN[e.origin]) : e.origin} · {FIELD[e.field] ? tr(FIELD[e.field]) : e.field}
                                      {e.lost ? ` ${tr('todolist.board.lost')}` : ''}
                                      {e.field === 'note' || e.field === 'done' || e.field === 'toTest' || e.field === 'tested' ? ` : ${JSON.stringify(e.after)}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
          {counts.total > 0 && shownCount === 0 && <div className="tl-empty">{tr('todolist.board.noMatch')}</div>}
        </div>
      </div>
    </div>
  );
}
