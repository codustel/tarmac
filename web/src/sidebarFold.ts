/**
 * Sidebar sur petit écran (fenêtre basse) : la navigation défile, le pied reste visible, et ses groupes
 * (utilisation Claude, Codex, dossiers scannés) se replient sur une ligne cliquable. Grand écran : rien ne change.
 */

/** Petit écran : hauteur de fenêtre à partir de laquelle la sidebar passe en mode compact. */
export const SIDEBAR_COMPACT_QUERY = '(max-height: 900px)';

/** Clé localStorage du choix replié (`1`) / déplié (`0`) d'un groupe. */
export const foldKey = (id: string) => `sidebar:fold:${id}`;

/** Grand écran : jamais replié. Petit écran : replié par défaut, sauf si l'utilisateur l'a déplié. */
export const isFolded = (stored: string | null, compact: boolean) => compact && stored !== '0';

/** Plus forte utilisation (en %, arrondie vers le bas) affichée sur la ligne repliée, ou null sans jauge. */
export const peakUsage = (limits: readonly { utilization: number }[]) =>
  limits.length ? Math.floor(Math.max(...limits.map((l) => l.utilization))) : null;
