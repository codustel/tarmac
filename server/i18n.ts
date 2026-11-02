import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingHttpHeaders } from 'node:http';
import { settings } from './settings.js';

/**
 * Textes produits par le serveur et affichés dans l'UI (erreurs de l'API, journaux des process,
 * diagnostics…), en anglais et en français. La langue d'une requête est celle envoyée par l'UI
 * (en-tête X-Tarmac-Lang), sinon le réglage `language` s'il est forcé, sinon Accept-Language, sinon
 * l'anglais (ex. serveur MCP). Hors requête (événements de fond), on prend la langue de la requête qui a
 * déclenché le traitement (contexte asynchrone), sinon le réglage, sinon la dernière langue de l'UI.
 * Les catalogues statiques (commandes git / Supabase) portent eux-mêmes les deux langues (`{ fr, en }`).
 */
export type Lang = 'fr' | 'en';
export type Loc = { fr: string; en: string };

const M = {
  // ── API générique
  'api.hostNotAllowed': { en: 'Host not allowed: {host}', fr: 'Hôte non autorisé : {host}' },
  'api.originNotAllowed': { en: 'Origin not allowed', fr: 'Origine non autorisée' },
  'api.unknownProject': { en: 'Unknown project', fr: 'Projet inconnu' },
  'api.noReadme': { en: 'No README', fr: 'Pas de README' },
  'api.badRequest': { en: 'Invalid request', fr: 'Requête invalide' },
  'api.fileNotFound': { en: 'File not found', fr: 'Fichier introuvable' },
  'api.notGitRepo': { en: 'This project is not in a git repository', fr: 'Ce projet n’est pas dans un dépôt git' },
  'api.noGitRepo': { en: 'No git repository', fr: 'Pas de dépôt git' },
  'api.unknownAction': { en: 'Unknown action', fr: 'Action inconnue' },
  'api.unknownCommand': { en: 'Unknown command', fr: 'Commande inconnue' },
  'api.noSupabase': { en: 'This project does not use Supabase', fr: 'Ce projet n’utilise pas Supabase' },
  'api.badSessionId': { en: 'Invalid session ID', fr: 'ID de session invalide' },
  'api.noClaudeCli': {
    en: 'claude CLI not found in Tarmac’s PATH (npm i -g @anthropic-ai/claude-code, then restart the service)',
    fr: 'CLI claude introuvable dans le PATH de Tarmac (npm i -g @anthropic-ai/claude-code, puis relance le service)',
  },
  'api.badRepo': { en: 'Invalid repository', fr: 'Repo invalide' },
  'api.alreadyExists': { en: '{path} already exists', fr: '{path} existe déjà' },
  'api.noGhCli': { en: 'gh CLI not installed — brew install gh', fr: 'CLI gh non installée — brew install gh' },
  'api.unknownPrereq': { en: 'Unknown prerequisite', fr: 'Prérequis inconnu' },
  'api.unknownAvd': { en: 'Unknown AVD', fr: 'AVD inconnu' },
  'api.demoMode': { en: 'Not available in demo mode', fr: 'Indisponible en mode démo' },
  'api.outsideRoots': { en: 'Path outside the scanned folders', fr: 'Chemin hors des dossiers scannés' },
  'api.openFailed': { en: 'Could not open: {error}', fr: 'Ouverture impossible : {error}' },
  'api.notRunning': { en: 'The project is not running.', fr: 'Le projet n’est pas lancé.' },
  'api.notFound': { en: 'Not found', fr: 'Introuvable' },
  // ── Réglages
  'settings.rootRequired': { en: 'At least one folder to scan is required.', fr: 'Au moins un dossier à scanner est requis.' },
  'settings.folderNotFound': { en: 'Folder not found: {path}', fr: 'Dossier introuvable : {path}' },
  'settings.folderNested': { en: '{path} is already inside {parent}', fr: '{path} est déjà inclus dans {parent}' },
  'settings.badPortRange': { en: 'Invalid port range (1024–65535, at least 10 ports).', fr: 'Plage de ports invalide (1024–65535, au moins 10 ports).' },
  'settings.badDepth': { en: 'Scan depth must be between 1 and 12.', fr: 'Profondeur de scan entre 1 et 12.' },
  'settings.badUrl': { en: 'Invalid URL: {url}', fr: 'URL invalide : {url}' },
  'settings.cloneDirNotFound': { en: 'Clone folder not found: {path}', fr: 'Dossier de clonage introuvable : {path}' },
  'settings.badBridgeInterval': { en: 'MCP bridge interval must be between 10 and 600 s.', fr: 'Intervalle du pont MCP entre 10 et 600 s.' },
  'settings.badSuiviFolder': { en: 'Invalid Todolist folder name.', fr: 'Nom de dossier du suivi invalide.' },
  // ── Catalogues
  'git.unknownCommand': { en: 'Unknown git command', fr: 'Commande git inconnue' },
  'git.messageRequired': { en: 'Commit message required', fr: 'Message de commit requis' },
  'git.badBranch': { en: 'Invalid branch name', fr: 'Nom de branche invalide' },
  'supabase.unknownCommand': { en: 'Unknown Supabase command', fr: 'Commande Supabase inconnue' },
  'supabase.badName': { en: 'Invalid name (letters, digits, - and _)', fr: 'Nom invalide (lettres, chiffres, - et _)' },
  'supabase.badRef': { en: 'Invalid project reference (20 characters a-z0-9)', fr: 'Référence de projet invalide (20 caractères a-z0-9)' },
  'supabase.badPath': { en: 'Invalid path', fr: 'Chemin invalide' },
  // ── Todolist (suivi)
  'suivi.tooManyTasks': { en: 'Too many tasks (5000 max.)', fr: 'Trop de tâches (5000 max.)' },
} satisfies Record<string, Loc>;

