import { createServer } from 'vite';
import process from 'node:process';

// Reuse Vite's TS and local asset imports; no HTTP server or extra loader.
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  await server.ssrLoadModule('/src/game/content/index.ts');
  process.stdout.write('Game content references are valid.\n');
} finally {
  await server.close();
}
