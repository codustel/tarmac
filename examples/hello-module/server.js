// Server side of the example module: routes live under /api/modules/hello.
/** @param {import('@codustel/tarmac/modules').ModuleContext} ctx */
export function register(ctx) {
  const db = ctx.openDb([
    'CREATE TABLE visits (at TEXT NOT NULL)',
  ]);

  ctx.app.get('/summary', async () => {
    db.prepare('INSERT INTO visits (at) VALUES (?)').run(new Date().toISOString());
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM visits').get();
    return { visits: n, projects: ctx.core.projects().length, coreVersion: ctx.core.version, greeting: ctx.settings.get().greeting ?? null };
  });

  ctx.app.post('/greeting', async (req) => {
    const greeting = String(req.body?.greeting ?? '').slice(0, 80);
    return ctx.settings.set({ greeting });
  });
}
