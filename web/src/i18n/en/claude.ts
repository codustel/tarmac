import type fr from '../fr/claude';

/** English texts — « claude » namespace (same keys as fr/claude.ts). */
const en: typeof fr = {
  'claude.loading': 'Loading…',
  'claude.filter': 'Filter…',
  'claude.refresh': 'Refresh',
  'claude.close': 'Close',

  // Session row (SessionRow)
  'claude.row.openHere': 'open here',
  'claude.row.active': 'active',
  'claude.row.activeTitle': 'Session running outside Tarmac (terminal, Claude app, IDE…)',
  'claude.row.show': 'Show',
  'claude.row.resume': 'Resume',
  'claude.row.resumeActiveTitle': 'Session already open elsewhere: resuming it here adds a second client to the same conversation',

  // Claude tab of the project panel (ProjectClaudeTab)
  'claude.tab.new': 'New session',
  'claude.tab.remoteTitle': 'Started with claude --remote-control: reachable from claude.ai/code and the mobile app',
  'claude.tab.noMatch': 'No matching sessions',
  'claude.tab.none': 'No Claude Code sessions for this project',
  'claude.tab.noneHint': 'Sessions started in this folder (terminal, VS Code, app) show up here, including finished or archived ones as long as their local transcript exists.',
  'claude.tab.footer': { one: '{count} session · transcripts from {dir}, kept {period}', other: '{count} sessions · transcripts from {dir}, kept {period}' },
  'claude.tab.retention': '30 days by default',
  'claude.tab.retentionTitle': 'cleanupPeriodDays setting in ~/.claude/settings.json',

  // Claude sessions page (ClaudeSessionsView)
  'claude.view.closeConfirm': 'Close “{label}”? The Claude session will stop (you can resume it later).',
  'claude.view.noTabs': 'No open sessions — start one from a project (Claude tab) or from the history.',
  'claude.view.history': 'History',
  'claude.view.allTitle': 'All Claude Code sessions',
  'claude.view.allSub': 'linked to a scanned project',
  'claude.view.noSession': 'No sessions',
  'claude.view.relaunch': 'Restart',
  'claude.view.openInBrowserTab': 'Open in a browser tab',
  'claude.view.emptyTitle': 'No Claude session open',
  'claude.view.emptyHint': 'Open a project, {claude} tab, then {newSession} — or resume a session from the {history}.',
  'claude.view.historyLink': 'history',
  'claude.view.emptyRemote': 'Every session starts with Remote Control: you’ll also find it on claude.ai/code and on mobile.',

  // Full-screen console (StandaloneTerminal)
  'claude.standalone.notFound': 'Session not found or closed.',

  // Subscription usage (ClaudeUsagePanel, sidebar)
  'claude.usage.title': 'Claude usage',
  'claude.usage.session': '5-hour session',
  'claude.usage.week': 'Week',
  'claude.usage.resets': 'Resets {when}',
  'claude.usage.reconnect': 'Launch Claude Code to sign in again',
  'claude.usage.notConnected': 'Claude Code is not signed in on this machine.',
  'claude.usage.expired': 'Claude Code sign-in has expired.',
  'claude.usage.error': 'Usage unavailable right now',
  'claude.usage.source': 'Read from this machine’s Claude Code sign-in, updated {when}. The token is only ever sent to Anthropic.',
};
export default en;
