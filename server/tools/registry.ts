// Registre des outils que Tarmac installe ou signale : données pures, aucune E/S.
// Commandes figées d'après notes/open-core/faits-cli-7.14.md ; aucune entrée utilisateur n'y est interpolée.
import path from 'node:path';

export type ToolId = 'git' | 'gh' | 'claude' | 'codex' | 'docker' | 'supabase';
export type ManagedId = 'git' | 'gh' | 'claude' | 'codex';
export const MANAGED: ManagedId[] = ['git', 'gh', 'claude', 'codex'];
export type Method = 'brew' | 'npm' | 'winget' | 'official' | 'xcode';
type Platform = 'darwin' | 'win32';

export interface ToolDef {
  id: ToolId;
  label: string;
  bin: string;
  managed: boolean;
  loginable: boolean;
  agent?: 'claude' | 'codex';
  docUrl: string;
  methods: Partial<Record<Platform, Method[]>>;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  git: { id: 'git', label: 'Git', bin: 'git', managed: true, loginable: false, docUrl: 'https://git-scm.com/downloads', methods: { darwin: ['brew', 'xcode'], win32: ['winget'] } },
  gh: { id: 'gh', label: 'GitHub CLI', bin: 'gh', managed: true, loginable: true, docUrl: 'https://cli.github.com', methods: { darwin: ['brew', 'official'], win32: ['winget', 'official'] } },
  claude: { id: 'claude', label: 'Claude Code', bin: 'claude', managed: true, loginable: true, agent: 'claude', docUrl: 'https://code.claude.com/docs/en/setup', methods: { darwin: ['brew', 'npm', 'official'], win32: ['npm', 'official'] } },
  codex: { id: 'codex', label: 'Codex', bin: 'codex', managed: true, loginable: true, agent: 'codex', docUrl: 'https://github.com/openai/codex', methods: { darwin: ['brew', 'npm', 'official'], win32: ['npm', 'official'] } },
  docker: { id: 'docker', label: 'Docker', bin: 'docker', managed: false, loginable: false, docUrl: 'https://docs.docker.com/get-started/get-docker/', methods: { darwin: [], win32: [] } },
  supabase: { id: 'supabase', label: 'Supabase CLI', bin: 'supabase', managed: false, loginable: false, docUrl: 'https://supabase.com/docs/guides/local-development/cli/getting-started', methods: { darwin: [], win32: [] } },
};

/** Dossier des binaires de release GitHub (gh « official »), avec les séparateurs de `platform` (pas ceux de l'hôte). */
export const TOOLS_BIN_DIR = (home: string, platform: NodeJS.Platform = process.platform): string =>
  (platform === 'win32' ? path.win32 : path.posix).join(home, '.tarmac', 'tools', 'bin');

const isPlatform = (p: NodeJS.Platform): p is Platform => p === 'darwin' || p === 'win32';

/** Premier moyen de la table réellement disponible ; `official` et `xcode` le sont toujours. */
export function chooseMethod(id: ManagedId, available: Set<'brew' | 'npm' | 'winget'>, platform: NodeJS.Platform): Method | null {
  if (!isPlatform(platform)) return null;
  for (const m of TOOLS[id].methods[platform] ?? []) {
    if (m === 'official' || m === 'xcode' || available.has(m)) return m;
  }
  return null;
}

// gh « official » : version lue par l'API releases/latest, zip de release, binaire copié dans ~/.tarmac/tools/bin.
const GH_OFFICIAL_DARWIN =
  'set -e; v=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | sed -n \'s/.*"tag_name": *"v\\([^"]*\\)".*/\\1/p\' | head -n 1); ' +
  '[ -n "$v" ]; case "$(uname -m)" in arm64) a=arm64;; *) a=amd64;; esac; t=$(mktemp -d); ' +
  'curl -fsSL "https://github.com/cli/cli/releases/download/v$v/gh_$v"_macOS_$a.zip -o "$t/gh.zip"; unzip -q "$t/gh.zip" -d "$t"; ' +
  'mkdir -p "$HOME/.tarmac/tools/bin"; cp "$t/gh_$v"_macOS_$a/bin/gh "$HOME/.tarmac/tools/bin/gh"; chmod +x "$HOME/.tarmac/tools/bin/gh"; rm -rf "$t"';

