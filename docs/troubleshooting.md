# Troubleshooting

Start with `tarmac doctor`: it checks Node, the service, the port, the domain, `gh`, Docker and the agents ticked
in Settings → Agents (Claude Code, Codex), and
says what to do for each problem. `tarmac logs` follows the service log.

## Access to ~/Documents

`~/Documents` (like `~/Desktop` and `~/Downloads`) is protected by macOS. On the first scan, accept the access
request for `node`. If no request shows up and projects from `~/Documents` are missing:

1. **System Settings → Privacy & Security → Files and Folders** (or **Full Disk Access**);
2. add the `node` binary (`which node` gives its path; with nvm or fnm, the binary of the version Tarmac uses);
3. `tarmac restart`.

Keeping your code outside `~/Documents` (`~/Developer`, `~/code`…) avoids the question altogether.

## Tarmac does not answer

- `tarmac status`: is the service loaded, does the server answer on its port?
- `tarmac logs`: the error is usually at the end (a port already in use, a Node too old after a version switch…).
- Another program uses port 7777: set `TARMAC_PORT=7790` (for example) in `~/.tarmac/env`, then `tarmac setup`.
- `tarmac doctor` says the service "runs another Tarmac installation": you reinstalled Tarmac under another Node
  version (nvm, fnm, Homebrew…), so the global package moved. Run `tarmac setup` again from the new one.

## Port 80

`http://tarmac.localhost:7777` is Tarmac's address and always works. The address without port is optional:
`tarmac setup --port-80` redirects port 80 with `pf`; it is off by default.

**Port 7777 stops answering after a restart (port 80 still works).** Seen with the `pf` redirect on some Macs:
once `pf` loads the rule at boot, direct connections to `127.0.0.1:7777` hang (MCP server, artifacts and sessions
cut off) while `http://127.0.0.1/` answers. `tarmac doctor` reports it. Fix: run `tarmac setup` (without
`--port-80`), which removes the redirect, or right away `sudo pfctl -a com.apple/com.codustel.tarmac -F all`
(until the next boot).

**Port 80 is already used.** If something else (Apache, nginx, another dev proxy) listens on port 80,
`tarmac setup` does not touch it and Tarmac stays on `http://tarmac.localhost:7777`. To get the URL without port
later, free port 80 and run `tarmac setup` again.

**The redirect is in place but macOS does not apply it.** `tarmac setup` and `tarmac doctor` check that a
connection to `127.0.0.1:80` reaches Tarmac. On some Macs the `pf` rule is loaded but has no effect
(`curl http://127.0.0.1/` is refused): Tarmac then keeps the address with port, nothing else is affected. To dig
further (administrator rights needed; these commands only read):

```bash
sudo pfctl -s info | head -3                                   # Status: Enabled?
sudo pfctl -s nat                                              # rdr-anchor "com.apple/*" present?
sudo pfctl -a com.apple -s Anchors                             # com.apple/com.codustel.tarmac listed?
sudo pfctl -vv -a com.apple/com.codustel.tarmac -s nat         # the rule, with its Evaluations / Packets counters
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/api/meta; sudo pfctl -vv -a com.apple/com.codustel.tarmac -s nat
sudo pfctl -s Interfaces -v | grep -A1 lo0                     # lo0 marked "skip" by another ruleset?
```

If the counters stay at 0 after the `curl`, the anchor is not evaluated for local traffic; if `lo0` is skipped,
another tool (VPN, firewall) has loaded its own `pf` ruleset. Either way, `http://tarmac.localhost:7777` keeps
working.

## The domain does not resolve

`tarmac.localhost` resolves to your Mac in Chrome, Firefox, Safari and the macOS resolver, with or without
`/etc/hosts`. A custom domain that does not end in `.localhost` needs the `/etc/hosts` entry: run `tarmac setup`
without `--no-sudo`. `http://localhost:7777` always works.

## The installed app (PWA)

- **No "Install the app" button**: installing needs a secure context, which `http://tarmac.localhost` is and
  `http://tarmac.test` is not (it redirects). Chrome also waits for a short use of the page before offering it:
  give it a few seconds, or use the menu **⋮ → Cast, save, and share → Install page as app**. In Chrome or Edge,
  the button then shows up in the sidebar and in the address bar; in Safari, **File → Add to Dock**.
