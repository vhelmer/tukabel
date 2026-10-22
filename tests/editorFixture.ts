import { test as base, expect } from '@playwright/test';
import { chmod, cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import sharp from 'sharp';
import { editorPlugin } from '../dev/editorPlugin';
import type { SpeechOptions } from '../dev/speech';
import type { DirectionOptions } from '../dev/animationDirection';
import type { ArtOptions } from '../dev/sceneArt';
import type { CodexOptions } from '../dev/codexAgent';
import { ready } from './helpers';

// Every test gets an isolated source checkout. Browser saves never touch the real
// project, developer notes, or another test's JSON/assets.
export const test = base.extend<{
  speechTools: SpeechOptions;
  artTools: ArtOptions;
  directionTools: DirectionOptions;
  codexTools: CodexOptions;
  workspace: { url: string; source: string; root: string };
}>({
  speechTools: [{}, { option: true }],
  artTools: [{ apiKey: '' }, { option: true }],
  directionTools: [{ apiKey: '' }, { option: true }],
  codexTools: [{ bin: '/nonexistent/tukabel-test-codex' }, { option: true }],
  workspace: async (
    { browserName, speechTools, artTools, directionTools, codexTools },
    use,
  ) => {
    const root = await mkdtemp(
      path.join(tmpdir(), `tukabel-editor-${browserName}-`),
    );
    const previousNodeEnv = process.env.NODE_ENV;
    // Vite preview() sets NODE_ENV=production in reused Playwright workers.
    process.env.NODE_ENV = 'development';
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      for (const file of [
        'src',
        'dev',
        'scripts',
        'index.html',
        'package.json',
        'vite.config.ts',
        'tsconfig.json',
      ])
        await cp(path.resolve(file), path.join(root, file), {
          recursive: true,
        });
      await symlink(
        path.resolve('node_modules'),
        path.join(root, 'node_modules'),
        'dir',
      );
      await writeFile(
        path.join(root, 'src/assets/animation-actor.png'),
        await sharp(path.join(root, 'src/assets/caretaker.svg'))
          .png()
          .toBuffer(),
      );
      const codex = { ...codexTools };
      if (codex.run) {
        codex.bin = path.join(root, 'mock-codex');
        await writeFile(
          codex.bin,
          '#!/usr/bin/env node\nconsole.log("codex-cli test");\n',
        );
        await chmod(codex.bin, 0o700);
      }
      server = await createServer({
        configFile: false,
        plugins: [
          react(),
          editorPlugin({
            speech: speechTools,
            art: artTools,
            direction: directionTools,
            codex,
          }),
        ],
        base: './',
        root,
        cacheDir: path.join(root, '.vite-cache'),
        server: { host: '127.0.0.1', port: 0, strictPort: false },
      });
      await server.listen();
      const url = server.resolvedUrls!.local[0]!;
      await use({
        root,
        url,
        source: path.join(root, 'src/game/content/project.json'),
      });
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  },
});
export async function openEditor(
  page: import('@playwright/test').Page,
  url: string,
) {
  await page.goto(url);
  await ready(page);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Zdroj načtený');
}
