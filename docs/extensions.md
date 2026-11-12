# Extensions (modules)

A module adds features to Tarmac without patching it: API routes, an entry in the sidebar with its own view,
its own settings and its own SQLite database. Tarmac's built-in features do not use this API; it exists for
extensions you install yourself.

A working example lives in [`examples/hello-module`](../examples/hello-module): one route, one table, one
setting and a view, in plain JavaScript with no build step.

## Loading

Tarmac loads only the folders listed in `TARMAC_MODULES`, separated by `:` (`;` on Windows). There is no
automatic discovery. Set it in `~/.tarmac/env`, then `tarmac restart`:

```bash
TARMAC_MODULES=/path/to/hello-module:/path/to/other-module
```

Modules are loaded once, when the service starts. **Settings → Modules** lists each folder with its version and
state: *loaded*, *ignored* (written for another API version) or *error* (with the reason). A module that fails
never stops Tarmac from starting.

> A module runs inside the Tarmac server with the same rights: it can read your files and run commands, like a
> code editor extension. Only list modules you trust.

## Manifest

The `tarmac` field of the module's `package.json`. Paths are relative to the module folder and must stay inside it.

```json
{
  "name": "tarmac-hello-module",
  "version": "1.0.0",
  "type": "module",
  "tarmac": {
    "apiVersion": 1,
    "id": "hello",
    "name": { "en": "Hello", "fr": "Bonjour" },
    "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\">…</svg>",
    "server": "server.js",
    "web": "web/index.js"
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `apiVersion` | yes | `1`. Any other value: the module is ignored. |
| `id` | yes | `^[a-z][a-z0-9-]{1,39}$`, unique among loaded modules. Used in URLs and the data folder. |
| `name` | yes | Shown in the sidebar and settings: a string, or `{ "en", "fr" }`. |
| `icon` | no | SVG markup, used as a mask: it is drawn in the sidebar's text color. |
| `server` | no | ES module that exports `register(ctx)`. |
| `web` | no | ES module that exports `mount(el, ctx)`. Its folder is served under `/modules/<id>/`. |

The module's `version` comes from `package.json`.

## Server side

```js
/** @param {import('@codustel/tarmac/modules').ModuleContext} ctx */
export function register(ctx) {
  const db = ctx.openDb(['CREATE TABLE visits (at TEXT NOT NULL)']);
  ctx.app.get('/summary', async () => ({ projects: ctx.core.projects().length }));
}
```

`register` may be async. `ctx` gives:

| Member | |
|---|---|
| `id` | The module id. |
| `app` | A Fastify instance scoped to `/api/modules/<id>`: `ctx.app.get('/summary', …)` answers `GET /api/modules/hello/summary`. Tarmac's protections apply (local host and origin only, request language). |
| `dataDir` | `~/.tarmac/modules/<id>/`, created for you. |
| `openDb(migrations)` | Opens `<dataDir>/data.db` (`node:sqlite`). Each array item is one migration, applied once, in order, in a transaction; add new ones at the end, never edit old ones. |
| `settings` | `get()` and `set(patch)` (shallow merge), stored in `<dataDir>/settings.json`. |
| `log` | Fastify logger. |
| `core.version` | Tarmac version. |
| `core.projects()` | Detected projects, read only: `{ id, name, dir, repoDir }`. |
| `core.lang()` | Interface language, `'en'` or `'fr'` (for texts the server writes, such as notifications). |
| `core.on(event, cb)` | Read-only subscription to a Tarmac event (see below). Returns an unsubscribe function. |
| `core.launchConsole(spec)` | Runs `spec.command` in Tarmac's system console (the one of the Tools screen, working directory = HOME) and returns the session `{ id, label, status, exitCode }`. `spec`: `{ command, label, env?, unsetEnv?, cols?, rows? }`; `env` adds variables, `unsetEnv` removes some. Refused in demo mode. Opens no new right: a module already runs in the server process. |
| `core.suivi.projects()` | Todolist projects, read only: `{ suiviProjectId, name, appProjectId }` (`appProjectId`: the scanned project where a session opens, or `null`). |
| `core.suivi.tasks(suiviProjectId)` | Tasks of a Todolist project, archived ones included, sorted by `order`: `{ id, num, title, order, status, auto, archived }`. `auto` is the task's "auto" mark, set by the user in the Todolist. |
| `core.dispatch(suiviProjectId, taskId, { agent? })` | Sends an untreated task to a **new** agent session in a Tarmac console, like the ▶ button (`agent`: `'claude'` by default, or `'codex'`). The instruction always ends with a fixed autopilot suffix: no `git push`, and stop and say so when blocked instead of marking the task to test. Same guards as ▶ (task untreated, agent enabled). Resolves to `{ terminalId, sessionId }` (`sessionId` may be `null` until the console reveals it); rejects with a readable message otherwise. |
| `core.usage()` | Plan usage, from what Tarmac already reads: `{ claude: { status, session }, codex: { status, session } \| null }`. `session` is the 5-hour window `{ utilization, resetsAt }` or `null` (plan without such a window, or usage unreadable: `status` is then not `ok`). Claude usage needs "show Claude usage" on in Tarmac. `codex` is `null` when Codex is off. Never contains a token, header or keychain value. |
| `core.terminals()` | Tarmac consoles, read only: `{ id, projectId, status: 'running' \| 'exited', exitCode }`. |
| `core.sessionBadges(provider)` | Badges shown next to each Claude session (see below). Returns an unsubscribe function. |

If `register` throws, the module is marked *error*, the routes it had already declared answer `503` and its event
subscriptions are removed.

### Events

`ctx.core.on(event, cb)` relays what Tarmac already tracks. Payloads are frozen objects; an exception thrown by `cb`
is logged under the module's name and never reaches Tarmac or other listeners. Subscribing to an unknown event
throws.

```js
export function register(ctx) {
  const off = ctx.core.on('process:status', (e) => {
    if (e.status === 'crashed') ctx.log.warn(`${e.projectName} exited with code ${e.exitCode}`);
  });
  // off() stops listening
}
```

| Event | When | Payload |
|---|---|---|
| `agent:turn` | An agent session (Claude Code, Codex) changes state, or is seen for the first time (`previous: null`). Checked every 4 s while someone listens. | `agent` (`claude` \| `codex`), `key` (`<agent>:<pid>`), `sessionId`, `terminalId` (Tarmac console, or null), `projectId`, `projectName`, `title`, `state`, `previous`, `previousMs` (time spent in `previous`), `at` |
| `process:status` | An app started by Tarmac changes status. | `projectId`, `projectName`, `status`, `previous`, `exitCode`, `at` |
| `suivi:task` | A task of a Todolist changes status, or is created (`previous: null`). | `suiviProjectId`, `projectName`, `taskId`, `num`, `title`, `status`, `previous`, `auto`, `at` |

- Agent `state`: `working` (answering or running a tool), `idle` (turn finished, waiting for a message), `permission`
  (a permission or choice box is on screen). `permission` is only detected in Tarmac consoles, whose screen Tarmac
  reads; a session running elsewhere stays `working` while it waits for a permission.
- App `status`: `stopped`, `starting`, `running`, `stopping`, `crashed`. `crashed` means the process exited on its
  own with a non-zero code or a signal; a stop you asked for gives `stopped`.
- Task `status`: `todo`, `toTest`, `done`.

### Session badges

`ctx.core.sessionBadges(provider)` adds small text badges next to each session in the Claude tab. Tarmac calls
`provider(sessions)` when it lists sessions, with frozen `{ id, cwd, file, sizeBytes, updatedAt }` objects (`file` is
the transcript path, or `null`). Return `{ [sessionId]: [{ label, title? }] }`.

```js
export function register(ctx) {
  ctx.core.sessionBadges((sessions) =>
    Object.fromEntries(sessions.map((s) => [s.id, [{ label: `${(s.sizeBytes / 1e6).toFixed(1)} MB`, title: 'History size' }]])));
}
```

- Text only, never HTML; translate the labels yourself (`ctx.core.lang()`).
- At most 4 badges per session and per module; `label` is cut at 24 characters, `title` at 200. Unknown session ids
  are ignored; badges appear in module loading order.
- Each provider has 1.5 s to answer. An error or a timeout is logged and gives no badges; the list is returned anyway.
- Without a provider, nothing is computed. A module in error or disabled is no longer called.

## Web side

```js
/** @type {import('@codustel/tarmac/modules').MountModule} */
export function mount(el, ctx) {
  el.textContent = ctx.lang === 'fr' ? 'Bonjour' : 'Hello';
  const off = ctx.onThemeChange((theme) => { /* 'light' | 'dark' */ });
  return () => off(); // called when the view is removed
}
```

A module with a `web` entry gets a sidebar entry; its view opens at `#m/<id>`. Tarmac imports the file, calls
`mount` with an empty element, and calls the returned function (if any) when the view goes away. The view is
mounted again when the interface language changes.

