import { Bell, BookOpenCheck, Eraser, Gauge, LineChart, MonitorDown, Moon, type LucideIcon } from 'lucide-react';

/** Texte bilingue. */
export type Bi = { fr: string; en: string };

/**
 * Fonctionnalité de Tarmac Pro montrée (verrouillée, avec une pastille Pro) dans la version gratuite.
 * Elle disparaît d'elle-même quand le module du même `id` est chargé (`/api/modules`, tout statut), ou, pour
 * `'desktop'`, quand l'app tourne dans Tarmac Desktop. Pour en ajouter une : une ligne dans `PRO_FEATURES`.
 */
export interface ProFeature {
  id: string;
  unlockedBy: { module: string } | 'desktop';
  icon: LucideIcon;
  name: Bi;
  pitch: Bi;
}

export const PRO_FEATURES: ProFeature[] = [
  { id: 'desktop', unlockedBy: 'desktop', icon: MonitorDown,
    name: { fr: 'Tarmac Desktop', en: 'Tarmac Desktop' },
    pitch: { fr: 'L’application macOS et Windows : installeur, icône dans la barre des menus, mises à jour automatiques.', en: 'The macOS and Windows app: installer, menu bar icon, automatic updates.' } },
  { id: 'notifications', unlockedBy: { module: 'notifications' }, icon: Bell,
    name: { fr: 'Notifications', en: 'Notifications' },
    pitch: { fr: 'Soyez prévenu quand une session Claude a fini ou attend votre réponse, sans rester devant l’écran.', en: 'Get notified when a Claude session is done or waiting for you, without watching the screen.' } },
  { id: 'costs', unlockedBy: { module: 'costs' }, icon: LineChart,
    name: { fr: 'Historique et coûts', en: 'History and costs' },
    pitch: { fr: 'Ce que chaque projet et chaque session ont consommé, jour après jour.', en: 'What each project and session consumed, day after day.' } },
  { id: 'autopilot', unlockedBy: { module: 'autopilot' }, icon: Moon,
    name: { fr: 'Pilote auto', en: 'Autopilot' },
    pitch: { fr: 'Les tâches de votre suivi s’enchaînent toutes seules, même la nuit.', en: 'The tasks of your tracker run one after the other on their own, even overnight.' } },
  { id: 'context', unlockedBy: { module: 'costs' }, icon: Gauge,
    name: { fr: 'Contexte des sessions', en: 'Session context' },
    pitch: { fr: 'Voyez le remplissage du contexte de chaque session et ses compactions.', en: 'See how full each session’s context is, and its compactions.' } },
  { id: 'setup', unlockedBy: { module: 'setup' }, icon: BookOpenCheck,
    name: { fr: 'Tout installer', en: 'Install everything' },
    pitch: { fr: 'Homebrew, Node, Docker, Supabase… installés en un clic, dans le bon ordre.', en: 'Homebrew, Node, Docker, Supabase… installed in one click, in the right order.' } },
  { id: 'leftovers', unlockedBy: { module: 'leftovers' }, icon: Eraser,
    name: { fr: 'Restes de sessions', en: 'Session leftovers' },
    pitch: { fr: 'Retrouvez et arrêtez les serveurs et navigateurs que vos sessions Claude et Codex ont laissés tourner.', en: 'Find and stop the servers and browsers your Claude and Codex sessions left running.' } },
];

/** Fonctionnalités à montrer : aucune si `hidden`, sinon celles dont le module est absent (et pas Desktop si `isDesktop`). */
export function lockedProFeatures(
  features: ProFeature[],
  modules: Array<{ id: string }>,
  opts: { isDesktop: boolean; hidden: boolean },
): ProFeature[] {
  if (opts.hidden) return [];
  const present = new Set(modules.map((m) => m.id));
  return features.filter((f) => (f.unlockedBy === 'desktop' ? !opts.isDesktop : !present.has(f.unlockedBy.module)));
}

/** Page des tarifs de runtarmac.com, dans la langue de l'app. */
export const pricingUrl = (lang: 'fr' | 'en') => (lang === 'fr' ? 'https://runtarmac.com/fr/tarifs/' : 'https://runtarmac.com/pricing/');

/**
 * Bouton d'une fonctionnalité Pro : `toggle` (module `moduleId` chargé : fonctionnalité normale), `pro` (absent :
 * pastille Pro, ouvre la proposition) ou `none` (absent et propositions Pro coupées).
 */
export function proButtonMode(modules: Array<{ id: string; status?: string }>, moduleId: string, hidden: boolean): 'toggle' | 'pro' | 'none' {
  if (modules.some((m) => m.id === moduleId)) return 'toggle';
  return hidden ? 'none' : 'pro';
}

/** Bouton « Auto » d'une tâche de la Todolist (module `autopilot`). */
export const autoButtonMode = (modules: Array<{ id: string; status?: string }>, hidden: boolean) => proButtonMode(modules, 'autopilot', hidden);
