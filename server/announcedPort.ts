const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1?\]|0\.0\.0\.0):(\d{2,5})/;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Port annoncé par l'app dans ses logs, pour un lancement donné.
 * Seule la PREMIÈRE URL localhost compte : les suivantes sont souvent des services tiers
 * que l'app utilise (ex. dl-img-avito sur 8001) et non l'adresse de l'app elle-même.
 * Créer une nouvelle instance à chaque démarrage.
 */
export class AnnouncedPort {
  private settled = false;

  /** Port de la ligne si c'est la première URL annoncée de ce lancement, sinon null. */
  take(text: string): number | null {
    if (this.settled) return null;
    const m = text.replace(ANSI_RE, '').match(URL_RE);
    if (!m) return null;
    this.settled = true;
    return Number(m[1]);
  }
}
