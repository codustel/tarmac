import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; onClick: () => void; disabled?: boolean; hint?: string } | 'separator';

/** Menu contextuel au style de VS Code, positionné au pointeur et gardé dans la fenêtre. */
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
      className="fixed z-50 min-w-[230px] rounded-md border py-1 text-[13px] shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
      style={{ left: pos.left, top: pos.top, background: '#1f1f1f', borderColor: '#454545', color: '#cccccc' }}
    >
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={i} className="mx-2 my-1 h-px" style={{ background: '#454545' }} />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => { onClose(); it.onClick(); }}
            className="mx-1 flex h-[26px] w-[calc(100%-8px)] items-center gap-6 rounded px-3 text-left enabled:hover:bg-[#0078d4] enabled:hover:text-white disabled:opacity-40"
          >
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-[12px] opacity-70">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
