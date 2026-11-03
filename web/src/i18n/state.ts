import { neutralTodolist, resolveLang, translate, type Lang, type LanguageSetting, type Params } from './core';
import { fr, type TKey } from './fr';
import { en } from './en';

/**
 * Langue active, lisible hors de React (api.ts, formats de date). Mise à jour par `I18nProvider` ; la
 * valeur initiale vient du localStorage (affichage immédiat, avant la réponse du serveur).
 */
export const dicts = { fr, en } as const;

const readStored = (): LanguageSetting => {
  try { return (localStorage.getItem('language') as LanguageSetting) || 'auto'; } catch { return 'auto'; }
};
const browserLangs = () => (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

let current: Lang = resolveLang(typeof localStorage === 'undefined' ? 'auto' : readStored(), browserLangs());

export const getLang = () => current;
export const setCurrentLang = (l: Lang) => { current = l; };
let neutral = false;
/** Codex coché : nom neutre de la Todolist aussi hors de React. */
export const setNeutralNames = (on: boolean) => { neutral = on; };
export { readStored, browserLangs };

/** Traduction hors composant (messages construits dans api.ts, toasts de modules non React…). */
export const translateNow = (key: TKey, params?: Params) => {
  const s = translate(dicts[current], current, key, params);
  return neutral ? neutralTodolist(s) : s;
};
