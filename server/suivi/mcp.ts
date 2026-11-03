#!/usr/bin/env node
/**
 * Serveur MCP `tarmac` (stdio) : relaie vers l'API locale de Tarmac avec le jeton
 * `SUIVI_TOKEN` de `~/.tarmac/env`. Déclaré dans Claude Code (canal B) et dans Claude desktop
 * (canal A : la page de l'artefact n'a droit qu'à `suivi_ping`, `suivi_pull`, `suivi_push`, `suivi_sessions`
 * et `suivi_dispatch`).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readEnvFile, suiviToken } from './token.js';
import { envVar } from '../dataDir.js';

const env = readEnvFile();
// TARMAC_API_URL (ancien nom : APP_MANAGER_URL) ; sinon le port du fichier env (TARMAC_PORT, ancien MANAGER_PORT).
const BASE = process.env.TARMAC_API_URL ?? process.env.APP_MANAGER_URL ?? `http://127.0.0.1:${envVar('PORT') ?? envVar('PORT', env) ?? 7777}`;
/**
 * `--artifact` (déclaration Claude desktop, pour les pages d'artefact) : seulement `ARTIFACT_TOOLS`, avec le
 * jeton artefact (canal A : coche et note des tâches existantes ; « Envoyer à Claude » d'une tâche non traitée).
 */
const ARTIFACT = process.argv.includes('--artifact');
const TOKEN = suiviToken(ARTIFACT ? 'artifact' : 'claude');

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'x-suivi-token': TOKEN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json().catch(() => null)) as any;
  if (!r.ok) throw new Error(data?.error ?? `Tarmac ${r.status} on ${path}`);
  return data as T;
}
const enc = encodeURIComponent;
const reply = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 1) }],
  structuredContent: (Array.isArray(payload) ? { items: payload } : payload) as Record<string, unknown>,
});
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true });
const run = (fn: () => Promise<unknown>) => fn().then(reply, fail);

const PROJECT = z.string().describe('Tracked project id: owner/repo of the git remote (e.g. acme/shop), otherwise the folder name');
const SOURCE = z.object({ kind: z.enum(['session', 'commit', 'quote']), ref: z.string(), at: z.string().optional() });
const TASK_FIELDS = {
  title: z.string().optional(),
  phase: z.number().int().optional().describe('Phase number; a new task goes at the end of the phase'),
  phaseTitle: z.string().optional(),
  parent: z.string().optional().describe('Parent task id: creates a lettered subtask (7.32 → 7.32a) right below it'),
  who: z.enum(['toi', 'ensemble', 'claude']).optional().describe('Who does it: "toi" = the user, "ensemble" = together, "claude" = Claude'),
  minutes: z.number().int().min(0).optional(),
  why: z.string().optional(),
  steps: z.array(z.string()).optional(),
  check: z.string().optional(),
  done: z.boolean().optional(),
  doneAt: z.string().nullable().optional(),
  toTest: z.boolean().optional().describe('Done by Claude, waiting for the user to test it'),
  note: z.string().optional(),
  sources: z.array(SOURCE).optional(),
  archived: z.boolean().optional().describe('Removes the task from the view (never delete)'),
  order: z.number().optional(),
  num: z.string().optional(),
};

const server = new McpServer({ name: 'tarmac', version: '1.0.0' });
/** Outils exposés aux pages d'artefact (`--artifact`). */
const ARTIFACT_TOOLS = new Set(['suivi_ping', 'suivi_pull', 'suivi_push', 'suivi_sessions', 'suivi_dispatch']);
const register: typeof server.registerTool = ((name: string, ...rest: any[]) =>
  ARTIFACT && !ARTIFACT_TOOLS.has(name) ? undefined : (server.registerTool as any)(name, ...rest)) as any;

register('suivi_ping', {
  description: "Checks that the Tarmac MCP server responds: returns the machine name and the Tarmac build.",
  annotations: { readOnlyHint: true },
}, () => run(async () => {
  const meta = await api<{ buildId: string; machine: string }>('GET', '/api/meta');
  return { ok: true, machine: meta.machine, buildId: meta.buildId, at: new Date().toISOString() };
}));

register('suivi_list_projects', {
  description: 'Lists the projects tracked in Tarmac with their counters (total, done, to test, time left, next task) and their artifact URL.',
  annotations: { readOnlyHint: true },
}, () => run(async () => {
  const list = await api<any[]>('GET', '/api/suivi/projects');
  return list.map((p) => ({ projectId: p.projectId, name: p.name, artifactUrl: p.artifactUrl, copyFile: p.copyFile, paths: p.paths, counts: p.counts, syncs: p.syncs }));
}));

register('suivi_get', {
  description: 'Full tracked project: theme, tasks sorted by order (with rev, updatedAt, sources), counters and syncs. `includeDone: false` to list only the remaining tasks.',
  inputSchema: { projectId: PROJECT, includeDone: z.boolean().optional() },
  annotations: { readOnlyHint: true },
}, ({ projectId, includeDone }) => run(async () => {
  const d = await api<any>('GET', `/api/suivi/projects/${enc(projectId)}`);
  return includeDone === false ? { ...d, tasks: d.tasks.filter((t: any) => !t.done) } : d;
}));

register('suivi_pull', {
  description: 'Tasks changed in Tarmac since the `since` cursor (0 = all). Returns the new cursor to pass on the next call. Used by the artifact (channel A) and catch-up sync.',
  inputSchema: { projectId: PROJECT, since: z.number().int().min(0).default(0) },
  annotations: { readOnlyHint: true },
}, ({ projectId, since }) => run(() => api('GET', `/api/suivi/projects/${enc(projectId)}/changes?since=${since}`)));

