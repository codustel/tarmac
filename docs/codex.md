# Codex (ChatGPT)

[Codex](https://developers.openai.com/codex) is OpenAI's coding agent for the terminal, included in ChatGPT plans.
Tarmac works with Codex the way it works with Claude Code: sessions in its consoles, sessions running elsewhere,
the activity LED and timeline, the **▶** button of the Todolist, and your plan usage. Claude Code is not needed.

## Turn it on

1. Install Codex and sign in with your ChatGPT account (`npm install -g @openai/codex` or `brew install codex`, then
   `codex login`).
2. In Tarmac, **Settings → Agents**: tick **Codex (ChatGPT)**. Claude Code, Codex, or both; Claude Code alone is the
   default and keeps Tarmac exactly as before.
3. Run `tarmac setup --with-codex` (or answer yes when `tarmac setup` offers it: it does when `codex` is in your
   `PATH` or Codex is ticked). It adds, with a backup copy of every file it changes:
   - the `tarmac` MCP server to `~/.codex/config.toml` (`[mcp_servers.tarmac]`, between two marked comments);
   - the "Project tracking" rule to `~/.codex/AGENTS.md` (between two marked HTML comments);
   - the `suivi` skill to `~/.agents/skills/suivi/SKILL.md` (Codex's folder for your own skills);
   - a session-start hook (`~/.codex/hooks.json` → `~/.codex/hooks/tarmac-suivi-check.sh`).
4. Open Codex once and type `/hooks` to trust the Tarmac hook: Codex skips hooks you have not reviewed.

`CODEX_HOME` is honored everywhere (`~/.codex` by default). `tarmac setup --dry-run` shows every write first.

## Sessions

- **Codex sessions** in the sidebar and the **Codex** tab of a project: every session of the project (read from
  `~/.codex/sessions`, names given with `/rename` included), **New session** (`codex` in the project folder) and
  **Resume** (`codex resume <id>`) in a built-in console.
- Sessions started elsewhere (Terminal, an IDE) show up under **Running outside Tarmac** with the shared LED.
  Tarmac matches a process to its session by its `resume <id>` argument, otherwise by the most recent transcript
  of its folder written since it started.
- Remote access: Codex has no per-session flag like Claude Code's `--remote-control`; following a session from your
  phone goes through the ChatGPT app ("Remote connections" in OpenAI's docs), not through Tarmac.

## Todolist with Codex

Codex keeps the Todolist through the `tarmac` MCP server, like Claude Code. Skills are called with `$` in Codex:

| Command | What it does |
|---|---|
| `$suivi init` | Registers the project in Tarmac and adds the `Todolist/` copy to the repo. |
| `$suivi sync` | Reads the tracker from Tarmac and rewrites the `Todolist/` copy. |
| `$suivi import` | Fills the tracker from past Codex sessions and the git history, after your review. |
| `$suivi theme` | Shows and fixes the colors and fonts detected for the project. |
| `$suivi restructure` | Splits, merges or renumbers phases after you review a preview; task ids and history are kept. |

The claude.ai artifact is Claude-only: with Codex, use Tarmac's **Todolist** view (and the repo copy). When Codex
is ticked, "Claude Todolist" is simply called **Todolist** in Tarmac.

## ▶ Send a task

The **▶** button lists the Claude and Codex sessions running in Tarmac consoles for the project, and offers a new
session of each ticked agent. A task is only typed into a session that is **idle**: Tarmac reads the end of the
Codex screen (empty prompt "Ask Codex to do anything", no "esc to interrupt", no approval prompt such as
"Would you like to run the following command?" or "1. Yes / 2. No") and the turn recorded in the session's
transcript (`task_started` without `task_complete`). Anything uncertain is refused, so Enter never answers an
approval prompt. Sessions started outside Tarmac cannot receive a task.

## Usage panel

Under Claude's, the **Codex usage** panel shows your ChatGPT plan, the 5-hour and weekly windows in %, and when
they reset. Codex records these limits in its local session files on every exchange (the values `/status` shows);
Tarmac reads the latest ones. No token is read and no network call is made. Before your first Codex exchange on
this Mac, the panel says so instead of guessing; a window that has reset since is hidden. Turn it off in
**Settings → Agents**.

## Check and remove

- `tarmac doctor` checks Codex only when it is ticked: CLI found, MCP server, skill, rule and hook in place.
- `tarmac uninstall` removes only what Tarmac wrote for Codex (the marked blocks, the hook, the skill), with backup
  copies; your own Codex settings are kept.
