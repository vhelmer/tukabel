import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { object, ready } from './helpers';
import { artFingerprint } from '../src/editor/jobs';
import type { GameContent } from '../src/game/types';

let release = () => {},
  started = false,
  calls = 0;
async function gate() {
  started = true;
  calls++;
  await new Promise<void>((resolve) => {
    release = resolve;
  });
}
async function save(page: import('@playwright/test').Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/project') && r.request().method() === 'PUT',
    { timeout: 4000 },
  );
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(page.locator('.saved-badge')).toBeVisible();
}

test.describe('asynchronous character direction', () => {
  test.use({
    directionTools: {
      apiKey: 'mock-direction-secret',
      fetch: (async (_url, init) => {
        const input = JSON.parse(JSON.parse(init!.body as string).input);
        await gate();
        return Response.json({
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    blink: input.current.blink,
                    talk: input.current.talk,
                    idle: null,
                    minMs: 700,
                    maxMs: 1600,
                    motion: 'breath',
                    notes:
                      'Nervózne mrkanie a jemné dýchanie. Používam pôvodné oči a ústa; samostatné nové pózy hlavy nevytváram.',
                  }),
                },
              ],
            },
          ],
        });
      }) as typeof fetch,
    },
  });
  test('text direction runs while saving and navigating, survives reload, previews, protects newer settings and saves playable bindings', async ({
    page,
    workspace,
  }, info) => {
    started = false;
    calls = 0;
    const original = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const actor = original.scenes
      .find((s) => s.id === 'animation-lab')!
      .hotspots.find((h) => h.id === 'blink-character')!;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openEditor(page, workspace.url);
    await page.getByRole('button', { name: 'Animace', exact: true }).click();
    await page
      .getByLabel('Animovaná postava', { exact: true })
      .selectOption(JSON.stringify(['animation-lab', actor.id]));
    const panel = page.getByRole('region', { name: 'Textová režie postavy' });
    await panel
      .getByText('Textová režie · experiment', { exact: true })
      .click();
    await panel
      .getByLabel('Jak se má postava chovat?', { exact: true })
      .fill(
        'Mrká nervózne, pri dialógu rozpráva a jemne dýcha. Občas pohne hlavou.',
      );
    await panel
      .getByRole('button', {
        name: 'Navrhnout chování přes AI (API kredit)',
        exact: true,
      })
      .click();
    await expect.poll(() => started).toBe(true);
    // This save must complete BEFORE the provider is allowed to finish.
    await page.getByRole('button', { name: 'Lokace', exact: true }).click();
    await page
      .getByLabel('Název lokace', { exact: true })
      .fill('Ateliér upravený počas AI');
    await save(page);
    expect(calls).toBe(1);
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    await expect(page.locator('.editor-job-tray')).toContainText(
      'AI navrhuje nastavení',
    );
    release();
    await expect(page.locator('.editor-job-tray')).toContainText(
      'Připravené na kontrolu',
    );
    await page
      .getByRole('button', { name: 'Otevřít výsledek', exact: true })
      .click();
    await expect(panel).toContainText('samostatné nové pózy hlavy nevytváram');
    const preview = panel.locator('canvas');
    await expect(preview).toBeVisible();
    const first = await preview.screenshot();
    await page.waitForTimeout(230);
    expect((await preview.screenshot()).equals(first)).toBe(false);
    await page
      .getByLabel('Procedurální pohyb', { exact: true })
      .selectOption('');
    await expect(
      panel.getByRole('button', {
        name: 'Použít navržené chování',
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Zpět', exact: true }).click();
    await expect(
      panel.getByRole('button', {
        name: 'Použít navržené chování',
        exact: true,
      }),
    ).toBeEnabled();
    await panel.screenshot({
      path: info.outputPath('character-direction-preview.png'),
    });
    await panel
      .getByRole('button', { name: 'Použít navržené chování', exact: true })
      .click();
    await save(page);
    const disk = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const binding = disk.scenes
      .find((s) => s.id === 'animation-lab')!
      .hotspots.find((h) => h.id === actor.id)!.animation!;
    expect(binding).toMatchObject({
      blink: actor.animation!.blink,
      talk: actor.animation!.talk,
      motion: 'breath',
      blinkIntervalMs: [700, 1600],
      mouthShapes: actor.animation!.mouthShapes,
    });
    expect(binding.voice).toEqual(actor.animation!.voice);
    await page
      .getByRole('button', { name: 'Otestovat odsud ↗', exact: true })
      .click();
    await ready(page);
    await (await object(page, actor.label)).click();
    await page
      .getByRole('button', { name: 'Porozprávať sa.', exact: true })
      .click();
    await expect(page.locator('.dialogue-panel')).toBeVisible();
    await expect(page.locator('.dialogue-panel audio')).toHaveCount(1);
    expect(calls).toBe(1);
    const status = await page.request.get(
      `${workspace.url}__tukabel/editor/animations/direction/status`,
    );
    expect(await status.text()).not.toContain('mock-direction-secret');
  });
});

test.describe('asynchronous artwork pipeline', () => {
  test.use({
    artTools: {
      apiKey: 'mock-art-secret',
      fetch: (async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        await gate();
        const [width, height] = body.size.split('x').map(Number);
        const png = await sharp({
          create: { width, height, channels: 4, background: '#586855' },
        })
          .png()
          .toBuffer();
        return Response.json({ data: [{ b64_json: png.toString('base64') }] });
      }) as typeof fetch,
    },
  });
  test('background repair completes independently, restores review after reload and applies without overwriting unrelated changes', async ({
    page,
    workspace,
  }) => {
    started = false;
    calls = 0;
    await openEditor(page, workspace.url);
    const doc = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const scene = doc.scenes[0]!;
    const headers = {
      Origin: new URL(workspace.url).origin,
      'X-Tukabel-Editor': '1',
    };
    const response = await page.request.post(
      `${workspace.url}__tukabel/editor/jobs`,
      {
        headers,
        data: {
          kind: 'art',
          label: 'Oddelený detail na pozadí',
          context: {
            sceneId: scene.id,
            targetId: '',
            label: 'Oddelený detail na pozadí',
            fingerprint: artFingerprint(scene, ''),
            placement: {
              bounds: { x: 0, y: 0, width: scene.width, height: scene.height },
              imageFit: 'stretch',
            },
          },
          input: {
            operation: 'extract',
            source: scene.background,
            selection: [
              { x: 50, y: 50 },
              { x: 90, y: 50 },
              { x: 90, y: 90 },
              { x: 50, y: 90 },
            ],
            prompt: 'Remove this detail and repair background.',
            confirmed: true,
          },
        },
      },
    );
    expect(response.status()).toBe(202);
    await expect.poll(() => started).toBe(true);
    await page
      .getByLabel('Název lokace', { exact: true })
      .fill('Úprava počas opravy pozadia');
    await save(page);
    // Queue operations and project reads remain responsive during provider work.
    const queued = await page.request.post(
      `${workspace.url}__tukabel/editor/jobs`,
      {
        headers,
        data: {
          kind: 'art',
          label: 'Cancelled before payment',
          context: {
            sceneId: scene.id,
            targetId: '',
            label: 'Cancelled',
            fingerprint: '',
            placement: {
              bounds: { x: 0, y: 0, width: scene.width, height: scene.height },
            },
          },
          input: {
            operation: 'edit',
            source: scene.background,
            prompt: 'Unused',
            confirmed: true,
          },
        },
      },
    );
    const second = await queued.json();
    expect(
      (
        await page.request.post(
          `${workspace.url}__tukabel/editor/jobs/${second.id}/cancel`,
          { headers, data: {} },
        )
      ).ok(),
    ).toBe(true);
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    release();
    await expect(page.locator('.editor-job-tray')).toContainText(
      'Připravené na kontrolu',
    );
    // An older result carries an older asset catalog. Reviewing it must not
    // forget an unrelated image imported while the result was waiting.
    await page
      .getByRole('button', { name: '+ Obrázková vrstva', exact: true })
      .click();
    const newImage = await sharp({
      create: { width: 32, height: 32, channels: 4, background: '#a86435' },
    })
      .png()
      .toBuffer();
    const upload = page.waitForResponse(
      (r) => r.url().endsWith('/assets') && r.request().method() === 'POST',
    );
    await page
      .getByRole('region', { name: 'Vrstvy scény' })
      .locator('input[type=file]')
      .setInputFiles({
        name: 'later-import.png',
        mimeType: 'image/png',
        buffer: newImage,
      });
    const uploaded = await (await upload).json();
    await expect(
      page.getByLabel('Obrázek vrstvy', { exact: true }),
    ).toHaveValue(uploaded.id);
    await page
      .getByRole('button', { name: 'Otevřít výsledek', exact: true })
      .click();
    const art = page.getByRole('region', { name: 'Grafické nástroje scény' });
    await expect(
      art.getByAltText('Oddělený transparentní objekt'),
    ).toBeVisible();
    await art
      .getByRole('button', { name: 'Použít výsledek ve scéně', exact: true })
      .click();
    await save(page);
    const disk = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    expect(disk.scenes[0]!.title).toBe('Úprava počas opravy pozadia');
    expect(disk.scenes[0]!.hotspots.some((h) => h.image === uploaded.id)).toBe(
      true,
    );
    const layer = disk.scenes[0]!.hotspots.find(
      (h) => h.label === 'Oddelený detail na pozadí',
    )!;
    expect(layer.decorative).toBe(true);
    expect(
      await readFile(path.join(workspace.root, 'src/assets', layer.image!)),
    ).toBeTruthy();
    expect(calls).toBe(1);
    const foreign = await page.request.post(
      `${workspace.url}__tukabel/editor/jobs`,
      { headers: { ...headers, Origin: 'https://foreign.invalid' }, data: {} },
    );
    expect(foreign.status()).toBe(403);
  });
});
