import { test, expect } from '@playwright/test';
import { preview } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { initialState } from '../src/game/state';
import type { GameContent } from '../src/game/types';
import { ready, object, menuAction } from './helpers';

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
    await expect(page.locator('.scene-frame')).toHaveAttribute(
      'aria-label',
      /^Lokácia: .+/,
    );
    // Exercise bundled audio through a voiced branch in the current story.
    const project = JSON.parse(source) as GameContent;
    const spoken = project.dialogues.flatMap((dialogue) => {
      const start = dialogue.nodes.find((node) => node.id === dialogue.start)!;
      return start.choices.flatMap((choice) => {
        const node = dialogue.nodes.find((node) => node.id === choice.next);
        if (choice.when || !node?.speech || !node.actor) return [];
        const scene = project.scenes.find((s) => s.id === node.actor!.sceneId)!;
        const actor = scene.hotspots.find(
          (h) => h.id === node.actor!.hotspotId,
        )!;
        if (
          !actor.onClick.some(
            (rule) =>
              !rule.when &&
              rule.effects?.some(
                (effect) =>
                  effect.type === 'dialogue' && effect.id === dialogue.id,
              ),
          )
        )
          return [];
        return [{ choice, scene, actor }];
      });
    })[0];
    expect(spoken).toBeDefined();
    await page.evaluate(
      (save) => localStorage.setItem('tukabel.save.v1', JSON.stringify(save)),
      {
        version: 1,
        contentId: project.id,
        state: { ...initialState(project), sceneId: spoken!.scene.id },
      },
    );
    await menuAction(page, 'Načítať hru');
    await ready(page);
    await (await object(page, spoken!.actor.label)).click();
    await page
      .getByRole('button', { name: spoken!.choice.text, exact: true })
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
    const artWrite = await page.request.post(
      new URL('__tukabel/editor/art/create', url).href,
      {
        headers: { Origin: new URL(url).origin, 'X-Tukabel-Editor': '1' },
        data: { confirmed: true },
      },
    );
    expect(artWrite.status()).toBe(404);
    const artStatus = await page.request.get(
      new URL('__tukabel/editor/art/status', url).href,
    );
    expect(artStatus.headers()['content-type']).not.toContain(
      'application/json',
    );
    const jobsWrite = await page.request.post(
      new URL('__tukabel/editor/jobs', url).href,
      {
        headers: { Origin: new URL(url).origin, 'X-Tukabel-Editor': '1' },
        data: {},
      },
    );
    expect(jobsWrite.status()).toBe(404);
    const jobsRead = await page.request.get(
      new URL('__tukabel/editor/jobs', url).href,
    );
    expect(jobsRead.headers()['content-type']).not.toContain(
      'application/json',
    );
    for (const operation of ['source', 'segment', 'matte']) {
      const response = await page.request.post(
        new URL(`__tukabel/editor/art/${operation}`, url).href,
        {
          headers: { Origin: new URL(url).origin, 'X-Tukabel-Editor': '1' },
          data: {},
        },
      );
      expect(response.status()).toBe(404);
    }
    const animationEndpoint = new URL('__tukabel/editor/animations/import', url)
      .href;
    const animationWrite = await page.request.post(animationEndpoint, {
      headers: { Origin: new URL(url).origin, 'X-Tukabel-Editor': '1' },
      data: { files: [] },
    });
    expect(animationWrite.status()).toBe(404);
    const codexStatus = await page.request.get(
      new URL('__tukabel/editor/codex/status', url).href,
    );
    expect(codexStatus.headers()['content-type']).not.toContain(
      'application/json',
    );
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
          'api.openai.com/v1/responses',
          'OPENAI_ANIMATION_MODEL',
          'CODEX_BIN',
          'Spustit místního Codex agenta',
          'SAM2_CHECKPOINT',
          'SAM3_PYTHON',
          'SAM3_MODEL',
          'HF_TOKEN',
          'sam3_adapter',
          'SEGMENTATION_PYTHON',
          'segment.py',
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
