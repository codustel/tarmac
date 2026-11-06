# Using Tarmac on Windows (WSL 2)

Tarmac is built for macOS, and `tarmac setup` only runs there. On Windows it runs **inside WSL 2** (Ubuntu or
Debian), started by hand: the dashboard, project detection, start / stop with ports and live logs, consoles,
the Git menu, GitHub, local Supabase and the Claude Todolist all work, and you use it from your Windows browser.
This setup is not officially supported: it is tested on Linux (Debian, Node 22), not on every Windows machine.

## 1. Prepare WSL 2

In PowerShell (administrator), once:

```powershell
wsl --install -d Ubuntu
```

Then, in the Ubuntu terminal:

```bash
sudo apt update && sudo apt install -y git lsof build-essential python3
```

Install **Node.js 22.13 or later** (for example with [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`), then
pnpm: `corepack enable`.

Keep your projects in the Linux file system (`~/dev/...`), not in `/mnt/c/...`: scanning and Git are much
slower on Windows drives.

## 2. Install and start Tarmac

```bash
git clone https://github.com/codustel/tarmac.git ~/tarmac
cd ~/tarmac
pnpm install
pnpm build
DEV_ROOTS=~/dev node dist/server/index.js
```

`DEV_ROOTS` lists the folders to scan (comma-separated); you can change them later in Settings. Tarmac stores
its data in `~/.tarmac` inside WSL.

Open **http://localhost:7777** in Edge or Chrome on Windows (WSL forwards `localhost` to Linux). Chrome and Edge
also accept `http://tarmac.localhost:7777`, where you can install Tarmac as an app (PWA) from the browser menu.

To update: `git pull && pnpm install && pnpm build`, then restart the command above.

## 3. Keep it running (optional)

Tarmac does not install a login service on Windows. Simple options: leave the command running in a Windows
Terminal tab, or run it in the background with `nohup node dist/server/index.js > ~/.tarmac/tarmac.log 2>&1 &`.
If systemd is enabled in your WSL distribution, a user service (`systemctl --user`) running the same command
also works.

## 4. Claude Code

If Claude Code runs inside WSL, Tarmac lists its sessions and opens new ones in its consoles. The Claude
Todolist needs the `tarmac` MCP server: `./scripts/mcp-install.sh --code` then `./scripts/suivi-install.sh` from
the clone (Claude Code side only; the Claude desktop app on Windows is not configured automatically).

Codex works the same way when it runs inside WSL (`npm install -g @openai/codex`; the Tools screen has no install
method for Linux, so install it yourself): tick it in Settings → Agents.
`tarmac setup` does not run on Windows, so add the `tarmac` MCP server by hand (`codex mcp add tarmac -- node
<clone>/dist/server/mcp.js`), and copy `codex/skills/suivi/` to `~/.agents/skills/` and `codex/AGENTS-suivi.md`
into `~/.codex/AGENTS.md` if you want the Todolist from Codex.

## What does not work on Windows

- `tarmac setup` and the other `tarmac` service commands (macOS only): start Tarmac by hand as above.
- The URL without a port (`http://tarmac.localhost`) and the `.test` alias.
- "Open in Finder", "Open in VS Code / Cursor / Zed" and the "open in editor" badge.
- Android emulators.
- The machine name shown in the sidebar (the Linux host name is shown instead).
