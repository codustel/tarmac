/**
 * `tarmac setup` : fichier `env`, LaunchAgent, domaine local, redirection du port 80 (pf), migration depuis
 * App Manager et intégration Claude Code. Même logique depuis le paquet npm installé et depuis un clone
 * (`scripts/install.sh` construit puis appelle cette commande).
 */
import fs from 'node:fs';
import path from 'node:path';
import { asideName, migrateDataDir, replaceStaleDataDir, staleDataDir } from '../server/dataDir.js';
import {
  ALIAS_DOMAIN, DEFAULT_PORT, DEV_MANAGER_LABEL, c, LABEL, OLD_DOMAINS, OLD_LABEL,
  readEnv, tilde, which, type Ctx, type Runner,
} from './context.js';
import type { Action, Runtime, Step } from './plan.js';
import { planCodexSetup } from './codex.js';

export interface SetupOptions {
  domain: string;
  /** Étapes avec sudo (/etc/hosts, retrait ou pose de pf) incluses. */
  sudo: boolean;
  /**
   * Redirection du port 80 (pf) demandée (`--port-80`). Sans elle, une redirection déjà posée est retirée :
   * sur certains Mac, la règle `rdr` sur lo0 coupe le port direct après un redémarrage (4.11a).
   */
  port80?: boolean;
  /** Intégration Claude Code (serveur MCP, skill, hook, règle). */
  claude: boolean;
  /** Déclaration du serveur MCP dans Claude desktop aussi (attend que l'app soit fermée). */
  claudeDesktop: boolean;
  /** Intégration Codex (serveur MCP, règle AGENTS.md, skill, hook) : Codex installé ou coché dans les réglages. */
  codex?: boolean;
  open: boolean;
  /**
   * `~/.tarmac` existe mais `~/.app-manager` est plus récent : le mettre de côté (`~/.tarmac.old-…`) puis copier
   * `~/.app-manager` (sur confirmation, ou --yes). Sans cette option, `~/.tarmac` est gardé tel quel.
   */
  replaceStale?: boolean;
}

/** Dossiers de code usuels, comme le serveur (premier démarrage) ; sinon ~/Documents. */
export const COMMON_ROOTS = ['Developer', 'Projects', 'projects', 'dev', '_dev', 'code', 'src', 'Documents/GitHub'];
export function detectDevRoots(home: string): string {
  const roots: string[] = [];
  for (const d of COMMON_ROOTS) {
    const p = path.join(home, d);
    if (!fs.existsSync(p)) continue;
    // ~/Projects et ~/projects : même dossier sur un disque insensible à la casse.
    const real = fs.realpathSync(p);
    if (!roots.includes(real)) roots.push(real);
  }
  return roots.length ? roots.join(',') : path.join(home, 'Documents');
}

