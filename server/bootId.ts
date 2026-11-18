import crypto from 'node:crypto';
import type { TerminalKind } from './terminals.js';

/** Identifiant tiré à chaque démarrage de Tarmac : relie un process à la console qui l'a lancé. */
export const BOOT_ID: string = crypto.randomBytes(4).toString('hex');

/** Variables d'environnement qui marquent une console : retrouvent la session d'un process, même orphelin. */
export function sessionMarkerEnv(bootId: string, terminalId: string, kind: TerminalKind | undefined): Record<string, string> {
  const env: Record<string, string> = { TARMAC_SESSION_ID: `${bootId}:${terminalId}` };
  if (kind === 'claude' || kind === 'codex') env.TARMAC_AGENT = kind;
  return env;
}
