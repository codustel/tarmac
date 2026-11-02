// Banc d'essai du gabarit d'artefact : sert la page rendue avec un faux `window.claude`
// (db en mémoire + mcp qui relaie vers l'instance de test de Tarmac avec le jeton artefact).
import http from 'node:http';
import fs from 'node:fs';
const SP = new URL('.', import.meta.url).pathname;
const token = fs.readFileSync(SP + 'data/env', 'utf8').match(/^SUIVI_ARTIFACT_TOKEN=(.*)$/m)[1];
const API = 'http://127.0.0.1:7790';

const mock = (seed) => `<script>
(function(){
  const docs = new Map(${JSON.stringify(seed)}.map(t => { const {id, ...d} = t; return [id, d]; }));
  const subs = [];
  const emit = () => { const list = [...docs].map(([id, d]) => ({ id, data: () => ({...d}) })).sort((a, b) => (a.data().order||0) - (b.data().order||0)); subs.forEach(cb => cb({ docs: list })); };
  const db = { collection: () => ({
    orderBy: () => ({ onSnapshot: (cb) => { subs.push(cb); setTimeout(emit, 50); return () => {}; } }),
    doc: (id) => ({
      update: async (d) => { docs.set(id, { ...docs.get(id), ...d }); window.__writes = (window.__writes||0) + 1; emit(); },
      set: async (d) => { docs.set(id, { ...d }); window.__sets = (window.__sets||0) + 1; emit(); },
    }),
  }) };
  const mcp = { callTool: async (server, tool, input) => {
    window.__calls = (window.__calls||[]).concat(tool);
    const p = encodeURIComponent(input.projectId);
    const r = tool === 'suivi_pull'
      ? await fetch('/api/suivi/projects/' + p + '/changes?since=' + input.since)
      : await fetch('/api/suivi/projects/' + p + '/push', { method: 'POST', headers: { 'content-type': 'application/json', 'x-suivi-token': '${token}' }, body: JSON.stringify({ tasks: input.tasks, channel: 'A' }) });
    if (!r.ok) throw { code: 'tool_error', message: await r.text() };
    return { payload: await r.json() };
  } };
  window.__docs = docs;
  window.claude = { use: async (n) => (n === 'db' ? db : n === 'mcp' ? (location.hash === '#phone' ? null : mcp) : null) };
})();
</script>`;

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
    const r = await fetch(API + req.url, { method: req.method, headers: { 'content-type': 'application/json', 'x-suivi-token': req.headers['x-suivi-token'] ?? '' }, body: req.method === 'GET' ? undefined : body });
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(await r.text());
  }
  // Page : le rendu de Tarmac, avec des tâches de départ « anciennes » (copie de l'artefact, sans updatedAt).
  const pid = encodeURIComponent(new URL(req.url, 'http://x').searchParams.get('p') ?? 'acme/shop');
  const html = await (await fetch(API + '/api/suivi/projects/' + pid + '/artifact.html')).text();
  const seed = (await (await fetch(API + '/api/suivi/projects/' + pid + '/export')).json()).tasks.map((t) => ({ ...t, updatedAt: null }));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>${mock(seed)}${html}</body></html>`);
}).listen(7795, () => console.log('banc d’essai : http://localhost:7795'));
