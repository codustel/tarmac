#!/usr/bin/env node
// Captures et enregistrements de l'instance de démo (scripts/demo/run-demo.sh) avec Playwright (Chromium).
//
//   node scripts/demo/capture.mjs [--url http://localhost:7790] [--out notes/publication/captures]
//        [--only scene1,scene2] [--forbidden <fichier>[,<fichier>…]]
//
// Playwright n'est pas une dépendance du dépôt : PLAYWRIGHT_CORE pointe vers un dossier `playwright-core`
// (ou `playwright`), CHROMIUM_PATH vers un exécutable Chromium si celui de Playwright n'est pas installé.
//
// Contrôle avant chaque capture : le texte de la page (innerText de tous les cadres, valeurs des champs),
// les journaux des apps et le contenu des consoles (HOME factice noté ~) ne doivent contenir aucun motif de
// notes/publication/mots-interdits.txt ni aucune entrée des listes --forbidden (noms de dépôts réels, nom de
// la machine, IP : à générer au moment de l'exécution, jamais commitées). Un motif trouvé arrête tout.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const value = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const URL_ = value('--url', 'http://localhost:7790').replace(/\/$/, '');
const OUT = path.resolve(value('--out', path.join(ROOT, 'notes/publication/captures')));
const ONLY = value('--only', '').split(',').filter(Boolean);
const FORBIDDEN = value('--forbidden', '').split(',').filter(Boolean);
const want = (scene) => !ONLY.length || ONLY.includes(scene);
/** Fenêtre de capture (×2 : PNG et vidéos en 3840×2160). */
const VW = 1920, VH = 1080;

const require_ = createRequire(path.join(process.env.PLAYWRIGHT_CORE ?? ROOT, 'noop.js'));
const { chromium } = process.env.PLAYWRIGHT_CORE ? require_(process.env.PLAYWRIGHT_CORE) : require_('playwright');

const say = (m) => console.log(`\x1b[1;34m▸\x1b[0m ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── API de l'instance ──────────────────────────────────────────────────────
async function api(p, method = 'GET', body) {
  const r = await fetch(URL_ + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${data?.error ?? ''}`);
  return data;
}
const projects = () => api('/api/projects');
const projectId = async (name) => (await projects()).find((p) => p.name === name)?.id ?? (() => { throw new Error(`Projet inconnu : ${name}`); })();
async function waitStatus(name, status, timeout = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = (await projects()).find((x) => x.name === name);
    if (p?.runtime.status === status) return;
    await sleep(300);
  }
  throw new Error(`${name} : statut ${status} non atteint`);
}

// ─── Contrôle des données réelles ───────────────────────────────────────────
const listLines = (file) => fs.readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim()).filter(Boolean);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = [
  ...listLines(path.join(ROOT, 'notes/publication/mots-interdits.txt')).map((p) => ({ re: new RegExp(p, 'i'), label: `mots-interdits: ${p}` })),
  // Entrées de moins de 4 caractères ignorées (mot courant, ex. un nom d'hôte « mac ») : signalées dans le rapport.
  ...FORBIDDEN.flatMap((f) => listLines(f).flatMap((w, i) => (w.length < 4 ? [] : [{ re: new RegExp(`(?<![\\w-])${esc(w)}(?![\\w-])`, 'i'), label: `${path.basename(f)}#${i + 1}` }]))),
];
// Nom public du paquet et de son dépôt (lien open source dans l'interface) : pas une donnée privée.
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PUBLIC = [PKG.name, PKG.name.replace(/^@/, '')].map((n) => new RegExp(esc(n), 'gi'));
const SKIPPED = FORBIDDEN.reduce((n, f) => n + listLines(f).filter((w) => w.length < 4).length, 0);
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

/** Texte des consoles (tampons rejoués par le WebSocket) et journaux des apps. */
async function backendText() {
  const parts = [];
  for (const p of await projects()) parts.push((await api(`/api/projects/${p.id}/logs`)).map?.((l) => l.text ?? l.line ?? JSON.stringify(l)).join('\n') ?? '');
  const terms = await api('/api/terminals');
  if (terms.length) {
    const ws = new WebSocket(URL_.replace(/^http/, 'ws') + '/ws');
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const got = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'term:replay') got.set(m.sid, m.data); };
    for (const t of terms) ws.send(JSON.stringify({ type: 'term:attach', sid: t.id }));
    const t0 = Date.now();
    while (got.size < terms.length && Date.now() - t0 < 3000) await sleep(50);
    ws.close();
    for (const t of terms) parts.push(`${t.label}\n${stripAnsi(got.get(t.id) ?? '')}`);
  }
  // HOME factice de la démo (journaux d'outils qui affichent des chemins absolus, ex. uvicorn --reload) : noté `~`
  // dans les journaux non affichés ; le texte de la page, lui, est contrôlé tel quel.
  const { home } = await api('/api/meta');
  return home ? parts.join('\n').replaceAll(home, '~') : parts.join('\n');
}

