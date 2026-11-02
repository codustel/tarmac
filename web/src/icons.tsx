import {
  siActix, siAngular, siAstro, siBun, siComposer, siCreatereactapp, siDeno, siDiscord, siDjango, siDocker, siElectron, siExpo,
  siExpress, siFastapi, siFastify, siFlask, siGatsby, siGin, siGnubash, siGo, siGradio, siHono, siHtml5, siJavascript,
  siJupyter, siKoa, siKotlin, siLaravel, siMarkdown, siNestjs, siNextdotjs, siNodedotjs, siNpm, siNuxt, siNx, siPandas,
  siPhp, siPnpm, siPoetry, siPypi, siPython, siPytorch, siReact, siReactrouter, siRemix, siRocket, siRuby, siRubyonrails,
  siRubygems, siRust, siScikitlearn, siSolid, siStreamlit, siSupabase, siSvelte, siSwift, siTanstack, siTauri, siTensorflow,
  siTurborepo, siTypescript, siCursor, siVscodium, siClaude, siUv, siVite, siVuedotjs, siWebpack, siYarn, siDart, siLua, siCplusplus, siC, siCss, siDotnet,
  type SimpleIcon,
} from 'simple-icons';
import { cx } from './ui';

const ICONS: Record<string, SimpleIcon> = {
  // Langages
  typescript: siTypescript, javascript: siJavascript, python: siPython, go: siGo, rust: siRust, php: siPhp, ruby: siRuby,
  html: siHtml5, css: siCss, shell: siGnubash, swift: siSwift, kotlin: siKotlin, dart: siDart, lua: siLua, cpp: siCplusplus,
  c: siC, csharp: siDotnet, markdown: siMarkdown, jupyter: siJupyter, docker: siDocker, vue: siVuedotjs,
  // Runtimes
  node: siNodedotjs, bun: siBun, deno: siDeno,
  // Frameworks web
  next: siNextdotjs, nuxt: siNuxt, astro: siAstro, sveltekit: siSvelte, svelte: siSvelte, remix: siRemix, 'react-router': siReactrouter,
  'tanstack-start': siTanstack, 'solid-start': siSolid, angular: siAngular, gatsby: siGatsby, cra: siCreatereactapp, vite: siVite,
  webpack: siWebpack, react: siReact, 'react-native': siReact, static: siHtml5, fresh: siDeno,
  // Backends
  nestjs: siNestjs, fastify: siFastify, express: siExpress, hono: siHono, koa: siKoa, django: siDjango, fastapi: siFastapi,
  flask: siFlask, streamlit: siStreamlit, gradio: siGradio, laravel: siLaravel, rails: siRubyonrails, gin: siGin, actix: siActix,
  rocket: siRocket,
  // Apps / data
  electron: siElectron, expo: siExpo, tauri: siTauri, discord: siDiscord, pytorch: siPytorch, tensorflow: siTensorflow,
  pandas: siPandas, 'scikit-learn': siScikitlearn, compose: siDocker, turborepo: siTurborepo, nx: siNx, supabase: siSupabase,
  // Gestionnaires
  npm: siNpm, pnpm: siPnpm, yarn: siYarn, uv: siUv, poetry: siPoetry, pip: siPypi, pipenv: siPypi, composer: siComposer,
  bundler: siRubygems, cargo: siRust,
  // Éditeurs
  cursor: siCursor, vscodium: siVscodium, claude: siClaude,
};

/** Noms de langages renvoyés par l'API GitHub → identifiants internes. */
const GITHUB_LANG: Record<string, string> = {
  TypeScript: 'typescript', JavaScript: 'javascript', Python: 'python', Go: 'go', Rust: 'rust', PHP: 'php', Ruby: 'ruby',
  HTML: 'html', CSS: 'css', SCSS: 'css', Shell: 'shell', Swift: 'swift', Kotlin: 'kotlin', Dart: 'dart', Vue: 'vue',
  Svelte: 'svelte', Astro: 'astro', 'Jupyter Notebook': 'jupyter', Dockerfile: 'docker', 'C#': 'csharp', 'C++': 'cpp', C: 'c',
  Lua: 'lua', MDX: 'markdown', Markdown: 'markdown',
};
export const githubLangId = (name: string | null) => (name ? GITHUB_LANG[name] ?? null : null);

/** Couleurs trop sombres pour le thème sombre → on passe en `currentColor`. */
function isDark(hex: string) {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60;
}

export function TechIcon({ id, label, size = 14, className }: { id: string | null | undefined; label?: string; size?: number; className?: string }) {
  const icon = id ? ICONS[id] : undefined;
  if (!icon) {
    return (
      <span
        title={label}
        className={cx('inline-grid place-items-center rounded-[3px] bg-panel-2 text-[8px] font-bold uppercase text-muted shrink-0', className)}
        style={{ width: size, height: size }}
      >
        {(label ?? id ?? '?').slice(0, 2)}
      </span>
    );
  }
  const dark = isDark(icon.hex);
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cx('shrink-0', dark && 'text-fg', className)}
      fill={dark ? 'currentColor' : `#${icon.hex}`}
    >
      <title>{label ?? icon.title}</title>
      <path d={icon.path} />
    </svg>
  );
}

/** Pastille icône + libellé. */
export function TechChip({ id, label, muted }: { id: string | null | undefined; label: string; muted?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded border border-line bg-panel px-1.5 h-5 text-[11px] font-medium whitespace-nowrap', muted ? 'text-muted' : 'text-fg')}>
      <TechIcon id={id} label={label} size={12} />
      {label}
    </span>
  );
}
