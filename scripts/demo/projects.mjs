// Projets fictifs de l'espace de démo (thème spatial fictif : Orbit Labs). Chaque projet décrit ses fichiers, son
// historique git (messages en anglais, dates relatives), son état de synchronisation et ses changements non
// commités. Utilisé par create-demo.mjs.

const json = (o) => JSON.stringify(o, null, 2) + '\n';

/** Bannière SVG d'un README (illustration sans texte de marque réelle). */
const banner = (title, subtitle, from, to, glyph) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="1200" height="360" rx="28" fill="url(#g)"/>
  <circle cx="1040" cy="70" r="160" fill="#fff" opacity=".08"/><circle cx="1110" cy="300" r="110" fill="#fff" opacity=".08"/>
  <text x="80" y="170" font-family="Inter, Helvetica, Arial, sans-serif" font-size="68" font-weight="800" fill="#fff">${title}</text>
  <text x="82" y="230" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" fill="#fff" opacity=".85">${subtitle}</text>
  <text x="930" y="225" font-size="150">${glyph}</text>
</svg>
`;

const gitignoreNode = 'node_modules/\ndist/\n.env\n.env.local\n.DS_Store\n*.log\n';
const gitignorePy = '.venv/\n__pycache__/\n*.pyc\n.env\n.DS_Store\n';

// ─── Boutique Vite + React ──────────────────────────────────────────────────
const storeProducts = [
  { id: 1, name: 'Rocket Desk Lamp', price: 59, tag: 'Bestseller', emoji: '🚀', from: '#c7d2fe', to: '#f5d0fe', rating: 4.9 },
  { id: 2, name: 'Astronaut Mug', price: 22, tag: 'New', emoji: '☕', from: '#bfdbfe', to: '#ddd6fe', rating: 4.8 },
  { id: 3, name: 'Ringed Planet Lamp', price: 79, tag: '-20%', emoji: '🪐', from: '#fde68a', to: '#fbcfe8', rating: 4.7 },
  { id: 4, name: 'Moon Phase Poster', price: 29, tag: null, emoji: '🌙', from: '#e0e7ff', to: '#cbd5e1', rating: 4.6 },
  { id: 5, name: 'Galaxy Socks (3 pairs)', price: 19, tag: 'Gift idea', emoji: '🧦', from: '#ddd6fe', to: '#a5f3fc', rating: 4.5 },
  { id: 6, name: 'Satellite Model Kit', price: 45, tag: 'New', emoji: '🛰️', from: '#a5f3fc', to: '#c7d2fe', rating: 4.8 },
  { id: 7, name: 'Pocket Telescope', price: 89, tag: null, emoji: '🔭', from: '#fecaca', to: '#ddd6fe', rating: 4.7 },
  { id: 8, name: 'Star Map Puzzle', price: 34, tag: 'Eco', emoji: '⭐', from: '#fef3c7', to: '#fed7aa', rating: 4.9 },
];

const storefront = {
  dir: 'nebula-store',
  repo: 'orbit-labs/nebula-store',
  install: 'pnpm',
  files: {
    '.gitignore': gitignoreNode,
    'package.json': json({
      name: 'nebula-store', private: true, version: '1.4.0', type: 'module',
      description: 'Nebula Store — space goodies: catalogue, cart and checkout.',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', lint: 'eslint .', test: 'vitest run' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.4', vite: '^6.0.7' },
    }),
    'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛍️</text></svg>" />
    <title>Nebula Store — Gear for the space-curious</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    'src/main.jsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
    'src/products.js': `export const products = ${JSON.stringify(storeProducts, null, 2)};\n`,
    'src/App.jsx': `import { useState } from 'react';
import { products } from './products.js';
import ProductCard from './components/ProductCard.jsx';

const categories = ['All', 'Lighting', 'Kitchen', 'Posters', 'Gifts'];

