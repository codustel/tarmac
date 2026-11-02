import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { T, exists, readJson, readText, type Command, type Detector } from './types.js';

/** Go : go.mod */
export const detectGo: Detector = ({ dir, names }) => {
  if (!names.has('go.mod')) return null;
  const mod = readText(path.join(dir, 'go.mod')) ?? '';
  const http = [['gin-gonic/gin', 'gin', 'Gin'], ['labstack/echo', 'echo', 'Echo'], ['gofiber/fiber', 'fiber', 'Fiber'], ['go-chi/chi', 'chi', 'chi']].find(([m]) => mod.includes(m));
  const commands: Command[] = [
    { id: 'go:run', label: 'go run .', cmd: 'go run .', group: 'run' },
    { id: 'go:test', label: 'go test', cmd: 'go test ./...', group: 'test' },
    { id: 'go:build', label: 'go build', cmd: 'go build ./...', group: 'dev' },
    { id: 'go:tidy', label: 'go mod tidy', cmd: 'go mod tidy', group: 'deps' },
  ];
  const go = T('go', 'Go');
  return {
    score: http ? 4 : 3,
    kind: http ? 'service' : 'console',
    name: mod.match(/^module\s+(\S+)/m)?.[1]?.split('/').pop(),
    language: go, platform: go, framework: http ? T(http[1], http[2]) : null, packageManager: 'go',
    serve: http ? { command: 'go', args: ['run', '.'], env: {}, fixedPort: null } : null,
    commands, defaultCommand: 'go:run',
  };
};

/** Rust : Cargo.toml */
export const detectRust: Detector = ({ dir, names }) => {
  if (!names.has('Cargo.toml')) return null;
  let cargo: any = {};
  try { cargo = parseToml(readText(path.join(dir, 'Cargo.toml')) ?? ''); } catch { /* invalide */ }
  const deps = Object.keys(cargo.dependencies ?? {});
  const http = [['actix-web', 'actix', 'Actix Web'], ['axum', 'axum', 'Axum'], ['rocket', 'rocket', 'Rocket'], ['warp', 'warp', 'warp']].find(([d]) => deps.includes(d));
  const tauri = deps.includes('tauri');
  const rust = T('rust', 'Rust');
  return {
    score: http ? 4 : 3,
    kind: http ? 'service' : 'console',
    name: cargo.package?.name, description: cargo.package?.description ?? null,
    language: rust, platform: rust, framework: http ? T(http[1], http[2]) : tauri ? T('tauri', 'Tauri') : null, packageManager: 'cargo',
    serve: http ? { command: 'cargo', args: ['run'], env: {}, fixedPort: null } : null,
    commands: [
      { id: 'cargo:run', label: 'cargo run', cmd: 'cargo run', group: 'run' },
      { id: 'cargo:test', label: 'cargo test', cmd: 'cargo test', group: 'test' },
      { id: 'cargo:build', label: 'cargo build --release', cmd: 'cargo build --release', group: 'dev' },
    ],
    defaultCommand: 'cargo:run',
  };
};

/** PHP : Laravel (artisan) ou serveur PHP intégré. */
export const detectPhp: Detector = ({ dir, names }) => {
  const composer = names.has('composer.json') ? readJson(path.join(dir, 'composer.json')) : null;
  const laravel = names.has('artisan');
  const docroot = exists(dir, 'public', 'index.php') ? 'public' : names.has('index.php') ? '.' : null;
  if (!composer && !laravel && !docroot) return null;
  const commands: Command[] = [];
  if (composer) commands.push({ id: 'composer:install', label: 'composer install', cmd: 'composer install', group: 'deps' });
  if (laravel) commands.push(
    { id: 'artisan:migrate', label: 'artisan migrate', cmd: 'php artisan migrate', group: 'dev' },
    { id: 'artisan:tinker', label: 'artisan tinker', cmd: 'php artisan tinker', group: 'tool' },
    { id: 'artisan:test', label: 'artisan test', cmd: 'php artisan test', group: 'test' },
  );
  const serve = laravel
    ? { command: 'php', args: ['artisan', 'serve', '--host=127.0.0.1', '--port={PORT}'], env: {}, fixedPort: null }
    : docroot ? { command: 'php', args: ['-S', '127.0.0.1:{PORT}', '-t', docroot], env: {}, fixedPort: null } : null;
  const php = T('php', 'PHP');
  return {
    score: serve ? 4 : 2,
    kind: serve ? 'web' : 'console',
    name: composer?.name?.split('/').pop(), description: composer?.description ?? null,
    language: php, platform: php, framework: laravel ? T('laravel', 'Laravel') : null, packageManager: composer ? 'composer' : null,
    serve, commands, defaultCommand: null,
  };
};

