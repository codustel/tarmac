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
- GitHub (repositories, clone in one click) and local Supabase views; built-in editor and source control view;
  Android emulators.
- Docker view: containers grouped by compose project (state, health, ports, CPU, memory, network, disk), linked
  project, start / stop / restart, "Open Docker Desktop / OrbStack" button.
- Claude usage in the sidebar: plan, 5-hour session, week and per-model weekly limits (such as Fable), read with
  Claude Code's own sign-in (token sent only to Anthropic); can be turned off in Settings.
- English and French interface.
- Documentation: README in English and French, `docs/` (configuration, Claude Code, security, troubleshooting,
  uninstall).

### Migration from App Manager

- `tarmac setup` replaces the App Manager service, copies `~/.app-manager` to `~/.tarmac` (the original is kept),
  replaces `manager.localhost` with `tarmac.localhost`, and the `app-manager` MCP server with `tarmac`.

[1.0.0]: https://github.com/codustel/tarmac/releases/tag/v1.0.0
