import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; onClick: () => void; disabled?: boolean; hint?: string } | 'separator';

/** Menu contextuel aux couleurs de Tarmac, positionné au pointeur et gardé dans la fenêtre. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[230px] rounded-lg border border-line bg-panel py-1 text-[13px] text-fg shadow-xl"
      style={{ left: pos.left, top: pos.top }}
    >
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={i} className="mx-2 my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => { onClose(); it.onClick(); }}
            className="mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-6 rounded-md px-2.5 text-left transition-colors enabled:hover:bg-accent/10 disabled:opacity-40"
          >
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-[12px] text-faint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
