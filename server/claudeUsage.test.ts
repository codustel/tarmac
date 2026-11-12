import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_MS, ClaudeUsageService, USAGE_URL, parseCredentials, parseUsage, planLabel, type Credentials, type UsageDeps } from './claudeUsage.js';
import { demoClaudeUsage, type DemoFixtures } from './demo/index.js';

// Jeton factice : il ne doit jamais apparaître dans une réponse de la route.
const FAKE_TOKEN = 'sk-ant-oat01-FAKE-TEST-TOKEN-0123456789';
const creds = (over: Partial<Credentials> = {}): Credentials => ({ accessToken: FAKE_TOKEN, expiresAt: null, subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x', ...over });

/** Réponse au format réel de l'API (valeurs inventées). */
const apiBody = (over: Record<string, unknown> = {}) => ({
  five_hour: { utilization: 42, resets_at: '2026-11-03T15:00:00.000Z' },
  seven_day: { utilization: 63, resets_at: '2026-11-06T09:00:00.000Z', limit_dollars: null },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false },
  limits: [
    { kind: 'weekly_all', group: 'weekly', percent: 63, severity: 'normal', resets_at: '2026-11-06T09:00:00.000Z', scope: null, is_active: true },
    { kind: 'weekly_scoped', group: 'weekly', percent: 28, severity: 'normal', resets_at: 1_794_000_000, scope: { model: { id: 'x', display_name: 'Fable' }, surface: null }, is_active: false },
  ],
  spend: { used: { amount_minor: 0 } },
  ...over,
});

function service(over: Partial<UsageDeps> & { body?: unknown; status?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let now = 1_000_000;
  const deps: UsageDeps = {
    readCredentials: async () => creds(),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(over.body ?? apiBody()), { status: over.status ?? 200 });
    }) as typeof fetch,
    now: () => now,
    demo: () => null,
    enabled: () => true,
    ...over,
  };
  return { svc: new ClaudeUsageService(deps), calls, tick: (ms: number) => (now += ms) };
}

test('parseUsage : session, semaine et limite hebdomadaire Fable', () => {
  const l = parseUsage(apiBody());
  assert.deepEqual(l.map((x) => [x.id, x.label, x.utilization]), [['session', null, 42], ['week', null, 63], ['model:fable', 'Fable', 28]]);
  assert.equal(l[2].resetsAt, new Date(1_794_000_000 * 1000).toISOString(), 'resets_at en secondes → ISO');
});

test('parseUsage : session absente (plan sans limite de session) → masquée', () => {
  const l = parseUsage(apiBody({ five_hour: null }));
  assert.deepEqual(l.map((x) => x.id), ['week', 'model:fable']);
  assert.deepEqual(parseUsage(apiBody({ five_hour: { utilization: null, resets_at: null } })).map((x) => x.id), ['week', 'model:fable']);
});

test('parseUsage : model_scoped et anciens champs, sans doublon', () => {
  const l = parseUsage(apiBody({
    limits: [],
    model_scoped: [{ display_name: 'Fable', utilization: 10, resets_at: null }],
    seven_day_sonnet: { utilization: 5, resets_at: null },
  }));
  assert.deepEqual(l.map((x) => x.id), ['session', 'week', 'model:fable', 'model:sonnet']);
  assert.deepEqual(parseUsage(null), []);
  assert.deepEqual(parseUsage({ limits: 'x', five_hour: 'y' }), []);
});

test('planLabel : noms lisibles, valeur brute si inconnue', () => {
  assert.equal(planLabel('max', 'default_claude_max_20x'), 'Max 20x');
  assert.equal(planLabel('max', 'default_claude_max_5x'), 'Max 5x');
  assert.equal(planLabel('max', null), 'Max');
  assert.equal(planLabel('pro', 'default_claude_ai'), 'Pro');
  assert.equal(planLabel('team', null), 'Team');
  assert.equal(planLabel('enterprise', null), 'Enterprise');
  assert.equal(planLabel('galaxy', null), 'galaxy');
  assert.equal(planLabel(null, null), null);
});

test('parseCredentials : JSON de Claude Code, ou null', () => {
  const c = parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN, expiresAt: 5, subscriptionType: 'pro', rateLimitTier: 't' } }));
  assert.equal(c?.subscriptionType, 'pro');
  assert.equal(parseCredentials('{}'), null);
  assert.equal(parseCredentials('pas du json'), null);
});