| `ctx` member | |
|---|---|
| `id`, `lang` | Module id; `'en'` or `'fr'`. |
| `theme()`, `onThemeChange(cb)` | Current theme and changes; `onThemeChange` returns an unsubscribe function. |
| `api(path, init)` | `fetch` to the module's routes: `ctx.api('/summary')` → `/api/modules/<id>/summary`. |
| `mountConsole(el, sessionId, opts?)` | Mounts in `el` the console of a session started by `core.launchConsole` (same view as the Tools screen). `opts.onExit(exitCode)` is called once when the process ends. Returns an unmount function. |

The view is framework-agnostic: use plain DOM, or bundle your own React, Vue or Svelte (Tarmac's React is not
shared, so versions never clash). The page's CSS variables (`--bg`, `--panel`, `--line`, `--fg`, `--muted`…)
follow the theme and can be used in your styles.

## Types

The npm package publishes the API types:

```ts
import type { ModuleContext, MountModule, RegisterModule } from '@codustel/tarmac/modules';
```

## Locked Pro entries

The free app shows Tarmac Pro features as locked sidebar entries with a Pro badge. An entry disappears as soon as a module with the same `id` is loaded (whatever its status). The list lives in `web/src/pro/features.ts`: a new Pro feature is one more line there.

## Developing a module

Run Tarmac from a clone with your module listed, then reload the page after each change to the web side, or
restart the server after a change to the server side:

```bash
TARMAC_MODULES="$PWD/../my-module" pnpm dev
```

The demo instance accepts it too, without touching your real Tarmac: `TARMAC_MODULES=… scripts/demo/run-demo.sh`.
