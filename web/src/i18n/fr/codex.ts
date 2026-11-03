import type { Entry } from '../core';

/** Textes français — espace « codex » (Codex, l'agent de code de ChatGPT) et réglage « Agents ». */
export default {
  // Barre latérale et titres
  'common.nav.codex': 'Sessions Codex',
  'common.title.codex': 'Sessions Codex',
  'common.sub.codex': 'Sessions Codex (ChatGPT) ouvertes depuis Tarmac, en onglets, et historique par projet.',

  // Onglet Codex du panneau projet
  'codex.tab.label': 'Codex',
  'codex.tab.newTitle': 'Lancée avec codex dans le dossier du projet',
  'codex.tab.none': 'Aucune session Codex pour ce projet',
  'codex.tab.noneHint': 'Les sessions Codex lancées dans ce dossier (terminal, Tarmac) apparaissent ici tant que leur transcript local existe.',
  'codex.tab.footer': { one: '{count} session · transcripts de {dir}', other: '{count} sessions · transcripts de {dir}' },
  'codex.row.resumeActiveTitle': 'Session déjà ouverte ailleurs : la reprendre ici ouvre un second client sur la même conversation',

  // Page Sessions Codex
  'codex.view.closeConfirm': 'Fermer « {label} » ? La session Codex sera arrêtée (elle reste reprenable).',
  'codex.view.noTabs': 'Aucune session ouverte — lance-en une depuis un projet (onglet Codex) ou l\'historique.',
  'codex.view.allTitle': 'Toutes les sessions Codex',
  'codex.view.emptyTitle': 'Aucune session Codex ouverte',
  'codex.view.emptyHint': 'Ouvre un projet, onglet {codex}, puis {newSession} — ou reprends une session depuis l\'{history}.',
  'codex.view.emptyRemote': 'Pour suivre une session depuis le téléphone, Codex passe par l\'app ChatGPT (Remote Control de Codex), pas par Tarmac.',

  // Utilisation du plan ChatGPT (sidebar)
  'codex.usage.title': 'Utilisation Codex',
  'codex.usage.session': 'Session 5 h',
  'codex.usage.week': 'Semaine',
  'codex.usage.none': 'Lance une session Codex pour voir tes limites',
  'codex.usage.noneTitle': 'Codex enregistre les limites de ton plan ChatGPT à chaque échange ; aucune n’est encore sur cette machine.',
  'codex.usage.allReset': 'Limites remises à zéro depuis le dernier échange',
  'codex.usage.error': 'Utilisation indisponible pour le moment',
  'codex.usage.source': 'Dernières limites enregistrées par Codex sur cette machine ({when}), comme /status. Aucun jeton lu, aucun appel réseau.',

  // Réglages → Agents
  'settings.agents.title': 'Agents',
  'settings.agents.sub': 'Les agents de code que Tarmac affiche et pilote : sessions, LED, timeline, bouton ▶, utilisation, tarmac doctor.',
  'settings.agents.claude': 'Claude Code',
  'settings.agents.claudeHint': 'Sessions Claude Code, Remote Control, artefact claude.ai de la Todolist.',
  'settings.agents.codex': 'Codex (ChatGPT)',
  'settings.agents.codexHint': 'Sessions Codex dans les consoles de Tarmac, bouton ▶ vers Codex, utilisation du plan ChatGPT.',
  'settings.agents.atLeastOne': 'Garde au moins un agent.',
  'settings.agents.setup': 'Pour que Codex voie la Todolist (serveur MCP tarmac, skill $suivi, règle AGENTS.md) : {cmd}',
  'settings.codexUsage': 'Afficher l’utilisation Codex (limites du plan ChatGPT) dans la barre latérale',
  'settings.codexUsageHint': 'Plan et limites lus dans les fichiers de session locaux de Codex, comme /status : aucun jeton lu, aucun appel réseau.',

  // Bouton ▶ (Todolist) : choix de l'agent
  'todolist.send.newAgent': '+ Nouvelle session {agent}',
  'todolist.send.both': 'Claude ou Codex',
  'todolist.send.buttonOf': '▶ {agent}',
  'todolist.send.buttonBoth': '▶ Agent',
  'todolist.send.titleOf': 'Envoyer à {agent}',
  'todolist.send.detailOf': '▶ Envoyer à {agent}',
  'todolist.send.noneOf': 'Aucune session {agent} ouverte dans Tarmac pour ce projet.',
  'todolist.send.sentNewOf': 'Envoyée à une nouvelle session {agent}',
  'todolist.send.outsideAny': 'Les sessions lancées hors de Tarmac (Terminal, Claude desktop, app ChatGPT) ne sont pas joignables.',
  'todolist.requestedAny': 'Demandée',
  'projects.action.codex': 'Codex : sessions du projet et nouvelle session',
  'codex.outside.sub': 'Sessions Codex ouvertes dans un terminal ou un IDE',
} satisfies Record<string, Entry>;