test('get : appelle seulement api.anthropic.com, jeton absent de la réponse', async () => {
  const { svc, calls } = service();
  const r = await svc.get();
  assert.equal(r.status, 'ok');
  assert.equal(r.plan, 'Max 20x');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, 'https://api.anthropic.com');
  assert.equal(calls[0].url, USAGE_URL);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${FAKE_TOKEN}`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN));
  assert.deepEqual(Object.keys(r).sort(), ['fetchedAt', 'limits', 'plan', 'status']);
});

test('get : réponse sans fuite même en erreur (jeton dans le corps renvoyé par le serveur)', async () => {
  const { svc } = service({ status: 500, body: { echo: FAKE_TOKEN } });
  const r = await svc.get();
  assert.equal(r.status, 'error');
  assert.equal(r.error, 'http-500');
  assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN));
});

test('get : cache d\'une minute, une seule requête pour des appels simultanés', async () => {
  const { svc, calls, tick } = service();
  await Promise.all([svc.get(), svc.get(), svc.get()]);
  await svc.get();
  assert.equal(calls.length, 1);
  tick(CACHE_MS + 1);
  await svc.get();
  assert.equal(calls.length, 2);
});

test('get : pas connecté, jeton expiré, 401, réseau', async () => {
  const none = service({ readCredentials: async () => null });
  assert.equal((await none.svc.get()).status, 'not-connected');
  assert.equal(none.calls.length, 0);

  const expired = service({ readCredentials: async () => creds({ expiresAt: 1 }) });
  const e = await expired.svc.get();
  assert.equal(e.status, 'expired');
  assert.equal(e.plan, 'Max 20x');
  assert.equal(expired.calls.length, 0, 'jamais d\'appel ni de renouvellement avec un jeton expiré');

  assert.equal((await service({ status: 401 }).svc.get()).status, 'expired');
  const net = service({ fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
  assert.deepEqual(await net.svc.get(), { status: 'error', plan: 'Max 20x', limits: [], fetchedAt: null, error: 'network' });
});

test('get : désactivé dans les réglages → rien n\'est lu', async () => {
  let read = 0;
  const { svc, calls } = service({ enabled: () => false, readCredentials: async () => { read++; return creds(); } });
  assert.equal((await svc.get()).status, 'disabled');
  assert.equal(read, 0);
  assert.equal(calls.length, 0);
});

test('mode démo : Max 20x, 42 / 63 / Fable 28, sans appel réseau', async () => {
  const d = demoClaudeUsage({} as DemoFixtures, Date.parse('2026-11-03T10:00:00Z'));
  assert.equal(d.plan, 'Max 20x');
  assert.deepEqual(d.limits.map((l) => [l.id, l.utilization]), [['session', 42], ['week', 63], ['model:fable', 28]]);
  const { svc, calls } = service({ demo: () => d, readCredentials: async () => { throw new Error('ne doit pas être lu'); } });
  assert.equal((await svc.get()).plan, 'Max 20x');
  assert.equal(calls.length, 0);
  const noSession = demoClaudeUsage({ claudeUsage: { plan: 'Pro', session: null, week: 10, models: [] } } as unknown as DemoFixtures);
  assert.deepEqual(noSession.limits.map((l) => l.id), ['week']);
});

const never = <T>() => new Promise<T>(() => {});

test('get : readCredentials qui ne rend jamais la main → erreur timeout bornée, inflight libérée', async () => {
  let reads = 0;
  const { svc, tick } = service({ timeoutMs: 20, readCredentials: () => { reads++; return never(); } });
  const r = await svc.get();
  assert.deepEqual(r, { status: 'error', plan: null, limits: [], fetchedAt: null, error: 'timeout' });
  assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN));
  assert.equal(reads, 1);
  await svc.get();
  assert.equal(reads, 1, 'échec mis en cache le temps du TTL normal');
  tick(CACHE_MS + 1);
  await svc.get();
  assert.equal(reads, 2, 'cache expiré : nouvelle lecture (inflight libérée)');
});

test('get : fetch (réponse ou r.json()) qui ne se termine jamais → erreur timeout bornée', async () => {
  for (const f of [
    (() => never<Response>()) as typeof fetch,
    (async () => ({ status: 200, ok: true, json: () => never() })) as unknown as typeof fetch,
  ]) {
    let calls = 0;
    const { svc, tick } = service({ timeoutMs: 20, fetch: ((...a: unknown[]) => { calls++; return (f as any)(...a); }) as typeof fetch });
    const r = await svc.get();
    assert.equal(r.status, 'error');
    assert.equal(r.error, 'timeout');
    assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN));
    tick(CACHE_MS + 1);
    await svc.get();
    assert.equal(calls, 2, 'nouvel appel après le délai');
  }
});
