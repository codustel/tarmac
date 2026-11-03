# Claude Code

Tarmac shows the Claude Code sessions of each project, opens new ones with Remote Control, and keeps a task tracker
per project, the **Claude Todolist**, that Claude fills while it works. Using ChatGPT's Codex as well, or instead?
See [Codex](codex.md).

## Sessions

Tarmac reads the local transcripts in `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR`), only the start and end of
each file, with a cache. Each session is attached to the deepest project that contains its working folder. For
each one: title (from `/rename`, else the automatic summary, else the first message), last activity, number of
messages, branch, and whether it is **active** (a `claude` process runs in that folder).

- **New session**: a project's **Claude** tab → **New session** runs
  `claude --session-id <uuid> --remote-control "<Project>"` in a built-in console.
- **Resume**: from the project's history or the **Claude sessions** page, `claude --resume <id> --remote-control`.
- Open sessions appear as tabs on the **Claude sessions** page; each can also open in its own browser tab.

With **Remote Control**, the same session is reachable from claude.ai/code and the Claude mobile app. It needs
Claude Code signed in to claude.ai (`/login`), not an API key. The `claude` command must be in the `PATH` captured
in `~/.tarmac/env` (see [Configuration](configuration.md#environment-variables-tarmacenv)).

Claude Code deletes transcripts older than 30 days. To keep the history longer, set `"cleanupPeriodDays": 365` in
`~/.claude/settings.json`. Cloud sessions started on claude.ai/code (not on this Mac) are not stored locally and do
not appear.

## Usage in the sidebar

The sidebar shows your plan (Pro, Max 5x, Max 20x, Team, Enterprise…) and the same limits as Claude Code's
`/usage` screen: **5-hour session** (hidden when your plan has no session limit), **week** (all models) and each
per-model weekly limit (for example **Fable**), with the percentage used and when it resets (hover a gauge for the
full date). Gauges turn orange from 70 % and red from 90 %. If the window is too short, the Tarmac logo makes room
first, then the panel hides; nothing scrolls.

How it works, and what Tarmac does with the token:

- Tarmac reads Claude Code's OAuth sign-in where Claude Code keeps it: the macOS keychain (item
  `Claude Code-credentials`; macOS may ask you to allow access the first time), else
  `~/.claude/.credentials.json`. It reads it again at each refresh and keeps no copy.
- It sends the token **only** to `https://api.anthropic.com/api/oauth/usage` (the endpoint Claude Code uses for
  `/usage`), with redirects refused. The token is never sent to the browser, logged or written anywhere.
- At most one request per minute, and only while a Tarmac window is open and visible (5 minutes after a
  `429`). The UI receives only the plan, the percentages and the reset dates (`GET /api/claude/usage`).
- Tarmac never refreshes the token. If Claude Code is not signed in or its sign-in has expired, the panel says
  "Launch Claude Code to sign in again"; opening Claude Code renews it.
- To turn it off: **Settings → Interface → Claude usage** (nothing is read while it is off).

## Claude Code integration

`tarmac setup` offers it (or `tarmac setup --with-claude`). It adds:

| Piece | Where | Role |
|---|---|---|
| MCP server `tarmac` | Claude Code, user scope (`~/.claude.json`) | Claude reads and writes the Claude Todolist during sessions (all `suivi_*` tools) |
| MCP server `tarmac` (optional) | Claude desktop (`claude_desktop_config.json`) | The Todolist artifact syncs live with Tarmac and sends tasks to Claude (only `suivi_ping`, `suivi_pull`, `suivi_push`, `suivi_sessions`, `suivi_dispatch`) |
| `/suivi` skill | `~/.claude/skills/suivi/` | The `/suivi` commands below |
| SessionStart hook | `~/.claude/hooks/suivi-check.sh` + `~/.claude/settings.json` | At session start in a Git repo: gives Claude the project's tracker and the tasks asked of Claude, or suggests `/suivi init` |
| "Project tracking" rule | a section appended to `~/.claude/CLAUDE.md` (once) | Every request becomes a task; a handled task goes to "to test" |

A backup copy is made next to each file it changes (`.bak-<date>`). Claude desktop rewrites its config while it
runs, so setup waits until you quit it, writes the entry, then relaunches it. Claude Code picks the server up at
its next session.

The MCP server is `node <install folder>/dist/server/mcp.js` (stdio). It talks to Tarmac's local API with the
token `SUIVI_TOKEN` from `~/.tarmac/env`; the Claude desktop entry runs it with `--artifact` and the more limited
`SUIVI_ARTIFACT_TOKEN`. Tarmac must be running for its tools to answer (`suivi_ping` checks it).

An install from the App Manager era registered the server as `app-manager`: setup replaces it with `tarmac` in
Claude Code and keeps `app-manager` as an alias in Claude desktop for artifacts already published with it.

## Claude Todolist

Every tracked project has three copies kept in step:

1. **Tarmac's database** (`~/.tarmac/suivi.db`), the source of truth, shown on the **Claude Todolist** page and
   in each project's panel, where you can check tasks and add notes;
2. a **claude.ai artifact** in the project's colors, readable from your phone, with its own database;
3. a **`Todolist/` copy** in the repository (`suivi.config.json`, `suivi.json`, `README.md`), versioned with the
   code. Do not edit `suivi.json` by hand: it is regenerated.

Adding and removing tasks is Claude's job (through the MCP server); you check, test and annotate. A task is never
deleted, only archived. A task Claude has handled goes to **to test**, and is checked once you have validated it.
A remark on a tested task creates a lettered subtask right below it (7.32 → 7.32a).

### Send a task to Claude (▶ Claude)

Every task not handled yet (not done, not to test, not archived) has a **▶ Claude** button, in Tarmac and in the
artifact. It hands the task to a Claude Code session with a short instruction, in the app's language:

> Handle task 4.12 “title” (id t-4-12) from the acme/shop tracker: read it with suivi_get, do it, then mark it to
> test (tracker rules).

- **In Tarmac** (Todolist page or project panel), the button lists the Claude sessions running in Tarmac's consoles
  for the project, with their state, plus **New session** (opened in a console with the instruction as its first
  message). The instruction is pasted into the chosen session (bracketed paste, then Enter).
- **In the artifact opened in Claude desktop**, the same menu goes through the MCP bridge (`suivi_sessions`,
  `suivi_dispatch`): one click is enough, nothing to copy. Claude desktop may ask you to allow the call.
- **In the artifact on the web or your phone** (no bridge), the button copies the instruction and marks the task;
  Tarmac picks the mark up at the next sync.

The task is then marked **Asked Claude** (cleared once it goes to test or is checked). The mark only comes from a
click: a `Todolist/` copy (import, file watch) or a write by Claude never sets it. The session-start hook reads the
marked tasks from Tarmac's local API only (never from the repo copy, which a cloned repo could forge) and passes
their numbers alone; Claude offers them in one line and only starts once you confirm.

Safeguards: only tasks of the project and only the task's own data (title cleaned of control characters) go out;
only to a Claude session running in a Tarmac console of that project; and only when that session is **idle with an
empty prompt**. A session that is working, waiting for a permission answer or whose state is unknown (text being
typed, screen not recognized) is shown as unavailable and nothing is written to it, so Enter can never approve a
permission or submit half-typed text. Sessions started outside Tarmac (Terminal, Claude desktop) can't be reached.

### `/suivi` commands

| Command | What it does |
|---|---|
| `/suivi init` | Registers the project, detects its brand (colors, fonts), publishes the artifact, creates `Todolist/` |
| `/suivi open` | Shows the project's artifact in the session (Claude desktop) |
| `/suivi import` | Fills the tracker from the project's past sessions, after you review the list |
| `/suivi sync [--all]` | Catch-up between the artifact and Tarmac (the most recent change wins) |
| `/suivi upgrade [--all]` | Republishes the artifact page with the latest template and its capabilities, same URL, data kept |
| `/suivi theme` | Shows or fixes the artifact's colors and fonts |
| `/suivi restructure` | Splits, merges or renumbers phases (e.g. phase 7 → 7 backend, 8 mobile, 9 frontend; old 8 → 10), after you review a preview; task ids and history are kept |
| `/suivi audit [--yes]` | Finds tasks already coded but still "to do" (commits citing them, code present), shows you the list, then sets them to test with the commit as evidence |

### Sync channels

Set in **Settings → Claude Todolist**; each works alone and they complement each other:

- **A · Artifact MCP bridge**: the artifact open in Claude desktop reads and writes Tarmac live (needs the Claude
  desktop MCP entry).
- **B · Claude in session**: Claude writes each task to Tarmac and to the artifact while it works.
- **C · Catch-up**: `/suivi sync` and the session-start hook compare the artifact and Tarmac.

Without the Claude Code integration, a `/suivi` command typed in a session opened from Tarmac still works: Tarmac
points Claude to the skill file of its install folder.
