import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { resolveLang, translate, interpolate, neutralTodolist, pickPlural, type Lang, type LanguageSetting, type Loc, type Params } from './core';
import { browserLangs, dicts, getLang, readStored, setCurrentLang, setNeutralNames } from './state';
import type { TKey } from './fr';

export type { Lang, LanguageSetting, Loc, Params } from './core';
export type { TKey } from './fr';
export { getLang, translateNow } from './state';
export * from './format';

/** `t(key, params)` ; `t.node` accepte des paramètres ReactNode ; `t.loc` choisit la langue d'un texte `{ fr, en }`. */
export interface T {
  (key: TKey, params?: Params): string;
  node: (key: TKey, params: Record<string, ReactNode>) => ReactNode;
  loc: (x: Loc | string | null | undefined) => string;
  lang: Lang;
}

function makeT(lang: Lang, neutral = false): T {
  const dict = dicts[lang];
  const fix = neutral ? neutralTodolist : (s: string) => s;
  const t = ((key: TKey, params?: Params) => fix(translate(dict, lang, key, params))) as T;
  t.node = (key, params) => {
    const e = dict[key] as string | { zero?: string; one: string; other: string } | undefined;
    if (e === undefined) return key;
    const count = typeof params.count === 'number' ? params.count : 0;
    const s = fix(typeof e === 'string' ? e : pickPlural(e, lang, count));
    const parts = s.split(/(\{\w+\})/);
    return parts.map((p, i) => {
      const m = /^\{(\w+)\}$/.exec(p);
      return <Fragment key={i}>{m && m[1] in params ? params[m[1]] : interpolate(p)}</Fragment>;
    });
  };
  t.loc = (x) => (x == null ? '' : typeof x === 'string' ? x : x[lang] ?? x.en);
  t.lang = lang;
  return t;
}

interface Ctx { t: T; lang: Lang; setting: LanguageSetting; setSetting: (s: LanguageSetting) => void }
const I18nCtx = createContext<Ctx>({ t: makeT(getLang()), lang: getLang(), setting: 'auto', setSetting: () => {} });

/**
 * Réglage de langue : localStorage pour l'affichage immédiat, réglages serveur pour la persistance (comme
 * le thème). Au changement de langue, les requêtes sont relancées : certains textes viennent du serveur,
 * qui répond dans la langue envoyée par `api.ts` (en-tête X-Tarmac-Lang).
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<LanguageSetting>(readStored);
  const [browser, setBrowser] = useState(browserLangs);
  const server = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const qc = useQueryClient();
  useEffect(() => {
    const s = server.data?.language;
    if (s && s !== setting) setSettingState(s);
  }, [server.data?.language]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => setBrowser(browserLangs());
    window.addEventListener('languagechange', on);
    return () => window.removeEventListener('languagechange', on);
  }, []);
  const lang = resolveLang(setting, browser);
  useEffect(() => {
    try { localStorage.setItem('language', setting); } catch { /* stockage indisponible */ }
  }, [setting]);
  const prev = useRef(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    if (prev.current !== lang) {
      prev.current = lang;
      qc.invalidateQueries();
    }
  }, [lang, qc]);
  // Rendu avec la bonne langue dès ce passage (avant l'effet) pour les fonctions hors React.
  // Codex coché : « Todolist » au lieu de « Todolist Claude » (voir neutralTodolist).
  const neutral = !!server.data?.agents?.codex;
  setCurrentLang(lang);
  setNeutralNames(neutral);
  const setSetting = useCallback((s: LanguageSetting) => {
    setSettingState(s);
    api.saveSettings({ language: s }).then((r) => qc.setQueryData(['settings'], r)).catch(() => null);
  }, [qc]);
  const value = useMemo(() => ({ t: makeT(lang, neutral), lang, setting, setSetting }), [lang, neutral, setting, setSetting]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useT = () => useContext(I18nCtx).t;
export const useLang = () => useContext(I18nCtx).lang;
export const useLanguageSetting = () => {
  const { setting, setSetting } = useContext(I18nCtx);
  return [setting, setSetting] as const;
};
