import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, CloudUpload, Ellipsis, FileText, Minus, Plus, RefreshCw, Undo2 } from 'lucide-react';
import type { ScmAction, ScmChange, ScmCode, ScmCommit, ScmGraphRow, ScmLog, ScmStatus } from '../api';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { FileIcon } from './fileIcon';
import { fmtDateTime, useT, type TKey } from '../i18n';

/** Couleurs des décorations git de VS Code (Dark Modern). */
export const SCM_COLOR: Record<ScmCode, string> = {
  M: '#e2c08d', T: '#e2c08d', A: '#81b88b', R: '#73c991', C: '#73c991', U: '#73c991', D: '#c74e39', '!': '#e4676b',
};
const SCM_TITLE: Record<ScmCode, TKey> = {
  M: 'ide.scm.code.M', T: 'ide.scm.code.T', A: 'ide.scm.code.A', R: 'ide.scm.code.R', C: 'ide.scm.code.C', U: 'ide.scm.code.U', D: 'ide.scm.code.D', '!': 'ide.scm.code.conflict',
};
const MUTED = '#9d9d9d';
const ACCENT = '#0078d4';

/** Badge à la VS Code : 10000 → « 10K ». */
export const fmtCount = (n: number) => (n >= 1000 ? `${Math.floor(n / 1000)}K` : String(n));
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

type Group = 'conflicts' | 'staged' | 'changes';
export interface ScmProps {
  projectId: string;
  status: ScmStatus | null;
  log: ScmLog | null;
  error: string | null;
  busy: boolean;
  onAction: (action: ScmAction, body?: { paths?: string[]; message?: string; amend?: boolean; push?: boolean }) => Promise<boolean>;
  onRefresh: () => void;
  onOpenChange: (c: ScmChange, staged: boolean, preview: boolean) => void;
  onOpenFile: (path: string) => void;
  onReveal: (path: string) => void;
  onCopy: (path: string) => void;
}

