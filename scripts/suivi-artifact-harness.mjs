// Banc d'essai du gabarit d'artefact : sert la page rendue avec un faux `window.claude`
// (db en mémoire + mcp qui relaie vers l'instance de test de Tarmac avec le jeton artefact).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Instance de démo (scripts/demo/run-demo.sh) : jeton artefact lu dans son dossier de données, jamais ~/.tarmac.
const DEMO_HOME = process.env.DEMO_HOME ?? path.join(os.homedir(), 'tarmac-demo-home');
const token = fs.readFileSync(process.env.SUIVI_ENV ?? path.join(DEMO_HOME, '.tarmac', 'env'), 'utf8').match(/^SUIVI_ARTIFACT_TOKEN=(.*)$/m)[1];
const API = `http://127.0.0.1:${process.env.DEMO_PORT ?? 7790}`;

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
    // #cancel : l'utilisateur refuse l'appel dans Claude desktop ; #offline : Tarmac non connecté.
    if (location.hash === '#offline') throw { code: 'server_not_connected', message: 'not connected' };
    if (location.hash === '#cancel' && tool === 'suivi_dispatch') throw { code: 'cancelled', message: 'declined' };
    const H = { 'content-type': 'application/json', 'x-suivi-token': '${token}' };
    const r = tool === 'suivi_pull'
      ? await fetch('/api/suivi/projects/' + p + '/changes?since=' + input.since)
      : tool === 'suivi_sessions'
        ? await fetch('/api/suivi/projects/' + p + '/sessions', { headers: H })
        : tool === 'suivi_dispatch'
          ? await fetch('/api/suivi/projects/' + p + '/tasks/' + encodeURIComponent(input.taskId) + '/dispatch', { method: 'POST', headers: H, body: JSON.stringify({ target: input.target }) })
          : await fetch('/api/suivi/projects/' + p + '/push', { method: 'POST', headers: H, body: JSON.stringify({ tasks: input.tasks, channel: 'A' }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw { code: 'tool_error', message: e.error, result: { content: [{ type: 'text', text: 'Error: ' + (e.error ?? r.status) }] } }; }
    const payload = await r.json();
    return { payload: tool === 'suivi_sessions' ? { sessions: payload } : payload };
  } };
  window.__docs = docs;
  window.claude = { use: async (n) => (n === 'db' ? db : n === 'mcp' ? (location.hash === '#phone' ? null : mcp) : null) };
  // Presse-papiers du banc : la dernière consigne copiée reste lisible (window.__clip).
  try { navigator.clipboard.writeText = async (x) => { window.__clip = x; }; } catch (e) {}
})();
</script>`;

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
    const r = await fetch(API + req.url, { method: req.method, headers: { 'content-type': 'application/json', 'x-suivi-token': req.headers['x-suivi-token'] ?? '' }, body: req.method === 'GET' ? undefined : body });
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(await r.text());
  }
  if (new URL(req.url, 'http://x').pathname !== '/') { res.writeHead(404); return res.end(); }
  // Page : le rendu de Tarmac, avec des tâches de départ « anciennes » (copie de l'artefact, sans updatedAt).
  const pid = encodeURIComponent(new URL(req.url, 'http://x').searchParams.get('p') ?? 'acme/shop');
  const html = await (await fetch(API + '/api/suivi/projects/' + pid + '/artifact.html')).text();
  const exp = await (await fetch(API + '/api/suivi/projects/' + pid + '/export')).json();
  if (!Array.isArray(exp.tasks)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(exp.error ?? 'projet inconnu'); }
  const seed = exp.tasks.map((t) => ({ ...t, updatedAt: null }));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>${mock(seed)}${html}</body></html>`);
}).listen(7795, () => console.log('banc d’essai : http://localhost:7795'));
