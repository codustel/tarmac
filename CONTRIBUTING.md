# Contributing to Tarmac

Thanks for your interest! Bug reports, ideas and pull requests are welcome, in English or French.

## Languages

- Issues, pull requests and commit messages: English or French, as you prefer.
- The existing code comments are in French; new comments can be in English. Do not translate existing comments
  in an unrelated pull request.
- The interface is bilingual: any new text goes into both catalogues (`web/src/i18n/en/*.ts` and
  `web/src/i18n/fr/*.ts`; on the server, `tr({ en, fr })` / `msg()` in `server/i18n.ts`). CLI messages
  (`cli/`) are in English.

## Set up a clone

Requirements: macOS, Node.js 22.13 or later, [pnpm](https://pnpm.io).

```bash
git clone https://github.com/codustel/tarmac.git
cd tarmac
pnpm install
```

Run in development mode (API with auto-reload on `:7777`, Vite UI on `:7778`):

```bash
DATA_DIR=/tmp/tarmac-dev DEV_ROOTS=~/Developer pnpm dev
```

If an installed Tarmac already runs on 7777, pick another port for the API: `TARMAC_PORT=7790 pnpm dev` (the Vite
proxy follows it). `DATA_DIR` keeps your development data apart from `~/.tarmac`.

To install the clone as your Tarmac service (instead of the npm package):

```bash
./scripts/install.sh --dry-run    # see what it would do
./scripts/install.sh              # pnpm install, pnpm build, then tarmac setup
pnpm tarmac status                # or: node dist/cli/tarmac.js <command>
```

After pulling changes: `pnpm install && pnpm build && pnpm tarmac restart`.

## Checks

```bash
pnpm typecheck
DATA_DIR=$(mktemp -d) pnpm test     # node:test + tsx; DATA_DIR keeps tests away from ~/.tarmac
pnpm build                          # vite (web) + tsup (server, MCP server, CLI) into dist/
```

The CI runs the same steps on macOS. CLI tests never touch the real machine: they use a temporary home folder,
temporary system paths and a fake command runner (`cli/cli.test.ts`). Keep it that way: no test may call
`launchctl`, `sudo` or write outside a temporary folder.

## Layout

| Folder | Content |
|---|---|
| `server/` | Fastify API, scanner, process and console management, Git, GitHub, Supabase, Claude sessions, Claude Todolist (`server/suivi/`, MCP server in `mcp.ts`) |
| `web/` | React UI (Vite, Tailwind CSS, TanStack Query, xterm.js) |
| `cli/` | The `tarmac` command (setup, update, uninstall, service, doctor) |
| `claude/` | `/suivi` skill, SessionStart hook and CLAUDE.md rule installed by the Claude Code integration |
| `templates/` | Claude Todolist artifact page |
| `scripts/` | Contributor scripts (install from a clone) and the Claude integration scripts used by `tarmac setup` |
| `brand/` | Logo and icons |
| `docs/` | User documentation |

## Commits and pull requests

- Commit messages follow `type(scope): summary` (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`), e.g.
  `fix(cli): keep the existing port on setup`. One logical change per commit.
- Pull requests: describe the problem and the change, add tests when behavior changes, and update the docs
  (`README.md`, `README.fr.md`, `docs/`) and `CHANGELOG.md` when users would notice.
- Do not commit personal paths, tokens, project names or screenshots showing private data.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) and you agree to
follow the [Code of Conduct](CODE_OF_CONDUCT.md).
