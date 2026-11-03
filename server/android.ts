import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tr } from './i18n.js';
import { demo, demoAndroid, isDemo } from './demo/index.js';

const exec = promisify(execFile);
const run = async (cmd: string, args: string[], timeout = 8000) => {
  try {
    const { stdout } = await exec(cmd, args, { timeout });
    return stdout;
  } catch {
    return null;
  }
};

// ─── Emplacements ───────────────────────────────────────────────────────────
/** SDK : variables d'environnement, sinon l'emplacement par défaut d'Android Studio. */
export function sdkDir(): string {
  for (const d of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) if (d && fs.existsSync(d)) return d;
  return path.join(os.homedir(), 'Library/Android/sdk');
}
const avdHome = () => process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android/avd');
const bin = {
  emulator: () => path.join(sdkDir(), 'emulator/emulator'),
  adb: () => path.join(sdkDir(), 'platform-tools/adb'),
  sdkmanager: () => path.join(sdkDir(), 'cmdline-tools/latest/bin/sdkmanager'),
  avdmanager: () => path.join(sdkDir(), 'cmdline-tools/latest/bin/avdmanager'),
};
const exists = (p: string) => fs.existsSync(p);

/** JDK 17 (Temurin) : Gradle / `expo run:android` en ont besoin. */
let javaHome17: string | null = null;
async function findJdk17() {
  const out = await run('/usr/libexec/java_home', ['-v', '17'], 5000);
  javaHome17 = out?.trim() || null;
  if (!javaHome17) {
    const temurin = '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home';
    if (exists(temurin)) javaHome17 = temurin;
  }
  return javaHome17;
}

/**
 * Injecte ANDROID_HOME, JAVA_HOME et les outils du SDK dans l'environnement de Tarmac : apps, consoles
 * et commandes lancées depuis Tarmac en héritent, sans toucher au .zshrc.
 */
export async function applyAndroidEnv() {
  if (isDemo()) return; // mode démo : SDK et émulateurs factices
  const sdk = sdkDir();
  if (exists(sdk)) {
    process.env.ANDROID_HOME = sdk;
    const dirs = ['platform-tools', 'emulator', 'cmdline-tools/latest/bin'].map((d) => path.join(sdk, d)).filter(exists);
    const current = (process.env.PATH ?? '').split(':');
    process.env.PATH = [...dirs.filter((d) => !current.includes(d)), ...current].join(':');
  }
  const jdk = await findJdk17();
  const cur = process.env.JAVA_HOME;
  if (jdk && (!cur || !exists(cur))) process.env.JAVA_HOME = jdk;
}