export type MsgKey = keyof typeof M;
export type Params = Record<string, string | number>;

const als = new AsyncLocalStorage<Lang>();
/** Dernière langue envoyée par l'UI (pour les événements sans requête d'origine). */
let lastUiLang: Lang = 'en';

const isLang = (x: unknown): x is Lang => x === 'fr' || x === 'en';

export function langFromAcceptLanguage(h: string | undefined): Lang | null {
  for (const part of (h ?? '').split(',')) {
    const base = part.trim().split(';')[0].toLowerCase().split('-')[0];
    if (base === 'fr' || base === 'en') return base;
  }
  return null;
}

/** Langue d'une requête (voir l'en-tête du fichier). */
export function requestLang(headers: IncomingHttpHeaders): Lang {
  const h = headers['x-tarmac-lang'];
  if (isLang(h)) return h;
  if (isLang(settings.language)) return settings.language;
  return langFromAcceptLanguage(headers['accept-language']) ?? 'en';
}

/** À appeler dans un hook onRequest : la suite du traitement de la requête voit sa langue. */
export function runWithRequestLang(headers: IncomingHttpHeaders, next: () => void) {
  const lang = requestLang(headers);
  if (isLang(headers['x-tarmac-lang'])) lastUiLang = lang;
  als.run(lang, next);
}

export const currentLang = (): Lang => als.getStore() ?? (isLang(settings.language) ? settings.language : lastUiLang);

/**
 * Langue de l'UI, indépendante de la requête en cours : pour les textes enregistrés puis affichés dans
 * l'UI (journal de synchro du suivi) même quand l'appel vient du serveur MCP (requête sans langue → anglais).
 */
export const uiLang = (): Lang => (isLang(settings.language) ? settings.language : lastUiLang);

export function msg(key: MsgKey, params?: Params, lang: Lang = currentLang()): string {
  return tr(M[key], params, lang);
}

const interpolate = (s: string, params?: Params) => (params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s);

/** Texte local à un module, écrit sur place en deux langues : `tr({ en: 'Ready on {url}', fr: 'Prêt sur {url}' }, { url })`. */
export const tr = (x: Loc, params?: Params, lang: Lang = currentLang()) => interpolate(x[lang] ?? x.en, params);

/** Erreur dont le message est traduit dans la langue courante ; `statusCode` repris par les routes. */
export const appError = (key: MsgKey, params?: Params, statusCode?: number) =>
  Object.assign(new Error(msg(key, params)), statusCode ? { statusCode } : {});

/** Pour les tests : toutes les entrées. */
export const serverMessages = M as Record<string, Loc>;