- **The app shows an old version**: open windows notice a new build and reload when in the background; otherwise
  a "Reload" banner shows up.
- **After a domain or port change** the installed app keeps its old address: uninstall it and install it again
  from the new URL.

## An app does not start, or a command is not found

Apps and consoles run with the `PATH` captured in `~/.tarmac/env` when you ran `tarmac setup`. If you installed a
tool since (pnpm, bun, uv, a new Node…), run `tarmac setup` again from your terminal, or edit the `PATH=` line,
then `tarmac restart`.

## A tool is missing (git, gh, Claude Code, Codex, Docker, Supabase)

- **git, `gh`, `claude`, `codex`**: open **Settings → Tools** and install or sign in there (or `tarmac setup --yes`).
  Tarmac also finds the folders where it installs them (`~/.tarmac/tools/bin`, `~/.local/bin`, Homebrew, the npm
  global folder) without a restart. Starting or resuming a Claude or Codex session with the tool missing offers the
  install and sign-in on the spot.
- **git on macOS**: macOS opens its own install window (Xcode command line tools). In the interface (Settings →
  Tools, or the prompt shown on first use), Tarmac waits for it to finish (up to 15 minutes). `tarmac setup` does
  not wait: it opens the window and moves on; finish the macOS install, then run `tarmac doctor` to check.
- **Claude Code or Codex installed from Tarmac**: Tarmac also sets up its integration (MCP server, `/suivi` skill,
  rule) and checks the agent in Settings → Agents; the row says whether it worked, with the details.
- **No Install button, "No automatic installation available"**: no install method exists on this machine; use the
  official page linked on the row.
- **A row shows "installed outside Tarmac" and no Update button**: Tarmac cannot tell how it was installed; update
  it the way you installed it.
- **A tool failed to install**: the row shows the error and **Retry**.
- **Docker or Supabase CLI**: Tarmac never installs them. A warning icon in the sidebar and a message in the view
  say what to do (install Docker Desktop, run `brew install supabase/tap/supabase`, start Docker); **Check again**
  once done.

## Codex

- **No Codex tab or sessions**: tick Codex in **Settings → Agents**.
- **Codex does not see the Todolist**: run `tarmac setup --with-codex`, then start a new Codex session (`codex mcp
  list` should show `tarmac`). The session-start hook runs only once you trust it in Codex (`/hooks`).
- **▶ says the Codex session's state is unknown**: Tarmac sends a task only to a Codex session showing an empty
  prompt ("Ask Codex to do anything") with no approval prompt; type or clear the prompt, or pick **New Codex
  session**.
- **The Codex usage panel says to start a session**: Codex records your plan limits during an exchange; send a
  message in Codex once, signed in with ChatGPT (`codex login`).

## Migration from App Manager

Tarmac used to be called App Manager. `tarmac setup` migrates it:

- the `com.codustel.app-manager` service is stopped and removed, `com.codustel.tarmac` replaces it;
- `~/.app-manager` is **copied** to `~/.tarmac` (`MANAGER_*` variables become `TARMAC_*`, `manager.localhost`
  becomes `tarmac.localhost`); the original is kept: delete it once Tarmac works;
- **a `~/.tarmac` is already there** (an earlier try, then App Manager kept being used): when `~/.app-manager` has
  newer data (`suivi.db`, `state.json`), `tarmac setup` shows both dates and offers to move `~/.tarmac` aside to
  `~/.tarmac.old-YYYYMMDD-HHMMSS` before copying (`--yes` accepts, `--dry-run` shows it; nothing is deleted). If
  you decline, `~/.tarmac` is kept and the server only writes a warning in `tarmac logs`;
- with your confirmation, the old port 80 redirect and the `manager.localhost` / `manager.test` lines of
  `/etc/hosts` are removed;
- the installed app on `manager.localhost` must be installed again from `http://tarmac.localhost`;
- `tarmac setup --with-claude` replaces the `app-manager` MCP server with `tarmac` and updates the `/suivi` skill.

`tarmac doctor` flags an App Manager install that is still there.

## Still stuck?

Open an issue with the output of `tarmac doctor` and the end of `tarmac logs` (check that they contain nothing
private): https://github.com/codustel/tarmac/issues