const report = [];
async function guard(page, file) {
  const texts = [];
  for (const f of page.frames()) {
    try {
      texts.push(await f.evaluate(() => [document.title, document.body?.innerText ?? '', ...[...document.querySelectorAll('input, textarea')].map((e) => e.value)].join('\n')));
    } catch { /* cadre en cours de navigation */ }
  }
  let corpus = texts.join('\n') + '\n' + (await backendText());
  for (const re of PUBLIC) corpus = corpus.replace(re, '');
  const hits = PATTERNS.filter((p) => p.re.test(corpus)).map((p) => p.label);
  report.push({ file: path.relative(OUT, file), chars: corpus.length, ok: !hits.length, hits });
  if (hits.length) {
    // Contexte des motifs publics seulement (jamais le texte d'une liste --forbidden).
    for (const p of PATTERNS.filter((p) => p.label.startsWith('mots-interdits') && p.re.test(corpus))) {
      const i = corpus.search(p.re);
      console.error(`  ${p.label} : …${corpus.slice(Math.max(0, i - 80), i + 60).replace(/\s+/g, ' ')}…`);
    }
    throw new Error(`Donnée interdite dans ${file} : ${hits.join(', ')}`);
  }
}

// ─── Captures ───────────────────────────────────────────────────────────────
const index = [];
let browser;
async function newPage({ lang = 'en', theme = 'dark', server = true } = {}) {
  if (server) await api('/api/settings', 'PUT', { theme, language: lang }); // server: false → réglages de Tarmac inchangés
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, colorScheme: theme, locale: lang === 'fr' ? 'fr-FR' : 'en-US' });
  await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); } catch { /* */ } }, [theme]);
  // Aucun appel réseau hors de la machine (polices, CDN…) : seules les adresses locales sont servies.
  await ctx.route('**/*', (route) => (/^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(route.request().url()) || route.request().url().startsWith('data:') ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  return page;
}
async function go(page, hash) {
  await page.goto(`${URL_}/#${hash}`);
  await page.waitForLoadState('networkidle').catch(() => null);
  await sleep(1200);
}
/** Capture contrôlée : `<scène>/<langue>-<thème>[-NN].png`. */
async function shot(page, scene, variant, desc, opts = {}) {
  const file = path.join(OUT, scene, `${variant}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.mouse.move(VW - 1, VH - 1); // pas de survol parasite
  await sleep(opts.wait ?? 300);
  await guard(page, file);
  await page.screenshot({ path: file, ...(opts.clip ? { clip: opts.clip } : {}) });
  index.push({ file: path.relative(OUT, file), desc });
  say(path.relative(OUT, file));
}

/**
 * Enregistrement net : images du screencast Chrome (3840×2160) assemblées à 30 i/s par ffmpeg (H.264, MP4).
 * Contrôle avant et après la séquence.
 */
async function record(page, name, desc, fn) {
  const dir = path.join(OUT, 'videos');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tarmac-rec-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.mp4`);
  await guard(page, file);
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => null);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW * 2, maxHeight: VH * 2, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await fn();
  await sleep(400);
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await guard(page, file);
  // Liste ffmpeg (concat) : chaque image dure jusqu'à la suivante ; la dernière jusqu'à la fin.
  const lines = [];
  frames.forEach((f, i) => {
    const p = path.join(tmp, `f${String(i).padStart(5, '0')}.jpg`);
    fs.writeFileSync(p, Buffer.from(f.data, 'base64'));
    const next = frames[i + 1]?.t ?? t1;
    const start = i === 0 ? Math.min(f.t, t0) : f.t;
    lines.push(`file '${p}'`, `duration ${Math.max(0.001, next - start).toFixed(4)}`);
  });
  lines.push(`file '${path.join(tmp, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
  fs.writeFileSync(path.join(tmp, 'list.txt'), lines.join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'),
    '-vf', `fps=30,scale=${VW * 2}:${VH * 2}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', file]);
  fs.rmSync(tmp, { recursive: true, force: true });
  index.push({ file: path.relative(OUT, file), desc: `${desc} (${(t1 - t0).toFixed(1)} s, ${frames.length} images source)` });
  say(`${path.relative(OUT, file)} (${frames.length} images)`);
}

// ─── Artefact Todolist (côté claude.ai) rendu en local ───────────────────────
/**
 * Sert le gabarit d'artefact rendu par l'instance (`/api/suivi/projects/<id>/artifact.html`) avec un faux
 * `window.claude` : base en mémoire remplie avec l'export des tâches, pas de pont MCP (comme sur mobile).
 */
async function serveArtifact(projectId, port = 7796) {
  const pid = encodeURIComponent(projectId);
  const html = await (await fetch(`${URL_}/api/suivi/projects/${pid}/artifact.html`)).text();
  const seed = (await api(`/api/suivi/projects/${pid}/export`)).tasks;
  const mock = `<script>(function(){
  const docs = new Map(${JSON.stringify(seed)}.map((t) => { const { id, ...d } = t; return [id, d]; }));
  const subs = [];
  const emit = () => { const list = [...docs].map(([id, d]) => ({ id, data: () => ({ ...d }) })).sort((a, b) => (a.data().order || 0) - (b.data().order || 0)); subs.forEach((cb) => cb({ docs: list })); };
  const db = { collection: () => ({
    orderBy: () => ({ onSnapshot: (cb) => { subs.push(cb); setTimeout(emit, 50); return () => {}; } }),
    doc: (id) => ({ update: async (d) => { docs.set(id, { ...docs.get(id), ...d }); emit(); }, set: async (d) => { docs.set(id, { ...d }); emit(); } }),
  }) };
  window.claude = { use: async (n) => (n === 'db' ? db : null) };
})();</script>`;
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${mock}${html}</body></html>`;
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://localhost:${port}/`, close: () => new Promise((r) => server.close(r)) };
}

