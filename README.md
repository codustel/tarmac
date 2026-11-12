<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/tarmac-logo-dark.svg">
    <img src="brand/tarmac-logo-light.svg" alt="Tarmac" width="360">
  </picture>
</p>

<p align="center"><strong>Tarmac — Claude Code, Codex and every project, on one runway</strong></p>

<p align="center"><a href="https://runtarmac.com"><strong>runtarmac.com</strong></a> · <a href="https://runtarmac.com/install/">Install</a> · <a href="https://runtarmac.com/features/claude-code-codex/">Claude Code + Codex</a> · <a href="https://runtarmac.com/pricing/">Free and Pro</a> · <a href="https://runtarmac.com/blog/">Blog</a></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@codustel/tarmac"><img src="https://img.shields.io/npm/v/@codustel/tarmac" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey" alt="macOS">
</p>

<p align="center">Created by <strong>Ismaël Belaaouad</strong> · Codustel — <a href="https://www.linkedin.com/in/codustel/">LinkedIn</a> · <a href="https://x.com/ismael_b_ai">X</a></p>

<p align="center"><a href="README.fr.md">Version française</a></p>

**Tarmac** is a local dashboard for macOS. It finds every project in your code folders, starts and stops them with
a free port, streams their logs, gives you a console and a Git menu in the browser, and runs your coding agents'
sessions there: Claude Code (also followed from claude.ai or your phone) and Codex, OpenAI's agent included in
ChatGPT plans. It runs as a login service on
`http://tarmac.localhost:7777` and installs as an app (PWA).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/home-en-dark.webp">
  <img src="docs/assets/home-en-light.webp" alt="Tarmac: projects view with the activity feed">
</picture>

| Claude Todolist | Console and Git menu | Settings |
|---|---|---|
| ![Claude Todolist](docs/assets/todolist.webp) | ![Console and Git menu](docs/assets/console-git.webp) | ![Settings](docs/assets/settings.webp) |

## Why Tarmac

You have a dozen projects, each with its own `pnpm dev`, port, `.env`, Supabase stack and agent sessions.
Tarmac puts them on one runway: one page to see what exists, what runs, what is out of sync with GitHub and what
your agents are working on, without opening ten terminals or remembering which app took port 3000.

Everything stays on your Mac: Tarmac listens on `127.0.0.1` only and has no telemetry. Its only network calls
are `git fetch` on your repositories and the GitHub API with your own token, to list your repositories.

## Features

- **Projects**: web apps and APIs (Next, Vite, Nuxt, Astro, SvelteKit, Express, Fastify, NestJS, Django, FastAPI,
  Rails, Laravel, Go, Rust…), workers and Python projects, found in your code folders, monorepos included. One
  group per project, named after its Git repository.
- **Run**: start, stop, restart, live status and logs, automatic port without conflicts (sticky per app), apps
  started outside Tarmac detected and adopted, "Free ports" after a crash.
- **Consoles**: an interactive terminal per project in the browser, detected commands (`package.json` scripts,
  `manage.py`, `cargo`, `go`…), Python virtualenv activated.
- **Git**: about 30 commands explained in a searchable menu (sync, commit, branches, stash, undo), with
  confirmation for destructive ones; ahead / behind and uncommitted changes at a glance.
- **Claude Code**: every session of each project (active or finished), new or resumed sessions with Remote
  Control in a built-in console, open from claude.ai/code and the mobile app too.
- **Claude usage**: your plan and live usage in the sidebar (5-hour session, week, per-model limits such as Fable),
  read with Claude Code's own sign-in; the token stays on your Mac and is only sent to Anthropic.
- **Codex (ChatGPT)**: tick Codex in Settings → Agents (Claude Code, Codex, or both) for the same with Codex:
  every session of each project, new or resumed sessions in a built-in console, sessions running elsewhere with the
  activity LED, the timeline, and your ChatGPT plan usage (5-hour and weekly windows) read from Codex's own local
  session files, with no token and no network call.
