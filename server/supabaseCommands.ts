import fs from 'node:fs';
import path from 'node:path';
import { quote } from './gitCommands.js';
import { appError, type Loc } from './i18n.js';

/**
 * Catalogue des commandes Supabase CLI proposées dans les consoles (même principe que le menu git :
 * pas de commande libre via l'API, paramètres validés puis échappés). Exécutées dans le dossier
 * qui contient `supabase/config.toml`.
 */
export type SupabaseArg = 'name' | 'ref' | 'path';

export interface SupabaseCommand {
  id: string;
  group: Loc;
  label: string;
  description: Loc;
  /** `{arg}` est remplacé par le paramètre échappé. */
  cmd: string;
  arg?: SupabaseArg;
  argLabel?: Loc;
  placeholder?: string;
  /** Commande destructrice ou qui modifie le projet distant → confirmation dans l'UI. */
  danger?: boolean;
}

export const SUPABASE_COMMANDS: SupabaseCommand[] = [
  // ── Local
  { id: 'init', group: { en: 'Local', fr: 'Local' }, label: 'supabase init', cmd: 'supabase init',
    description: {
      en: 'Creates supabase/config.toml: needed for the local stack, migrations and types.',
      fr: 'Crée supabase/config.toml : nécessaire pour la stack locale, les migrations et les types.' } },
  { id: 'status', group: { en: 'Local', fr: 'Local' }, label: 'supabase status', cmd: 'supabase status',
    description: {
      en: 'Local stack state: API, Studio and database URLs, and the anon / service_role keys.',
      fr: 'État de la stack locale : URL de l’API, de Studio, de la base, et les clés anon / service_role.' } },
  { id: 'start', group: { en: 'Local', fr: 'Local' }, label: 'supabase start', cmd: 'supabase start',
    description: {
      en: 'Starts the local stack (Postgres, Auth, Storage, Studio…) in Docker. Docker must be running.',
      fr: 'Démarre la stack locale (Postgres, Auth, Storage, Studio…) dans Docker. Docker doit tourner.' } },
  { id: 'stop', group: { en: 'Local', fr: 'Local' }, label: 'supabase stop', cmd: 'supabase stop',
    description: {
      en: 'Stops the local stack and keeps the database data.',
      fr: 'Arrête la stack locale en gardant les données de la base.' } },
  { id: 'stop-no-backup', group: { en: 'Local', fr: 'Local' }, label: 'supabase stop --no-backup', cmd: 'supabase stop --no-backup', danger: true,
    description: {
      en: 'Stops the local stack and deletes its data (Docker volumes). Irreversible.',
      fr: 'Arrête la stack locale et supprime ses données (volumes Docker). Irréversible.' } },

  // ── Base de données
  { id: 'migration-list', group: { en: 'Database', fr: 'Base de données' }, label: 'supabase migration list', cmd: 'supabase migration list',
    description: {
      en: 'Compares local migrations with those applied on the linked remote project.',
      fr: 'Compare les migrations locales et celles appliquées sur le projet distant lié.' } },
  { id: 'migration-new', group: { en: 'Database', fr: 'Base de données' }, label: 'supabase migration new', cmd: 'supabase migration new {arg}', arg: 'name', argLabel: { en: 'Migration name', fr: 'Nom de la migration' }, placeholder: 'add_profiles_table',
    description: {
      en: 'Creates an empty, timestamped SQL migration file in supabase/migrations.',
      fr: 'Crée un fichier de migration SQL vide et horodaté dans supabase/migrations.' } },
  { id: 'migration-up', group: { en: 'Database', fr: 'Base de données' }, label: 'supabase migration up', cmd: 'supabase migration up',
    description: {
      en: 'Applies the migrations not yet run to the local database, without resetting it.',
      fr: 'Applique à la base locale les migrations pas encore jouées, sans la réinitialiser.' } },
  { id: 'db-diff', group: { en: 'Database', fr: 'Base de données' }, label: 'supabase db diff', cmd: 'supabase db diff',
    description: {
      en: 'Shows the SQL of changes made to the local database (through Studio…) that are not in a migration yet.',
      fr: 'Affiche le SQL des changements faits sur la base locale (via Studio…) qui ne sont pas encore dans une migration.' } },
  { id: 'db-diff-file', group: { en: 'Database', fr: 'Base de données' }, label: 'supabase db diff -f', cmd: 'supabase db diff -f {arg}', arg: 'name', argLabel: { en: 'Migration name', fr: 'Nom de la migration' }, placeholder: 'studio_changes',
    description: {
      en: 'Saves these changes into a new migration.',
      fr: 'Enregistre ces changements dans une nouvelle migration.' } },
  { id: 'db-lint', group: { en: 'Database', fr: 'Base de données' }, label: 'supabase db lint', cmd: 'supabase db lint',
    description: {
      en: 'Checks the local schema (type errors in functions, broken references…).',
      fr: 'Vérifie le schéma local (erreurs de typage dans les fonctions, références cassées…).' } },
  { id: 'db-reset', group: { en: 'Database', fr: 'Base de données' }, label: 'supabase db reset', cmd: 'supabase db reset', danger: true,
    description: {
      en: 'Recreates the local database then replays all migrations and the seed. Local data is lost.',
      fr: 'Recrée la base locale puis rejoue toutes les migrations et le seed. Les données locales sont perdues.' } },

  // ── Projet distant
  { id: 'login', group: { en: 'Remote project', fr: 'Projet distant' }, label: 'supabase login', cmd: 'supabase login',
    description: {
      en: 'Connects the CLI to your Supabase account (opens the browser).',
      fr: 'Connecte la CLI à ton compte Supabase (ouvre le navigateur).' } },
  { id: 'projects-list', group: { en: 'Remote project', fr: 'Projet distant' }, label: 'supabase projects list', cmd: 'supabase projects list',
    description: {
      en: 'Lists your Supabase projects, with their reference (for supabase link).',
      fr: 'Liste tes projets Supabase, avec leur référence (pour supabase link).' } },
  { id: 'link', group: { en: 'Remote project', fr: 'Projet distant' }, label: 'supabase link', cmd: 'supabase link --project-ref {arg}', arg: 'ref', argLabel: { en: 'Project reference', fr: 'Référence du projet' }, placeholder: 'abcdefghijklmnopqrst',
    description: {
      en: 'Links this folder to a remote project (asks for the database password).',
      fr: 'Lie ce dossier à un projet distant (demande le mot de passe de la base).' } },
  { id: 'db-push-dry', group: { en: 'Remote project', fr: 'Projet distant' }, label: 'supabase db push --dry-run', cmd: 'supabase db push --dry-run',
    description: {
      en: 'Preview: lists the migrations that would be applied to the remote project (applies nothing).',
      fr: 'Aperçu : liste les migrations qui seraient appliquées au projet distant (n’applique rien).' } },
  { id: 'db-push', group: { en: 'Remote project', fr: 'Projet distant' }, label: 'supabase db push', cmd: 'supabase db push', danger: true,
    description: {
      en: 'Applies local migrations to the linked remote project’s database (production!).',
      fr: 'Applique les migrations locales sur la base du projet distant lié (production !).' } },
  { id: 'db-pull', group: { en: 'Remote project', fr: 'Projet distant' }, label: 'supabase db pull', cmd: 'supabase db pull',
    description: {
      en: 'Creates a migration from the remote schema (changes made in the dashboard).',
      fr: 'Crée une migration à partir du schéma distant (changements faits dans le dashboard).' } },
  { id: 'secrets-list', group: { en: 'Remote project', fr: 'Projet distant' }, label: 'supabase secrets list', cmd: 'supabase secrets list',
    description: {
      en: 'Lists the edge function secrets of the remote project (names and digests, not the values).',
      fr: 'Liste les secrets des edge functions du projet distant (noms et empreintes, pas les valeurs).' } },

  // ── Edge functions
  { id: 'functions-list', group: { en: 'Edge functions', fr: 'Edge functions' }, label: 'supabase functions list', cmd: 'supabase functions list',
    description: {
      en: 'Lists the edge functions deployed on the remote project.',
      fr: 'Liste les edge functions déployées sur le projet distant.' } },
  { id: 'functions-new', group: { en: 'Edge functions', fr: 'Edge functions' }, label: 'supabase functions new', cmd: 'supabase functions new {arg}', arg: 'name', argLabel: { en: 'Function name', fr: 'Nom de la fonction' }, placeholder: 'send-email',
    description: {
      en: 'Creates an edge function (Deno) in supabase/functions.',
      fr: 'Crée une edge function (Deno) dans supabase/functions.' } },
  { id: 'functions-serve', group: { en: 'Edge functions', fr: 'Edge functions' }, label: 'supabase functions serve', cmd: 'supabase functions serve',
    description: {
      en: 'Serves edge functions locally with hot reload (local stack started).',
      fr: 'Sert les edge functions en local avec rechargement à chaud (stack locale démarrée).' } },
  { id: 'functions-deploy-one', group: { en: 'Edge functions', fr: 'Edge functions' }, label: 'supabase functions deploy <name>', cmd: 'supabase functions deploy {arg}', arg: 'name', argLabel: { en: 'Function name', fr: 'Nom de la fonction' }, placeholder: 'send-email', danger: true,
    description: {
      en: 'Deploys one edge function to the remote project.',
      fr: 'Déploie une edge function sur le projet distant.' } },
  { id: 'functions-deploy', group: { en: 'Edge functions', fr: 'Edge functions' }, label: 'supabase functions deploy', cmd: 'supabase functions deploy', danger: true,
    description: {
      en: 'Deploys all edge functions to the remote project.',
      fr: 'Déploie toutes les edge functions sur le projet distant.' } },

  // ── Types
  { id: 'types-local', group: { en: 'TypeScript types', fr: 'Types TypeScript' }, label: 'gen types --local', cmd: 'supabase gen types typescript --local',
    description: {
      en: 'Shows the TypeScript types generated from the local database schema.',
      fr: 'Affiche les types TypeScript générés depuis le schéma de la base locale.' } },
  { id: 'types-local-file', group: { en: 'TypeScript types', fr: 'Types TypeScript' }, label: 'gen types --local > file', cmd: 'supabase gen types typescript --local > {arg}', arg: 'path', argLabel: { en: 'Output file', fr: 'Fichier de sortie' }, placeholder: 'src/types/database.ts',
    description: {
      en: 'Writes these types to a project file (overwritten if it exists).',
      fr: 'Écrit ces types dans un fichier du projet (écrasé s’il existe).' } },
  { id: 'types-linked', group: { en: 'TypeScript types', fr: 'Types TypeScript' }, label: 'gen types --linked', cmd: 'supabase gen types typescript --linked',
    description: {
      en: 'Shows the TypeScript types generated from the linked remote project’s schema.',
      fr: 'Affiche les types TypeScript générés depuis le schéma du projet distant lié.' } },
];