// ─── Éléments de l'interface ────────────────────────────────────────────────
/** Ligne d'un projet dans la vue Projets (le plus petit bloc qui contient son nom et un bouton d'action). */
const row = (page, name) => page.locator('div').filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole('button', { name: /^(Start|Stop|Run|Démarrer|Arrêter|Lancer|Start all|Tout démarrer)$/ }) }).last();
const openPanel = async (page, name) => { await page.getByText(name, { exact: true }).first().click(); await sleep(800); };
/** Panneau latéral d'un projet (onglets Logs, Navigateur, Console…). */
const panel = (page) => page.locator('div[class*="w-[46%]"]');
const panelTab = async (page, label) => { await panel(page).getByRole('button', { name: label }).first().click(); await sleep(900); };


// ─── Scénario ───────────────────────────────────────────────────────────────
const { scenario, COVERAGE } = await import('./scenes.mjs');
browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failed = null;
try {
  await scenario({ api, projects, projectId, waitStatus, shot, record, newPage, go, row, openPanel, panel, panelTab, serveArtifact, sleep, say, want });
} catch (e) {
  failed = e;
} finally {
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  const prev = fs.existsSync(path.join(OUT, 'controle.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'controle.json'), 'utf8')) : { checks: [], index: [] };
  const merge = (a, b) => [...new Map([...a, ...b].map((x) => [x.file + (x.desc ? '' : ''), x])).values()];
  const checks = ONLY.length ? merge(prev.checks, report) : report;
  const idx = ONLY.length ? merge(prev.index, index) : index;
  fs.writeFileSync(path.join(OUT, 'controle.json'), JSON.stringify({ at: new Date().toISOString(), patterns: PATTERNS.length, skippedShortEntries: SKIPPED, checks, index: idx }, null, 2));
  // index.md : chaque fichier et ce qu'il montre, par scène.
  const byScene = new Map();
  for (const e of [...idx].sort((a, b) => a.file.localeCompare(b.file))) {
    const scene = e.file.split('/')[0];
    byScene.set(scene, [...(byScene.get(scene) ?? []), e]);
  }
  const md = ['# Captures et enregistrements de Tarmac (démo)', '',
    'Instance de démo isolée (`scripts/demo/run-demo.sh`), captures `scripts/demo/capture.mjs` : Chromium 1920×1080,',
    '`deviceScaleFactor` 2 (PNG 3840×2160), vidéos MP4 H.264 3840×2160 à 30 i/s. Nommage `<scène>/<langue>-<thème>[-NN].png`.',
    `Contrôle des données réelles : ${checks.length} contrôles, ${checks.filter((c) => !c.ok).length} échec(s) (détail : \`controle.json\`).`, '',
    '## Couverture des fonctionnalités', '', '| Fonctionnalité (README) | Captures et vidéos |', '| --- | --- |'];
  const files = new Set(idx.map((e) => e.file));
  for (const { feature, files: list } of COVERAGE) {
    const found = list.flatMap((f) => [...files].filter((x) => x === f || x.startsWith(f)));
    md.push(`| ${feature} | ${found.length ? [...new Set(found)].map((f) => `[\`${f}\`](${f})`).join(' · ') : '**manquant**'} |`);
  }
  md.push('');
  for (const [scene, list] of byScene) {
    md.push(`## ${scene}`, '', '| Fichier | Contenu |', '| --- | --- |');
    for (const e of list) md.push(`| [\`${e.file}\`](${e.file}) | ${e.desc} |`);
    md.push('');
  }
  fs.writeFileSync(path.join(OUT, 'index.md'), md.join('\n'));
}
if (failed) { console.error(`\x1b[1;31m✗\x1b[0m ${failed.stack ?? failed}`); process.exit(1); }
say(`${index.length} fichiers, ${report.length} contrôles, ${report.filter((r) => !r.ok).length} échec(s), ${PATTERNS.length} motifs`);
