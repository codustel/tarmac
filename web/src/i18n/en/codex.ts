import type fr from '../fr/codex';

/** English texts — « codex » namespace (same keys as fr/codex.ts). */
const en: typeof fr = {
  'common.nav.codex': 'Codex sessions',
  'common.title.codex': 'Codex sessions',
  'common.sub.codex': 'Codex (ChatGPT) sessions opened from Tarmac, as tabs, and history per project.',

  'codex.tab.label': 'Codex',
  'codex.tab.newTitle': 'Started with codex in the project folder',
  'codex.tab.none': 'No Codex session for this project',
  'codex.tab.noneHint': 'Codex sessions started in this folder (terminal, Tarmac) show up here as long as their local transcript exists.',
  'codex.tab.footer': { one: '{count} session · transcripts from {dir}', other: '{count} sessions · transcripts from {dir}' },
  'codex.row.resumeActiveTitle': 'Session already open elsewhere: resuming it here opens a second client on the same conversation',

  'codex.view.closeConfirm': 'Close “{label}”? The Codex session will be stopped (it can be resumed).',
  'codex.view.noTabs': 'No open session — start one from a project (Codex tab) or from the history.',
  'codex.view.allTitle': 'All Codex sessions',
  'codex.view.emptyTitle': 'No Codex session open',
  'codex.view.emptyHint': 'Open a project, {codex} tab, then {newSession} — or resume a session from the {history}.',
  'codex.view.emptyRemote': 'To follow a session from your phone, Codex goes through the ChatGPT app (Codex Remote Control), not through Tarmac.',

  'codex.usage.title': 'Codex usage',
  'codex.usage.session': '5-hour session',
  'codex.usage.week': 'Week',
  'codex.usage.none': 'Start a Codex session to see your limits',
  'codex.usage.noneTitle': 'Codex records your ChatGPT plan limits on every exchange; none are on this machine yet.',
  'codex.usage.allReset': 'Limits reset since the last exchange',
  'codex.usage.error': 'Usage unavailable right now',
  'codex.usage.source': 'Latest limits recorded by Codex on this machine ({when}), as in /status. No token read, no network call.',

  'settings.agents.title': 'Agents',
  'settings.agents.sub': 'The coding agents Tarmac shows and drives: sessions, LED, timeline, ▶ button, usage, tarmac doctor.',
  'settings.agents.claude': 'Claude Code',
  'settings.agents.claudeHint': 'Claude Code sessions, Remote Control, claude.ai Todolist artifact.',
  'settings.agents.codex': 'Codex (ChatGPT)',
  'settings.agents.codexHint': 'Codex sessions in Tarmac consoles, ▶ button to Codex, ChatGPT plan usage.',
  'settings.agents.atLeastOne': 'Keep at least one agent.',
  'settings.agents.setup': 'For Codex to see the Todolist (tarmac MCP server, $suivi skill, AGENTS.md rule): {cmd}',
  'settings.codexUsage': 'Show Codex usage (ChatGPT plan limits) in the sidebar',
  'settings.codexUsageHint': 'Plan and limits read from Codex’s local session files, as in /status: no token read, no network call.',

  'todolist.send.newAgent': '+ New {agent} session',
  'todolist.send.both': 'Claude or Codex',
  'todolist.send.buttonOf': '▶ {agent}',
  'todolist.send.buttonBoth': '▶ Agent',
  'todolist.send.titleOf': 'Send to {agent}',
  'todolist.send.detailOf': '▶ Send to {agent}',
  'todolist.send.noneOf': 'No {agent} session open in Tarmac for this project.',
  'todolist.send.sentNewOf': 'Sent to a new {agent} session',
  'todolist.send.outsideAny': 'Sessions started outside Tarmac (Terminal, Claude desktop, ChatGPT app) can’t be reached.',
  'todolist.requestedAny': 'Requested',
  'projects.action.codex': 'Codex: project sessions and new session',
  'codex.outside.sub': 'Codex sessions open in a terminal or an IDE',
};
export default en;
