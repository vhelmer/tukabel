import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend-only release (npm run build:release): no editor middleware, and the
// asset glob/content are swapped for the outputs of scripts/build-release.mjs.
const release = path.resolve(import.meta.dirname, '.release');
const assets = path.resolve(import.meta.dirname, 'src/assets');
const swaps: Record<string, string> = {
  [path.resolve(import.meta.dirname, 'src/game/assetFiles.ts')]: path.join(
    release,
    'assetFiles.ts',
  ),
  [path.resolve(import.meta.dirname, 'src/game/content/project.json')]:
    path.join(release, 'project.json'),
};

function releaseAssets(): Plugin {
  return {
    name: 'tukabel-release-assets',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved) return null;
      const file = resolved.id.split('?')[0]!;
      const swap = swaps[file];
      if (swap) return swap + resolved.id.slice(file.length);
      // Statically imported WAV effects use their MP3 encodes.
      if (file.startsWith(assets + path.sep) && file.endsWith('.wav'))
        return (
          path.join(release, 'assets', path.relative(assets, file)) +
          '.mp3' +
          resolved.id.slice(file.length)
        );
      return null;
    },
  };
}

export default defineConfig({
  plugins: [releaseAssets(), react()],
  base: './',
  build: { outDir: 'dist-release', emptyOutDir: true, assetsInlineLimit: 0 },
});
