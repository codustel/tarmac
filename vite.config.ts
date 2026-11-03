import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = `http://127.0.0.1:${process.env.TARMAC_PORT ?? process.env.MANAGER_PORT ?? 7777}`;

/** Identifiant du build : injecté dans le JS et écrit dans version.json → l'UI détecte une nouvelle version. */
const BUILD_ID = Date.now().toString(36);
const versionFile = (): Plugin => ({
  name: 'version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId: BUILD_ID }) });
  },
});

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 7778,
    proxy: { '/api': api, '/modules': api, '/ws': { target: api.replace('http', 'ws'), ws: true } },
  },
});