/** Ruby : Rails ou projet Bundler. */
export const detectRuby: Detector = ({ dir, names }) => {
  if (!names.has('Gemfile')) return null;
  const rails = exists(dir, 'bin', 'rails');
  const ruby = T('ruby', 'Ruby');
  return {
    score: rails ? 4 : 2,
    kind: rails ? 'web' : 'console',
    language: ruby, platform: ruby, framework: rails ? T('rails', 'Ruby on Rails') : null, packageManager: 'bundler',
    serve: rails ? { command: 'bin/rails', args: ['server', '-b', '127.0.0.1', '-p', '{PORT}'], env: {}, fixedPort: null } : null,
    commands: [
      { id: 'bundle:install', label: 'bundle install', cmd: 'bundle install', group: 'deps' },
      ...(rails ? [
        { id: 'rails:console', label: 'rails console', cmd: 'bin/rails console', group: 'tool' as const },
        { id: 'rails:migrate', label: 'db:migrate', cmd: 'bin/rails db:migrate', group: 'dev' as const },
      ] : []),
    ],
    defaultCommand: null,
  };
};

/** Deno : deno.json(c) */
export const detectDeno: Detector = ({ dir, names }) => {
  const file = names.has('deno.json') ? 'deno.json' : names.has('deno.jsonc') ? 'deno.jsonc' : null;
  if (!file || names.has('package.json')) return null;
  const cfg = readJson(path.join(dir, file)) ?? {};
  const tasks = Object.keys(cfg.tasks ?? {});
  const fresh = JSON.stringify(cfg.imports ?? {}).includes('$fresh');
  const dev = ['dev', 'start'].find((t) => tasks.includes(t));
  return {
    score: fresh && dev ? 4 : 2,
    kind: fresh && dev ? 'web' : 'console',
    language: T('typescript', 'TypeScript'), platform: T('deno', 'Deno'), framework: fresh ? T('fresh', 'Fresh') : null, packageManager: 'deno',
    serve: fresh && dev ? { command: 'deno', args: ['task', dev], env: {}, fixedPort: null } : null,
    commands: tasks.map((t) => ({ id: `task:${t}`, label: t, cmd: `deno task ${t}`, group: 'run' as const })),
    defaultCommand: dev ? `task:${dev}` : null,
  };
};

/** Site statique : index.html sans outillage → servi par le serveur HTTP de Python. */
export const detectStatic: Detector = ({ names }) => {
  if (!names.has('index.html') || names.has('package.json')) return null;
  return {
    score: 1.5,
    loose: true,
    kind: 'web',
    language: T('html', 'HTML'), platform: null, framework: T('static', 'Site statique'), packageManager: null,
    serve: { command: 'python3', args: ['-m', 'http.server', '{PORT}', '--bind', '127.0.0.1'], env: {}, fixedPort: null },
    commands: [], defaultCommand: null,
  };
};

/** Docker Compose seul. */
export const detectCompose: Detector = ({ names }) => {
  const file = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find((f) => names.has(f));
  if (!file) return null;
  return {
    score: 1.2,
    kind: 'console',
    language: T('docker', 'Docker'), platform: T('docker', 'Docker'), framework: T('compose', 'Compose'), packageManager: null,
    commands: [
      { id: 'compose:up', label: 'compose up', cmd: 'docker compose up', group: 'run' },
      { id: 'compose:ps', label: 'compose ps', cmd: 'docker compose ps', group: 'tool' },
      { id: 'compose:down', label: 'compose down', cmd: 'docker compose down', group: 'tool' },
    ],
    defaultCommand: 'compose:up',
  };
};

const EXT_LANG: Record<string, [string, string]> = {
  '.sh': ['shell', 'Shell'], '.swift': ['swift', 'Swift'], '.kt': ['kotlin', 'Kotlin'], '.java': ['java', 'Java'],
  '.dart': ['dart', 'Dart'], '.c': ['c', 'C'], '.cpp': ['cpp', 'C++'], '.cs': ['csharp', 'C#'], '.md': ['markdown', 'Markdown'],
  '.ipynb': ['jupyter', 'Jupyter'], '.lua': ['lua', 'Lua'], '.js': ['javascript', 'JavaScript'], '.ts': ['typescript', 'TypeScript'],
  '.py': ['python', 'Python'], '.go': ['go', 'Go'], '.rb': ['ruby', 'Ruby'], '.php': ['php', 'PHP'], '.rs': ['rust', 'Rust'],
};

/** Dépôt git sans outillage reconnu : langage deviné d'après les fichiers à la racine. */
export const detectBareRepo: Detector = ({ names, isGitRoot }) => {
  if (!isGitRoot) return null;
  // Les fichiers Markdown (notes, docs) ne font pas un projet.
  const counts = new Map<string, number>();
  for (const n of names) {
    const l = EXT_LANG[path.extname(n)];
    if (l && l[0] !== 'markdown') counts.set(l[0], (counts.get(l[0]) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) return null;
  const entry = Object.values(EXT_LANG).find(([id]) => id === top)!;
  return {
    score: 0.5,
    loose: true,
    kind: 'other',
    language: T(entry[0], entry[1]),
    platform: null, framework: null, packageManager: null, commands: [], defaultCommand: null,
  };
};