// ─── Diagnostic ─────────────────────────────────────────────────────────────
export interface AndroidCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Commande d'installation proposée (exécutable via /api/android/install). */
  install: string | null;
  /** Prérequis manquants pour lancer l'installation. */
  blockedBy: string[];
  optional?: boolean;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const abi = () => (process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64');
const DEFAULT_IMAGE = () => `system-images;android-36;google_apis_playstore;${abi()}`;
const CMDLINE_TOOLS_URL = 'https://dl.google.com/android/repository/commandlinetools-mac-14742923_latest.zip';

function installCommands(): Record<string, string> {
  const sdk = q(sdkDir());
  const sdkm = `${q(bin.sdkmanager())} --sdk_root=${sdk}`;
  const tmp = '"$(mktemp -d)"';
  return {
    brew: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    jdk: 'brew install --cask temurin@17',
    cmdline: `T=${tmp} && curl -fL -o "$T/tools.zip" ${CMDLINE_TOOLS_URL} && unzip -q "$T/tools.zip" -d "$T" && mkdir -p ${sdk}/cmdline-tools && rm -rf ${sdk}/cmdline-tools/latest && mv "$T/cmdline-tools" ${sdk}/cmdline-tools/latest && rm -rf "$T"`,
    'platform-tools': `yes | ${sdkm} --licenses > /dev/null; ${sdkm} platform-tools`,
    emulator: `yes | ${sdkm} --licenses > /dev/null; ${sdkm} emulator`,
    avd: `yes | ${sdkm} --licenses > /dev/null; ${sdkm} ${q(DEFAULT_IMAGE())} && echo no | ${q(bin.avdmanager())} create avd -n Pixel_API_36 -k ${q(DEFAULT_IMAGE())} -d pixel_7`,
  };
}

/** `detail` null : accélération disponible sans ligne explicite (libellé traduit au moment du diagnostic). */
let accel: { ok: boolean; detail: string | null } | null = null;
async function checkAccel() {
  if (accel || !exists(bin.emulator())) return accel;
  try {
    const { stdout } = await exec(bin.emulator(), ['-accel-check'], { timeout: 15000 });
    accel = { ok: true, detail: stdout.split('\n').find((l) => /Hypervisor|HAXM|KVM|WHPX|AEHD/i.test(l))?.trim() ?? null };
  } catch (e: any) {
    accel = { ok: false, detail: String(e.stdout ?? e.message).trim().split('\n').slice(-1)[0] };
  }
  return accel;
}

async function checks(avdCount: number): Promise<AndroidCheck[]> {
  const cmds = installCommands();
  const brew = (await run('brew', ['--version'], 5000)) !== null;
  const jdk = await findJdk17();
  const has = { cmdline: exists(bin.sdkmanager()), adb: exists(bin.adb()), emulator: exists(bin.emulator()) };
  const acc = await checkAccel();
  const sdkTools = [...(jdk ? [] : ['jdk']), ...(has.cmdline ? [] : ['cmdline'])];
  const list: AndroidCheck[] = [
    { id: 'brew', label: 'Homebrew', ok: brew, detail: brew ? tr({ en: 'Installed', fr: 'Installé' }) : tr({ en: 'Required to install the JDK', fr: 'Requis pour installer le JDK' }), install: cmds.brew, blockedBy: [] },
    { id: 'jdk', label: 'JDK 17 (Temurin)', ok: !!jdk, detail: jdk ?? tr({ en: 'Required by Gradle (expo run:android) and sdkmanager', fr: 'Requis par Gradle (expo run:android) et sdkmanager' }), install: cmds.jdk, blockedBy: brew ? [] : ['brew'] },
    { id: 'cmdline', label: 'Android cmdline-tools', ok: has.cmdline, detail: has.cmdline ? bin.sdkmanager() : tr({ en: 'sdkmanager / avdmanager: installs SDK components', fr: 'sdkmanager / avdmanager : installation des composants du SDK' }), install: cmds.cmdline, blockedBy: [] },
    { id: 'platform-tools', label: 'platform-tools (adb)', ok: has.adb, detail: has.adb ? bin.adb() : tr({ en: 'Talks to the emulator', fr: 'Communication avec l’émulateur' }), install: cmds['platform-tools'], blockedBy: sdkTools },
    { id: 'emulator', label: tr({ en: 'Android emulator', fr: 'Émulateur Android' }), ok: has.emulator, detail: has.emulator ? bin.emulator() : tr({ en: 'Emulator engine', fr: 'Moteur de l’émulateur' }), install: cmds.emulator, blockedBy: sdkTools },
    {
      id: 'avd',
      label: tr({ en: 'Virtual device (AVD)', fr: 'Appareil virtuel (AVD)' }),
      ok: avdCount > 0,
      detail: avdCount > 0
        ? tr(avdCount > 1 ? { en: '{n} available', fr: '{n} disponibles' } : { en: '{n} available', fr: '{n} disponible' }, { n: avdCount })
        : tr({ en: 'No AVD — creates a Pixel 7 ({image})', fr: 'Aucun AVD — création d’un Pixel 7 ({image})' }, { image: DEFAULT_IMAGE() }),
      install: cmds.avd,
      blockedBy: sdkTools,
    },
  ];
  if (acc) list.push({ id: 'accel', label: tr({ en: 'Hardware acceleration', fr: 'Accélération matérielle' }), ok: acc.ok, detail: acc.detail ?? tr({ en: 'Available', fr: 'Disponible' }), install: null, blockedBy: [] });
  return list.map((c) => ({ ...c, install: c.ok ? null : c.install }));
}

/** Commande d'installation par identifiant (jamais une commande fournie par le client). */
export function installCommand(id: string): string | null {
  const image = id.match(/^image:(system-images;[\w.-]+;[\w.-]+;[\w.-]+)$/)?.[1];
  if (image) return `yes | ${q(bin.sdkmanager())} --sdk_root=${q(sdkDir())} --licenses > /dev/null; ${q(bin.sdkmanager())} --sdk_root=${q(sdkDir())} ${q(image)}`;
  return installCommands()[id] ?? null;
}

// ─── Appareils virtuels ─────────────────────────────────────────────────────
export type AvdState = 'stopped' | 'starting' | 'booting' | 'ready' | 'stopping';
export interface Avd {
  name: string;
  device: string | null;
  api: string | null;
  image: string | null;
  /** Image système absente du SDK : l'AVD ne peut pas démarrer. */
  missingImage: string | null;
  state: AvdState;
  serial: string | null;
  pid: number | null;
  error: string | null;
}

const readIni = (file: string): Record<string, string> => {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, 'utf8').split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]),
    );
  } catch {
    return {};
  }
};

