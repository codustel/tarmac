import setiFont from './seti.woff?url';
import { SETI } from './setiTheme';

// Police d'icônes Seti, chargée une seule fois.
if (typeof document !== 'undefined' && !document.getElementById('seti-font')) {
  const style = document.createElement('style');
  style.id = 'seti-font';
  style.textContent = `@font-face{font-family:seti;src:url(${setiFont}) format('woff');font-display:block}`;
  document.head.appendChild(style);
}

/**
 * Langages de VS Code par extension / nom de fichier : le thème Seti associe beaucoup d'icônes à un
 * identifiant de langage plutôt qu'à une extension (ex. `.ts` → typescript).
 */
const LANG_BY_EXT: Record<string, string> = {};
const LANG_BY_NAME: Record<string, string> = {};
const def = (lang: string, exts: string, names = '') => {
  for (const e of exts.split(' ').filter(Boolean)) LANG_BY_EXT[e] = lang;
  for (const n of names.split(' ').filter(Boolean)) LANG_BY_NAME[n.toLowerCase()] = lang;
};
def('typescript', 'ts cts mts');
def('typescriptreact', 'tsx');
def('javascript', 'js mjs cjs es6 pac');
def('javascriptreact', 'jsx');
def('json', 'json webmanifest har geojson jsonld map ipynb', 'composer.lock .watchmanconfig');
def('jsonc', 'jsonc code-workspace', '.eslintrc .eslintrc.json .babelrc jsconfig.json .jshintrc settings.json launch.json tasks.json keybindings.json extensions.json devcontainer.json .swcrc');
def('jsonl', 'jsonl ndjson');
def('markdown', 'md mkd mdwn mdown markdown markdn mdtxt mdtext mdx');
def('css', 'css');
def('scss', 'scss');
def('sass', 'sass');
def('less', 'less');
def('postcss', 'pcss postcss');
def('stylus', 'styl');
def('html', 'html htm shtml xhtml ejs jsp asp aspx');
def('vue', 'vue');
def('python', 'py pyw pyi rpy gyp gypi ipy', 'sconstruct sconscript');
def('ruby', 'rb rbx rjs gemspec rake ru podspec rbi', 'rakefile gemfile guardfile podfile capfile vagrantfile brewfile');
def('erb', 'erb');
def('php', 'php php4 php5 phtml ctp');
def('go', 'go');
def('rust', 'rs');
def('java', 'java jav');
def('kotlin', 'kt kts');
def('swift', 'swift');
def('dart', 'dart');
def('c', 'c i');
def('cpp', 'cpp cc cxx c++ hpp hh hxx h++ h ino inl ipp');
def('cuda-cpp', 'cu cuh');
def('csharp', 'cs csx cake');
def('fsharp', 'fs fsi fsx');
def('objective-c', 'm');
def('objective-cpp', 'mm');
def('sql', 'sql dsql');
def('shellscript', 'sh bash zsh ksh csh fish bashrc zshrc zprofile zshenv profile', '.envrc .bashrc .zshrc .zprofile .bash_profile pkgbuild apkbuild');
def('powershell', 'ps1 psm1 psd1');
def('bat', 'bat cmd');
def('yaml', 'yml yaml eyaml eyml cff');
def('xml', 'xml xsd xsl xslt plist csproj xaml resx props targets wsdl');
def('properties', 'properties cfg conf gitattributes gitconfig gitmodules editorconfig', '.gitattributes .gitconfig .gitmodules .editorconfig .npmrc');
def('dotenv', 'env', '.env');
def('ignore', '', '.gitignore .npmignore .dockerignore .eslintignore .prettierignore .vscodeignore .gcloudignore');
def('dockerfile', 'dockerfile', 'dockerfile containerfile');
def('dockercompose', '', 'docker-compose.yml docker-compose.yaml compose.yml compose.yaml');
def('makefile', 'mak mk', 'makefile gnumakefile');
def('lua', 'lua');
def('perl', 'pl pm pod psgi');
def('r', 'r rhistory rprofile');
def('julia', 'jl');
def('elixir', 'ex exs');
def('elm', 'elm');
def('haskell', 'hs lhs');
def('ocaml', 'ml mli');
def('clojure', 'clj cljs cljc edn');
def('groovy', 'groovy gvy nf', 'jenkinsfile');
def('gradle', 'gradle');
def('terraform', 'tf tfvars');
def('handlebars', 'handlebars hbs');
def('mustache', 'mustache');
def('jinja', 'j2 jinja jinja2');
def('nunjucks', 'njk');
def('jade', 'pug jade');
def('haml', 'haml');
def('latex', 'tex ltx');
def('tex', 'sty cls');
def('razor', 'cshtml razor');
def('coffeescript', 'coffee cson');
def('godot', 'gd');
def('bicep', 'bicep');
def('vala', 'vala');
def('rescript', 'res resi');
def('git-commit', '', 'commit_editmsg merge_msg');

/** Langage VS Code d'un fichier (aussi utilisé pour la coloration dans l'éditeur). */
export function languageOf(name: string): string | null {
  const lower = name.toLowerCase();
  if (LANG_BY_NAME[lower]) return LANG_BY_NAME[lower];
  if (lower.startsWith('.env.') || lower.endsWith('.env')) return 'dotenv';
  if (lower.startsWith('dockerfile.')) return 'dockerfile';
  if (/^docker-compose\..+\.ya?ml$/.test(lower)) return 'dockercompose';
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  return LANG_BY_EXT[ext] ?? null;
}

/** Résolution identique à VS Code : nom exact, puis extensions (la plus longue d'abord), puis langage. */
function resolve(name: string): string {
  const lower = name.toLowerCase();
  if (SETI.names[lower]) return SETI.names[lower];
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    if (SETI.ext[ext]) return SETI.ext[ext];
  }
  const lang = languageOf(name);
  return (lang && SETI.lang[lang]) || SETI.file;
}

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const [code, color] = resolve(name).split('|');
  return (
    <span
      aria-hidden
      className={className}
      style={{ fontFamily: 'seti', color, fontSize: 22, lineHeight: 1, width: 16, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}
    >
      {String.fromCodePoint(parseInt(code, 16))}
    </span>
  );
}
