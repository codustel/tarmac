# Troubleshooting

Start with `tarmac doctor`: it checks Node, the service, the port, the domain, `gh`, Docker and Claude Code, and
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
- Another program uses port 7777: set `TARMAC_PORT=7790` (for example) in `~/.tarmac/env`, then `tarmac setup`
  (it updates the port 80 redirect too).
- `tarmac doctor` says the service "runs another Tarmac installation": you reinstalled Tarmac under another Node
  version (nvm, fnm, Homebrew…), so the global package moved. Run `tarmac setup` again from the new one.

## Port 80 is already used

If something else (Apache, nginx, another dev proxy) listens on port 80, `tarmac setup` does not touch it and
Tarmac stays on `http://tarmac.localhost:7777`. To get the URL without port later, free port 80 and run
`tarmac setup` again.

## The domain does not resolve

`tarmac.localhost` resolves to your Mac in Chrome, Firefox, Safari and the macOS resolver, with or without
`/etc/hosts`. A custom domain that does not end in `.localhost` needs the `/etc/hosts` entry: run `tarmac setup`
without `--no-sudo`. `http://localhost:7777` always works.

## The installed app (PWA)

- **No "Install the app" button**: installing needs a secure context, which `http://tarmac.localhost` is and
  `http://tarmac.test` is not (it redirects). In Chrome or Edge, use the button in the sidebar or the install icon
  in the address bar; in Safari, **File → Add to Dock**.
- **The app shows an old version**: open windows notice a new build and reload when in the background; otherwise
  a "Reload" banner shows up.
- **After a domain or port change** the installed app keeps its old address: uninstall it and install it again
  from the new URL.

## An app does not start, or a command is not found

Apps and consoles run with the `PATH` captured in `~/.tarmac/env` when you ran `tarmac setup`. If you installed a
tool since (pnpm, bun, uv, a new Node…), run `tarmac setup` again from your terminal, or edit the `PATH=` line,
then `tarmac restart`. The same applies when the Claude tab says `claude` is not found.

## Migration from App Manager

Tarmac used to be called App Manager. `tarmac setup` migrates it:

- the `com.codustel.app-manager` service is stopped and removed, `com.codustel.tarmac` replaces it;
- `~/.app-manager` is **copied** to `~/.tarmac` (`MANAGER_*` variables become `TARMAC_*`, `manager.localhost`
  becomes `tarmac.localhost`); the original is kept: delete it once Tarmac works;
- with your confirmation, the old port 80 redirect and the `manager.localhost` / `manager.test` lines of
  `/etc/hosts` are removed;
- the installed app on `manager.localhost` must be installed again from `http://tarmac.localhost`;
- `tarmac setup --with-claude` replaces the `app-manager` MCP server with `tarmac` and updates the `/suivi` skill.

`tarmac doctor` flags an App Manager install that is still there.

## Still stuck?

Open an issue with the output of `tarmac doctor` and the end of `tarmac logs` (check that they contain nothing
private): https://github.com/codustel/tarmac/issues
