# Uninstall

```bash
tarmac uninstall            # service, port 80 redirect, /etc/hosts entries, MCP server in Claude Code
tarmac uninstall --purge    # the same, and deletes ~/.tarmac (settings, history, Claude Todolist database)
npm uninstall -g @codustel/tarmac
```

`tarmac uninstall --dry-run` lists every action first. The `sudo` steps (redirect, `/etc/hosts`) are explained and
confirmed; `--no-sudo` skips them, `--yes` answers yes to every question.

What `tarmac uninstall` removes:

- the login service `com.codustel.tarmac` (`~/Library/LaunchAgents/com.codustel.tarmac.plist`);
- the port 80 redirect (`/etc/pf.anchors/com.codustel.tarmac` and the LaunchDaemon `com.codustel.tarmac.pf`);
- the `tarmac.localhost` and `tarmac.test` lines (and your custom domain) in `/etc/hosts`;
- the `tarmac` MCP server in Claude Code (`claude mcp remove --scope user tarmac`), if Claude Code is installed;
- with `--purge`, the data folder `~/.tarmac`.

What it leaves, to remove by hand if you set up the Claude Code integration:

- `~/.claude/skills/suivi/` and `~/.claude/hooks/suivi-check.sh`;
- the `suivi-check.sh` entry under `hooks.SessionStart` in `~/.claude/settings.json`;
- the "Project tracking (Claude Todolist)" section of `~/.claude/CLAUDE.md`;
- the `tarmac` (and `app-manager`) entry of `mcpServers` in Claude desktop's
  `~/Library/Application Support/Claude/claude_desktop_config.json`;
- the installed app (PWA): open it, then its menu (⋮) → Uninstall Tarmac (Chrome / Edge), or delete it from `~/Applications` (Safari).

Your projects are never touched, including their `Todolist/` folders, which you can keep or delete.

From a clone, `./scripts/uninstall.sh` runs the same command.