function avdDir(name: string) {
  const ini = readIni(path.join(avdHome(), `${name}.ini`));
  return ini.path && exists(ini.path) ? ini.path : path.join(avdHome(), `${name}.avd`);
}

function listAvdNames(): string[] {
  try {
    return fs.readdirSync(avdHome()).filter((f) => f.endsWith('.ini')).map((f) => f.slice(0, -4)).filter((n) => exists(avdDir(n))).sort();
  } catch {
    return [];
  }
}

/** Process émulateur en cours (lancés par Tarmac ou par Android Studio) : nom d'AVD → pid. */
async function emulatorProcesses() {
  const out = (await run('ps', ['-Ao', 'pid=,args='])) ?? '';
  const map = new Map<string, number>();
  for (const line of out.split('\n')) {
    if (!/qemu-system|\/emulator\b/.test(line)) continue;
    const m = line.match(/^\s*(\d+)\s.*?(?:\s-avd\s+|\s@)(\S+)/);
    if (m) map.set(m[2], Number(m[1]));
  }
  return map;
}

/** Émulateurs vus par adb : nom d'AVD → { serial, prêt }. */
async function adbEmulators() {
  const map = new Map<string, { serial: string; ready: boolean }>();
  if (!exists(bin.adb())) return map;
  const out = (await run(bin.adb(), ['devices'])) ?? '';
  const serials = [...out.matchAll(/^(emulator-\d+)\s+(\w+)/gm)];
  await Promise.all(serials.map(async ([, serial, st]) => {
    const name = (await run(bin.adb(), ['-s', serial, 'emu', 'avd', 'name'], 4000))?.split('\n')[0]?.trim();
    if (!name) return;
    const booted = st === 'device' ? (await run(bin.adb(), ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], 4000))?.trim() === '1' : false;
    map.set(name, { serial, ready: booted });
  }));
  return map;
}

/**
 * Dernière erreur de lancement par AVD (process sorti prématurément) ; arrêts demandés. Lignes du journal
 * de l'émulateur, ou code de sortie traduit à la lecture (langue de la requête qui l'affiche).
 */
const errors = new Map<string, string | { code: number | null }>();
const errorText = (name: string, e: string | { code: number | null }) =>
  typeof e === 'string' ? e : tr({ en: 'The emulator stopped (code {code}) — log: {log}', fr: 'L’émulateur s’est arrêté (code {code}) — journal : {log}' }, { code: String(e.code), log: logFile(name) });
const stopping = new Set<string>(); // affichage « Arrêt… »
const killed = new Set<string>();
const booted = new Set<string>(); // a atteint l'état « prêt » depuis son lancement // arrêt demandé : la sortie de l'émulateur n'est pas une erreur
const logFile = (name: string) => path.join(os.tmpdir(), `tarmac-emulator-${name}.log`);

export async function listAvds(): Promise<Avd[]> {
  const [procs, adb] = await Promise.all([emulatorProcesses(), adbEmulators()]);
  return listAvdNames().map((name) => {
    const cfg = readIni(path.join(avdDir(name), 'config.ini'));
    const sysdir = cfg['image.sysdir.1'] ?? null;
    const missingImage = sysdir && !exists(path.join(sdkDir(), sysdir)) ? sysdir.replace(/\/$/, '').replaceAll('/', ';') : null;
    const a = adb.get(name);
    const pid = procs.get(name) ?? null;
    if (!a && !pid) stopping.delete(name);
    if (a?.ready) booted.add(name);
    const state: AvdState = !a && !pid ? 'stopped' : stopping.has(name) ? 'stopping' : a ? (a.ready ? 'ready' : 'booting') : 'starting';
    return {
      name,
      device: cfg['hw.device.name'] ?? null,
      api: sysdir?.match(/android-(\d+)/)?.[1] ?? null,
      image: cfg['tag.display'] ?? cfg['tag.id'] ?? null,
      missingImage,
      state,
      serial: a?.serial ?? null,
      pid,
      error: state === 'stopped' && errors.has(name) ? errorText(name, errors.get(name)!) : null,
    };
  });
}

