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
  const { content } = await server.ssrLoadModule('/src/game/content/index.ts');
  const { validateAnimationAssets } = await server.ssrLoadModule(
    '/dev/animationImport.ts',
  );
  await validateAnimationAssets(path.resolve('src/assets'), content);
  const { validateSpeechAssets } = await server.ssrLoadModule('/dev/speech.ts');
  await validateSpeechAssets(path.resolve('src/assets'), content);
  process.stdout.write('Game content references are valid.\n');
} finally {
  await server?.close();
  await rm(cacheDir, { recursive: true, force: true });
}