export default function App() {
  const [cart, setCart] = useState([2, 4]);
  const [active, setActive] = useState('All');
  const total = cart.reduce((s, id) => s + products.find((p) => p.id === id).price, 0);
  return (
    <div className="page">
      <header className="nav">
        <div className="logo"><span className="logo-mark">✦</span> Nebula Store</div>
        <nav className="links"><a>Shop</a><a>Collections</a><a>Launch log</a><a>About</a></nav>
        <div className="nav-right">
          <input className="search" placeholder="Search the galaxy…" />
          <button className="cart">🛒 <span>{cart.length}</span> · \${total}</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">New: Mission 07 collection · Free shipping over $50</p>
          <h1>Gear for the<br />space-curious.</h1>
          <p className="lead">Lamps, posters and gifts inspired by rockets, planets and the night sky. Shipped from Earth, with care.</p>
          <div className="cta"><button className="primary">Shop the collection</button><button className="ghost">Gift cards</button></div>
        </div>
        <div className="hero-art"><span>🚀</span><div className="badge">★ 4.9 · 3,412 reviews</div></div>
      </section>

      <div className="chips">
        {categories.map((c) => <button key={c} className={c === active ? 'chip on' : 'chip'} onClick={() => setActive(c)}>{c}</button>)}
      </div>

      <main className="grid">
        {products.map((p) => <ProductCard key={p.id} product={p} inCart={cart.includes(p.id)} onAdd={() => setCart([...cart, p.id])} />)}
      </main>

      <footer className="footer">© 2026 Nebula Store · Made on Earth · <a>Shipping</a> · <a>Returns</a></footer>
    </div>
  );
}
`,
    'src/components/ProductCard.jsx': `export default function ProductCard({ product: p, inCart, onAdd }) {
  return (
    <article className="card">
      <div className="thumb" style={{ background: \`linear-gradient(135deg, \${p.from}, \${p.to})\` }}>
        <span className="emoji">{p.emoji}</span>
        {p.tag && <span className="tag">{p.tag}</span>}
      </div>
      <div className="info">
        <h3>{p.name}</h3>
        <div className="row">
          <span className="price">\${p.price}</span>
          <span className="rating">★ {p.rating}</span>
        </div>
        <button className={inCart ? 'add added' : 'add'} onClick={onAdd}>{inCart ? '✓ In cart' : 'Add to cart'}</button>
      </div>
    </article>
  );
}
`,
    'src/styles.css': `:root { --ink: #1f2937; --muted: #6b7280; --line: #e6e4f0; --bg: #f7f7fb; --accent: #7c3aed; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: var(--ink); background: var(--bg); }
* { box-sizing: border-box; }
body { margin: 0; }
button { font: inherit; cursor: pointer; }
.page { max-width: 1180px; margin: 0 auto; padding: 0 28px 40px; }
.nav { display: flex; align-items: center; gap: 28px; padding: 22px 0; }
.logo { font-weight: 800; font-size: 20px; letter-spacing: -.02em; }
.logo-mark { color: var(--accent); }
.links { display: flex; gap: 22px; color: var(--muted); font-size: 14px; }
.nav-right { margin-left: auto; display: flex; gap: 10px; }
.search { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 9px 16px; width: 220px; font: inherit; font-size: 13px; }
.cart { border: 0; background: var(--ink); color: #fff; border-radius: 999px; padding: 9px 16px; font-size: 13px; font-weight: 600; }
.hero { display: grid; grid-template-columns: 1.2fr 1fr; gap: 40px; align-items: center; background: radial-gradient(circle at 80% 20%, rgba(192,132,252,.35), transparent 40%), radial-gradient(circle at 15% 90%, rgba(56,189,248,.25), transparent 45%), linear-gradient(135deg, #0b1026, #1e1b4b 55%, #312e81); color: #fff; border-radius: 28px; padding: 48px 56px; margin-top: 6px; }
.eyebrow { color: #c4b5fd; font-weight: 600; font-size: 13px; margin: 0 0 10px; }
.hero h1 { font-size: 52px; line-height: 1.04; letter-spacing: -.035em; margin: 0 0 16px; }
.lead { color: #c7d2fe; max-width: 440px; line-height: 1.6; margin: 0 0 24px; }
.cta { display: flex; gap: 12px; }
.primary { background: var(--accent); color: #fff; border: 0; border-radius: 12px; padding: 13px 22px; font-weight: 600; box-shadow: 0 10px 24px -10px var(--accent); }
.ghost { background: rgba(255,255,255,.1); color: #fff; border: 1px solid rgba(255,255,255,.25); border-radius: 12px; padding: 13px 22px; font-weight: 600; }
.hero-art { position: relative; height: 250px; display: grid; place-items: center; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); border-radius: 24px; }
.hero-art span { font-size: 130px; }
.badge { position: absolute; bottom: 18px; right: 18px; background: #fff; color: #1f2937; border-radius: 999px; padding: 8px 14px; font-size: 12px; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,.08); }
.chips { display: flex; gap: 8px; margin: 30px 0 18px; }
.chip { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 7px 15px; font-size: 13px; color: var(--muted); }
.chip.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 20px; overflow: hidden; transition: transform .2s, box-shadow .2s; }
.card:hover { transform: translateY(-3px); box-shadow: 0 18px 40px -22px rgba(0,0,0,.35); }
.thumb { position: relative; height: 170px; display: grid; place-items: center; }
.emoji { font-size: 74px; filter: drop-shadow(0 10px 14px rgba(0,0,0,.15)); }
.tag { position: absolute; top: 12px; left: 12px; background: #fff; border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 700; }
.info { padding: 14px 16px 16px; }
.info h3 { font-size: 15px; margin: 0 0 6px; }
.row { display: flex; justify-content: space-between; margin-bottom: 12px; }
.price { font-weight: 700; }
.rating { color: #7c3aed; font-size: 13px; }
.add { width: 100%; border: 1px solid var(--ink); background: #fff; border-radius: 10px; padding: 9px; font-size: 13px; font-weight: 600; }
.add.added { background: #ecfdf5; border-color: #10b981; color: #047857; }
.footer { margin-top: 36px; color: var(--muted); font-size: 13px; text-align: center; }
@media (max-width: 760px) {
  .page { padding: 0 16px 28px; }
  .nav { gap: 12px; padding: 16px 0; }
  .links, .search { display: none; }
  .hero { grid-template-columns: 1fr; padding: 28px 24px; gap: 20px; border-radius: 22px; }
  .hero h1 { font-size: 34px; }
  .lead { font-size: 14px; margin-bottom: 18px; }
  .hero-art { height: 150px; }
  .hero-art span { font-size: 84px; }
  .chips { margin: 20px 0 14px; flex-wrap: wrap; }
  .grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .thumb { height: 120px; }
  .emoji { font-size: 54px; }
}
`,
    'docs/banner.svg': banner('Nebula Store', 'Space goodies · React + Vite · Supabase', '#4f46e5', '#c026d3', '🪐'),
    'README.md': `![Nebula Store](docs/banner.svg)

# Nebula Store

The online shop for **Nebula Store**, space goodies for the space-curious: catalogue, cart and checkout.

## Getting started

\`\`\`bash
pnpm install
pnpm dev        # http://localhost:5173
\`\`\`

## Stack

| Layer | Tech |
| --- | --- |
| UI | React 18 + Vite |
| Data | Supabase (Postgres, Auth, Storage) |
| Payments | Stripe Checkout (test mode in dev) |
| Hosting | Vercel |

## Scripts

- \`pnpm dev\` — local dev server with HMR
- \`pnpm build\` — production build in \`dist/\`
- \`pnpm test\` — unit tests (Vitest)

## Roadmap

- [x] Product grid and categories
- [x] Cart with persisted state
- [ ] Cart drawer with quantity controls
- [ ] Apple Pay / Google Pay
`,
    'CHANGELOG.md': '# Changelog\n',
    '.env.example': 'VITE_SUPABASE_URL=http://127.0.0.1:64321\nVITE_SUPABASE_ANON_KEY=your-anon-key\nVITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx\n',
    '.env.local': 'VITE_SUPABASE_URL=http://127.0.0.1:64321\nVITE_SUPABASE_ANON_KEY=demo-anon-key\n',
  },
  history: [
    { msg: 'Initial commit: Vite + React scaffold', age: '62d', only: ['.gitignore', 'package.json', 'vite.config.js', 'index.html', 'src/main.jsx'] },
    { msg: 'feat: product catalogue and product cards', age: '55d', add: ['src/products.js', 'src/components/ProductCard.jsx'] },
    { msg: 'feat: home page hero and category chips', age: '41d', add: ['src/App.jsx', 'src/styles.css'] },
    { msg: 'docs: README with stack and scripts', age: '33d', add: ['README.md', 'docs/banner.svg'] },
    { msg: 'chore: add env example for Supabase and Stripe', age: '27d', add: ['.env.example'] },
    { msg: 'fix: cart total rounding on discounted items', age: '19d' },
    { msg: 'feat: persist cart in localStorage', age: '12d' },
    { msg: 'perf: lazy-load product images', age: '6d' },
    { msg: 'feat: free shipping banner over $50', age: '2d' },
    { msg: 'style: refine card hover and spacing', age: '5h' },
  ],
  pushedBack: 2, // origin/main 2 commits derrière → « 2 à pousser »
  branch: 'feat/cart-drawer',
  dirty: {
    'src/components/CartDrawer.jsx': `export default function CartDrawer({ open, items, onClose }) {
  if (!open) return null;
  return (
    <aside className="drawer">
      <header><h2>Your cart</h2><button onClick={onClose}>×</button></header>
      {items.map((p) => <div key={p.id} className="line">{p.emoji} {p.name} <b>\${p.price}</b></div>)}
    </aside>
  );
}
`,
    'src/styles.css': { append: '\n.drawer { position: fixed; inset: 0 0 0 auto; width: 380px; background: #fff; box-shadow: -20px 0 60px rgba(0,0,0,.15); padding: 24px; }\n' },
  },
};

// ─── API Fastify ────────────────────────────────────────────────────────────
const api = {
  dir: 'rocket-api',
  repo: 'orbit-labs/rocket-api',
  install: 'pnpm',
  files: {
    '.gitignore': gitignoreNode,
    'package.json': json({
      name: 'rocket-api', private: true, version: '2.3.1', type: 'module',
      description: 'Launch catalogue REST API: missions, rockets, launch windows.',
      scripts: { dev: 'node --watch src/server.js', start: 'node src/server.js', test: 'node --test' },
      dependencies: { fastify: '^5.2.1', '@fastify/cors': '^10.0.2', 'pino-pretty': '^13.0.0' },
    }),
    'src/server.js': `import Fastify from 'fastify';
import cors from '@fastify/cors';
import { routes } from './routes.js';

const app = Fastify({
  logger: { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
});
await app.register(cors);
await app.register(routes, { prefix: '/v1' });

app.get('/health', async () => ({ status: 'ok', uptime: Math.round(process.uptime()) }));

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '127.0.0.1' });
app.log.info('Launch catalogue loaded: 128 missions, 14 launch sites');
`,
    'src/routes.js': `const launches = Array.from({ length: 24 }, (_, i) => ({ id: \`M-\${270 + i}\`, rocket: ['Comet II', 'Heron', 'Vega Lite'][i % 3], status: ['scheduled', 'go', 'landed'][i % 3] }));

export async function routes(app) {
  app.get('/missions', async (req) => ({ items: [], page: Number(req.query.page ?? 1), total: 128 }));
  app.get('/launches', async () => ({ items: launches }));
  app.get('/launches/:id', async (req, reply) => launches.find((l) => l.id === req.params.id) ?? reply.code(404).send({ error: 'Not found' }));
  app.post('/launches', async (req, reply) => reply.code(201).send({ id: \`M-\${300 + launches.length}\`, status: 'scheduled' }));
}
`,
    'docs/banner.svg': banner('Rocket API', 'Launch catalogue · Fastify · OpenAPI', '#0ea5e9', '#6366f1', '🚀'),
    'README.md': '![Rocket API](docs/banner.svg)\n\n# Rocket API\n\nLaunch catalogue REST API: missions, rockets and launch windows (Fastify 5).\n\n```bash\npnpm install\npnpm dev   # PORT=3000 by default\n```\n\n| Route | Description |\n| --- | --- |\n| `GET /health` | Liveness probe |\n| `GET /v1/missions` | Paginated mission catalogue |\n| `GET /v1/launches` | Upcoming launches |\n| `POST /v1/launches` | Schedule a launch |\n',
    'CHANGELOG.md': '# Changelog\n',
  },
  history: [
    { msg: 'Initial commit', age: '120d', only: ['.gitignore', 'package.json'] },
    { msg: 'feat: health endpoint and structured logging', age: '110d', add: ['src/server.js'] },
    { msg: 'feat: launches routes', age: '95d', add: ['src/routes.js'] },
    { msg: 'docs: API routes table', age: '70d', add: ['README.md', 'docs/banner.svg'] },
    { msg: 'feat: CORS for nebula-store', age: '40d' },
    { msg: 'fix: 404 on unknown launch id', age: '22d' },
    { msg: 'chore: upgrade to Fastify 5', age: '9d' },
    { msg: 'feat: pagination on /missions', age: '1d' },
  ],
};

// ─── Worker BullMQ ──────────────────────────────────────────────────────────
const jobs = {
  dir: 'launch-queue',
  repo: 'orbit-labs/launch-queue',
  install: 'pnpm',
  files: {
    '.gitignore': gitignoreNode,
    'package.json': json({
      name: 'launch-queue', private: true, version: '0.9.0', type: 'module',
      description: 'Launch task queue: countdowns, telemetry reports, weather checks (BullMQ).',
      scripts: { dev: 'node --watch src/worker.js', start: 'node src/worker.js' },
      dependencies: { bullmq: '^5.34.0' },
    }),
    'src/worker.js': `// Background worker. With REDIS_URL, jobs come from BullMQ queues; without it (local dev),
// an in-memory queue replays a realistic workload so the worker can be developed offline.
const queues = {
  countdown: ['notify-t-minus', 'sync-launch-window', 'send-go-poll'],
  telemetry: ['render-flight-report', 'archive-telemetry'],
  weather: ['check-pad-weather', 'check-upper-winds', 'refresh-forecast'],
  payload: ['build-manifest'],
};
const c = { dim: '\\x1b[2m', green: '\\x1b[32m', cyan: '\\x1b[36m', yellow: '\\x1b[33m', reset: '\\x1b[0m' };
const ts = () => new Date().toTimeString().slice(0, 8);
const log = (m) => console.log(\`\${c.dim}\${ts()}\${c.reset} \${m}\`);

if (process.env.REDIS_URL) {
  const { Worker } = await import('bullmq');
  for (const name of Object.keys(queues)) new Worker(name, async (job) => job.data, { connection: { url: process.env.REDIS_URL } });
  log(\`Connected to Redis, listening on \${Object.keys(queues).length} queues\`);
} else {
  log(\`\${c.yellow}REDIS_URL not set — using the in-memory queue (local development)\${c.reset}\`);
  log(\`Workers ready: \${Object.keys(queues).map((q) => c.cyan + q + c.reset).join(', ')} (concurrency 4)\`);
  let id = 18420;
  const tick = () => {
    const q = Object.keys(queues)[Math.floor(Math.random() * 4)];
    const names = queues[q];
    const name = names[Math.floor(Math.random() * names.length)];
    const ms = 40 + Math.floor(Math.random() * 600);
    const order = \`M-\${280 + Math.floor(Math.random() * 40)}\`;
    id += 1;
    log(\`\${c.cyan}[\${q}]\${c.reset} job \${id} \${name} (mission \${order}) \${c.green}✓ done\${c.reset} in \${ms} ms\`);
    setTimeout(tick, 350 + Math.random() * 900);
  };
  tick();
}
`,
    'README.md': '# launch-queue\n\nLaunch task queue: countdown notifications, telemetry reports, weather checks and payload manifests.\n\nQueues are powered by **BullMQ**. Without `REDIS_URL`, the worker uses an in-memory queue for local development.\n\n```bash\npnpm install\nREDIS_URL=redis://localhost:6379 pnpm dev\n```\n',
    'CHANGELOG.md': '# Changelog\n',
  },
  history: [
    { msg: 'Initial commit: BullMQ worker', age: '80d' },
    { msg: 'feat: flight report queue', age: '58d' },
    { msg: 'feat: in-memory queue for local development', age: '31d' },
    { msg: 'fix: retry weather checks with backoff', age: '4d' },
  ],
};

// ─── Monorepo Turborepo ─────────────────────────────────────────────────────
const platform = {
  dir: 'mission-control',
  repo: 'orbit-labs/mission-control',
  install: 'pnpm',
  files: {
    '.gitignore': gitignoreNode + '.turbo/\n',
    'package.json': json({
      name: 'mission-control', private: true,
      description: 'Mission control console: pilot dashboard and flight API.',
      scripts: { dev: 'turbo run dev', build: 'turbo run build', lint: 'turbo run lint' },
      devDependencies: { turbo: '^2.3.3' },
    }),
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
    'turbo.json': json({ $schema: 'https://turbo.build/schema.json', tasks: { dev: { cache: false, persistent: true }, build: { dependsOn: ['^build'], outputs: ['dist/**'] }, lint: {} } }),
    'apps/admin/package.json': json({
      name: '@orbit/admin', private: true, version: '0.6.0', type: 'module', description: 'Admin dashboard',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', '@orbit/ui': 'workspace:*' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.4', vite: '^6.0.7' },
    }),
    'apps/admin/vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
    'apps/admin/index.html': '<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>Mission Control</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>\n',
    'apps/admin/src/main.jsx': `import React from 'react';
import { createRoot } from 'react-dom/client';
import { Stat } from '@orbit/ui';

const stats = [['Launches (30d)', '12', '+3'], ['Success rate', '98.4%', '+0.6 pt'], ['Next window', 'T-02:14:09', '+12 min'], ['Scrubs', '1', '-2']];

function App() {
  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: 32, background: '#0f172a', minHeight: '100vh', color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 20px' }}>Mission Control · Overview</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>{stats.map(([l, v, d]) => <Stat key={l} label={l} value={v} delta={d} />)}</div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
`,
    'apps/api/package.json': json({
      name: '@orbit/internal-api', private: true, version: '0.4.2', type: 'module', description: 'Internal API (Express)',
      scripts: { dev: 'node --watch src/index.js', start: 'node src/index.js' },
      dependencies: { express: '^4.21.2' },
    }),
    'apps/api/src/index.js': `import express from 'express';

const app = express();
app.use(express.json());
app.use((req, _res, next) => { console.log(\`\${new Date().toTimeString().slice(0, 8)} \${req.method} \${req.url}\`); next(); });
app.get('/', (_req, res) => res.json({ service: 'flight-api', status: 'nominal', endpoints: ['/health', '/reports/daily'] }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/reports/daily', (_req, res) => res.json({ launches: 4, telemetryPoints: 734250 }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, '127.0.0.1', () => console.log(\`internal-api listening on http://localhost:\${port}\`));
`,
    'packages/ui/package.json': json({ name: '@orbit/ui', private: true, version: '0.3.0', type: 'module', main: 'src/index.jsx', description: 'Shared UI components', peerDependencies: { react: '^18.3.1' } }),
    'packages/ui/src/index.jsx': `export function Stat({ label, value, delta }) {
  const up = delta.startsWith('+');
  return (
    <div style={{ background: '#1e293b', borderRadius: 14, padding: 18 }}>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, margin: '6px 0' }}>{value}</div>
      <div style={{ fontSize: 12, color: up ? '#34d399' : '#f87171' }}>{delta}</div>
    </div>
  );
}
`,
    'supabase/config.toml': '# Supabase local (supabase start)\nproject_id = "mission-control"\n\n[api]\nport = 64321\n\n[db]\nport = 64322\n\n[studio]\nport = 64323\n\n[inbucket]\nport = 64324\n',
    'supabase/migrations/20260901120000_init.sql': 'create table public.launches (\n  id text primary key,\n  rocket text not null,\n  status text not null default \'pending\',\n  created_at timestamptz not null default now()\n);\n',
    'docs/banner.svg': banner('Mission Control', 'Turborepo · pilot console + flight API · Supabase', '#0d9488', '#2563eb', '🛰️'),
    'README.md': '![Mission Control](docs/banner.svg)\n\n# Mission Control\n\nPilot console monorepo (Turborepo + pnpm workspaces).\n\n| Package | Description |\n| --- | --- |\n| `apps/admin` | Admin dashboard (React + Vite) |\n| `apps/api` | Internal API (Express) |\n| `packages/ui` | Shared UI components |\n\n```bash\npnpm install\nsupabase start\npnpm dev\n```\n',
    'CHANGELOG.md': '# Changelog\n',
  },
  history: [
    { msg: 'Initial commit: Turborepo workspace', age: '150d', only: ['.gitignore', 'package.json', 'pnpm-workspace.yaml', 'turbo.json'] },
    { msg: 'feat(ui): shared Stat component', age: '140d', add: ['packages/ui/package.json', 'packages/ui/src/index.jsx'] },
    { msg: 'feat(admin): overview dashboard', age: '120d', add: ['apps/admin/package.json', 'apps/admin/vite.config.js', 'apps/admin/index.html', 'apps/admin/src/main.jsx'] },
    { msg: 'feat(api): daily reports endpoint', age: '100d', add: ['apps/api/package.json', 'apps/api/src/index.js'] },
    { msg: 'chore: local Supabase with launches table', age: '60d', add: ['supabase/config.toml', 'supabase/migrations/20260901120000_init.sql'] },
    { msg: 'docs: monorepo README', age: '45d', add: ['README.md', 'docs/banner.svg'] },
    { msg: 'fix(admin): negative deltas in red', age: '14d' },
    { msg: 'feat(api): request logging', age: '3d' },
  ],
  remoteAhead: ['feat(admin): launch table with filters', 'chore: bump turbo to 2.3', 'fix(api): timezone in daily report'],
};

// ─── API FastAPI (Python) ───────────────────────────────────────────────────
const insights = {
  dir: 'orbit-insights',
  repo: 'orbit-labs/orbit-insights',
  install: 'venv',
  pip: ['fastapi==0.115.6', 'uvicorn==0.34.0'],
  files: {
    '.gitignore': gitignorePy,
    'requirements.txt': 'fastapi==0.115.6\nuvicorn==0.34.0\n',
    'main.py': `"""Orbit Insights: trajectory analytics for mission control."""
import logging
import random

from fastapi import FastAPI

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("insights")

app = FastAPI(title="Orbit Insights", version="1.2.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/trajectories/{mission}")
def trajectory(mission: str, points: int = 60):
    log.info("computing trajectory for %s (%s points)", mission, points)
    return {"mission": mission, "altitude_km": [round(i * 6.5 + random.random(), 2) for i in range(points)]}


@app.get("/orbits/decay")
def decay(limit: int = 5):
    return {"items": ["SAT-114", "SAT-207", "SAT-311"][:limit]}
`,
    'supabase/config.toml': 'project_id = "orbit-insights"\n\n[api]\nport = 65321\n\n[db]\nport = 65322\n\n[studio]\nport = 65323\n',
    'README.md': '# Orbit Insights\n\nTrajectory analytics for mission control (FastAPI + Supabase).\n\n```bash\npython3 -m venv .venv\n.venv/bin/pip install -r requirements.txt\n.venv/bin/uvicorn main:app --reload\n```\n\nOpenAPI docs: `/docs`.\n',
    'CHANGELOG.md': '# Changelog\n',
  },
  history: [
    { msg: 'Initial commit: FastAPI service', age: '90d' },
    { msg: 'feat: trajectory endpoint', age: '75d' },
    { msg: 'feat: orbit decay report', age: '20d' },
    { msg: 'chore: pin dependencies', age: '7d' },
  ],
};

// ─── Script Python (console) ────────────────────────────────────────────────
const telemetry = {
  dir: 'telemetry-tools',
  repo: 'orbit-labs/telemetry-tools',
  files: {
    '.gitignore': gitignorePy,
    'pyproject.toml': '[project]\nname = "telemetry-tools"\nversion = "0.3.0"\ndescription = "Command-line helpers to export and check launch telemetry."\nrequires-python = ">=3.11"\n\n[project.scripts]\ntelemetry-tools = "telemetry_tools.cli:main"\n',
    'telemetry_tools/__init__.py': '__version__ = "0.3.0"\n',
    'telemetry_tools/cli.py': `"""Export and check launch telemetry from the command line."""
import argparse
import csv
import sys


def main() -> None:
    parser = argparse.ArgumentParser(prog="telemetry-tools", description=__doc__)
    parser.add_argument("command", choices=["export", "check"])
    parser.add_argument("--mission", default="M-284")
    args = parser.parse_args()
    writer = csv.writer(sys.stdout)
    writer.writerow(["t", "altitude_km", "velocity_kms"])
    for i in range(5):
        writer.writerow([f"T+{i * 10:03}s", round(i * 6.5, 1), round(1.2 + i * 0.4, 2)])


if __name__ == "__main__":
    main()
`,
    'main.py': 'from telemetry_tools.cli import main\n\nif __name__ == "__main__":\n    main()\n',
    'README.md': '# telemetry-tools\n\nCommand-line helpers to export and check launch telemetry.\n\n```bash\npython3 main.py export --mission M-284 > m284.csv\n```\n',
    'CHANGELOG.md': '# Changelog\n',
  },
  history: [
    { msg: 'Initial commit', age: '200d' },
    { msg: 'feat: CSV export', age: '180d' },
    { msg: 'feat: check command', age: '35d' },
  ],
  dirty: { 'telemetry_tools/cli.py': { append: '\n# TODO: support --format json\n' } },
};

// ─── App mobile Expo ────────────────────────────────────────────────────────
const mobile = {
  dir: 'pocket-pilot',
  repo: 'orbit-labs/pocket-pilot',
  files: {
    '.gitignore': gitignoreNode + '.expo/\nios/\nandroid/\n',
    'package.json': json({
      name: 'pocket-pilot', version: '1.1.0', main: 'expo-router/entry', private: true,
      description: 'Pocket Pilot: follow launches from your phone (iOS and Android).',
      scripts: { start: 'expo start', android: 'expo start --android', ios: 'expo start --ios', web: 'expo start --web' },
      dependencies: { expo: '~52.0.25', 'expo-router': '~4.0.16', react: '18.3.1', 'react-native': '0.76.6' },
    }),
    'app.json': json({ expo: { name: 'Pocket Pilot', slug: 'pocket-pilot', scheme: 'pocketpilot', version: '1.1.0', ios: { bundleIdentifier: 'app.pocketpilot' }, android: { package: 'app.pocketpilot' } } }),
    'app/index.tsx': "import { Text, View } from 'react-native';\n\nexport default function Home() {\n  return (\n    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>\n      <Text style={{ fontSize: 22, fontWeight: '700' }}>Pocket Pilot</Text>\n    </View>\n  );\n}\n",
    'README.md': '# Pocket Pilot\n\nExpo app (iOS and Android): live launch countdowns and mission alerts.\n\n```bash\npnpm install\npnpm android   # emulator\n```\n',
    'CHANGELOG.md': '# Changelog\n',
  },
  history: [
    { msg: 'Initial commit: Expo Router app', age: '70d' },
    { msg: 'feat: home screen', age: '50d' },
    { msg: 'chore: upgrade to Expo SDK 52', age: '16d' },
  ],
};

// ─── Site Astro ─────────────────────────────────────────────────────────────
const docs = {
  dir: 'launchpad-docs',
  repo: 'orbit-labs/launchpad-docs',
  install: 'pnpm',
  files: {
    '.gitignore': gitignoreNode + '.astro/\n',
    'package.json': json({ name: 'launchpad-docs', type: 'module', version: '0.5.0', private: true, description: 'Public developer docs and changelog.', scripts: { dev: 'astro dev', build: 'astro build', preview: 'astro preview' }, dependencies: { astro: '^5.1.5' } }),
    'astro.config.mjs': "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({ site: 'https://launchpad-docs.dev' });\n",
    'src/pages/index.astro': `---
const guides = ['Quick start', 'Authentication', 'Launches API', 'Launch webhooks', 'Rate limits'];
---
<html lang="en">
  <head><meta charset="utf-8" /><title>Launchpad Docs</title></head>
  <body style="font-family: Inter, system-ui, sans-serif; max-width: 760px; margin: 60px auto; color: #111827;">
    <h1>Launchpad Docs</h1>
    <p>Build on Orbit Labs: Rocket API, launch webhooks and SDKs.</p>
    <ul>{guides.map((g) => <li>{g}</li>)}</ul>
  </body>
</html>
`,
    'README.md': '# Launchpad Docs\n\nPublic developer documentation for Orbit Labs, built with Astro.\n\n```bash\npnpm install\npnpm dev\n```\n',
    'CHANGELOG.md': '# Changelog\n',
  },
  history: [
    { msg: 'Initial commit: Astro site', age: '45d' },
    { msg: 'docs: authentication guide', age: '30d' },
    { msg: 'docs: webhooks and rate limits', age: '8d' },
  ],
};

// ─── CLI Go ─────────────────────────────────────────────────────────────────
const satellite = {
  dir: 'satellite-cli',
  repo: 'orbit-labs/satellite-cli',
  files: {
    '.gitignore': 'bin/\n.DS_Store\n',
    'go.mod': 'module github.com/orbit-labs/satellite-cli\n\ngo 1.23\n',
    'main.go': `// satellite-cli checks the health of Orbit Labs services from the terminal.
package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	targets := os.Args[1:]
	if len(targets) == 0 {
		targets = []string{"https://rocket-api.dev/health"}
	}
	client := http.Client{Timeout: 5 * time.Second}
	for _, t := range targets {
		start := time.Now()
		res, err := client.Get(t)
		if err != nil {
			fmt.Printf("✗ %s  %v\\n", t, err)
			continue
		}
		fmt.Printf("✓ %s  %d  %s\\n", t, res.StatusCode, time.Since(start).Round(time.Millisecond))
	}
}
`,
    'README.md': '# satellite-cli\n\nA tiny Go CLI that checks the health of Orbit Labs services.\n\n```bash\ngo run . https://rocket-api.dev/health\n```\n',
    'CHANGELOG.md': '# Changelog\n',
  },
  history: [
    { msg: 'Initial commit: health checker', age: '300d' },
    { msg: 'feat: multiple targets', age: '260d' },
    { msg: 'feat: timeout and latency', age: '240d' },
  ],
};

export const PROJECTS = [storefront, api, jobs, platform, insights, telemetry, mobile, docs, satellite];
