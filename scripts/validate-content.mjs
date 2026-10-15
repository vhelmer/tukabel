import { createServer } from 'vite';
import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Reuse Vite's TS and local asset imports; no HTTP server or extra loader.
const cacheDir = await mkdtemp(
  path.join(tmpdir(), 'tukabel-content-validation-'),
);
let server;
try {
  server = await createServer({
    cacheDir,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  await server.ssrLoadModule('/src/game/content/index.ts');
  process.stdout.write('Game content references are valid.\n');
} finally {
  await server?.close();
  await rm(cacheDir, { recursive: true, force: true });
}