register('suivi_push', {
  description: 'Sends Tarmac tasks changed in the artifact (full documents with updatedAt and rev). Merged task by task: the most recent wins, the discarded version goes to the log. channel: "A" (live bridge) or "C" (catch-up /suivi sync).',
  inputSchema: { projectId: PROJECT, tasks: z.array(z.record(z.string(), z.unknown())).max(5000), channel: z.enum(['A', 'C']).default('A') },
}, ({ projectId, tasks, channel }) => run(() => api('POST', `/api/suivi/projects/${enc(projectId)}/push`, { tasks, channel })));

register('suivi_sessions', {
  description: 'Lists the agent sessions (Claude Code, and Codex when it is enabled in Tarmac) currently running in Tarmac consoles for this project (terminalId, agent, name, title, state, start, last activity), most recently active first. Only `available` (idle) sessions can receive a task. Sessions started outside Tarmac are not listed: Tarmac cannot reach them. Used to pick the session that receives a task (suivi_dispatch).',
  inputSchema: { projectId: PROJECT },
  annotations: { readOnlyHint: true },
}, ({ projectId }) => run(async () => ({ sessions: await api<unknown[]>('GET', `/api/suivi/projects/${enc(projectId)}/sessions`) })));

register('suivi_dispatch', {
  description: 'Sends an untreated task (not done, not to test, not archived) to a coding agent: types a short instruction ("handle task <num> … read it with suivi_get, do it, then mark it to test") into a running idle session of this project (`target` = its terminalId from suivi_sessions), or opens a new session in the project with it as the first message (`target: "new"`, with `agent` = "claude" or "codex"; default: the first agent enabled in Tarmac). Marks the task as requested (requestedAt, requestedTo). Call it once per user click; never retry automatically.',
  inputSchema: {
    projectId: PROJECT,
    taskId: z.string().describe('Task id (e.g. t-4-12), not its number'),
    target: z.string().describe('terminalId of a running session (from suivi_sessions), or "new" for a new session'),
    agent: z.enum(['claude', 'codex']).optional().describe('Agent of the new session (target "new"); must be enabled in Tarmac → Settings → Agents'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, ({ projectId, taskId, target, agent }) => run(() => api('POST', `/api/suivi/projects/${enc(projectId)}/tasks/${enc(taskId)}/dispatch`, agent ? { target, agent } : { target })));

register('suivi_upsert_task', {
  description: 'Creates or updates a task (channel B). Without `id`: new task (id, number and order computed: end of `phase`, or lettered subtask under `parent`). With `id`: only the given fields change. Never delete: `archived: true` removes the task from the view. Also write the same task to the artifact db (ArtifactData), then call suivi_write_copy. Write task content in the user’s language.',
  inputSchema: { projectId: PROJECT, id: z.string().optional(), ...TASK_FIELDS },
}, ({ projectId, ...task }) => run(() => api('POST', `/api/suivi/projects/${enc(projectId)}/tasks`, task)));

register('suivi_set_done', {
  description: 'Checks or unchecks a task (doneAt set to now or cleared), and/or marks it “to test”. Rule: a task handled by Claude becomes “to test”; it is checked only after the user validates it.',
  inputSchema: { projectId: PROJECT, id: z.string(), done: z.boolean().optional(), toTest: z.boolean().optional(), note: z.string().optional() },
}, ({ projectId, id, done, toTest, note }) => run(() => api('POST', `/api/suivi/projects/${enc(projectId)}/tasks`, {
  id,
  ...(done !== undefined ? { done, doneAt: done ? new Date().toISOString() : null } : {}),
  ...(toTest !== undefined ? { toTest } : {}),
  ...(note !== undefined ? { note } : {}),
})));

register('suivi_register_project', {
  description: 'Registers (or completes) a tracked project in Tarmac: name, brand, title, subtitle, artifact URL, theme, local folders, copy file name. Used by /suivi init.',
  inputSchema: {
    projectId: PROJECT,
    name: z.string(),
    brand: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    artifactUrl: z.string().optional(),
    paths: z.array(z.string()).optional().describe('Absolute local folders of the project (main clone, worktrees)'),
    copyFile: z.string().optional().describe('Copy file name in Todolist/ (default suivi.json)'),
    theme: z.record(z.string(), z.unknown()).optional().describe('Theme { brand, primary, fonts, dark, light }; colors as #RRGGBB'),
  },
}, (input) => run(() => api('POST', '/api/suivi/projects', input)));

register('suivi_sync_prepare', {
  description: 'Catch-up sync with the artifact (/suivi sync), step 1: returns the folder to export the artifact db to (ArtifactData list, out_dir = <dir>/dump).',
  inputSchema: { projectId: PROJECT },
}, ({ projectId }) => run(() => api('POST', `/api/suivi/projects/${enc(projectId)}/sync/prepare`)));

register('suivi_sync_merge', {
  description: 'Catch-up sync, step 2: Tarmac merges the artifact db export (the most recent wins, the other goes to the log) and returns `batches`, the ArtifactData write batches to apply to the artifact (add if_version to the "update" writes).',
  inputSchema: { projectId: PROJECT },
}, ({ projectId }) => run(() => api('POST', `/api/suivi/projects/${enc(projectId)}/sync/merge`)));

register('suivi_write_copy', {
  description: 'Regenerates the project’s versioned copy Todolist/<file>.json from Tarmac (call after every change).',
  inputSchema: { projectId: PROJECT },
}, ({ projectId }) => run(() => api('POST', `/api/suivi/projects/${enc(projectId)}/write-copy`)));

await server.connect(new StdioServerTransport());
