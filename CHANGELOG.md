# Changelog

All notable changes to Tarmac are listed here. The format follows [Keep a Changelog](https://keepachangelog.com),
and versions follow [Semantic Versioning](https://semver.org).

## [1.0.0] - Unreleased

First public release. Tarmac was previously a private tool named App Manager.

### Added

- Installation in two commands: `npm install -g @codustel/tarmac`, then `tarmac setup`.
- `tarmac` command: `setup` (with `--dry-run`, `--domain`, `--no-sudo`, `--with-claude` / `--no-claude`, `--yes`),
  `update`, `uninstall [--purge]`, `start`, `stop`, `restart`, `status`, `logs`, `open`, `doctor`.
- Projects view: detection of web apps, APIs, workers and Python projects (monorepos included), start / stop with
  automatic ports, live logs, consoles, Git menu, README, production URLs, favorites.
- Claude Code sessions per project, new or resumed with Remote Control.
- Claude Todolist: per-project tracker kept by Claude through the `tarmac` MCP server and the `/suivi` skill,
  mirrored in a claude.ai artifact and a `Todolist/` copy.
- ▶ Claude button on every pending task (Tarmac and the artifact): sends it to an idle Claude session running in
  a Tarmac console, or to a new session; the task is marked "Asked Claude" until it goes to test.
- GitHub (repositories, clone in one click) and local Supabase views; built-in editor and source control view;
  Android emulators.
- Docker view: containers grouped by compose project (state, health, ports, CPU, memory, network, disk), linked
  project, start / stop / restart, "Open Docker Desktop / OrbStack" button.
- Claude usage in the sidebar: plan, 5-hour session, week and per-model weekly limits (such as Fable), read with
  Claude Code's own sign-in (token sent only to Anthropic); can be turned off in Settings.
- Codex (ChatGPT) next to Claude Code: Settings → Agents (Claude Code, Codex, or both; Claude Code alone by
  default), Codex sessions in Tarmac consoles (new, `codex resume`), Codex sessions running elsewhere with the
  activity LED, timeline, ▶ to an idle Codex session or a new one, Codex usage panel (ChatGPT plan, 5-hour and
  weekly windows, read from Codex's local session files without any token), `tarmac setup --with-codex`
  (`tarmac` MCP server, `AGENTS.md` rule, `$suivi` skill, session-start hook), `tarmac doctor` and `uninstall`.
- English and French interface.
- Documentation: README in English and French, `docs/` (configuration, Claude Code, Codex, security,
  troubleshooting, uninstall).

### Migration from App Manager

- `tarmac setup` replaces the App Manager service, copies `~/.app-manager` to `~/.tarmac` (the original is kept),
  replaces `manager.localhost` with `tarmac.localhost`, and the `app-manager` MCP server with `tarmac`.

[1.0.0]: https://github.com/codustel/tarmac/releases/tag/v1.0.0
