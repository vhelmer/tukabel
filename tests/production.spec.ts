import { test, expect } from '@playwright/test';
import { preview } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { initialState } from '../src/game/state';
import type { GameContent } from '../src/game/types';
import { ready, object } from './helpers';

test('production serves a static game without editor code or write endpoints', async ({
  page,
}) => {
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  const url = server.resolvedUrls!.local[0]!;
  try {
    const source = await readFile('src/game/content/project.json', 'utf8');
    await page.goto(url);
    await ready(page);
    await expect(
      page.getByRole('button', { name: 'Dev Mode', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.dev-workspace')).toHaveCount(0);
    await (await object(page, 'Router')).click();
    await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
      'Dve antény',
    );
    const project = JSON.parse(source) as GameContent;
    await page.evaluate(
      (save) => localStorage.setItem('tukabel.save.v1', JSON.stringify(save)),
      {
        version: 1,
        contentId: project.id,
        state: { ...initialState(project), sceneId: 'animation-lab' },
      },
    );
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .getByRole('button', { name: 'Načítať hru', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Pokračovať v hre', exact: true })
      .click();
    await ready(page);
    const actor = project.scenes
      .find((s) => s.id === 'animation-lab')!
      .hotspots.find((h) => h.id === 'blink-character')!;
    await (await object(page, actor.label)).click();
    await page
      .getByRole('button', { name: 'Porozprávať sa.', exact: true })
      .click();
    const audio = page.locator('.dialogue-panel audio');
    await expect(audio).toHaveCount(1);
    await audio.evaluate(async (el) => {
      await (el as HTMLAudioElement).play();
    });
    await expect
      .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime))
      .toBeGreaterThan(0);
    const responseAudio = await page.request.get(
      new URL((await audio.getAttribute('src')) ?? '', url).href,
    );
    expect(responseAudio.ok()).toBe(true);
    expect((await responseAudio.body()).subarray(0, 4).toString()).toBe('RIFF');
    const endpoint = new URL('__tukabel/editor/project', url).href;
    const response = await page.request.get(endpoint);
    expect(response.headers()['content-type']).not.toContain(
      'application/json',
    );
    const write = await page.request.put(endpoint, {
      headers: { Origin: new URL(url).origin, 'X-Tukabel-Editor': '1' },
      data: { content: JSON.parse(source), revision: 'unused' },
    });
    expect(write.status()).toBe(404);
    const animationEndpoint = new URL('__tukabel/editor/animations/import', url)
      .href;
    const animationWrite = await page.request.post(animationEndpoint, {
      headers: { Origin: new URL(url).origin, 'X-Tukabel-Editor': '1' },
      data: { files: [] },
    });
    expect(animationWrite.status()).toBe(404);
    for (const operation of ['generate', 'import', 'analyze', 'catalog']) {
      const speechWrite = await page.request.post(
        new URL(`__tukabel/editor/speech/${operation}`, url).href,
        {
          headers: { Origin: new URL(url).origin, 'X-Tukabel-Editor': '1' },
          data: { confirmed: true },
        },
      );
      expect(speechWrite.status()).toBe(404);
    }
    expect(await readFile('src/game/content/project.json', 'utf8')).toBe(
      source,
    );
    for (const file of await readdir('dist/assets')) {
      expect(file).not.toContain('DevWorkspace');
      if (file.endsWith('.js')) {
        const bundle = await readFile(path.join('dist/assets', file), 'utf8');
        for (const serverOnly of [
          '__tukabel/editor',
          'OPENAI_API_KEY',
          'FAL_KEY',
          'ELEVENLABS_API_KEY',
          'RHUBARB_BIN',
          'api.elevenlabs.io',
          'queue.fal.run',
          'api.openai.com/v1/images',
        ])
          expect(bundle).not.toContain(serverOnly);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
