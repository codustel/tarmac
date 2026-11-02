/** Ouverture d'un projet dans l'IDE depuis n'importe quelle vue (bouton </>). */
const EVENT = 'ide:open';

export function openInIde(projectId: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: projectId }));
}

export function onIdeOpen(cb: (projectId: string) => void) {
  const h = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
