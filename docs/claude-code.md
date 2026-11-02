# Claude Code

Tarmac shows the Claude Code sessions of each project, opens new ones with Remote Control, and keeps a task tracker
per project, the **Claude Todolist**, that Claude fills while it works.

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

## Claude Code integration

`tarmac setup` offers it (or `tarmac setup --with-claude`). It adds:

| Piece | Where | Role |
|---|---|---|
| MCP server `tarmac` | Claude Code, user scope (`~/.claude.json`) | Claude reads and writes the Claude Todolist during sessions (all `suivi_*` tools) |
| MCP server `tarmac` (optional) | Claude desktop (`claude_desktop_config.json`) | The Todolist artifact syncs live with Tarmac (only `suivi_ping`, `suivi_pull`, `suivi_push`) |
| `/suivi` skill | `~/.claude/skills/suivi/` | The `/suivi` commands below |
| SessionStart hook | `~/.claude/hooks/suivi-check.sh` + `~/.claude/settings.json` | At session start in a Git repo: gives Claude the project's tracker, or suggests `/suivi init` |
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

### `/suivi` commands

| Command | What it does |
|---|---|
| `/suivi init` | Registers the project, detects its brand (colors, fonts), publishes the artifact, creates `Todolist/` |
| `/suivi open` | Shows the project's artifact in the session (Claude desktop) |
| `/suivi import` | Fills the tracker from the project's past sessions, after you review the list |
| `/suivi sync [--all]` | Catch-up between the artifact and Tarmac (the most recent change wins) |
| `/suivi upgrade [--all]` | Republishes the artifact page with the latest template, same URL, data kept |
| `/suivi theme` | Shows or fixes the artifact's colors and fonts |

### Sync channels

Set in **Settings → Claude Todolist**; each works alone and they complement each other:

- **A · Artifact MCP bridge**: the artifact open in Claude desktop reads and writes Tarmac live (needs the Claude
  desktop MCP entry).
- **B · Claude in session**: Claude writes each task to Tarmac and to the artifact while it works.
- **C · Catch-up**: `/suivi sync` and the session-start hook compare the artifact and Tarmac.

Without the Claude Code integration, a `/suivi` command typed in a session opened from Tarmac still works: Tarmac
points Claude to the skill file of its install folder.
