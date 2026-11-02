/**
 * Jeton partagé entre l'API de Tarmac et le serveur MCP `tarmac` :
 * `SUIVI_TOKEN` dans `~/.tarmac/env` (droits 600), créé au premier besoin.
 * Le MCP n'est pas lancé par le LaunchAgent : il relit le fichier lui-même.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDirOf } from '../dataDir.js';

export { dataDirOf };
const envFile = (dataDir: string) => path.join(dataDir, 'env');

/** Valeurs `CLÉ=valeur` du fichier `env` (sans interprétation shell). */
export function readEnvFile(dataDir = dataDirOf()): Record<string, string> {
  try {
    return Object.fromEntries(
      fs.readFileSync(envFile(dataDir), 'utf8').split('\n')
        .map((l) => l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => [m[1], m[2].trim().replace(/^(['"])(.*)\1$/, '$2')]),
    );
  } catch {
    return {};
  }
}

/**
 * `claude` : Claude Code (tous les outils). `artifact` : pages d'artefact via Claude desktop
 * (`suivi_pull`, `suivi_push` en canal A, limité à la coche et à la note des tâches existantes).
 */
export type TokenKind = 'claude' | 'artifact';
const KEYS: Record<TokenKind, string> = { claude: 'SUIVI_TOKEN', artifact: 'SUIVI_ARTIFACT_TOKEN' };
const cached: Partial<Record<TokenKind, string>> = {};

export function suiviToken(kind: TokenKind = 'claude', dataDir = dataDirOf()): string {
  if (cached[kind]) return cached[kind]!;
  const key = KEYS[kind];
  const existing = process.env[key] || readEnvFile(dataDir)[key];
  if (existing) return (cached[kind] = existing);
  const token = crypto.randomBytes(24).toString('base64url');
  const f = envFile(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const prev = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  fs.writeFileSync(f, `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}# tarmac MCP server token (Claude Todolist, ${kind})\n${key}=${token}\n`, { mode: 0o600 });
  fs.chmodSync(f, 0o600);
  return (cached[kind] = token);
}
