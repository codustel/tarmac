// Données factices de l'espace de démo : sessions Claude Code, Todolist Claude, fixtures du mode démo.

import crypto from 'node:crypto';

/** UUID stable dérivé d'un texte (sessions identiques d'une génération à l'autre). */
export const uuidOf = (s) => {
  const h = crypto.createHash('sha1').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const H = 3_600_000;
const D = 24 * H;

/**
 * Sessions Claude Code par projet. `age` : dernière activité, `span` : durée de la session ;
 * `messages` : nombre d'échanges affiché (index des sessions) ; `chat` : derniers échanges (rejoués par claude-demo).
 */
export const SESSIONS = [
  {
    project: 'nebula-store', title: 'Cart drawer with quantity controls', branch: 'feat/cart-drawer', age: 0.15 * H, span: 2 * H, messages: 64,
    chat: [
      ['user', 'Add a slide-over cart drawer with quantity controls and a subtotal. Keep the current card styles.'],
      ['assistant', "I'll add a `CartDrawer` component, wire it to the cart button in the header and reuse the card tokens from `styles.css`. Let me start with the component."],
      ['user', 'Looks good. Also close it on Escape and when clicking the backdrop.'],
      ['assistant', 'Done: Escape and backdrop clicks close the drawer, focus returns to the cart button. I also added a test for the subtotal with discounted items.'],
    ],
  },
  {
    project: 'nebula-store', title: 'Fix cart total rounding on discounts', branch: 'main', age: 19 * D, span: 1.2 * H, messages: 22,
    chat: [['user', 'The cart total shows 63.19999 with the -20% planet lamp. Can you fix the rounding?'], ['assistant', 'The discount was applied on floats. I switched prices to integer cents and format them at display time.']],
  },
  {
    project: 'nebula-store', title: 'Lazy-load product images', branch: 'main', age: 6 * D, span: 0.8 * H, messages: 14,
    chat: [['user', 'Lighthouse says the product grid blocks LCP. Lazy-load what is below the fold.'], ['assistant', 'Added `loading="lazy"` and explicit sizes; LCP drops from 2.9 s to 1.4 s on the throttled profile.']],
  },
  {
    project: 'rocket-api', title: 'Pagination on /v1/missions', branch: 'main', age: 1 * D, span: 1.5 * H, messages: 31,
    chat: [['user', 'Add cursor pagination to /v1/missions, 24 items per page.'], ['assistant', 'Implemented `?cursor=` with an opaque base64 cursor, plus `next` in the response and tests for the last page.']],
  },
  {
    project: 'rocket-api', title: 'Upgrade to Fastify 5', branch: 'chore/fastify-5', age: 9 * D, span: 3 * H, messages: 47,
    chat: [['user', 'Upgrade the API to Fastify 5 and fix whatever breaks.'], ['assistant', 'Upgraded fastify and @fastify/cors; two route schemas needed `type: object` at the root. All tests pass.']],
  },
  {
    project: 'launch-queue', title: 'Retry weather checks with exponential backoff', branch: 'main', age: 4 * D, span: 0.9 * H, messages: 18,
    chat: [['user', 'Pad weather checks fail when the forecast service rate-limits us. Add retries.'], ['assistant', 'Added 5 attempts with exponential backoff (1 s → 16 s) and jitter; failed jobs go to a dead-letter queue.']],
  },
  {
    project: 'mission-control/apps/admin', title: 'Launch table with filters', branch: 'main', age: 2 * D, span: 2.5 * H, messages: 56,
    chat: [['user', 'Build a launch table in the pilot console: status filter, date range and CSV export.'], ['assistant', 'Added `LaunchTable` with server-side filtering through the flight API, and a CSV export of the current view.']],
  },
  {
    project: 'mission-control', title: 'Set up Turborepo pipelines', branch: 'main', age: 30 * D, span: 1 * H, messages: 12,
    chat: [['user', 'Configure turbo so build depends on upstream packages and dev is persistent.'], ['assistant', 'Updated `turbo.json`: `build` depends on `^build` with `dist/**` outputs, `dev` is persistent and uncached.']],
  },
  {
    project: 'orbit-insights', title: 'Trajectory endpoint', branch: 'main', age: 3 * D, span: 1.1 * H, messages: 25,
    chat: [['user', 'Add /trajectories/{mission} returning the altitude series.'], ['assistant', 'Added the endpoint with a `points` query parameter (10–600) and an OpenAPI example.']],
  },
  {
    project: 'launchpad-docs', title: 'Write the launch webhooks guide', branch: 'docs/webhooks', age: 8 * D, span: 1.4 * H, messages: 19,
    chat: [['user', 'Write a launch webhooks guide: events, signatures, retries.'], ['assistant', 'Drafted `webhooks.md` with the event catalogue (T-minus, liftoff, landing), HMAC signature verification in Node and Python, and the retry schedule.']],
  },
];

/**
 * Sessions « en cours hors Tarmac » : run-demo.sh lance un faux `claude` (agents-demo.mjs) dans le dossier du projet,
 * qui écrit son fichier `sessions/<pid>.json` comme Claude Code (point d'entrée, statut busy / idle) et fait vivre
 * ses faux agents en arrière-plan (`<session>/subagents/agent-<id>.jsonl` + `.meta.json`).
 */
export const RUNNING_AGENTS = [
  {
    project: 'nebula-store', session: 'Cart drawer with quantity controls', entrypoint: 'claude-desktop', status: 'busy',
    subagents: [
      { id: 'a7c3e19d2b4f60a18', type: 'Explore', description: 'Audit cart drawer accessibility' },
      { id: 'a2f9b07c5d1e83b42', type: 'general-purpose', description: 'Write checkout e2e tests', finished: true },
    ],
  },
  { project: 'rocket-api', session: 'Pagination on /v1/missions', entrypoint: 'claude-vscode', status: 'idle', subagents: [] },
];
export const sessionIdOf = (project, title) => uuidOf(`${project}:${title}`);

// ─── Codex (ChatGPT) ────────────────────────────────────────────────────────
/** Sessions Codex factices (transcripts « rollout » dans <home>/.codex/sessions), mêmes champs que SESSIONS. */
export const CODEX_SESSIONS = [
  {
    project: 'rocket-api', title: 'Rate limiting on the public endpoints', branch: 'feat/rate-limit', age: 0.4 * H, span: 1.2 * H,
    chat: [
      ['user', 'Add rate limiting to the public endpoints: 60 requests per minute per API key, with a Retry-After header.'],
      ['assistant', 'I added a token-bucket limiter as a Fastify plugin, keyed by API key, and a Retry-After header on 429 responses. Tests cover the limit and the reset.'],
    ],
  },
  {
    project: 'nebula-store', title: 'Product search with filters', branch: 'feat/search', age: 1.5 * D, span: 2 * H,
    chat: [
      ['user', 'Add a search box to the catalogue with category and price filters, debounced.'],
      ['assistant', 'Search is in place: a debounced input, category chips and a price range, all synced to the URL so results can be shared.'],
    ],
  },
  {
    project: 'launch-queue', title: 'Dead-letter queue for failed launches', branch: 'main', age: 5 * D, span: 1 * H,
    chat: [
      ['user', 'Failed launch jobs should go to a dead-letter queue after 5 attempts.'],
      ['assistant', 'Done: after the fifth attempt a job moves to the `launches:dead` queue with its last error, and the dashboard lists them.'],
    ],
  },
];
/** Session Codex « en cours hors Tarmac » (faux `codex` qui dort, lancé par run-agents.mjs). */
export const CODEX_RUNNING = [{ project: 'launch-queue', session: 'Dead-letter queue for failed launches' }];
export const codexSessionIdOf = (project, title) => {
  const u = uuidOf(`codex:${project}:${title}`);
  return `${u.slice(0, 14)}7${u.slice(15)}`; // identifiants de fil de Codex : UUID v7
};

/** Transcript « rollout » de Codex (une ligne `{ timestamp, type, payload }` par élément), limites d'usage comprises. */
export function codexRollout(s, cwd, now, usage = { session: 23, week: 41, plan: 'plus' }) {
  const id = codexSessionIdOf(s.project, s.title);
  const end = now - s.age;
  const start = end - s.span;
  const at = (ms) => new Date(ms).toISOString();
  const step = s.span / Math.max(1, s.chat.length + 1);
  const lines = [{ timestamp: at(start), type: 'session_meta', payload: { id, session_id: id, timestamp: at(start), cwd, originator: 'codex_cli_rs', cli_version: '0.98.0', source: 'cli', git: { branch: s.branch } } }];
  let t = start;
  for (const [role, text] of s.chat) {
    t += step;
    if (role === 'user') {
      lines.push({ timestamp: at(t), type: 'event_msg', payload: { type: 'task_started' } });
      lines.push({ timestamp: at(t), type: 'event_msg', payload: { type: 'user_message', message: text } });
    } else {
      lines.push({ timestamp: at(t), type: 'event_msg', payload: { type: 'agent_message', message: text } });
      lines.push({ timestamp: at(t), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: {
        limit_id: 'codex', primary: { used_percent: usage.session, window_minutes: 300, resets_at: Math.round((now + 2.6 * H) / 1000) },
        secondary: { used_percent: usage.week, window_minutes: 10080, resets_at: Math.round((now + 4.2 * D) / 1000) }, plan_type: usage.plan,
      } } });
      lines.push({ timestamp: at(end), type: 'event_msg', payload: { type: 'task_complete' } });
    }
  }
  const d = new Date(start);
  const stamp = d.toISOString().slice(0, 19).replace(/:/g, '-');
  const rel = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/rollout-${stamp}-${id}.jsonl`;
  return { id, rel, jsonl: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' };
}

/** Lignes JSONL d'un transcript au format lu par Tarmac (et par Claude Code). */
export function transcript(s, cwd, now) {
  const id = sessionIdOf(s.project, s.title);
  const end = now - s.age;
  const start = end - s.span;
  const lines = [];
  const step = (s.span) / Math.max(1, s.chat.length);
  let parent = null;
  s.chat.forEach(([role, text], i) => {
    const uuid = uuidOf(`${id}:${i}`);
    const base = { parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.12', gitBranch: s.branch, uuid, timestamp: new Date(start + i * step).toISOString() };
    lines.push(role === 'user'
      ? { ...base, type: 'user', message: { role: 'user', content: text } }
      : { ...base, type: 'assistant', message: { role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text }] } });
    parent = uuid;
  });
  lines.push({ type: 'summary', summary: s.title, leafUuid: parent });
  // Dernier évènement : fin de la session (date de dernière activité).
  lines.push({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.12', gitBranch: s.branch, type: 'system', subtype: 'turn_duration', timestamp: new Date(end).toISOString(), uuid: uuidOf(`${id}:end`) });
  return { id, jsonl: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', messages: s.messages };
}

// ─── Todolist Claude ────────────────────────────────────────────────────────
const task = (num, phase, phaseTitle, title, extra = {}) => ({
  id: `t-${num.replace('.', '-')}`,
  phase, phaseTitle, num, title,
  who: 'claude', minutes: 0, why: '', steps: [], check: '',
  done: false, doneAt: null, note: '', toTest: false, tested: false, testedAt: null, testNote: '',
  parent: null, sources: [], archived: false,
  ...extra,
});

const iso = (now, days) => new Date(now - days * D).toISOString();

/** Lien d'artefact factice (affiché « Artefact » sur la carte, jamais ouvert pendant les captures). */
const artifact = (name) => `https://claude.ai/artifact/orbit-labs-${name}`;
const fonts = { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' };
/** Ordre, révision et dates communes ; identifiants t-1-4a… (le point du numéro devient un tiret). */
const finish = (tasks, now, updatedDays, createdDays) => {
  const out = tasks.map((t, i) => ({ ...t, order: i + 1, rev: 1, updatedAt: iso(now, updatedDays), updatedBy: 'claude', createdAt: iso(now, createdDays) }));
  for (const t of out) t.id = `t-${t.num.replace('.', '-')}`;
  return out;
};
const ok = (now, days, extra = {}) => ({ done: true, doneAt: iso(now, days), tested: true, testedAt: iso(now, days - 0.2), ...extra });

// Cinq projets suivis, chacun à sa couleur, avancements variés (≈ 60 % à 92 %).
export function todolistStorefront(now) {
  const P1 = 'Catalogue and cart';
  const P2 = 'Checkout';
  const P3 = 'Launch';
  const tasks = finish([
    task('1.1', 1, P1, 'Product grid with categories', { why: 'Browse every space goodie from the home page.', ...ok(now, 40), sources: [{ kind: 'commit', ref: 'a41c9e2', at: null }] }),
    task('1.2', 1, P1, 'Persist the cart in localStorage', { why: 'Keep the cart after a reload.', ...ok(now, 12) }),
    task('1.3', 1, P1, 'Fix cart total rounding on discounted items', ok(now, 19)),
    task('1.4', 1, P1, 'Cart drawer with quantity controls', { why: 'Edit the cart without leaving the page.', steps: ['Slide-over drawer', 'Quantity stepper', 'Subtotal and checkout button'], toTest: true, done: false, minutes: 30, check: 'Open the drawer, change quantities, the subtotal updates.' }),
    task('1.4a', 1, P1, 'Close the drawer on Escape and backdrop click', { parent: 't-1-4', toTest: true, minutes: 15 }),
    task('1.4b', 1, P1, 'Return focus to the cart button', { parent: 't-1-4', minutes: 15 }),
    task('1.5', 1, P1, 'Lazy-load product images', ok(now, 6)),
    task('2.1', 2, P2, 'Checkout in test mode', { why: 'Take payments without handling card data.', ...ok(now, 4) }),
    task('2.2', 2, P2, 'Order confirmation email with launch countdown', { who: 'ensemble', ...ok(now, 3) }),
    task('2.3', 2, P2, 'Gift wrapping option', { who: 'toi', ...ok(now, 2) }),
    task('3.1', 3, P3, 'Lighthouse ≥ 95 on mobile', { toTest: true, note: 'LCP 1.4 s after lazy-loading.', minutes: 45 }),
    task('3.2', 3, P3, 'Production domain nebula-store.app', { who: 'toi', ...ok(now, 1) }),
  ], now, 0.1, 45);
  return {
    config: { projectId: 'orbit-labs/nebula-store', name: 'nebula-store', brand: 'NEBULA STORE', title: 'Nebula Store', subtitle: 'Space goodies: catalogue, cart and checkout', file: 'suivi.json', artifactUrl: artifact('nebula-store'), theme: { primary: '#7C3AED', fonts } },
    data: suiviFile(tasks, now),
  };
}

export function todolistPlatform(now) {
  const P1 = 'Pilot console';
  const P2 = 'Flight API';
  const tasks = finish([
    task('1.1', 1, P1, 'Turborepo pipelines', ok(now, 30)),
    task('1.2', 1, P1, 'Overview dashboard', ok(now, 20)),
    task('1.3', 1, P1, 'Launch table with filters and CSV export', { toTest: true, minutes: 20 }),
    task('1.4', 1, P1, 'Role-based access for flight controllers', ok(now, 9)),
    task('1.5', 1, P1, 'Daily launch report email', { who: 'ensemble', ...ok(now, 6) }),
    task('2.1', 2, P2, 'Rate limits per ground station', ok(now, 3)),
    task('2.2', 2, P2, 'Replay a launch from recorded telemetry', { minutes: 120, why: 'Rehearse a countdown with real data.' }),
  ], now, 1, 35);
  return {
    config: { projectId: 'orbit-labs/mission-control', name: 'mission-control', brand: 'MISSION CONTROL', title: 'Mission Control', subtitle: 'Pilot console and flight API', file: 'suivi.json', artifactUrl: artifact('mission-control'), theme: { primary: '#0D9488', fonts } },
    data: suiviFile(tasks, now),
  };
}

export function todolistRocketApi(now) {
  const P1 = 'Missions API';
  const P2 = 'Reliability';
  const tasks = finish([
    task('1.1', 1, P1, 'Missions and launches endpoints', ok(now, 26)),
    task('1.2', 1, P1, 'Cursor pagination on /v1/missions', ok(now, 1)),
    task('1.3', 1, P1, 'OpenAPI spec and examples', ok(now, 14)),
    task('1.4', 1, P1, 'Filter launches by pad and status', ok(now, 9)),
    task('1.5', 1, P1, 'Validate payloads with JSON schemas', ok(now, 7)),
    task('2.1', 2, P2, 'Structured logs with request ids', ok(now, 12)),
    task('2.2', 2, P2, 'Health check for the countdown clock', ok(now, 5)),
    task('2.3', 2, P2, 'Retry webhooks with exponential backoff', ok(now, 4)),
    task('2.4', 2, P2, 'Load test: 2,000 requests per second', ok(now, 3)),
    task('2.5', 2, P2, 'Graceful shutdown during a launch window', ok(now, 2)),
    task('2.6', 2, P2, 'Upgrade to Fastify 5', ok(now, 9)),
    task('2.7', 2, P2, 'Alert when a launch slips past T-0', { toTest: true, minutes: 25, why: 'Flight controllers must know within a minute.' }),
  ], now, 0.3, 30);
  return {
    config: { projectId: 'orbit-labs/rocket-api', name: 'rocket-api', brand: 'ROCKET API', title: 'Rocket API', subtitle: 'Missions and launches API', file: 'suivi.json', artifactUrl: artifact('rocket-api'), theme: { primary: '#EA580C', fonts } },
    data: suiviFile(tasks, now),
  };
}

export function todolistInsights(now) {
  const P1 = 'Telemetry analytics';
  const P2 = 'Reports';
  const tasks = finish([
    task('1.1', 1, P1, 'Ingest telemetry from launch-queue', ok(now, 21)),
    task('1.2', 1, P1, 'Altitude series per mission', ok(now, 3)),
    task('1.3', 1, P1, 'Trajectory endpoint with sampling', ok(now, 3)),
    task('1.4', 1, P1, 'Anomaly detection on engine temperature', { toTest: true, minutes: 40, check: 'Replay mission M-281: the spike at T+42 s is flagged.' }),
    task('1.5', 1, P1, 'Cache hot queries', ok(now, 8)),
    task('2.1', 2, P2, 'Weekly launch report (PDF)', ok(now, 10)),
    task('2.2', 2, P2, 'Compare two missions side by side', ok(now, 5)),
    task('2.3', 2, P2, 'Fuel efficiency chart', { minutes: 60 }),
    task('2.4', 2, P2, 'Share a report link with the crew', { who: 'ensemble', minutes: 30 }),
    task('2.5', 2, P2, 'Dark theme for charts', { minutes: 20 }),
  ], now, 3, 28);
  return {
    config: { projectId: 'orbit-labs/orbit-insights', name: 'orbit-insights', brand: 'ORBIT INSIGHTS', title: 'Orbit Insights', subtitle: 'Telemetry analytics and reports', file: 'suivi.json', artifactUrl: artifact('orbit-insights'), theme: { primary: '#2563EB', fonts } },
    data: suiviFile(tasks, now),
  };
}

export function todolistPilot(now) {
  const P1 = 'Crew app';
  const tasks = finish([
    task('1.1', 1, P1, 'Countdown screen with live T-minus', ok(now, 18)),
    task('1.2', 1, P1, 'Push notification at T-10 minutes', ok(now, 12)),
    task('1.3', 1, P1, 'Mission checklist with offline mode', ok(now, 10)),
    task('1.4', 1, P1, 'Sign in with the crew badge QR code', ok(now, 8)),
    task('1.5', 1, P1, 'Weather panel for the launch pad', ok(now, 6)),
    task('1.6', 1, P1, 'Haptic feedback on go / no-go', ok(now, 5)),
    task('1.7', 1, P1, 'Dark cockpit theme', ok(now, 4)),
    task('1.8', 1, P1, 'Accessibility labels on every control', ok(now, 3)),
    task('1.9', 1, P1, 'TestFlight beta for the crew', { who: 'toi', toTest: true, minutes: 30 }),
    task('1.10', 1, P1, 'Store screenshots and description', { who: 'ensemble', minutes: 45 }),
  ], now, 2, 20);
  return {
    config: { projectId: 'orbit-labs/pocket-pilot', name: 'pocket-pilot', brand: 'POCKET PILOT', title: 'Pocket Pilot', subtitle: 'Crew mobile app', file: 'suivi.json', artifactUrl: artifact('pocket-pilot'), theme: { primary: '#DB2777', fonts } },
    data: suiviFile(tasks, now),
  };
}

function suiviFile(tasks, now) {
  const live = tasks.filter((t) => !t.archived);
  const done = live.filter((t) => t.done).length;
  return {
    collection: 'tasks',
    exportedAt: new Date(now).toISOString(),
    counts: { total: live.length, done, remaining: live.length - done, toTest: live.filter((t) => t.toTest && !t.done).length },
    tasks,
  };
}

// ─── Fixtures du mode démo (server/demo) ────────────────────────────────────
export function fixtures(home) {
  return {
    machine: 'MacBook Pro',
    hostname: 'macbook-pro',
    ips: [{ iface: 'en0', address: '192.168.1.42' }],
    github: {
      login: 'orbit-labs',
      repos: [
        { owner: 'orbit-labs', name: 'nebula-store', description: 'Nebula Store — space goodies: catalogue, cart and checkout', language: 'JavaScript', pushedAt: '-2d' },
        { owner: 'orbit-labs', name: 'rocket-api', description: 'Launch catalogue REST API: missions, rockets, launch windows', language: 'JavaScript', pushedAt: '-1d' },
        { owner: 'orbit-labs', name: 'launch-queue', description: 'Launch task queue (BullMQ)', language: 'JavaScript', pushedAt: '-4d', private: true },
        { owner: 'orbit-labs', name: 'mission-control', description: 'Mission control console: pilot dashboard and flight API', language: 'TypeScript', pushedAt: '-3h', private: true },
        { owner: 'orbit-labs', name: 'orbit-insights', description: 'Trajectory analytics API (FastAPI)', language: 'Python', pushedAt: '-7d', private: true },
        { owner: 'orbit-labs', name: 'telemetry-tools', description: 'Export and check launch telemetry from the CLI', language: 'Python', pushedAt: '-35d', private: true },
        { owner: 'orbit-labs', name: 'pocket-pilot', description: 'Pocket Pilot: launches on your phone (Expo)', language: 'TypeScript', pushedAt: '-16d' },
        { owner: 'orbit-labs', name: 'launchpad-docs', description: 'Public developer docs (Astro)', language: 'MDX', pushedAt: '-8d' },
        { owner: 'orbit-labs', name: 'satellite-cli', description: 'Health checks for Orbit Labs services, from the terminal', language: 'Go', pushedAt: '-240d' },
        { owner: 'orbit-labs', name: 'zero-gravity-ui', description: 'Design system: tokens, icons and React components', language: 'TypeScript', pushedAt: '-5h' },
        { owner: 'orbit-labs', name: 'deep-space-infra', description: 'Terraform modules and CI pipelines', language: 'HCL', pushedAt: '-6d', private: true },
        { owner: 'orbit-labs', name: 'star-tracker', description: 'Public status page for every launch service', language: 'Svelte', pushedAt: '-21d' },
        { owner: 'orbit-labs', name: 'comet-pipelines', description: 'Nightly telemetry ETL (dbt + Airflow)', language: 'Python', pushedAt: '-11d', private: true },
        { owner: 'orbit-labs', name: 'meteor-assets', description: 'Logos and press kit', language: null, pushedAt: '-400d', archived: true },
        { owner: 'orbit-labs-oss', name: 'gravity-kit', description: 'Open-source physics helpers for orbital mechanics', language: 'TypeScript', pushedAt: '-14d' },
        { owner: 'orbit-labs-oss', name: 'stardust-icons', description: 'Fork: space-themed icon set', language: 'TypeScript', pushedAt: '-60d', fork: true },
      ],
    },
    ghCli: { installed: true, loggedIn: true, user: 'orbit-labs' },
    supabase: {
      instances: [
        {
          projectId: 'mission-control', status: 'running', ports: { api: 64321, db: 64322, studio: 64323, mail: 64324 },
          services: [
            ['analytics', 'supabase/logflare:1.12.0'], ['auth', 'supabase/gotrue:v2.170.0'], ['db', 'supabase/postgres:17.4.1.054'],
            ['edge_runtime', 'supabase/edge-runtime:v1.67.4'], ['inbucket', 'inbucket/inbucket:3.0.3'], ['kong', 'library/kong:2.8.1'],
            ['meta', 'supabase/postgres-meta:v0.88.9'], ['pooler', 'supabase/supavisor:2.4.14'], ['realtime', 'supabase/realtime:v2.34.47'],
            ['rest', 'postgrest/postgrest:v12.2.12'], ['storage', 'supabase/storage-api:v1.22.7'], ['studio', 'supabase/studio:2025.10.20'], ['vector', 'timberio/vector:0.28.1-alpine'],
          ].map(([name, image]) => ({ name, image: `public.ecr.aws/${image}`, state: 'running', status: name === 'db' ? 'Up 3 hours (healthy)' : 'Up 3 hours' })),
        },
        {
          projectId: 'orbit-insights', status: 'stopped', ports: { api: 65321, db: 65322, studio: 65323, mail: 65324 },
          services: [['auth', 'supabase/gotrue:v2.170.0'], ['db', 'supabase/postgres:17.4.1.054'], ['kong', 'library/kong:2.8.1'], ['rest', 'postgrest/postgrest:v12.2.12'], ['studio', 'supabase/studio:2025.10.20']]
            .map(([name, image]) => ({ name, image: `public.ecr.aws/${image}`, state: 'exited', status: 'Exited (0) 2 days ago' })),
        },
      ],
    },
    // Vue Docker : conteneurs compose de rocket-api et launch-queue, un conteneur isolé ; les stacks Supabase
    // (mission-control, orbit-insights) sont ajoutées par le serveur à partir de `supabase.instances`.
    docker: {
      engine: { name: 'Docker Desktop 4.40.0', version: '28.0.4', cpus: 12, memTotalGb: 16 },
      images: { count: 23, sizeGb: 9.6 },
      volumes: { count: 9, sizeGb: 1.8 },
      containers: [
        { name: 'rocket-api-postgres-1', image: 'postgres:17-alpine', project: 'rocket-api', service: 'postgres', workingDir: '~/Developer/rocket-api', state: 'running', health: 'healthy', since: '-5h', ports: [[5432, 55432]], cpu: 1.6, memMb: 74, netMb: [38, 52] },
        { name: 'rocket-api-redis-1', image: 'redis:7-alpine', project: 'rocket-api', service: 'redis', workingDir: '~/Developer/rocket-api', state: 'running', health: 'healthy', since: '-5h', ports: [[6379, 56379]], cpu: 0.7, memMb: 12, memLimitMb: 256, netMb: [9, 14] },
        { name: 'rocket-api-adminer-1', image: 'adminer:5', project: 'rocket-api', service: 'adminer', workingDir: '~/Developer/rocket-api', state: 'running', since: '-5h', ports: [[8080, 8088]], cpu: 0.1, memMb: 21, netMb: [2, 6] },
        { name: 'launch-queue-redis-1', image: 'redis:7-alpine', project: 'launch-queue', service: 'redis', workingDir: '~/Developer/launch-queue', state: 'running', health: 'healthy', since: '-26h', ports: [[6379, 56380]], cpu: 2.3, memMb: 18, memLimitMb: 512, netMb: [212, 188] },
        { name: 'launch-queue-worker-1', image: 'orbit/launch-queue-worker:0.9.0', project: 'launch-queue', service: 'worker', workingDir: '~/Developer/launch-queue', state: 'exited', exitCode: 1, since: '-40m' },
        { name: 'mailpit', image: 'axllent/mailpit:v1.21', state: 'running', since: '-2d', ports: [[8025, 8025], [1025, 1025]], cpu: 0.2, memMb: 23, netMb: [1, 1] },
      ],
    },
    android: {
      sdk: '~/Library/Android/sdk',
      checks: [
        { id: 'brew', label: 'Homebrew', ok: true, detail: 'Installed' },
        { id: 'jdk', label: 'JDK 17 (Temurin)', ok: true, detail: '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home' },
        { id: 'cmdline', label: 'Android cmdline-tools', ok: true, detail: '~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager' },
        { id: 'platform-tools', label: 'platform-tools (adb)', ok: true, detail: '~/Library/Android/sdk/platform-tools/adb' },
        { id: 'emulator', label: 'Android emulator', ok: true, detail: '~/Library/Android/sdk/emulator/emulator' },
        { id: 'avd', label: 'Virtual device (AVD)', ok: true, detail: '3 available' },
        { id: 'accel', label: 'Hardware acceleration', ok: true, detail: 'Hypervisor.Framework OS X Version 15.5' },
      ],
      avds: [
        { name: 'Pixel_9_API_36', device: 'pixel_9', api: '36', image: 'Google Play', state: 'ready', serial: 'emulator-5554' },
        { name: 'Pixel_7_API_35', device: 'pixel_7', api: '35', image: 'Google APIs', state: 'stopped', serial: null },
        { name: 'Pixel_Tablet_API_34', device: 'pixel_tablet', api: '34', image: 'Google Play', state: 'stopped', serial: null },
      ],
    },
    editors: [{ editor: 'vscode', editorLabel: 'VS Code', path: '~/Developer/nebula-store' }],
    claudeCommand: 'bin/claude',
    home,
  };
}
