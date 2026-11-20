import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SIDEBAR_COMPACT_QUERY, foldKey, isFolded } from '../sidebarFold';

/** Petit écran (fenêtre basse) : la sidebar passe en mode compact (voir sidebarFold.ts). */
export function useCompactSidebar() {
  const [compact, setCompact] = useState(() => matchMedia(SIDEBAR_COMPACT_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(SIDEBAR_COMPACT_QUERY);
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

/** Groupe repliable du pied de la sidebar : replié par défaut sur petit écran, choix mémorisé (localStorage). */
export function useFold(id: string, compact: boolean): [folded: boolean, toggle: () => void] {
  const [stored, setStored] = useState<string | null>(() => {
    try { return localStorage.getItem(foldKey(id)); } catch { return null; }
  });
  const folded = isFolded(stored, compact);
  const toggle = () => {
    const v = folded ? '0' : '1';
    setStored(v);
    try { localStorage.setItem(foldKey(id), v); } catch { /* stockage indisponible */ }
  };
  return [folded, toggle];
}

export const FoldChevron = ({ folded }: { folded: boolean }) =>
  folded ? <ChevronRight className="size-3 shrink-0 text-faint" aria-hidden="true" /> : <ChevronDown className="size-3 shrink-0 text-faint" aria-hidden="true" />;
