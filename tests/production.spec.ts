import { test, expect } from '@playwright/test';
import { preview } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
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
    const animationEndpoint = new URL('__tukabel/editor/animations/jobs', url)
      .href;
    const animationWrite = await page.request.post(animationEndpoint, {
      headers: { Origin: new URL(url).origin, 'X-Tukabel-Editor': '1' },
      data: { prompt: 'Blink' },
    });
    expect(animationWrite.status()).toBe(404);
    const info = await page.request.get(
      new URL('__tukabel/editor/animations/info', url).href,
    );
    expect(info.headers()['content-type']).not.toContain('application/json');
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
