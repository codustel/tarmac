import type { Entry } from '../core';

/** Textes français — espace « claude ». Clés préfixées par « claude. ». */
export default {
  'claude.loading': 'Chargement…',
  'claude.filter': 'Filtrer…',
  'claude.refresh': 'Rafraîchir',
  'claude.close': 'Fermer',

  // Ligne de session (SessionRow)
  'claude.row.openHere': 'ouverte ici',
  'claude.row.active': 'active',
  'claude.row.activeTitle': 'Un process claude tourne dans ce dossier (terminal, VS Code…)',
  'claude.row.show': 'Afficher',
  'claude.row.resume': 'Reprendre',
  'claude.row.resumeActiveTitle': 'Session déjà ouverte ailleurs : la reprendre ici crée un second client sur la même conversation',

  // Onglet Claude du panneau projet (ProjectClaudeTab)
  'claude.tab.new': 'Nouvelle session',
  'claude.tab.remoteTitle': 'Lancée avec claude --remote-control : accessible depuis claude.ai/code et l\'app mobile',
  'claude.tab.noMatch': 'Aucune session ne correspond',
  'claude.tab.none': 'Aucune session Claude Code pour ce projet',
  'claude.tab.noneHint': 'Les sessions lancées dans ce dossier (terminal, VS Code, app) apparaissent ici, y compris les sessions terminées ou archivées tant que leur transcript local existe.',
  'claude.tab.footer': { one: '{count} session · transcripts de {dir}, conservés {period}', other: '{count} sessions · transcripts de {dir}, conservés {period}' },
  'claude.tab.retention': '30 jours par défaut',
  'claude.tab.retentionTitle': 'Réglage cleanupPeriodDays de ~/.claude/settings.json',

  // Page Sessions Claude (ClaudeSessionsView)
  'claude.view.closeConfirm': 'Fermer « {label} » ? La session Claude sera arrêtée (elle reste reprenable).',
  'claude.view.noTabs': 'Aucune session ouverte — lance-en une depuis un projet (onglet Claude) ou l\'historique.',
  'claude.view.history': 'Historique',
  'claude.view.activeElsewhere': 'Actives hors de Tarmac :',
  'claude.view.allTitle': 'Toutes les sessions Claude Code',
  'claude.view.allSub': 'rattachées à un projet scanné',
  'claude.view.noSession': 'Aucune session',
  'claude.view.relaunch': 'Relancer',
  'claude.view.openInBrowserTab': 'Ouvrir dans un onglet du navigateur',
  'claude.view.emptyTitle': 'Aucune session Claude ouverte',
  'claude.view.emptyHint': 'Ouvre un projet, onglet {claude}, puis {newSession} — ou reprends une session depuis l\'{history}.',
  'claude.view.historyLink': 'historique',
  'claude.view.emptyRemote': 'Chaque session est lancée avec Remote Control : tu la retrouves aussi sur claude.ai/code et sur mobile.',

  // Console plein écran (StandaloneTerminal)
  'claude.standalone.notFound': 'Session introuvable ou fermée.',

  // Utilisation de l'abonnement (ClaudeUsagePanel, sidebar)
  'claude.usage.title': 'Utilisation Claude',
  'claude.usage.session': 'Session 5 h',
  'claude.usage.week': 'Semaine',
  'claude.usage.resets': 'Remise à zéro : {when}',
  'claude.usage.reconnect': 'Lance Claude Code pour te reconnecter',
  'claude.usage.notConnected': 'Claude Code n’est pas connecté sur cette machine.',
  'claude.usage.expired': 'Connexion Claude Code expirée.',
  'claude.usage.error': 'Utilisation indisponible pour le moment',
  'claude.usage.source': 'Lu depuis la connexion Claude Code de cette machine, mis à jour {when}. Le jeton n’est envoyé qu’à Anthropic.',
} satisfies Record<string, Entry>;
