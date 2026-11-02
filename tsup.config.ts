import { defineConfig } from 'tsup';

const common = { format: ['esm'] as const, target: 'node22', platform: 'node' as const, clean: true };

export default defineConfig([
  // Serveur et serveur MCP.
  { ...common, entry: { index: 'server/index.ts', mcp: 'server/suivi/mcp.ts' }, outDir: 'dist/server', sourcemap: true },
  // CLI `tarmac` (bin du paquet npm) : un seul fichier, sans dépendance externe.
  { ...common, entry: { tarmac: 'cli/tarmac.ts' }, outDir: 'dist/cli', format: ['esm'] },
]);
