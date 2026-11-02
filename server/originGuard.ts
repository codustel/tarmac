// Garde d'origine : Tarmac lance des commandes et des shells, donc seule une page servie par Tarmac lui-même
// (même schéma, même hôte, même port) peut appeler l'API ou ouvrir un WebSocket. Un nom d'hôte local ne suffit
// pas : une autre app en dev sur localhost:5173 ou foo.localhost est une origine différente.

/** Hôte normalisé (minuscules, sans port par défaut) pour comparer `Host` et l'hôte d'une origine. */
function normalizeHost(host: string, protocol: string): string {
  const h = host.toLowerCase();
  const def = protocol === 'https:' ? ':443' : ':80';
  return h.endsWith(def) ? h.slice(0, -def.length) : h;
}

/**
 * Vrai si l'en-tête `Origin` est absent (client hors navigateur : CLI, MCP, hooks) ou désigne exactement
 * l'adresse demandée (`protocol` + `Host`), ou l'une des origines `extra` (ex. URL publique configurée).
 */
export function originAllowed(origin: string | undefined, host: string, extra: string[] = [], protocol = 'http:'): boolean {
  if (origin === undefined) return true;
  let o: URL;
  try { o = new URL(origin); } catch { return false; } // « null » (iframe isolée, file://) ou invalide
  if (extra.includes(o.origin)) return true;
  return o.protocol === protocol && normalizeHost(o.host, protocol) === normalizeHost(host, protocol);
}

/**
 * Vrai si `Sec-Fetch-Site` montre une requête venue d'un autre site ou d'une autre origine du même site
 * (localhost:5173 et localhost:7777 sont « same-site »). Couvre les requêtes sans `Origin` (GET `no-cors`).
 */
export function crossOriginFetch(secFetchSite: string | undefined): boolean {
  return secFetchSite === 'cross-site' || secFetchSite === 'same-site';
}
