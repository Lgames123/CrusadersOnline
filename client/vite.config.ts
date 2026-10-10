import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const ENV_FILE = path.resolve(import.meta.dirname, '../.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE); // same SERVER_PORT as the game server
const GAME_SERVER = process.env['GAME_SERVER_URL'] ?? `http://127.0.0.1:${process.env['SERVER_PORT'] ?? 8090}`;
const GENERATED_DIR = path.resolve(import.meta.dirname, '../local/generated');
const TYPES: Record<string, string> = { '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.json': 'application/json' };

/**
 * Dev-only: serves the user's locally converted assets (local/generated, git-ignored) at
 * /generated/*. Never part of a production build, so original-game assets are never shipped.
 */
function localGeneratedAssets(): Plugin {
  return {
    name: 'local-generated-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/generated', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        const file = path.resolve(GENERATED_DIR, '.' + rel);
        if (!file.startsWith(GENERATED_DIR + path.sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
        res.setHeader('cache-control', 'no-store'); // re-running `pnpm convert` must show up on reload
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [localGeneratedAssets()],
  // Pre-bundle the in-browser converter's dependencies (worker) so the dev server does not
  // discover them mid-import and reload the page.
  optimizeDeps: { include: ['fflate', '@gltf-transform/core'] },
  server: {
    port: 3000,
    strictPort: true,
    // Same-origin API + WebSocket in development (session cookies need this).
    proxy: {
      '/api': { target: GAME_SERVER, changeOrigin: false },
      '/ws': { target: GAME_SERVER, ws: true },
      '/healthz': { target: GAME_SERVER },
    },
  },
  preview: { port: 3000, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
