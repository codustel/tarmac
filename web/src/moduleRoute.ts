/** Vue de module seule, plein cadre (ex. fenêtre Tarmac Desktop) : `#module/<id>`. */
export const moduleRouteId = (hash: string): string | null => hash.match(/^#module\/([a-z0-9-]+)$/)?.[1] ?? null;

/** Conteneur de la route seule : toute la fenêtre, la page ne défile pas (c'est le module qui gère son défilement). */
export const standaloneModuleClass = 'flex h-screen flex-col overflow-hidden bg-white p-4 dark:bg-neutral-950';
/** Élément de montage du module en route seule : remplit la hauteur restante. */
export const moduleFillClass = 'h-full min-h-0 flex-1';
