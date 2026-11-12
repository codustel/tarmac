import os from 'node:os';
import type { ModuleConsoleSpec, ModuleTerminalSession } from './api.js';

const SYSTEM_ID = '__system__';

export interface LaunchConsoleDeps {
  isDemo: () => boolean;
  /** `terminals.create` du cœur. */
  create: (
    target: { id: string; dir: string; env: Record<string, string>; pathPrepend: string[] },
    spec: { command: string; label: string; unsetEnv?: string[]; cols?: number; rows?: number },
  ) => Promise<ModuleTerminalSession>;
  demoMessage: () => string;
}

/**
 * `ctx.core.launchConsole` : même chemin que `deps.launch` des outils (console système `__system__`, dossier HOME),
 * avec `env` en plus. Refusé en mode démo. N'ouvre aucun droit nouveau : un module tourne déjà dans le processus.
 */
export function makeLaunchConsole(deps: LaunchConsoleDeps): (spec: ModuleConsoleSpec) => Promise<ModuleTerminalSession> {
  return async (spec) => {
    if (deps.isDemo()) throw new Error(deps.demoMessage());
    if (!spec || typeof spec.command !== 'string' || !spec.command.trim()) throw new Error('launchConsole: command is required');
    if (typeof spec.label !== 'string' || !spec.label.trim()) throw new Error('launchConsole: label is required');
    return deps.create(
      { id: SYSTEM_ID, dir: os.homedir(), env: { ...(spec.env ?? {}) }, pathPrepend: [] },
      { command: spec.command, label: spec.label, unsetEnv: spec.unsetEnv, cols: spec.cols, rows: spec.rows },
    );
  };
}
