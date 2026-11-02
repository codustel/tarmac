import common from './fr/common';
import settings from './fr/settings';
import claude from './fr/claude';
import todolist from './fr/todolist';
import projects from './fr/projects';
import ide from './fr/ide';
import github from './fr/github';
import supabase from './fr/supabase';
import android from './fr/android';

/** Dictionnaire français : référence des clés (`en` est typé dessus). Un fichier par espace de noms. */
export const fr = { ...common, ...settings, ...claude, ...todolist, ...projects, ...ide, ...github, ...supabase, ...android };
export type Dict = typeof fr;
export type TKey = keyof Dict;
