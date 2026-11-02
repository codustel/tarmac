# Security policy

## Supported versions

Security fixes are released for the latest `1.x` version. Update with `tarmac update`.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: on
https://github.com/codustel/tarmac, **Security → Report a vulnerability**.

Include the Tarmac version (`tarmac --version`), your macOS and Node versions, the steps to reproduce and the
impact you see. You will get an answer within a week. Once a fix is released, the advisory is published with
credit to you, unless you prefer otherwise.

## Scope

Tarmac is meant to be reachable from the local machine only (see [docs/security.md](docs/security.md)). Of
particular interest:

- a way for a website or another machine to reach Tarmac's API or WebSockets (bypassing the `Host` / `Origin`
  checks, DNS rebinding, CSRF);
- running a command outside the allowed ones through the API, or reading / writing files outside a project;
- access to the Claude Todolist API without the MCP token, or with the artifact token beyond its rights;
- `tarmac setup` / `tarmac uninstall` changing more than what they describe.

Running Tarmac on a network interface (`TARMAC_HOST=0.0.0.0`) or behind a tunnel is unsupported.
