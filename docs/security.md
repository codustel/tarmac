# Security

Tarmac starts apps, opens shells and runs Git commands on your behalf. It is built to be reachable from your own
Mac only. This page explains how, and what each part is allowed to do. To report a vulnerability, see
[SECURITY.md](../SECURITY.md).

## Local only

- The server listens on **`127.0.0.1`** (`TARMAC_HOST`), never on your network interfaces by default.
- Every HTTP and WebSocket request whose `Host` header is not local is refused (`403`). Accepted hosts:
  `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test`, the host of `TARMAC_URL` and `ALLOWED_HOSTS`. This
  blocks DNS rebinding.
- A request sent by a browser page must come from Tarmac itself: its `Origin` must be exactly the address
  requested (scheme, host and port) or the origin of `TARMAC_URL`, and API or WebSocket requests marked
  `Sec-Fetch-Site: cross-site` or `same-site` are refused. A website you visit, or another app you run in dev on
  `localhost:5173` or `app.localhost`, cannot call Tarmac's API or open its consoles. Clients without `Origin`
  (the `tarmac` CLI, the MCP server, hooks) are not affected.
- The "write TypeScript types to a file" Supabase command only writes inside the project: a path through a
  symbolic link that leads outside is refused.
- No telemetry. Outgoing calls are limited to `git fetch` on your repositories and the GitHub API with your token.

Do not set `TARMAC_HOST=0.0.0.0` or put Tarmac behind a tunnel: anyone who reaches the UI can run commands as
you. To use your projects from another device, use Claude Code's Remote Control (sessions) or your own VPN.

## What Tarmac can run

| Feature | Scope |
|---|---|
| Start / stop an app | The command detected for that app (its `dev` script, `manage.py runserver`, `uvicorn`…), in its folder, with a port from the range. Stop kills the app's process group. |
| Consoles | An interactive shell (PTY) as your user, in the project folder. This is the reason Tarmac must stay local. |
| Git menu | Only the ~30 listed commands go through the API (no free command); branch names are validated and commit messages are length-limited, then both are shell-quoted. Destructive commands ask for confirmation in the UI. |
| Supabase menu | Only the listed `supabase` CLI commands, with the same validation. |
| Docker view | Reads the engine socket (containers, stats, disk usage). Actions are limited to start, stop and restart, on a container ID or compose project that must appear in the engine's own list; nothing else (no `exec`, `rm`, prune, pull). Stop and restart ask for confirmation. |
| Editor, README, files | Reads and writes are confined to the project folder; the README image route only serves image files of the project. |
| Ports | "Free ports" stops what still listens on ports Tarmac assigned to apps (never Docker or Tarmac itself). |
| Clone | `gh repo clone` or `git clone` into the clone folder. |

Projects are only searched in the folders you list in **Settings**.

## Tokens and secrets

- `~/.tarmac/env` and `~/.tarmac/settings.json` are created with mode `600` (readable by you only).
  `settings.json` holds the GitHub token if you enter one in Settings; otherwise Tarmac uses `GITHUB_TOKEN` or the
  `gh` CLI's token, and never stores them.
- The `tarmac` MCP server authenticates to the local API with a random token: `SUIVI_TOKEN` (Claude Code: every
  Claude Todolist tool, including creating tasks) or `SUIVI_ARTIFACT_TOKEN` (Claude desktop, for artifact pages:
  read the tracker, check tasks and add notes only). Both are generated on first use and stored in
  `~/.tarmac/env`. Creating or importing tasks without the Claude Code token is refused.
- The Claude Todolist rule tells Claude never to put a secret or a `.env` value in a task.

## What needs `sudo`, and why

Only `tarmac setup` and `tarmac uninstall`, only after an explanation and your confirmation, and never with
`--no-sudo`. `tarmac setup --dry-run` prints the exact commands.

| Change | Why |
|---|---|
| `127.0.0.1 tarmac.localhost` and `127.0.0.1 tarmac.test` appended to `/etc/hosts` | Forces IPv4 for `tarmac.localhost` (which already resolves without it) and makes the `tarmac.test` alias work |
| `/etc/pf.anchors/com.codustel.tarmac`: `rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port 7777` | A user process cannot listen on port 80: this loopback-only redirect gives an URL without port |
| `/Library/LaunchDaemons/com.codustel.tarmac.pf.plist` | Loads that rule again at boot (`pfctl -E`, then the anchor under `com.apple/`, already referenced by the system `pf.conf`) |
| Removal of the same items for App Manager (`manager.localhost`, `com.codustel.app-manager`) | Migration from Tarmac's former name |

The redirect only applies to `127.0.0.1`, on the loopback interface; it does not open any port to your network.
`tarmac uninstall` removes all of it. The login service itself (LaunchAgent) runs as your user, without
privileges.