/** Construit la commande ; erreur si le paramètre est invalide. */
export function buildSupabaseCommand(id: string, arg?: string): { cmd: SupabaseCommand; shell: string } {
  const cmd = SUPABASE_COMMANDS.find((c) => c.id === id);
  if (!cmd) throw appError('supabase.unknownCommand', undefined, 400);
  const a = (arg ?? '').trim();
  let value = '';
  if (cmd.arg === 'name') {
    if (!/^[A-Za-z0-9][\w-]{0,99}$/.test(a)) throw appError('supabase.badName', undefined, 400);
    value = quote(a);
  } else if (cmd.arg === 'ref') {
    if (!/^[a-z0-9]{20}$/.test(a)) throw appError('supabase.badRef', undefined, 400);
    value = a;
  } else if (cmd.arg === 'path') {
    // Chemin relatif au dossier Supabase, sans remonter ni option déguisée.
    if (!/^[\w][\w./-]{0,199}$/.test(a) || a.split('/').includes('..')) throw appError('supabase.badPath', undefined, 400);
    value = quote(a);
  }
  return { cmd, shell: cmd.cmd.replace('{arg}', value) };
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.expo', 'vendor', 'coverage', '.venv', 'venv']);
const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
/** Vrai dossier Supabase CLI (pas un `lib/supabase` de code client). */
const isSupabaseDir = (p: string) => ['config.toml', 'migrations', 'functions'].some((f) => fs.existsSync(path.join(p, 'supabase', f)));

/** Sous-dossiers proches (3 niveaux) contenant un dossier Supabase. */
function findBelow(dir: string): string | null {
  let level = [dir];
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next: string[] = [];
    for (const d of level) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.') || e.name === 'supabase') continue;
        const sub = path.join(d, e.name);
        if (isSupabaseDir(sub)) return sub;
        next.push(sub);
      }
    }
    level = next;
  }
  return null;
}

/**
 * Dossier où lancer la CLI Supabase pour un projet : celui qui contient un dossier `supabase/`
 * (le projet, un parent jusqu'à la racine du dépôt, ou un sous-dossier proche comme packages/db).
 * À défaut, le projet lui-même s'il utilise Supabase (dépendance @supabase/* ou variables SUPABASE_*).
 */
export function findSupabaseDir(dir: string, stop: string): { dir: string; hasFolder: boolean } | null {
  for (let d = dir; d.startsWith(stop); d = path.dirname(d)) {
    if (isSupabaseDir(d)) return { dir: d, hasFolder: true };
    if (d === stop || path.dirname(d) === d) break;
  }
  const below = findBelow(dir) ?? (stop !== dir ? findBelow(stop) : null);
  if (below) return { dir: below, hasFolder: true };
  try {
    if (fs.readFileSync(path.join(dir, 'package.json'), 'utf8').includes('"@supabase/')) return { dir, hasFolder: false };
  } catch { /* pas de package.json */ }
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^\.env(\..+)?$/.test(f) && fs.readFileSync(path.join(dir, f), 'utf8').includes('SUPABASE_')) return { dir, hasFolder: false };
    }
  } catch { /* dossier illisible */ }
  return null;
}