/** Vue « Contrôle de code source » : message et commit, groupes de fichiers, graphe. */
export function ScmView(props: ScmProps) {
  const { projectId, status: s, log, error, busy, onAction } = props;
  const t = useT();
  const msgKey = `ide:scm-msg:${projectId}`;
  const [message, setMessage] = useState(() => localStorage.getItem(msgKey) ?? '');
  useEffect(() => { localStorage.setItem(msgKey, message); }, [msgKey, message]);
  const [open, setOpen] = useState<Record<string, boolean>>({ conflicts: true, staged: true, changes: true, graph: true });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const total = s ? s.counts.staged + s.counts.changes + s.counts.conflicts : 0;
  const commit = async (opts: { amend?: boolean; push?: boolean } = {}) => {
    if (!message.trim() && !opts.amend) {
      input.current?.focus();
      return;
    }
    if (await onAction('commit', { message, ...opts })) setMessage('');
  };
  const discard = (paths: string[], all = false) => {
    const what = all
      ? t('ide.scm.discard.all', { count: paths.length })
      : paths.length === 1 ? t('ide.scm.discard.one', { name: base(paths[0]) }) : t('ide.scm.discard.many', { count: paths.length });
    if (!confirm(t('ide.scm.discard.confirm', { what }))) return;
    if (all) onAction('discardAll');
    else onAction('discard', { paths });
  };

  const moreMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 2,
      items: [
        { label: 'Pull', onClick: () => onAction('pull') },
        { label: 'Push', onClick: () => onAction('push') },
        { label: 'Fetch', onClick: () => onAction('fetch') },
        { label: t('ide.scm.sync'), onClick: () => onAction('sync') },
        'separator',
        { label: t('ide.scm.commit'), onClick: () => commit() },
        { label: t('ide.scm.commitPush'), onClick: () => commit({ push: true }) },
        { label: t('ide.scm.commitAmend'), onClick: () => commit({ amend: true }) },
        'separator',
        { label: t('ide.scm.stageAll'), disabled: !s?.counts.changes, onClick: () => onAction('stageAll') },
        { label: t('ide.scm.unstageAll'), disabled: !s?.counts.staged, onClick: () => onAction('unstageAll') },
        { label: t('ide.scm.discardAll'), disabled: !s?.counts.changes, onClick: () => discard(s!.changes.map((c) => c.path), true) },
      ],
    });
  };
  const commitMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 2,
      items: [
        { label: t('ide.scm.commit'), onClick: () => commit() },
        { label: t('ide.scm.commitAmend'), onClick: () => commit({ amend: true }) },
        { label: t('ide.scm.commitPush'), onClick: () => commit({ push: true }) },
        { label: t('ide.scm.commitSync'), onClick: async () => { if (message.trim() && (await onAction('commit', { message }))) { setMessage(''); onAction('sync'); } } },
      ],
    });
  };
  const rowMenu = (e: React.MouseEvent, c: ScmChange, group: Group) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: t('ide.scm.openChanges'), disabled: group === 'conflicts', onClick: () => props.onOpenChange(c, group === 'staged', false) },
        { label: t('ide.scm.openFile'), disabled: c.code === 'D' && group !== 'staged', onClick: () => props.onOpenFile(c.path) },
        'separator',
        group === 'staged'
          ? { label: t('ide.scm.unstage'), onClick: () => onAction('unstage', { paths: [c.path] }) }
          : { label: t('ide.scm.stage'), onClick: () => onAction('stage', { paths: [c.path] }) },
        { label: t('ide.scm.discardChanges'), disabled: group !== 'changes', onClick: () => discard([c.path]) },
        'separator',
        { label: t('ide.scm.copyRelPath'), onClick: () => props.onCopy(c.path) },
        { label: t('ide.scm.revealInExplorer'), onClick: () => props.onReveal(c.path) },
      ],
    });
  };

  // Bouton principal : comme VS Code, il devient « Synchroniser » / « Publier » quand il n'y a rien à commiter.
  let primary: { label: React.ReactNode; title: string; onClick: () => void; disabled?: boolean };
  if (total > 0 || !s) primary = { label: <><Check className="size-4" />{t('ide.scm.commit')}</>, title: t('ide.scm.commitShortcut'), onClick: () => commit(), disabled: !s };
  else if (s.upstream && (s.ahead || s.behind)) {
    primary = {
      label: <><RefreshCw className="size-3.5" />{t('ide.scm.syncChanges')} {s.behind ? `${s.behind}↓ ` : ''}{s.ahead ? `${s.ahead}↑` : ''}</>,
      title: t('ide.scm.syncTitle', { upstream: s.upstream }), onClick: () => onAction('sync'),
    };
  } else if (!s.upstream && s.branch) primary = { label: <><CloudUpload className="size-4" />{t('ide.scm.publishBranch')}</>, title: 'git push -u origin HEAD', onClick: () => onAction('push') };
  else primary = { label: <><Check className="size-4" />{t('ide.scm.commit')}</>, title: t('ide.scm.noChangesTitle'), onClick: () => commit(), disabled: true };

  const groups: Array<{ key: Group; title: string; list: ScmChange[]; count: number }> = s
    ? [
        { key: 'conflicts', title: t('ide.scm.group.conflicts'), list: s.conflicts, count: s.counts.conflicts },
        { key: 'staged', title: t('ide.scm.group.staged'), list: s.staged, count: s.counts.staged },
        { key: 'changes', title: t('ide.scm.group.changes'), list: s.changes, count: s.counts.changes },
      ].filter((g) => g.count > 0 || g.key === 'changes') as any
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex h-[35px] shrink-0 items-center pl-5 pr-2 text-[11px] tracking-wide" style={{ color: MUTED }}>
        <span className="flex-1 truncate">{t('ide.scm.header')}</span>
        <button title={t('ide.scm.commit')} onClick={() => commit()} className="ide-icon-btn"><Check className="size-4" /></button>
        <button title={t('ide.scm.refresh')} onClick={props.onRefresh} className="ide-icon-btn"><RefreshCw className="size-3.5" /></button>
        <button title={t('ide.scm.moreActions')} onClick={moreMenu} className="ide-icon-btn"><Ellipsis className="size-4" /></button>
        {busy && <div className="ide-progress absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"><div style={{ background: ACCENT }} /></div>}
      </div>

      {error && !s && <div className="px-5 py-2 text-[12px]" style={{ color: MUTED }}>{error}</div>}

      {s && (
        <div className="ide-scroll min-h-0 flex-1 overflow-auto pb-2">
          <div className="space-y-1.5 px-3 pb-2 pt-0.5">
            <textarea
              ref={input}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } }}
              placeholder={t('ide.scm.messagePlaceholder', { branch: s.branch ?? t('ide.scm.detachedHead') })}
              rows={Math.min(8, Math.max(1, message.split('\n').length))}
              className="block w-full resize-none rounded-[2px] px-2 py-1 text-[13px] outline-none placeholder:text-[#8b8b8b] focus:outline-1 focus:outline-[#0078d4]"
              style={{ background: '#313131', color: '#cccccc', border: '1px solid #3c3c3c' }}
            />
            <div className="flex h-[26px] text-[13px] text-white">
              <button
                title={primary.title}
                disabled={primary.disabled || busy}
                onClick={primary.onClick}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l-[2px] hover:brightness-110 disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                <span className="flex items-center gap-1.5 truncate">{primary.label}</span>
              </button>
              <button title={t('ide.scm.commitMoreActions')} disabled={busy} onClick={commitMenu} className="grid w-[26px] place-items-center rounded-r-[2px] hover:brightness-110 disabled:opacity-50" style={{ background: ACCENT, borderLeft: '1px solid rgb(255 255 255 / 0.4)' }}>
                <ChevronDown className="size-4" />
              </button>
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.key}>
              <div onClick={() => toggle(g.key)} className="ide-row group flex h-[22px] cursor-pointer select-none items-center gap-0.5 pl-1 pr-2 text-[13px]">
                {open[g.key] ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                <span className="flex-1 truncate">{g.title}</span>
                <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
                  {g.key === 'staged' && <button title={t('ide.scm.unstageAll')} onClick={() => onAction('unstageAll')} className="ide-icon-btn"><Minus className="size-4" /></button>}
                  {g.key === 'changes' && g.count > 0 && <>
                    <button title={t('ide.scm.discardAll')} onClick={() => discard(s.changes.map((c) => c.path), true)} className="ide-icon-btn"><Undo2 className="size-3.5" /></button>
                    <button title={t('ide.scm.stageAll')} onClick={() => onAction('stageAll')} className="ide-icon-btn"><Plus className="size-4" /></button>
                  </>}
                </span>
                <span className="ml-1 rounded-full px-1.5 text-[11px] leading-[18px]" style={{ background: '#616161', color: '#fff' }}>{fmtCount(g.count)}</span>
              </div>
              {open[g.key] && g.list.map((c) => (
                <ChangeRow
                  key={c.path}
                  c={c}
                  group={g.key}
                  onClick={() => (g.key === 'conflicts' ? props.onOpenFile(c.path) : props.onOpenChange(c, g.key === 'staged', true))}
                  onDoubleClick={() => g.key !== 'conflicts' && props.onOpenChange(c, g.key === 'staged', false)}
                  onContextMenu={(e) => rowMenu(e, c, g.key)}
                  onOpen={() => props.onOpenFile(c.path)}
                  onStage={() => onAction(g.key === 'staged' ? 'unstage' : 'stage', { paths: [c.path] })}
                  onDiscard={() => discard([c.path])}
                />
              ))}
              {open[g.key] && g.count > g.list.length && (
                <div className="h-[22px] pl-9 text-[12px] leading-[22px]" style={{ color: MUTED }}>{t('ide.scm.moreFiles', { count: g.count - g.list.length })}</div>
              )}
              {open[g.key] && g.key === 'changes' && total === 0 && (
                <div className="pl-9 text-[12px] leading-[22px]" style={{ color: MUTED }}>{t('ide.scm.noChanges')}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {s && log && (
        <div className="flex shrink-0 flex-col" style={{ borderTop: '1px solid #2b2b2b', maxHeight: open.graph ? '45%' : undefined, minHeight: open.graph ? 120 : undefined }}>
          <div onClick={() => toggle('graph')} className="ide-row flex h-[22px] shrink-0 cursor-pointer select-none items-center gap-0.5 pl-1 text-[11px] font-bold">
            {open.graph ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {t('ide.scm.graph')}
          </div>
          {open.graph && <Graph log={log} status={s} />}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function ChangeRow({ c, group, onClick, onDoubleClick, onContextMenu, onOpen, onStage, onDiscard }: {
  c: ScmChange; group: Group;
  onClick: () => void; onDoubleClick: () => void; onContextMenu: (e: React.MouseEvent) => void;
  onOpen: () => void; onStage: () => void; onDiscard: () => void;
}) {
  const t = useT();
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  const color = SCM_COLOR[c.code];
  return (
    <div
      title={`${c.path}${c.orig ? ` ← ${c.orig}` : ''} • ${t(SCM_TITLE[c.code])}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className="ide-row group flex h-[22px] cursor-pointer select-none items-center gap-1.5 pl-[22px] pr-2 text-[13px]"
    >
      <FileIcon name={base(c.path)} />
      <span className="shrink-0 truncate" style={{ color, textDecoration: c.code === 'D' ? 'line-through' : undefined }}>{base(c.path)}</span>
      <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: MUTED }}>{dirOf(c.path)}</span>
      <span className="hidden shrink-0 items-center group-hover:flex">
        {c.code !== 'D' && <button title={t('ide.scm.openFile')} onClick={stop(onOpen)} className="ide-icon-btn"><FileText className="size-3.5" /></button>}
        {group === 'changes' && <button title={t('ide.scm.discardChanges')} onClick={stop(onDiscard)} className="ide-icon-btn"><Undo2 className="size-3.5" /></button>}
        {group === 'staged'
          ? <button title={t('ide.scm.unstage')} onClick={stop(onStage)} className="ide-icon-btn"><Minus className="size-4" /></button>
          : <button title={t('ide.scm.stage')} onClick={stop(onStage)} className="ide-icon-btn"><Plus className="size-4" /></button>}
      </span>
      <span className="w-3 shrink-0 text-center text-[12px]" style={{ color }}>{c.code}</span>
    </div>
  );
}

// ─── Graphe ──────────────────────────────────────────────────────────────────

const LANE = ['#b180d7', '#3794ff', '#e2c08d', '#4ec9b0', '#f14c4c', '#d18616', '#73c991'];
const ROW = 22;
const GAP = 11;
const x = (c: number) => 9 + c * GAP;
const nodeColor = (c: ScmCommit, row: ScmGraphRow) => (c.flow === 'out' ? '#3794ff' : c.flow === 'in' ? '#d18616' : LANE[row.col % LANE.length]);

function Graph({ log, status }: { log: ScmLog; status: ScmStatus }) {
  const t = useT();
  const width = Math.max(1, ...log.graph.map((r) => Math.max(r.col, ...r.top.flat(), ...r.bottom.flat()) + 1));
  const w = x(width - 1) + 9;
  return (
    <div className="ide-scroll min-h-0 flex-1 overflow-auto pb-2 text-[13px]">
      {status.upstream && (status.ahead > 0 || status.behind > 0) && (
        <div className="flex h-[22px] items-center gap-3 pl-6 text-[12px]" style={{ color: MUTED }}>
          {status.ahead > 0 && <span className="flex items-center gap-1" style={{ color: '#3794ff' }}><ArrowUp className="size-3.5" />{t('ide.scm.outgoing', { count: status.ahead })}</span>}
          {status.behind > 0 && <span className="flex items-center gap-1" style={{ color: '#d18616' }}><ArrowDown className="size-3.5" />{t('ide.scm.incoming', { count: status.behind })}</span>}
          <span className="truncate">{status.upstream}</span>
        </div>
      )}
      {log.commits.map((c, i) => {
        const row = log.graph[i];
        const color = nodeColor(c, row);
        const seg = (k: string, [a, b]: [number, number], y1: number, y2: number, touches: boolean) => (
          <path key={k} d={a === b ? `M${x(a)} ${y1}V${y2}` : `M${x(a)} ${y1}C${x(a)} ${(y1 + y2) / 2} ${x(b)} ${(y1 + y2) / 2} ${x(b)} ${y2}`}
            stroke={touches ? color : LANE[(y1 === 0 ? b : a) % LANE.length]} strokeWidth={1.5} fill="none" />
        );
        const head = c.refs.some((r) => r.startsWith('HEAD'));
        return (
          <div
            key={c.hash}
            title={`${c.subject}\n${c.author} · ${fmtDateTime(c.date * 1000)}\n${c.hash.slice(0, 8)}${c.flow === 'out' ? ` · ${t('ide.scm.notPushed')}` : c.flow === 'in' ? ` · ${t('ide.scm.toPull')}` : ''}`}
            className="ide-row flex items-center gap-1.5 pl-2 pr-2"
            style={{ height: ROW }}
          >
            <svg width={w} height={ROW} className="shrink-0">
              {row.top.map((s, k) => seg(`t${k}`, s, 0, GAP, s[1] === row.col && s[0] === s[1]))}
              {row.bottom.map((s, k) => seg(`b${k}`, s, GAP, ROW, s[0] === row.col && s[0] === s[1]))}
              {head
                ? <><circle cx={x(row.col)} cy={GAP} r={5} fill="#181818" stroke={color} strokeWidth={2} /><circle cx={x(row.col)} cy={GAP} r={2} fill={color} /></>
                : c.parents.length > 1
                  ? <circle cx={x(row.col)} cy={GAP} r={4} fill="#181818" stroke={color} strokeWidth={2} />
                  : <circle cx={x(row.col)} cy={GAP} r={4} fill={color} />}
            </svg>
            <span className={`min-w-0 flex-1 truncate ${head ? 'font-semibold text-white' : ''}`} style={{ color: c.flow === 'in' ? MUTED : undefined }}>{c.subject}</span>
            {c.refs.map((r) => <RefBadge key={r} r={r} />)}
          </div>
        );
      })}
    </div>
  );
}

function RefBadge({ r }: { r: string }) {
  const tag = r.startsWith('tag: ');
  const head = r.startsWith('HEAD -> ');
  const name = tag ? r.slice(5) : head ? r.slice(8) : r;
  const remote = !tag && !head && r.includes('/');
  const bg = head ? '#3794ff' : remote ? '#b180d7' : tag ? '#4ec9b0' : '#616161';
  return (
    <span className="max-w-[45%] shrink-0 truncate rounded-full px-1.5 text-[11px] leading-[16px] text-white" style={{ background: bg }} title={r}>
      {remote ? '☁ ' : head ? '◎ ' : tag ? '⌂ ' : ''}{name}
    </span>
  );
}
