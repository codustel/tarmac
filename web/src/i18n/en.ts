import type { Dict } from './fr';
import common from './en/common';
import settings from './en/settings';
import claude from './en/claude';
import todolist from './en/todolist';
import projects from './en/projects';
import ide from './en/ide';
import github from './en/github';
import supabase from './en/supabase';
import android from './en/android';

/** English dictionary (fallback language). Typed on `fr`: a missing key is a typecheck error. */
export const en: Dict = { ...common, ...settings, ...claude, ...todolist, ...projects, ...ide, ...github, ...supabase, ...android };
