import { useCallback, useEffect, useMemo, useState } from 'react';
import { Code2, Pin, X } from 'lucide-react';
import { api, type Project } from '../api';
import { copy, cx, useToast } from '../ui';
import { useT } from '../i18n';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Workspace } from './Workspace';
import { applyMonacoTheme } from './theme';
import { useDarkMode } from './tokens';

/** Onglets épinglés d'abord, ordre relatif conservé. */
const normalize = (tabs: string[], pinned: string[]) => [...tabs.filter((t) => pinned.includes(t)), ...tabs.filter((t) => !pinned.includes(t))];

/** Menu IDE : un onglet par projet ouvert, chacun avec son espace de travail (gardé en mémoire). */
export default function IdeView({ projects, tabs, pinned, active, onActive, onClose, onTabs, onPinned }: {
  projects: Project[];
  tabs: string[];
  pinned: string[];
  active: string | null;
  onActive: (id: string) => void;
  onClose: (ids: string[]) => void;
  onTabs: (tabs: string[]) => void;
  onPinned: (pinned: string[]) => void;
}) {
  const toast = useToast();
  const t = useT();
  // Thème Monaco (global à tous les éditeurs) redéfini à chaque bascule clair / sombre, jetons relus.
  const dark = useDarkMode();
  useEffect(() => { applyMonacoTheme(dark); }, [dark]);
  const [dirty, setDirty] = useState<Record<string, number>>({});
  const setDirtyFor = useCallback((id: string, n: number) => setDirty((d) => (d[id] === n ? d : { ...d, [id]: n })), []);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const order = normalize(tabs, pinned).filter((id) => byId.has(id));
  const current = active && order.includes(active) ? active : order[0] ?? null;

  const close = (ids: string[]) => {
    if (ids.length === 0) return;
    const unsaved = ids.filter((id) => dirty[id]);
    if (unsaved.length && !confirm(t('ide.projects.confirmClose', { projects: unsaved.map((id) => byId.get(id)?.name ?? id).join(', ') }))) return;
    for (const id of ids) localStorage.removeItem(`ide:ws:${id}`);
    onClose(ids);
  };

  const setPin = (id: string, on: boolean) => {
    const next = on ? [...pinned.filter((x) => x !== id), id] : pinned.filter((x) => x !== id);
    onPinned(next);
    onTabs(normalize(tabs, next));
  };

  // ─── Menu contextuel ───
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuItems = (id: string): MenuItem[] => {
    const p = byId.get(id)!;
    const i = order.indexOf(id);
    const isPinned = pinned.includes(id);
    const open = (w: 'finder' | 'editor') => api.open(p.dir, w).catch((e) => toast('err', e.message));
    return [
      { label: t(isPinned ? 'ide.tabs.unpin' : 'ide.tabs.pin'), onClick: () => setPin(id, !isPinned) },
      'separator',
      { label: t('ide.tabs.close'), hint: t('ide.tabs.middleClick'), onClick: () => close([id]) },
      { label: t('ide.tabs.closeOthers'), disabled: order.length < 2, onClick: () => close(order.filter((x) => x !== id)) },
      { label: t('ide.tabs.closeRight'), disabled: i === order.length - 1, onClick: () => close(order.slice(i + 1)) },
      { label: t('ide.tabs.closeUnpinned'), disabled: order.every((x) => pinned.includes(x)), onClick: () => close(order.filter((x) => !pinned.includes(x))) },
      { label: t('ide.tabs.closeAll'), onClick: () => close(order) },
      'separator',
      { label: t('ide.tabs.copyPath'), onClick: () => copy(p.dir, toast, t('ide.tabs.pathCopied')) },
      { label: t('ide.tabs.revealInFinder'), onClick: () => open('finder') },
      { label: t('ide.projects.openVsCode'), onClick: () => open('editor') },
    ];
  };

  // ─── Glisser-déposer : déposer parmi les épinglés épingle l'onglet, et inversement ───
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string | null; after: boolean } | null>(null);
  const onDrop = () => {
    if (!dragId || !drop || drop.id === dragId) return reset();
    const rest = order.filter((x) => x !== dragId);
    const at = drop.id === null ? rest.length : rest.indexOf(drop.id) + (drop.after ? 1 : 0);
    rest.splice(at, 0, dragId);
    const target = drop.id === null ? null : drop.id;
    const pin = target !== null && pinned.includes(target);
    const nextPinned = pin ? [...pinned.filter((x) => x !== dragId), dragId] : pinned.filter((x) => x !== dragId);
    // Ordre des épinglés = ordre d'affichage.
    const sortedPinned = rest.filter((x) => nextPinned.includes(x));
    onPinned(sortedPinned);
    onTabs(normalize(rest, sortedPinned));
    reset();
  };
  const reset = () => { setDragId(null); setDrop(null); };

  if (order.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-bg text-[13px] text-muted">
        <div className="max-w-sm space-y-2 text-center">
          <Code2 className="mx-auto size-10 opacity-50" />
          <div>{t('ide.projects.emptyTitle')}</div>
          <div className="text-[12px]">{t.node('ide.projects.emptyHint', { icon: <Code2 className="inline size-3.5 -mt-0.5" /> })}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="ide-scroll flex h-[39px] shrink-0 items-end gap-1 overflow-x-auto px-2 pt-1 shadow-[inset_0_-1px_0_var(--line)]">
        {order.map((id) => {
          const p = byId.get(id)!;
          const on = id === current;
          const isPinned = pinned.includes(id);
          const marker = drop?.id === id && dragId !== id ? (drop.after ? 'right' : 'left') : null;
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.name); }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientX > r.left + r.width / 2;
                if (drop?.id !== id || drop.after !== after) setDrop({ id, after });
              }}
              onDrop={(e) => { e.preventDefault(); onDrop(); }}
              onDragEnd={reset}
              onClick={() => onActive(id)}
              onAuxClick={(e) => e.button === 1 && close([id])}
              onContextMenu={(e) => { e.preventDefault(); onActive(id); setMenu({ id, x: e.clientX, y: e.clientY }); }}
              title={p.dir}
              className={cx(
                'group relative flex h-8 shrink-0 cursor-pointer select-none items-center gap-2 rounded-t-md border border-b-0 pl-3 pr-1.5 text-[13px] transition-colors',
                on ? 'border-line bg-bg font-medium text-fg' : 'border-transparent text-muted hover:bg-panel-2 hover:text-fg',
              )}
              style={{ opacity: dragId === id ? 0.5 : 1, marginBottom: on ? -1 : 0, height: on ? 33 : undefined }}
            >
              {marker && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ [marker]: -1 }} />}
              <Code2 className={cx('size-3.5', on && 'text-accent')} />
              <span>{p.name}</span>
              {dirty[id] ? <span className="text-[11px]" style={{ color: 'var(--ide-git-m)' }}>●</span> : null}
              {isPinned ? (
                <button title={t('ide.tabs.unpin')} onClick={(e) => { e.stopPropagation(); setPin(id, false); }} className="grid size-5 place-items-center rounded text-muted hover:bg-panel-2 hover:text-fg">
                  <Pin className="size-3.5 rotate-45" />
                </button>
              ) : (
                <button title={t('ide.projects.close')} onClick={(e) => { e.stopPropagation(); close([id]); }} className="grid size-5 place-items-center rounded text-muted hover:bg-panel-2 hover:text-fg">
                  <X className={on ? 'size-3.5' : 'size-3.5 opacity-0 group-hover:opacity-100'} />
                </button>
              )}
            </div>
          );
        })}
        {/* Zone vide : déposer ici place l'onglet en dernier (non épinglé). */}
        <div
          className="min-w-8 flex-1"
          onDragOver={(e) => { if (dragId) { e.preventDefault(); if (drop?.id !== null) setDrop({ id: null, after: true }); } }}
          onDrop={(e) => { e.preventDefault(); onDrop(); }}
          style={{ boxShadow: drop?.id === null ? 'inset 2px 0 0 var(--accent)' : undefined }}
        />
      </div>
      <div className="min-h-0 flex-1">
        {/* Ordre stable : réordonner les onglets ne déplace pas les éditeurs dans le DOM. */}
        {[...order].sort().map((id) => (
          <Workspace key={id} project={byId.get(id)!} visible={id === current} onDirty={(n) => setDirtyFor(id, n)} />
        ))}
      </div>
      {menu && byId.has(menu.id) && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={closeMenu} />}
    </div>
  );
}
