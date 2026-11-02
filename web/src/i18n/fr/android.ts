import type { Entry } from '../core';

/** Textes français — espace « android ». Clés préfixées par « android. ». */
export default {
  'android.state.stopped': 'Arrêté',
  'android.state.starting': 'Lancement…',
  'android.state.booting': 'Démarrage d’Android…',
  'android.state.ready': 'Prêt',
  'android.state.stopping': 'Arrêt…',
  'android.tools.title': 'Outillage',
  'android.tools.allReady': 'Tout est prêt',
  'android.tools.missing': { one: '{count} élément à installer', other: '{count} éléments à installer' },
  'android.tools.sdk': 'SDK : {path}',
  'android.tools.copied': 'Commande copiée',
  'android.tools.installFirst': 'Installer d’abord : {list}',
  'android.tools.install': 'Installer',
  'android.avds.title': 'Émulateurs',
  'android.avds.emptyTitle': 'Aucun appareil virtuel',
  'android.avds.emptyHint': 'Crée-en un avec la ligne « {label} » ci-dessus, ou depuis le Device Manager d’Android Studio.',
  'android.avds.missingImage': 'Image système absente : {image}',
  'android.avds.start': 'Lancer',
  'android.avds.coldTitle': 'Démarrage à froid : ignore le snapshot (utile si l’émulateur reste bloqué au démarrage)',
  'android.avds.cold': 'À froid',
  'android.avds.stop': 'Arrêter',
  'android.install.done': 'Terminé',
  'android.install.failed': 'Échec ({code})',
  'android.install.close': 'Fermer',
} satisfies Record<string, Entry>;