export function envFileContent(ctx: Ctx, o: { port: number; url: string; devRoots: string }): string {
  return `# Tarmac configuration — reloaded every time the service starts.
# Folders scanned by default (can be changed later in Settings)
DEV_ROOTS=${o.devRoots}
TARMAC_HOST=127.0.0.1
TARMAC_PORT=${o.port}
TARMAC_URL=${o.url}
# Port range assigned to apps (avoids the usual 3000/5173/54321-54329)
PORT_RANGE=4100-4999
SCAN_MAX_DEPTH=6
SCAN_INTERVAL_S=120
GIT_FETCH_INTERVAL_MIN=15
# PATH captured at setup time (nvm, fnm, Homebrew, pnpm, bun…) to run apps as in your terminal
PATH="${ctx.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'}"
# Optional: otherwise the \`gh\` CLI token is used
# GITHUB_TOKEN=github_pat_xxx
`;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** LaunchAgent : shell de login pour hériter du PATH, puis `env` chargé, puis le serveur de ce paquet. */
export function plistContent(ctx: Ctx): string {
  const cmd = `set -a; source "${ctx.envFile}"; set +a; exec node "${ctx.serverJs}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>${xml(cmd)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(ctx.appDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(ctx.logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(ctx.logFile)}</string>
</dict>
</plist>
`;
}

export const pfRule = (port: number) => `rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port ${port}\n`;

export function pfDaemonContent(ctx: Ctx): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}.pf</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>-c</string><string>/sbin/pfctl -E; /sbin/pfctl -a com.apple/${LABEL} -f ${ctx.pfAnchor}</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`;
}

const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const esc = (s: string) => s.replace(/\./g, '\\.');
/** Ligne `127.0.0.1 <hôte>` présente dans /etc/hosts. */
export const hostsHas = (hosts: string, host: string, ip = '127\\.0\\.0\\.1') => new RegExp(`^${ip}[ \\t]+${esc(host)}[ \\t]*$`, 'm').test(hosts);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const loaded = (rt: Runtime, label: string) => rt.runner.capture(['launchctl', 'print', `gui/${rt.ctx.uid}/${label}`]) !== null;
async function waitUnloaded(rt: Runtime, label: string) {
  for (let i = 0; i < 40 && loaded(rt, label); i++) await sleep(250);
}

/** Port retenu : celui du fichier `env` existant (ou de l'ancienne installation), 7777 s'il est < 1024. */
export function choosePort(ctx: Ctx, migrating: boolean): number {
  const e = readEnv(migrating ? path.join(ctx.oldDataDir, 'env') : ctx.envFile);
  const p = Number(e.TARMAC_PORT ?? e.MANAGER_PORT ?? DEFAULT_PORT) || DEFAULT_PORT;
  return p < 1024 ? DEFAULT_PORT : p;
}

export function planSetup(ctx: Ctx, o: SetupOptions, runner: Runner): Step[] {
  const steps: Step[] = [];
  const uid = ctx.uid;
  const hosts = read(ctx.hostsFile);

  // 0. Anciennes installations : Dev Manager (très ancien nom), puis App Manager.
  if (fs.existsSync(ctx.devManagerPlist)) {
    steps.push({
      id: 'legacy-dev-manager',
      title: `Remove the old ${DEV_MANAGER_LABEL} service (~/.dev-manager is kept)`,
      actions: [
        { kind: 'exec', argv: ['launchctl', 'bootout', `gui/${uid}/${DEV_MANAGER_LABEL}`], allowFail: true },
        { kind: 'remove', path: ctx.devManagerPlist },
      ],
    });
  }
  const oldService = fs.existsSync(ctx.oldPlist) || runner.capture(['launchctl', 'print', `gui/${uid}/${OLD_LABEL}`]) !== null;
  if (oldService) {
    steps.push({
      id: 'legacy-service',
      title: `Stop and remove the App Manager service (${OLD_LABEL})`,
      actions: [
        { kind: 'exec', argv: ['launchctl', 'bootout', `gui/${uid}/${OLD_LABEL}`], allowFail: true },
        { kind: 'task', label: `wait until ${OLD_LABEL} is unloaded`, run: (rt) => waitUnloaded(rt, OLD_LABEL) },
        { kind: 'remove', path: ctx.oldPlist },
      ],
    });
  }
  // ~/.tarmac déjà là mais périmé (copie faite avant le dernier usage d'App Manager) : mis de côté, jamais supprimé.
  const replacing = !!o.replaceStale && !ctx.env.DATA_DIR && staleDataDir(ctx.dataDir, ctx.oldDataDir) !== null;
  if (replacing) {
    const aside = asideName(ctx.dataDir);
    steps.push({
      id: 'replace-stale-data',
      title: `Move the outdated ${tilde(ctx, ctx.dataDir)} aside to ${tilde(ctx, aside)}, then copy App Manager data `
        + `${tilde(ctx, ctx.oldDataDir)} → ${tilde(ctx, ctx.dataDir)} (nothing is deleted)`,
      actions: [
        { kind: 'exec', argv: ['launchctl', 'bootout', `gui/${uid}/${LABEL}`], allowFail: true },
        { kind: 'task', label: `wait until ${LABEL} is unloaded (it may use ${tilde(ctx, ctx.dataDir)})`, run: (rt) => waitUnloaded(rt, LABEL) },
        {
          kind: 'task',
          label: `rename ${tilde(ctx, ctx.dataDir)} → ${tilde(ctx, aside)}, then copy ${tilde(ctx, ctx.oldDataDir)} (without manager.log; in env: MANAGER_* → TARMAC_*)`,
          run: () => { replaceStaleDataDir(ctx.dataDir, ctx.oldDataDir, aside); },
        },
      ],
    });
  }
  const migrating = replacing || (!ctx.env.DATA_DIR && !fs.existsSync(ctx.dataDir) && fs.existsSync(ctx.oldDataDir));
  if (migrating && !replacing) {
    steps.push({
      id: 'migrate-data',
      title: `Copy App Manager data: ${tilde(ctx, ctx.oldDataDir)} → ${tilde(ctx, ctx.dataDir)} (the original is kept)`,
      actions: [{
        kind: 'task',
        label: 'copy the folder (without manager.log); in env: MANAGER_* → TARMAC_*, manager.* → tarmac.*',
        run: () => { migrateDataDir(ctx.dataDir, ctx.oldDataDir); },
      }],
    });
  }

  // 1. Fichier d'environnement (jamais écrasé ; un port < 1024 est remplacé par 7777).
  const port = choosePort(ctx, migrating);
  const envExists = fs.existsSync(ctx.envFile) || (migrating && fs.existsSync(path.join(ctx.oldDataDir, 'env')));
  if (!envExists) {
    // Adresse sans port seulement avec la redirection du port 80 (--port-80) ; vérifiée à la fin du setup.
    const url = o.sudo && o.port80 ? `http://${o.domain}` : `http://${o.domain}:${port}`;
    steps.push({
      id: 'env',
      title: `Create the configuration ${tilde(ctx, ctx.envFile)}`,
      actions: [{ kind: 'write', path: ctx.envFile, content: envFileContent(ctx, { port, url, devRoots: detectDevRoots(ctx.home) }), mode: 0o600 }],
    });
  } else {
    steps.push({
      id: 'env',
      title: `Keep the existing configuration ${tilde(ctx, ctx.envFile)}`,
      actions: [{
        kind: 'task',
        label: `check TARMAC_PORT (a port below 1024 is replaced by ${DEFAULT_PORT})`,
        run: (rt) => {
          const text = read(ctx.envFile);
          const fixed = text.replace(/^((?:export\s+)?)(?:TARMAC|MANAGER)_PORT=(\d+)[ \t]*$/m, (line, pre, p) => (Number(p) < 1024 ? `${pre}TARMAC_PORT=${DEFAULT_PORT}` : line));
          if (fixed !== text) {
            fs.writeFileSync(ctx.envFile, fixed, { mode: 0o600 });
            rt.out.log(`! TARMAC_PORT below 1024 is not allowed on 127.0.0.1 → ${DEFAULT_PORT}`);
          }
        },
      }],
    });
  }

  // 2. LaunchAgent (démarrage à la connexion, relance en cas de plantage).
  steps.push({
    id: 'launch-agent',
    title: `Install the login service ${tilde(ctx, ctx.plist)} and start it`,
    actions: [
      { kind: 'write', path: ctx.plist, content: plistContent(ctx) },
      { kind: 'write', path: ctx.logFile, content: '' },
      { kind: 'exec', argv: ['launchctl', 'bootout', `gui/${uid}/${LABEL}`], allowFail: true },
      { kind: 'task', label: `wait until ${LABEL} is unloaded (bootout is asynchronous)`, run: (rt) => waitUnloaded(rt, LABEL) },
      {
        kind: 'task',
        label: `$ launchctl bootstrap gui/${uid} ${tilde(ctx, ctx.plist)}  (3 tries, then launchctl kickstart -k)`,
        run: async (rt) => {
          for (let i = 0; i < 3; i++) {
            if (rt.runner.capture(['launchctl', 'bootstrap', `gui/${uid}`, ctx.plist]) !== null) return;
            await sleep(1000);
          }
          if (rt.runner.capture(['launchctl', 'kickstart', '-k', `gui/${uid}/${LABEL}`]) !== null) return;
          throw new Error(`Could not load the service (${LABEL}). Try: launchctl bootstrap gui/${uid} "${ctx.plist}"`);
        },
      },
    ],
  });

  // 3. Réseau de l'ancienne installation (sudo) : redirection pf, LaunchDaemon, domaines manager.*.
  const oldHosts = OLD_DOMAINS.filter((h) => hostsHas(hosts, h) || hostsHas(hosts, h, '::1'));
  if (o.sudo && (fs.existsSync(ctx.oldPfDaemon) || fs.existsSync(ctx.oldPfAnchor) || oldHosts.length)) {
    steps.push({
      id: 'legacy-network',
      title: `Remove App Manager's port 80 redirect and domains (${OLD_DOMAINS.join(', ')})`,
      sudo: true,
      actions: [
        { kind: 'exec', argv: ['sudo', 'launchctl', 'bootout', `system/${OLD_LABEL}.pf`], allowFail: true },
        { kind: 'exec', argv: ['sudo', 'pfctl', '-a', `com.apple/${OLD_LABEL}`, '-F', 'all'], allowFail: true },
        { kind: 'exec', argv: ['sudo', 'rm', '-f', ctx.oldPfDaemon, ctx.oldPfAnchor] },
        ...oldHosts.map((h): Action => ({ kind: 'exec', argv: ['sudo', 'sed', '-i', '', '-E', `/^(127\\.0\\.0\\.1|::1)[[:space:]]+${esc(h)}[[:space:]]*$/d`, ctx.hostsFile] })),
      ],
    });
  }

  // 4. Domaine local dans /etc/hosts (sudo). *.localhost se résout déjà vers la boucle locale ; l'entrée force
  //    l'IPv4 (la redirection pf et le serveur sont en 127.0.0.1) et ajoute l'alias tarmac.test.
  if (o.sudo) {
    const missing = [o.domain, ALIAS_DOMAIN].filter((h) => !hostsHas(hosts, h));
    const v6 = hostsHas(hosts, o.domain, '::1');
    if (missing.length || v6) {
      steps.push({
        id: 'hosts',
        title: `Point ${[o.domain, ALIAS_DOMAIN].join(' and ')} to 127.0.0.1 in ${ctx.hostsFile}`,
        sudo: true,
        actions: [
          ...(v6 ? [{ kind: 'exec', argv: ['sudo', 'sed', '-i', '', '-E', `/^::1[[:space:]]+${esc(o.domain)}[[:space:]]*$/d`, ctx.hostsFile] } as Action] : []),
          ...(missing.length ? [{ kind: 'exec', argv: ['sudo', 'tee', '-a', ctx.hostsFile], input: missing.map((h) => `127.0.0.1\t${h}\n`).join('') } as Action] : []),
          { kind: 'exec', argv: ['sudo', 'dscacheutil', '-flushcache'], allowFail: true },
          { kind: 'exec', argv: ['sudo', 'killall', '-HUP', 'mDNSResponder'], allowFail: true },
        ],
      });
    }
  }

  // 5. Port 80 → port de Tarmac (pf), seulement avec --port-80 : un utilisateur non-root ne peut pas écouter sur
  //    le port 80, mais la règle pf peut couper le port direct après un redémarrage (4.11a). Sans l'option, une
  //    redirection déjà posée (installation précédente) est retirée.
  if (o.sudo && o.port80) {
    const anchorOk = read(ctx.pfAnchor) === pfRule(port) && fs.existsSync(ctx.pfDaemon);
    if (!anchorOk) {
      steps.push({
        id: 'pf',
        title: `Redirect port 80 to ${port} with pf (anchor com.apple/${LABEL}, reloaded at boot)`,
        sudo: true,
        when: {
          label: 'port 80 is free',
          check: (rt) => fs.existsSync(ctx.pfAnchor) || rt.runner.capture(['nc', '-z', '-G', '1', '127.0.0.1', '80'], { timeoutMs: 3000 }) === null,
        },
        otherwise: `Port 80 is already used by another service: Tarmac stays on http://${o.domain}:${port}`,
        actions: [
          { kind: 'exec', argv: ['sudo', 'tee', ctx.pfAnchor], input: pfRule(port) },
          { kind: 'exec', argv: ['sudo', 'tee', ctx.pfDaemon], input: pfDaemonContent(ctx) },
          { kind: 'exec', argv: ['sudo', 'launchctl', 'bootout', `system/${LABEL}.pf`], allowFail: true },
          { kind: 'exec', argv: ['sudo', 'launchctl', 'bootstrap', 'system', ctx.pfDaemon] },
        ],
      });
    }
  } else if (o.sudo && (fs.existsSync(ctx.pfAnchor) || fs.existsSync(ctx.pfDaemon))) {
    steps.push({
      id: 'pf',
      title: `Remove the port 80 redirect (pf): it can block port ${port} after a restart; Tarmac stays on http://${o.domain}:${port}`,
      sudo: true,
      actions: [
        { kind: 'exec', argv: ['sudo', 'launchctl', 'bootout', `system/${LABEL}.pf`], allowFail: true },
        { kind: 'exec', argv: ['sudo', 'pfctl', '-a', `com.apple/${LABEL}`, '-F', 'all'], allowFail: true },
        { kind: 'exec', argv: ['sudo', 'rm', '-f', ctx.pfDaemon, ctx.pfAnchor] },
      ],
    });
  }

  // 6. Vérification et URL finale.
  steps.push({
    id: 'start',
    title: 'Check that Tarmac answers and save its URL',
    actions: [
      {
        kind: 'task',
        label: `wait for http://127.0.0.1:${port}/api/meta (up to 30 s)`,
        run: async (rt) => {
          for (let i = 0; i < 60; i++) {
            if (await answers(`http://127.0.0.1:${port}`)) return;
            await sleep(500);
          }
          const tail = read(ctx.logFile).trimEnd().split('\n').slice(-30).join('\n');
          if (tail) rt.out.error(tail);
          throw new Error(`The service does not respond (full log: ${ctx.logFile}).`);
        },
      },
      {
        kind: 'task',
        label: `if the pf redirect is installed: check that http://127.0.0.1/api/meta (port 80) reaches Tarmac; `
          + `TARMAC_URL in ${tilde(ctx, ctx.envFile)} = http://${o.domain} if so, else http://${o.domain}:${port}`,
        run: async (rt) => {
          const r = await resolveUrl({ domain: o.domain, port, pfInstalled: fs.existsSync(ctx.pfAnchor) }, answers);
          if (r.port80 === 'not-applied') rt.out.log(`${c.yellow('!')} ${port80NotApplied(o.domain, port)}`);
          setEnvVar(ctx.envFile, 'TARMAC_URL', r.url, /^(?:TARMAC|MANAGER)_URL=/);
          finalUrl = r.url;
        },
      },
      ...(o.open ? [{ kind: 'task', label: `$ open http://${o.domain}…`, run: (rt: Runtime) => { rt.runner.run(['open', finalUrl]); } } as Action] : []),
    ],
  });

  // 7. Intégration Claude Code (sur confirmation, demandée avant l'exécution du plan).
  if (o.claude) {
    steps.push({
      id: 'claude',
      title: 'Set up the Claude Code integration: MCP server "tarmac", /suivi skill, SessionStart hook, rule in ~/.claude/CLAUDE.md',
      actions: [
        { kind: 'exec', argv: ['/bin/bash', path.join(ctx.appDir, 'scripts/mcp-install.sh'), '--code', ...(o.claudeDesktop ? ['--desktop'] : [])], allowFail: true },
        { kind: 'exec', argv: ['/bin/bash', path.join(ctx.appDir, 'scripts/suivi-install.sh')], allowFail: true },
      ],
    });
  }
  // 8. Intégration Codex (sur confirmation, comme Claude).
  if (o.codex) steps.push(planCodexSetup(ctx));
  return steps;
}

