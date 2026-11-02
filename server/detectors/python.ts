import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { tr } from '../i18n.js';
import { T, exists, readText, type Command, type Detector, type ServeSpec, type Tech } from './types.js';

const ENTRY_CANDIDATES = ['main.py', 'app.py', 'run.py', 'cli.py', 'bot.py', 'server.py', '__main__.py', 'src/main.py', 'app/main.py'];
const WEB_CANDIDATES = ['main.py', 'app.py', 'api.py', 'server.py', 'wsgi.py', 'asgi.py', 'app/main.py', 'src/main.py', 'src/app/main.py', 'app/__init__.py', 'streamlit_app.py', 'Home.py'];

interface Runner {
  pm: string;
  /** Préfixe pour exécuter python / un module. */
  python: string;
  module: (mod: string) => string;
  venv: string | null;
}

function resolveRunner(dir: string, names: Set<string>): Runner {
  const venv = ['.venv', 'venv', 'env'].find((v) => exists(dir, v, 'bin', 'python')) ?? null;
  if (names.has('uv.lock')) return { pm: 'uv', python: 'uv run python', module: (m) => `uv run python -m ${m}`, venv };
  if (names.has('poetry.lock') && !venv) return { pm: 'poetry', python: 'poetry run python', module: (m) => `poetry run python -m ${m}`, venv };
  if (names.has('Pipfile') && !venv) return { pm: 'pipenv', python: 'pipenv run python', module: (m) => `pipenv run python -m ${m}`, venv };
  if (venv) return { pm: names.has('poetry.lock') ? 'poetry' : 'pip', python: `${venv}/bin/python`, module: (m) => `${venv}/bin/python -m ${m}`, venv };
  return { pm: 'pip', python: 'python3', module: (m) => `python3 -m ${m}`, venv: null };
}

function readDeps(dir: string, names: Set<string>): { deps: Set<string>; pyproject: any } {
  const deps = new Set<string>();
  const add = (spec: string) => {
    const name = spec.trim().match(/^([A-Za-z0-9_.\-]+)/)?.[1];
    if (name) deps.add(name.toLowerCase().replace(/_/g, '-'));
  };
  let pyproject: any = null;
  if (names.has('pyproject.toml')) {
    try {
      pyproject = parseToml(readText(path.join(dir, 'pyproject.toml')) ?? '');
      (pyproject.project?.dependencies ?? []).forEach(add);
      Object.values(pyproject.project?.['optional-dependencies'] ?? {}).flat().forEach((d: any) => add(String(d)));
      Object.keys(pyproject.tool?.poetry?.dependencies ?? {}).forEach(add);
      Object.values(pyproject['dependency-groups'] ?? {}).flat().forEach((d: any) => typeof d === 'string' && add(d));
    } catch { /* pyproject invalide */ }
  }
  for (const n of names) {
    if (/^requirements.*\.txt$/.test(n)) {
      for (const line of (readText(path.join(dir, n)) ?? '').split('\n')) if (line && !line.startsWith('#') && !line.startsWith('-')) add(line);
    }
  }
  if (names.has('Pipfile')) {
    try {
      const pf = parseToml(readText(path.join(dir, 'Pipfile')) ?? '') as any;
      Object.keys({ ...pf.packages, ...pf['dev-packages'] }).forEach(add);
    } catch { /* Pipfile invalide */ }
  }
  return { deps, pyproject };
}

