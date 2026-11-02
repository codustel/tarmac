/**
 * Analyse des arguments de la CLI `tarmac` (sans dépendance) : commande, options booléennes et `--domain`.
 */

export const COMMANDS = ['setup', 'update', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs', 'open', 'doctor', 'help', 'version'] as const;
export type Command = (typeof COMMANDS)[number];

export interface Flags {
  dryRun: boolean;
  domain?: string;
  noSudo: boolean;
  withClaude: boolean;
  noClaude: boolean;
  yes: boolean;
  noOpen: boolean;
  purge: boolean;
}

export interface Parsed {
  command: Command;
  flags: Flags;
  error?: string;
}

/** Options acceptées par commande (les autres sont refusées). */
const ALLOWED: Partial<Record<Command, (keyof Flags)[]>> = {
  setup: ['dryRun', 'domain', 'noSudo', 'withClaude', 'noClaude', 'yes', 'noOpen'],
  uninstall: ['dryRun', 'purge', 'noSudo', 'yes'],
  update: ['dryRun'],
};

const BOOL: Record<string, keyof Flags> = {
  '--dry-run': 'dryRun',
  '--no-sudo': 'noSudo',
  '--with-claude': 'withClaude',
  '--no-claude': 'noClaude',
  '--yes': 'yes',
  '-y': 'yes',
  '--no-open': 'noOpen',
  '--purge': 'purge',
};

/** Nom de domaine local : lettres, chiffres, tirets, au moins un point (ex. tarmac.localhost). */
export const isValidDomain = (d: string) => /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(d);

export function parseArgs(argv: string[]): Parsed {
  const flags: Flags = { dryRun: false, noSudo: false, withClaude: false, noClaude: false, yes: false, noOpen: false, purge: false };
  const seen = new Set<keyof Flags>();
  let command: Command | undefined;
  const fail = (error: string): Parsed => ({ command: command ?? 'help', flags, error });

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { command: 'help', flags };
    if (a === '--version' || a === '-v' || a === '-V') return { command: 'version', flags };
    if (a === '--domain' || a.startsWith('--domain=')) {
      const value = a === '--domain' ? argv[++i] : a.slice('--domain='.length);
      if (!value || value.startsWith('-')) return fail('--domain needs a value, e.g. --domain tarmac.localhost');
      if (!isValidDomain(value)) return fail(`Invalid domain: ${value}`);
      flags.domain = value.toLowerCase();
      seen.add('domain');
      continue;
    }
    if (a in BOOL) {
      (flags[BOOL[a]] as boolean) = true;
      seen.add(BOOL[a]);
      continue;
    }
    if (a.startsWith('-')) return fail(`Unknown option: ${a}`);
    if (command) return fail(`Unexpected argument: ${a}`);
    if (!(COMMANDS as readonly string[]).includes(a)) return fail(`Unknown command: ${a}`);
    command = a as Command;
  }

  command ??= 'help';
  const allowed = ALLOWED[command] ?? [];
  const extra = [...seen].find((f) => !allowed.includes(f));
  if (extra) return fail(`Option not supported by "${command}": ${optionName(extra)}`);
  if (flags.withClaude && flags.noClaude) return fail('--with-claude and --no-claude cannot be used together');
  return { command, flags };
}

function optionName(flag: keyof Flags): string {
  if (flag === 'domain') return '--domain';
  return Object.entries(BOOL).find(([, f]) => f === flag)?.[0] ?? flag;
}

export const HELP = `Tarmac — the local runway for your projects and your Claude Code sessions

Usage: tarmac <command> [options]

Commands:
  setup        Install Tarmac as a macOS login service and open it in the browser
  update       Update Tarmac (npm install -g @codustel/tarmac@latest) and restart it
  uninstall    Remove the service, the local domain and the port 80 redirect
  start        Start the service
  stop         Stop the service
  restart      Restart the service
  status       Show whether the service is running and where
  logs         Follow the service log
  open         Open Tarmac in the browser
  doctor       Check Node, the service, the port, the domain, gh, Docker and Claude Code

Options for setup:
  --dry-run        Print every action without changing anything
  --domain <name>  Local domain (default: tarmac.localhost)
  --no-sudo        Skip the steps that need administrator rights (/etc/hosts, port 80 redirect);
                   Tarmac stays reachable on http://tarmac.localhost:7777
  --with-claude    Set up the Claude Code integration without asking
  --no-claude      Do not set up the Claude Code integration
  --no-open        Do not open the browser at the end
  -y, --yes        Answer yes to every question

Options for uninstall:
  --purge          Also delete ~/.tarmac (settings, history, Todolist database)
  --dry-run, --no-sudo, --yes   As for setup

Other options:
  -h, --help       Show this help
  -v, --version    Show the version

Docs: https://github.com/codustel/tarmac#readme`;