export async function androidStatus() {
  const d = demo();
  if (d) return demoAndroid(d);
  await applyAndroidEnv(); // un outil vient peut-être d'être installé
  const avds = await listAvds();
  return { sdk: sdkDir(), sdkExists: exists(sdkDir()), checks: await checks(avds.length), avds };
}

export const isAvd = (name: string) => listAvdNames().includes(name);

/** Démarre un AVD hors de Tarmac (survit à son redémarrage). `cold` : ignore le snapshot. */
export async function startAvd(name: string, cold = false) {
  if (!exists(bin.emulator())) throw new Error(tr({ en: 'Emulator not installed (see the diagnostics)', fr: 'Émulateur non installé (voir le diagnostic)' }));
  const procs = await emulatorProcesses();
  if (procs.has(name)) return;
  // Verrous laissés par un émulateur planté : sinon « Running multiple emulators with the same AVD ».
  const dir = avdDir(name);
  for (const f of ['hardware-qemu.ini.lock', 'multiinstance.lock', 'snapshot.lock']) fs.rmSync(path.join(dir, f), { force: true, recursive: true });

  errors.delete(name);
  killed.delete(name);
  booted.delete(name);
  const out = fs.openSync(logFile(name), 'w');
  const args = ['-avd', name, ...(cold ? ['-no-snapshot-load'] : [])];
  const child = spawn(bin.emulator(), args, { detached: true, stdio: ['ignore', out, out], env: process.env });
  fs.closeSync(out);
  const startedAt = Date.now();
  // Seul un échec au lancement est une erreur : une fois démarré, l'émulateur peut être fermé par sa
  // fenêtre ou par le bouton Arrêter (code non nul, lignes « ERROR » de fin de session sans gravité).
  child.on('exit', (code) => {
    const wasBooted = booted.delete(name);
    if (killed.delete(name) || wasBooted || Date.now() - startedAt > 60_000) return;
    let log: string[] = [];
    try { log = fs.readFileSync(logFile(name), 'utf8').split('\n').filter((l) => /ERROR|FATAL|PANIC/.test(l)); } catch { /* journal absent */ }
    errors.set(name, log.slice(-3).join('\n') || { code });
  });
  child.unref();
}

export async function stopAvd(name: string) {
  const avd = (await listAvds()).find((a) => a.name === name);
  if (!avd || avd.state === 'stopped') return;
  stopping.add(name);
  killed.add(name);
  errors.delete(name);
  if (avd.serial && (await run(bin.adb(), ['-s', avd.serial, 'emu', 'kill'], 5000)) !== null) return;
  if (avd.pid) process.kill(avd.pid, 'SIGTERM');
}

/**
 * Appareil cible pour un projet mobile : un émulateur déjà lancé, sinon démarrage du premier AVD.
 * Retourne le nom de l'AVD utilisé.
 */
export async function ensureEmulator(): Promise<string> {
  const avds = await listAvds();
  const running = avds.find((a) => a.state === 'ready') ?? avds.find((a) => a.state !== 'stopped');
  if (running) return running.name;
  const first = avds.find((a) => !a.missingImage);
  if (!first) throw new Error(tr({ en: 'No usable Android emulator — see the Android tab', fr: 'Aucun émulateur Android utilisable — voir l’onglet Android' }));
  await startAvd(first.name);
  return first.name;
}

/** Préfixe shell : attend la fin du démarrage d'Android avant de lancer la commande. */
export function waitForBootCommand() {
  const adb = q(bin.adb());
  // Textes sans « " », « $ » ni « ` » : insérés tels quels entre guillemets doubles.
  const waiting = tr({ en: 'Waiting for the emulator to boot…', fr: 'Attente du démarrage de l’émulateur…' });
  const ready = tr({ en: 'Emulator ready.', fr: 'Émulateur prêt.' });
  return `echo "${waiting}" && ${adb} wait-for-device && until [ "$(${adb} shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r')" = 1 ]; do sleep 1; done && echo "${ready}"`;
}