- **Todolist**: a task tracker per project that your agent keeps up to date through the `tarmac` MCP server and the
  `suivi` skill (`/suivi` in Claude Code, `$suivi` in Codex), with a `Todolist/` copy in the repo and, for Claude, a
  claude.ai artifact. A **▶** button sends a pending task to an idle Claude or Codex session running in Tarmac, or
  to a new one. With Claude Code alone it is called the Claude Todolist.
- **GitHub**: your repositories and organizations, which ones are cloned, "Clone" in one click (`gh` or SSH).
- **Local Supabase**: running instances, Studio, Mailpit, API and Postgres URLs, linked project.
- **Docker**: containers grouped by compose project with state, health, ports, CPU and memory, linked project,
  start / stop / restart (Docker Desktop, OrbStack, Colima).
- **And**: README rendering, built-in editor and source control view, open in VS Code / Cursor / Zed / WebStorm,
  projects open in VS Code flagged, production URL per app, favorites, Android emulators, light / dark theme,
  English and French interface.

## Requirements

- macOS (Apple silicon or Intel).
- [Node.js](https://nodejs.org) **22.13 or later** (Tarmac uses the built-in `node:sqlite`).
- Optional, and installed for you by Tarmac (see [Tools](#tools)): Git, [GitHub CLI](https://cli.github.com) (`gh`),
  [Claude Code](https://claude.com/claude-code) and / or [Codex](https://developers.openai.com/codex) (agent
  sessions and Todolist).
- Optional, to install yourself (Tarmac only flags them): Docker Desktop / OrbStack / Colima (Docker view, local
  Supabase) and the Supabase CLI.

### Install the dependencies yourself

Tarmac installs Git, `gh`, Claude Code and Codex for you (see [Tools](#tools)). To install everything by hand
instead, or for Node.js, Docker and the Supabase CLI, which Tarmac never installs, type these commands in Terminal
(macOS). On Windows, follow [Windows (WSL 2)](docs/windows.md).

| Dependency | Needed for | Install | Then |
|---|---|---|---|
| [Homebrew](https://brew.sh) | the commands below | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` | |
| [Node.js](https://nodejs.org) 22.13+ | Tarmac itself (required) | `brew install node` (or with [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`) | `node -v` |
| Git | Git menu, cloning | `brew install git` (or `xcode-select --install`) | |
| [GitHub CLI](https://cli.github.com) | GitHub tab, Clone | `brew install gh` | `gh auth login` |
| [Claude Code](https://claude.com/claude-code) | Claude sessions, Todolist | `curl -fsSL https://claude.ai/install.sh \| bash` (or `npm install -g @anthropic-ai/claude-code`) | `claude` (sign in on first launch) |
| [Codex](https://developers.openai.com/codex) | Codex sessions, Todolist | `npm install -g @openai/codex` (or `brew install --cask codex`) | `codex login` |
| Docker: [Docker Desktop](https://www.docker.com/products/docker-desktop/), [OrbStack](https://orbstack.dev) or [Colima](https://github.com/abiosoft/colima) | Docker view, local Supabase | `brew install --cask docker-desktop`, or `brew install --cask orbstack`, or `brew install colima docker` | open the app (Colima: `colima start`) |
| [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) | local Supabase | `brew install supabase/tap/supabase` | `supabase start` in a project |

`tarmac doctor` then lists what is still missing.

## Install

```bash
npm install -g @codustel/tarmac
tarmac setup
```

`tarmac setup` creates `~/.tarmac/env`, installs a login service (LaunchAgent), then, with your confirmation and
your password (`sudo`), adds `tarmac.localhost` to `/etc/hosts`. Last,
it offers to install the tools that are missing (git, `gh`, Claude Code, Codex: see [Tools](#tools)), then to set up
the Claude Code integration, and the Codex one when `codex` is installed (or with `--with-codex`). Run `tarmac setup --dry-run` first to see every action without changing anything.

**Tarmac's address is `http://tarmac.localhost:7777`**: it always works, with or without `sudo` (Chrome, Firefox
and Safari resolve `*.localhost` on their own). `tarmac setup --no-sudo` skips the `/etc/hosts` step.
An address without port (`http://tarmac.localhost`) is optional: `tarmac setup --port-80` redirects port 80 to
Tarmac with `pf`. It is off by default because on some Macs the rule blocks port 7777 after a restart; a redirect
installed by an earlier version is removed by `tarmac setup` (see [Troubleshooting](docs/troubleshooting.md#port-80)).

To install Tarmac as an app in Chrome, give the page a few seconds: Chrome shows its install button only after a
short use of the page. Meanwhile, use the menu **⋮ → Cast, save, and share → Install page as app**.

An existing **App Manager** install (Tarmac's former name) is migrated: its service is replaced and its data is
copied from `~/.app-manager` to `~/.tarmac` (the original is kept). If an older `~/.tarmac` is already there,
`tarmac setup` says so and offers to move it aside (`~/.tarmac.old-<date>`, nothing is deleted) before copying.

## Tools

Nothing to install by hand: Tarmac installs the tools it needs and never bundles a binary. For each one it uses the
first method available: Homebrew, then npm, then the tool's official installer (`git` on macOS: Homebrew, else the
Xcode command line tools window opened by macOS). Installs run in a visible Tarmac console.

- **First launch**: a **Tools** welcome screen lists Git, GitHub CLI, Claude Code and Codex, all ticked
  ("Recommended: leave everything checked"). It shows once, and only when a managed tool is missing; **Later**
  closes it. Installing Claude Code or Codex also sets up Tarmac's integration (MCP server, `/suivi` skill, rule,
  hook) and ticks the agent in **Settings → Agents**.
- **Settings → Tools**: the same list at any time: state (Missing, Signed out, Ready), version, **Sign in** (runs the
  tool's login in the console: you sign in yourself, in the browser) and **Update** when a newer version exists.
  A tool installed outside Tarmac is only updated by the method that installed it; if Tarmac cannot tell, the row
  says "installed outside Tarmac" and has no button. Nothing updates automatically.
- **At first use**: if `claude` or `codex` disappeared, starting or resuming a session offers to install it, then to
  sign in, then opens the session, with no restart of the service.
- **Terminal**: `tarmac setup` asks about each missing tool; `tarmac setup --yes` installs them all; without a
  terminal and without `--yes`, none is installed.
- **Docker and Supabase CLI** are never installed by Tarmac: the sidebar shows a warning icon on their entries (also
  when Docker is installed but stopped), and the view explains what to do, with a **Check again** button. The
  Claude, Codex and GitHub entries show the same icon when their tool is missing or signed out.

## First steps

1. Open `http://tarmac.localhost:7777` (`tarmac open`). Click **Install the app** in the sidebar to get a Dock icon.
2. In **Settings**, check the folders to scan (by default the usual code folders that exist: `~/Developer`,
   `~/Projects`, `~/dev`, `~/code`…), then connect the GitHub CLI in one click (**Settings → Tools**).
3. Start an app with **Start**, open its console, or open an agent session from its **Claude** or **Codex** tab
   (tick Codex in **Settings → Agents** first; Claude Code alone is the default).
4. With the integration, type `/suivi init` in a Claude Code session, or `$suivi init` in a Codex session, to create
   the project's Todolist. Codex asks you once to trust Tarmac's session-start hook: type `/hooks` in Codex.

`~/Documents` is protected by macOS: accept the access request for `node` on the first scan (see
[Troubleshooting](docs/troubleshooting.md#access-to-documents)).

## Commands

```text
tarmac status | start | stop | restart | logs | open
tarmac doctor          # checks Node, the service, the port, the domain, gh, Docker and the ticked agents
tarmac update          # npm install -g @codustel/tarmac@latest, then restart
tarmac uninstall       # --purge also deletes ~/.tarmac
```

Open windows, the installed app included, notice a new version and reload themselves; running apps and consoles
are not affected by an update.

### Todolist commands

Typed in a Claude Code session, inside the project's folder (needs the integration from the install). In Codex,
skills are called with `$`: `$suivi init`, `$suivi sync`, `$suivi import` and `$suivi theme` work the same way; the
artifact commands (`open`, `upgrade`) are Claude-only, Codex works with Tarmac's Todolist view and the `Todolist/`
copy (see [Codex](docs/codex.md)).

| Command | What it does |
|---|---|
| `/suivi init` | Creates the project's Claude Todolist: registers the project in Tarmac, picks up its brand colors and fonts, publishes the claude.ai artifact and adds the `Todolist/` copy to the repo. Run it once per project. |
| `/suivi open` | Shows the project's artifact in the session (Claude desktop), to read or tick tasks without leaving the chat. |
| `/suivi import` | Fills the tracker from the project's past Claude sessions: Claude lists the requests it finds, you review the list, then it writes the tasks. |
| `/suivi sync [--all]` | Catches up between the artifact and Tarmac when one changed without the other (phone, another computer); the most recent change wins. `--all` does every project. |
| `/suivi upgrade [--all]` | Republishes the artifact page with the latest template (new buttons such as **▶ Claude**, fixes) at the same URL, data kept. Run it after updating Tarmac. `--all` does every project. |
| `/suivi theme` | Shows the artifact's colors and fonts and lets you fix them if the detection got them wrong. |
| `/suivi restructure` | Reorganizes the tracker when a phase grows too big: splits it into several phases, shifts or merges the following ones (e.g. phase 7 → 7 backend, 8 mobile, 9 frontend; old 8 → 10). Claude shows you a preview of the new numbers first; task ids and history are kept. |
| `/suivi audit [--yes]` | Catches up forgotten statuses: Claude looks for tasks already coded but still "to do" (commits citing them, code present), shows you the list, then sets them to test with the commit as evidence. Partial work stays to do, with what is missing in the note. |

## Documentation

- [Configuration](docs/configuration.md): folders, ports, domain, environment variables, settings.
- [Claude Code](docs/claude-code.md): sessions, Remote Control, MCP server, Claude Todolist and `/suivi`.
- [Codex](docs/codex.md): Codex sessions, MCP server, `AGENTS.md` rule, `$suivi` skill, ▶ button and usage.
- [Security](docs/security.md): what Tarmac listens on, what it can run, what needs `sudo` and why.
- [Troubleshooting](docs/troubleshooting.md): `~/Documents` access, port 80, installed app, migration.
- [Windows (WSL 2)](docs/windows.md): running Tarmac on Windows, and what does not work there.
- [Extensions](docs/extensions.md): modules that add routes, a view and settings without patching Tarmac.
- [Uninstall](docs/uninstall.md).

## FAQ

**Why `tarmac.localhost`?** Browsers treat `localhost` and `*.localhost` as secure contexts, which the installed app
(PWA), the service worker and the clipboard need. `http://tarmac.test` also works and redirects there.

**Does it work on Windows or Linux?** Tarmac is built for macOS and `tarmac setup` only runs there. On Windows it
runs inside WSL 2, started by hand, with a few features missing: see [Windows (WSL 2)](docs/windows.md).

**Do I need port 80?** No. Tarmac uses `http://tarmac.localhost:7777`; `--port-80` is only for an address without port.

**Can I use another port or domain?** Yes: `tarmac setup --domain my.localhost`, and `TARMAC_PORT` in
`~/.tarmac/env` (see [Configuration](docs/configuration.md)).

**Is a Claude subscription required?** Only for the Claude features. Remote Control needs Claude Code signed in to
claude.ai (`/login`), not an API key.

**Does it work with ChatGPT?** Yes, through Codex, OpenAI's coding agent included in ChatGPT plans: tick it in
Settings → Agents and run `tarmac setup --with-codex`. Claude Code is not needed then. See [Codex](docs/codex.md).

## Contributing

Issues and pull requests are welcome, in English or French: see [CONTRIBUTING.md](CONTRIBUTING.md). Please report
security issues privately ([SECURITY.md](SECURITY.md)).

## License

[MIT](LICENSE) — © 2026 Ismaël Belaaouad ([Codustel](https://www.linkedin.com/in/codustel/)). Follow the project on [LinkedIn](https://www.linkedin.com/in/codustel/) and [X](https://x.com/ismael_b_ai).

Not affiliated with Anthropic or OpenAI. Claude and Claude Code are trademarks of Anthropic; ChatGPT and Codex are
trademarks of OpenAI.
