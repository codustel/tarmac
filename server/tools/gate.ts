// Garde du premier appel côté serveur : ouvrir Claude ou Codex exige l'outil installé et connecté.
// Erreur 424 portant { tool, state, installMethod, docUrl } pour que l'interface propose l'installation ou la connexion.
// N'importe ni config, ni settings, ni i18n (R2) : le texte traduit est injecté.
import { TOOLS, type ManagedId, type Method, type ToolId } from './registry.js';
import { toolStatus, type StatusDeps } from './status.js';

export interface GateDeps extends StatusDeps {
  /** Texte serveur traduit (server/i18n.ts `msg`). */
  msg: (key: 'api.toolAbsent' | 'api.toolLoggedOut', params: { tool: string }) => string;
}

export class ToolMissingError extends Error {
  readonly statusCode = 424;
  constructor(
    message: string,
    readonly tool: ToolId,
    readonly state: 'absent' | 'logged-out',
    readonly installMethod: Method | null,
  ) {
    super(message);
  }
  /** Corps de la réponse HTTP ; `docUrl` = page officielle, proposée quand aucun moyen d'installation n'existe. */
  body() {
    return { error: this.message, tool: this.tool, state: this.state, installMethod: this.installMethod, docUrl: TOOLS[this.tool].docUrl };
  }
}

/** Laisse passer si l'outil est prêt ou d'état inconnu ; sinon lève `ToolMissingError`. */
export async function requireTool(id: ManagedId, deps: GateDeps): Promise<void> {
  const s = await toolStatus(id, deps);
  if (s.state !== 'absent' && s.state !== 'logged-out') return;
  const key = s.state === 'absent' ? 'api.toolAbsent' : 'api.toolLoggedOut';
  throw new ToolMissingError(deps.msg(key, { tool: TOOLS[id].label }), id, s.state, s.installMethod);
}
