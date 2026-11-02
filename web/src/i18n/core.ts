/**
 * Cœur de l'i18n, sans React (testable sous Node) : choix de la langue, interpolation `{param}` et pluriel.
 * Une entrée de dictionnaire est une chaîne, ou un objet de formes plurielles choisies par `Intl.PluralRules`
 * selon le paramètre `count` (`zero` est facultatif et prioritaire quand count vaut 0).
 */
export type Lang = 'fr' | 'en';
export type LanguageSetting = 'auto' | Lang;
export const LANGS: Lang[] = ['en', 'fr'];
/** Langue de repli. */
export const FALLBACK: Lang = 'en';

export type Plural = { zero?: string; one: string; other: string };
export type Entry = string | Plural;
export type Params = Record<string, string | number>;

/** Texte présent dans les deux langues (catalogues servis par le serveur). */
export type Loc = { fr: string; en: string };

/** `auto` : langue du navigateur (`fr*` → fr, sinon en). */
export function resolveLang(setting: LanguageSetting | undefined | null, browser: readonly string[] = []): Lang {
  if (setting === 'fr' || setting === 'en') return setting;
  for (const l of browser) {
    const base = l.toLowerCase().split(/[-_]/)[0];
    if (base === 'fr') return 'fr';
    if (base === 'en') return 'en';
  }
  return FALLBACK;
}

export const interpolate = (s: string, params?: Params) =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;

const rules = new Map<Lang, Intl.PluralRules>();
export function pickPlural(entry: Plural, lang: Lang, count: number): string {
  if (count === 0 && entry.zero !== undefined) return entry.zero;
  let r = rules.get(lang);
  if (!r) rules.set(lang, (r = new Intl.PluralRules(lang)));
  return r.select(count) === 'one' ? entry.one : entry.other;
}

export function translate(dict: Record<string, Entry>, lang: Lang, key: string, params?: Params): string {
  const e = dict[key];
  if (e === undefined) return key;
  const s = typeof e === 'string' ? e : pickPlural(e, lang, Number(params?.count ?? 0));
  return interpolate(s, params);
}

/** Paramètres `{x}` d'une entrée (toutes formes plurielles confondues), triés. */
export function paramsOf(e: Entry): string[] {
  const all = typeof e === 'string' ? [e] : Object.values(e).filter((x): x is string => typeof x === 'string');
  return [...new Set(all.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
}