/** Trouve `fichier.py` + variable d'app (`app = FastAPI(`) parmi les candidats. */
function findApp(dir: string, re: RegExp): { file: string; module: string; variable: string } | null {
  for (const f of WEB_CANDIDATES) {
    const src = readText(path.join(dir, f));
    const m = src?.match(re);
    if (m) {
      const module = f.replace(/\/__init__\.py$/, '').replace(/\.py$/, '').replace(/\//g, '.');
      return { file: f, module, variable: m[1] ?? 'app' };
    }
  }
  return null;
}

function findImport(dir: string, mod: string): string | null {
  const re = new RegExp(`^\\s*(import|from)\\s+${mod}\\b`, 'm');
  return WEB_CANDIDATES.concat(ENTRY_CANDIDATES).find((f) => re.test(readText(path.join(dir, f)) ?? '')) ?? null;
}

const sh = (s: string) => s.split(' ');

export const detectPython: Detector = ({ dir, names, isGitRoot }) => {
  const hasMarker = ['pyproject.toml', 'setup.py', 'Pipfile', 'manage.py'].some((n) => names.has(n)) || [...names].some((n) => /^requirements.*\.txt$/.test(n));
  const rootPy = [...names].some((n) => n.endsWith('.py'));
  if (!hasMarker && !(isGitRoot && rootPy)) return null;

  const { deps, pyproject } = readDeps(dir, names);
  const r = resolveRunner(dir, names);
  const language = T('python', 'Python');
  const commands: Command[] = [];

  // Point d'entrée « console »
  const entry = ENTRY_CANDIDATES.find((f) => exists(dir, f));
  if (entry) commands.push({ id: `run:${entry}`, label: `python ${entry}`, cmd: `${r.python} ${entry}`, group: 'run' });
  for (const name of Object.keys(pyproject?.project?.scripts ?? pyproject?.tool?.poetry?.scripts ?? {})) {
    const cmd = r.pm === 'uv' ? `uv run ${name}` : r.pm === 'poetry' && !r.venv ? `poetry run ${name}` : r.venv ? `${r.venv}/bin/${name}` : name;
    commands.push({ id: `script:${name}`, label: name, cmd, group: 'run' });
  }

  let framework: Tech | null = null;
  let serve: ServeSpec | null = null;
  let kind: 'web' | 'service' | 'console' = 'console';

  if (names.has('manage.py') || deps.has('django')) {
    framework = T('django', 'Django');
    if (names.has('manage.py')) {
      kind = 'web';
      serve = { command: '', args: sh(`${r.python} manage.py runserver 127.0.0.1:{PORT}`), env: {}, fixedPort: null };
      commands.push(
        { id: 'django:migrate', label: 'migrate', cmd: `${r.python} manage.py migrate`, group: 'dev' },
        { id: 'django:makemigrations', label: 'makemigrations', cmd: `${r.python} manage.py makemigrations`, group: 'dev' },
        { id: 'django:shell', label: tr({ en: 'Django shell', fr: 'shell Django' }), cmd: `${r.python} manage.py shell`, group: 'tool' },
        { id: 'django:createsuperuser', label: 'createsuperuser', cmd: `${r.python} manage.py createsuperuser`, group: 'tool' },
      );
    }
  } else if (deps.has('fastapi')) {
    framework = T('fastapi', 'FastAPI');
    const app = findApp(dir, /(\w+)\s*=\s*FastAPI\(/);
    if (app) {
      kind = 'service';
      serve = { command: '', args: sh(`${r.module('uvicorn')} ${app.module}:${app.variable} --reload --host 127.0.0.1 --port {PORT}`), env: {}, fixedPort: null };
    }
  } else if (deps.has('flask')) {
    framework = T('flask', 'Flask');
    const app = findApp(dir, /(\w+)\s*=\s*Flask\(/);
    if (app) {
      kind = 'web';
      serve = { command: '', args: sh(`${r.module('flask')} --app ${app.module}:${app.variable} run --debug --host 127.0.0.1 --port {PORT}`), env: {}, fixedPort: null };
    }
  } else if (deps.has('streamlit')) {
    framework = T('streamlit', 'Streamlit');
    const file = findImport(dir, 'streamlit');
    if (file) {
      kind = 'web';
      serve = { command: '', args: sh(`${r.module('streamlit')} run ${file} --server.port {PORT} --server.address 127.0.0.1 --server.headless true`), env: {}, fixedPort: null };
    }
  } else if (deps.has('gradio')) {
    framework = T('gradio', 'Gradio');
    const file = findImport(dir, 'gradio');
    if (file) {
      kind = 'web';
      serve = { command: '', args: sh(`${r.python} ${file}`), env: { GRADIO_SERVER_PORT: '{PORT}', GRADIO_SERVER_NAME: '127.0.0.1' }, fixedPort: null };
    }
  } else if (deps.has('torch') || deps.has('tensorflow') || deps.has('scikit-learn') || deps.has('pandas')) {
    framework = deps.has('torch') ? T('pytorch', 'PyTorch') : deps.has('tensorflow') ? T('tensorflow', 'TensorFlow') : deps.has('pandas') ? T('pandas', 'pandas') : T('scikit-learn', 'scikit-learn');
  }
  if (serve) [serve.command, ...serve.args] = serve.args;

  // Outils
  if (deps.has('pytest') || exists(dir, 'tests') || exists(dir, 'pytest.ini')) commands.push({ id: 'test:pytest', label: 'pytest', cmd: r.module('pytest'), group: 'test' });
  if (deps.has('jupyter') || deps.has('jupyterlab') || deps.has('notebook')) commands.push({ id: 'tool:jupyter', label: 'Jupyter Lab', cmd: r.module('jupyter lab'), group: 'tool' });
  commands.push({ id: 'tool:repl', label: tr({ en: 'Python REPL', fr: 'REPL Python' }), cmd: r.python, group: 'tool' });

  const install =
    r.pm === 'uv' ? 'uv sync'
      : r.pm === 'poetry' ? 'poetry install'
        : r.pm === 'pipenv' ? 'pipenv install'
          : names.has('requirements.txt') ? `${r.venv ? `${r.venv}/bin/pip` : 'python3 -m pip'} install -r requirements.txt`
            : names.has('pyproject.toml') ? `${r.venv ? `${r.venv}/bin/pip` : 'python3 -m pip'} install -e .`
              : null;
  if (install) commands.push({ id: 'deps:install', label: install, cmd: install, group: 'deps' });
  if (!r.venv && r.pm === 'pip') commands.push({ id: 'deps:venv', label: tr({ en: 'create .venv', fr: 'créer .venv' }), cmd: 'python3 -m venv .venv', group: 'deps' });

  const venvAbs = r.venv ? path.join(dir, r.venv) : null;
  return {
    score: serve ? 5 : hasMarker ? 3 : 1,
    // Fichiers .py sans outillage (ni pyproject, ni requirements…) : simple script.
    loose: !hasMarker,
    kind,
    name: pyproject?.project?.name ?? pyproject?.tool?.poetry?.name,
    description: pyproject?.project?.description ?? pyproject?.tool?.poetry?.description ?? null,
    language,
    languages: [language],
    platform: T('python', 'Python'),
    framework,
    packageManager: r.pm,
    serve,
    commands,
    defaultCommand: commands.find((c) => c.group === 'run')?.id ?? null,
    env: { PYTHONUNBUFFERED: '1', ...(venvAbs ? { VIRTUAL_ENV: venvAbs } : {}) },
    pathPrepend: venvAbs ? [path.join(venvAbs, 'bin')] : [],
  };
};
