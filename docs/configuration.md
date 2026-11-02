# Configuration

Most settings live in the app (**Settings**). This page lists where Tarmac keeps its files, which ports and domain
it uses, and the environment variables read when the service starts.

## Folders

| Path | Content |
|---|---|
| Install folder | The npm package (`npm root -g`/`@codustel/tarmac`), or your clone. `tarmac status` shows it. |
| `~/.tarmac/env` | Service configuration (variables below), created by `tarmac setup` and never overwritten. Mode `600`. |
| `~/.tarmac/settings.json` | Settings edited in the app, plus names, production URLs and favorites set per project. Mode `600`: it can hold your GitHub token. |
| `~/.tarmac/state.json` | Ports assigned to apps, port history, apps started by Tarmac (adopted again after a restart). |
| `~/.tarmac/suivi.db` | Claude Todolist database (SQLite). |
| `~/.tarmac/tarmac.log` | Service log (`tarmac logs`). |
| `~/Library/LaunchAgents/com.codustel.tarmac.plist` | Login service (starts at login, restarted after a crash). |

Set `DATA_DIR` to use another folder than `~/.tarmac`.

## Ports and domain

- Tarmac listens on **`127.0.0.1:7777`** (`TARMAC_PORT`). **The reference address is
  `http://tarmac.localhost:7777`**: it always works.
- The address without port is a bonus. A user process cannot listen on port 80, so `tarmac setup` adds a `pf`
  rule that redirects `127.0.0.1:80` to 7777 (anchor `com.apple/com.codustel.tarmac`, reloaded at boot by the
  LaunchDaemon `com.codustel.tarmac.pf`), then checks that a connection to `127.0.0.1:80` really reaches Tarmac.
  `TARMAC_URL` is saved without port only if it does. If port 80 is already taken, if macOS does not apply the
  redirect (see [Troubleshooting](troubleshooting.md#port-80)), or with `--no-sudo`, the URL keeps its port.
  `tarmac doctor` says whether the redirect is active.
- Apps started by Tarmac get a port from **4100–4999** (`PORT_RANGE`, or **Settings → Port range**), which avoids
  the usual 3000, 5173 and 54321–54329. Each app keeps its port from one run to the next.
- The domain is **`tarmac.localhost`** (`tarmac setup --domain other.localhost` to change it). Chrome, Firefox,
  Safari and the macOS resolver send every `*.localhost` name to the loopback address, so it works without
  `/etc/hosts`; `tarmac setup` still adds `127.0.0.1 tarmac.localhost` there to force IPv4 (the server and the
  port 80 redirect are IPv4), plus the alias `tarmac.test`, which redirects to `tarmac.localhost`.
- Why not `.local`? It is reserved for Bonjour (mDNS) on macOS and `/etc/hosts` entries in `.local` are slow to
  resolve. Why not `.dev`? It is a real top-level domain with HSTS (HTTPS only).

## Environment variables (`~/.tarmac/env`)

The file is loaded every time the service starts: edit it, then `tarmac restart`.

| Variable | Default | Role |
|---|---|---|
| `DEV_ROOTS` | existing code folders (`~/Developer`, `~/Projects`, `~/dev`, `~/code`…), else `~/Documents` | Folders scanned before any change in Settings, comma separated |
| `TARMAC_HOST` | `127.0.0.1` | Listening address (see [Security](security.md) before changing it) |
| `TARMAC_PORT` | `7777` | Tarmac's port (1024 or more) |
| `TARMAC_URL` | `http://tarmac.localhost` | Public URL, added to the allowed hosts; written by `tarmac setup` |
| `ALLOWED_HOSTS` | — | Extra allowed host names, comma separated |
| `PORT_RANGE` | `4100-4999` | Default port range for apps |
| `SCAN_MAX_DEPTH` | `6` | Default scan depth |
| `SCAN_INTERVAL_S` | `120` | Automatic rescan |
| `GIT_FETCH_INTERVAL_MIN` | `15` | Automatic `git fetch` (remote state) |
| `GITHUB_TOKEN` | `gh` token | Used when no token is set in Settings |
| `PATH` | your shell's `PATH` at setup time | Apps and consoles run with it (nvm, fnm, Homebrew, pnpm, bun, uv…) |
| `DATA_DIR` | `~/.tarmac` | Data folder |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where Claude Code sessions are read |
| `DOCKER_HOST` | Docker Desktop, OrbStack or Colima socket | Docker socket for local Supabase |
| `LOG_BUFFER_LINES` | `2000` | Log lines kept per app |
| `LOG_LEVEL` | `warn` | Server log level |
| `SUIVI_TOKEN`, `SUIVI_ARTIFACT_TOKEN` | generated | Tokens of the `tarmac` MCP server (see [Security](security.md)) |

Variables from the former name (`MANAGER_PORT`, `MANAGER_URL`, `MANAGER_HOST`) are still read.

If an app works in your terminal but not in Tarmac, the `PATH` captured at setup time is probably missing a tool:
update the `PATH=` line (or run `tarmac setup` again from that terminal), then `tarmac restart`.

## Settings (in the app)

- **Interface**: language (Automatic follows the browser, English or French) and theme (light, dark, system;
  saved on the server so every window and the installed app share it).
- **Local folders**: folders to scan, projects shown (by default only what runs: web, API, mobile, workers and
  Python; tick the box to also show libraries and CLIs), scan depth.
- **GitHub**: tracked accounts and organizations (empty = everything your token can see), **Connect the gh CLI**
  (runs `gh auth login --web` in a built-in console), clone folder, optional access token (fine-grained
  recommended). Without a token, Tarmac uses `GITHUB_TOKEN`, then `gh auth token`.
- **Execution**: editor for **Open in editor** (VS Code, Cursor, Zed, WebStorm), port range.
- **Claude Todolist**: sync channels, MCP bridge interval, name of the `Todolist/` folder, latest syncs (see
  [Claude Code](claude-code.md)).

Per project, from its row or panel: display name, production URL, favorite.