const GH_OFFICIAL_WIN32 =
  '$ErrorActionPreference = "Stop"; $v = (Invoke-RestMethod https://api.github.com/repos/cli/cli/releases/latest).tag_name.TrimStart("v"); ' +
  '$t = Join-Path $env:TEMP "tarmac-gh"; Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $t | Out-Null; ' +
  'Invoke-WebRequest "https://github.com/cli/cli/releases/download/v$v/gh_$($v)_windows_amd64.zip" -OutFile "$t\\gh.zip"; Expand-Archive "$t\\gh.zip" -DestinationPath $t; ' +
  '$d = Join-Path $env:USERPROFILE ".tarmac\\tools\\bin"; New-Item -ItemType Directory $d -Force | Out-Null; Copy-Item "$t\\bin\\gh.exe" "$d\\gh.exe" -Force; Remove-Item $t -Recurse -Force';

const INSTALL: Record<ManagedId, Partial<Record<Platform, Partial<Record<Method, string>>>>> = {
  git: {
    darwin: { brew: 'brew install git', xcode: 'xcode-select --install' },
    win32: { winget: 'winget install --id Git.Git -e --source winget' },
  },
  gh: {
    darwin: { brew: 'brew install gh', official: GH_OFFICIAL_DARWIN },
    win32: { winget: 'winget install --id GitHub.cli -e --source winget', official: GH_OFFICIAL_WIN32 },
  },
  claude: {
    darwin: { brew: 'brew install --cask claude-code', npm: 'npm install -g @anthropic-ai/claude-code', official: 'curl -fsSL https://claude.ai/install.sh | bash' },
    win32: { npm: 'npm install -g @anthropic-ai/claude-code', official: 'irm https://claude.ai/install.ps1 | iex' },
  },
  codex: {
    darwin: { brew: 'brew install --cask codex', npm: 'npm install -g @openai/codex', official: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' },
    // install.ps1 : commande exacte non vérifiée (faits-cli-7.14.md), à confirmer au test réel sous Windows.
    win32: { npm: 'npm install -g @openai/codex', official: 'irm https://chatgpt.com/codex/install.ps1 | iex' },
  },
};

const UPDATE: Record<ManagedId, Partial<Record<Method, string | null>>> = {
  git: { brew: 'brew upgrade git', xcode: null, winget: 'winget upgrade --id Git.Git -e --source winget' },
  gh: { brew: 'brew upgrade gh', winget: 'winget upgrade --id GitHub.cli -e --source winget' },
  claude: { brew: 'brew upgrade --cask claude-code', npm: 'npm install -g @anthropic-ai/claude-code@latest', official: 'claude update' },
  codex: { brew: 'brew upgrade --cask codex', npm: 'npm install -g @openai/codex@latest' },
};

export function installCommand(id: ManagedId, m: Method, platform: NodeJS.Platform): string {
  const cmd = isPlatform(platform) ? INSTALL[id][platform]?.[m] : undefined;
  if (!cmd) throw new Error(`Aucune commande d'installation : ${id} / ${m} / ${platform}`);
  return cmd;
}

/** Mise à jour ; `null` quand le moyen n'a pas de mise à jour propre (xcode). Les moyens `official` sans commande dédiée se réinstallent. */
export function updateCommand(id: ManagedId, m: Method, platform: NodeJS.Platform): string | null {
  const own = UPDATE[id][m];
  if (own !== undefined) return own;
  return installCommand(id, m, platform);
}

const LOGIN = { gh: 'gh auth login', claude: 'claude auth login', codex: 'codex login' } as const;
export const loginCommand = (id: 'gh' | 'claude' | 'codex'): string => LOGIN[id];

const STATUS = {
  gh: ['gh', 'auth', 'status'],
  claude: ['claude', 'auth', 'status'],
  codex: ['codex', 'login', 'status'],
} as const;
/** Argv complet (binaire en tête), lecture seule : jamais de jeton. */
export const statusCommand = (id: 'gh' | 'claude' | 'codex'): string[] => [...STATUS[id]];

export const versionArgs = (_id: ToolId): string[] => ['--version'];