/** URL retenue par l'étape `start` (affichée à la fin de `setup`). */
export let finalUrl = '';

/** Vrai si `base` atteint bien Tarmac : `/api/meta` répond en JSON avec un `buildId` (pas une autre app). */
export async function answers(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const meta = await r.json() as Record<string, unknown> | null;
    return !!meta && typeof meta === 'object' && 'buildId' in meta;
  } catch {
    return false;
  }
}

/** État de la redirection du port 80 : active, installée mais sans effet, ou absente. */
export type Port80 = 'active' | 'not-applied' | 'none';

export const port80NotApplied = (domain: string, port: number) =>
  `The port 80 redirect is in place but macOS does not apply it: Tarmac stays on http://${domain}:${port} `
  + '(see "Port 80" in docs/troubleshooting.md).';

/**
 * URL à enregistrer : sans port seulement si la redirection pf est installée ET qu'une connexion à
 * 127.0.0.1:80 atteint réellement Tarmac ; sinon avec le port, puis 127.0.0.1 en dernier recours.
 */
export async function resolveUrl(
  o: { domain: string; port: number; pfInstalled: boolean },
  probe: (base: string) => Promise<boolean>,
): Promise<{ url: string; port80: Port80 }> {
  const port80: Port80 = !o.pfInstalled ? 'none' : (await probe('http://127.0.0.1')) ? 'active' : 'not-applied';
  const candidates = [...(port80 === 'active' ? [`http://${o.domain}`] : []), `http://${o.domain}:${o.port}`];
  for (const u of candidates) if (await probe(u)) return { url: u, port80 };
  return { url: `http://127.0.0.1:${o.port}`, port80 };
}

/** Remplace (ou ajoute) une variable du fichier `env`. */
export function setEnvVar(file: string, key: string, value: string, match = new RegExp(`^${key}=`)) {
  const lines = read(file).split('\n');
  const i = lines.findIndex((l) => match.test(l));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
}

/** Claude Code et Claude desktop présents sur ce Mac. */
export function claudePresence(ctx: Ctx) {
  return {
    code: which('claude', ctx.env) !== null,
    desktop: fs.existsSync('/Applications/Claude.app') || fs.existsSync(path.join(ctx.home, 'Applications/Claude.app')),
  };
}
