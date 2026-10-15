import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { test, openEditor } from './editorFixture';
import { object, ready } from './helpers';
import type {
  AnimationJob,
  GenerationRequest,
  SourceInfo,
} from '../src/editor/animationTypes';
import type { GameContent, Hotspot } from '../src/game/types';
import type { VideoGenerator } from '../dev/falVideo';
import { fixtureVideo } from './videoFixture';

const controlledProvider: VideoGenerator = {
  model: 'controlled-video-provider',
  async generate({ image, signal, onProgress }) {
    signal.throwIfAborted();
    const metadata = await sharp(image).metadata();
    expect(metadata.width).toBe(290);
    expect(metadata.height).toBe(290);
    onProgress('Testovací zdroj pripravuje celé video…', 'test-request');
    return { video: await fixtureVideo(), requestId: 'test-request' };
  },
};
async function actorPanel(page: Page) {
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('caretaker');
  await page
    .getByLabel('Obrázok objektu', { exact: true })
    .selectOption('animation-actor.png');
  await page.locator('.animation-panel > summary').click();
  await expect(
    page.getByLabel('Dĺžka AI videa', { exact: true }),
  ).toBeVisible();
}
async function saveProject(page: Page) {
  await page
    .getByRole('button', { name: 'Uložiť do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editora' }),
  ).toContainText('Uložené do');
}
async function faceImage(page: Page, actor: Hotspot) {
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  // Finish CSS scene fades, while keeping the Pixi animation clock active.
  const bytes = await canvas.screenshot({ animations: 'disabled' });
  const metadata = await sharp(bytes).metadata();
  const scale = Math.min(box.width / 1280, box.height / 720);
  const resolution = metadata.width! / box.width;
  const left = Math.round(
    ((box.width - 1280 * scale) / 2 + actor.bounds.x * scale) * resolution,
  );
  const top = Math.round(
    ((box.height - 720 * scale) / 2 + actor.bounds.y * scale) * resolution,
  );
  return sharp(bytes)
    .extract({
      left,
      top,
      width: Math.floor(actor.bounds.width * scale * resolution),
      height: Math.floor(
        actor.bounds.height * (110 / 290) * scale * resolution,
      ),
    })
    .png()
    .toBuffer();
}

test('missing FAL_KEY disables generation even with OpenAI configured; manual animation still works', async ({
  page,
  workspace,
}) => {
  await openEditor(page, workspace.url);
  await actorPanel(page);
  await expect(page.locator('.ai-unavailable')).toContainText('FAL_KEY');
  await expect(
    page.getByRole('button', { name: 'Vygenerovať / regenerovať video' }),
  ).toBeDisabled();
  await expect(page.getByLabel('Maska x', { exact: true })).toHaveCount(0);
  const source = (await (
    await page.request.get(
      new URL(
        '__tukabel/editor/animations/source?id=animation-actor.png',
        workspace.url,
      ).href,
    )
  ).json()) as SourceInfo;
  const request: GenerationRequest = {
    source: 'animation-actor.png',
    sourceRevision: source.revision,
    kind: 'blink',
    prompt: 'Blink',
    duration: 2,
    background: 'magenta',
  };
  const denied = await page.request.post(
    new URL('__tukabel/editor/animations/jobs', workspace.url).href,
    {
      headers: {
        Origin: new URL(workspace.url).origin,
        'X-Tukabel-Editor': '1',
      },
      data: request,
    },
  );
  expect(denied.status()).toBe(503);
  await page.getByRole('button', { name: 'Nová ručná animácia' }).click();
  await page.getByRole('button', { name: '+ Snímka', exact: true }).click();
  await expect(page.locator('.animation-timeline button')).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Priradiť postave', exact: true })
    .click();
  await page.getByLabel('Pohyb bez AI', { exact: true }).selectOption('breath');
  await saveProject(page);
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(saved.animations![0]!.frames).toHaveLength(2);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  const original = await page
    .locator('canvas')
    .screenshot({ animations: 'disabled' });
  await expect
    .poll(async () =>
      (
        await page.locator('canvas').screenshot({ animations: 'disabled' })
      ).equals(original),
    )
    .toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const staticFrame = await page.locator('canvas').screenshot();
  await page.waitForTimeout(200);
  expect((await page.locator('canvas').screenshot()).equals(staticFrame)).toBe(
    true,
  );
});

test.describe('whole-asset video workflow', () => {
  test.use({ videoGenerator: controlledProvider });
  test('video preview, extraction, persistence, resampling and blink/talk playback work in development and static production', async ({
    page,
    workspace,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openEditor(page, workspace.url);
    await actorPanel(page);
    const initialJSON = await readFile(workspace.source, 'utf8');
    await page
      .getByLabel('Prompt animácie', { exact: true })
      .fill(
        'The full character blinks once, keeping the same position and clothes.',
      );
    await page
      .getByRole('button', { name: 'Vygenerovať / regenerovať video' })
      .click();
    await expect(
      page.getByRole('status', { name: 'Stav animácie' }),
    ).toContainText('Pôvodné MP4 je uložené');
    const video = page.locator('.animation-video');
    await expect(video).toBeVisible();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    expect(
      await video.evaluate((v: HTMLVideoElement) => v.duration),
    ).toBeCloseTo(2, 1);
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(0);
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    expect(await readFile(workspace.source, 'utf8')).toBe(initialJSON);
    await page
      .getByRole('button', { name: 'Uložiť herné snímky', exact: true })
      .click();
    await expect(page.locator('.animation-timeline button')).toHaveCount(24);
    // A second local extraction changes timing without another video generation.
    await page.getByLabel('Začiatok úseku (s)', { exact: true }).fill('0.5');
    await page.getByLabel('Koniec úseku (s)', { exact: true }).fill('1.5');
    await page.getByLabel('Extrakcia snímkov (fps)', { exact: true }).fill('6');
    await page
      .getByRole('button', { name: 'Uložiť herné snímky', exact: true })
      .click();
    await expect(page.locator('.animation-timeline button')).toHaveCount(6);
    const jobs = (await (
      await page.request.get(
        new URL('__tukabel/editor/animations/jobs', workspace.url).href,
      )
    ).json()) as AnimationJob[];
    expect(jobs).toHaveLength(1);
    const blink = jobs[0]!;
    expect(blink.requestId).toBe('test-request');
    expect(
      (
        await readFile(path.join(workspace.root, 'src/assets', blink.video!))
      ).toString('ascii', 4, 8),
    ).toBe('ftyp');
    const rgba = await sharp(
      await readFile(
        path.join(workspace.root, 'src/assets', blink.result!.frames[0]!),
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(rgba[3]).toBe(0);
    const first = await page
      .locator('.animation-image img')
      .getAttribute('src');
    await page.getByRole('button', { name: 'Prehrať náhľad' }).click();
    await expect
      .poll(() => page.locator('.animation-image img').getAttribute('src'))
      .not.toBe(first);
    await page.getByRole('button', { name: 'Zastaviť náhľad' }).click();
    await page
      .getByLabel('Názov animácie', { exact: true })
      .fill('Testovacie video mrknutie');
    await page
      .locator('.animation-preview')
      .screenshot({ path: testInfo.outputPath('fal-video-preview.png') });
    await page
      .getByRole('button', { name: 'Priradiť postave', exact: true })
      .click();
    await page
      .getByLabel('Mrkanie min. (sekundy)', { exact: true })
      .fill('0.2');
    await page
      .getByLabel('Mrkanie max. (sekundy)', { exact: true })
      .fill('0.2');
    await page.getByLabel('Oblasť y', { exact: true }).fill('120');
    await saveProject(page);
    const savedBlink = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const actor = savedBlink.scenes[0]!.hotspots.find(
      (h) => h.id === 'caretaker',
    )!;
    expect(actor.animation!.blink).toBe(blink.result!.id);
    await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
    await ready(page);
    const face = await faceImage(page, actor);
    await expect
      .poll(async () => (await faceImage(page, actor)).equals(face))
      .toBe(false);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    await page.getByLabel('Typ animácie', { exact: true }).selectOption('talk');
    await expect(
      page.getByLabel('Prompt animácie', { exact: true }),
    ).toHaveValue(/speaks calmly/);
    await page
      .getByRole('button', { name: 'Vygenerovať / regenerovať video' })
      .click();
    await expect
      .poll(
        async () =>
          (
            (await (
              await page.request.get(
                new URL('__tukabel/editor/animations/jobs', workspace.url).href,
              )
            ).json()) as AnimationJob[]
          ).at(-1)?.status,
      )
      .toBe('completed');
    await expect(
      page.getByRole('status', { name: 'Stav animácie' }),
    ).toContainText('Pôvodné MP4 je uložené');
    await page
      .getByRole('button', { name: 'Uložiť herné snímky', exact: true })
      .click();
    await expect(page.locator('.animation-timeline button')).toHaveCount(12);
    await page
      .getByRole('button', { name: 'Priradiť postave', exact: true })
      .click();
    await page
      .getByLabel('Dialóg postavy', { exact: true })
      .selectOption('caretaker');
    await page
      .getByLabel('Automatické mrkanie', { exact: true })
      .selectOption('');
    await saveProject(page);
    await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
    await ready(page);
    const neutral = await faceImage(page, actor);
    await page.waitForTimeout(150);
    expect((await faceImage(page, actor)).equals(neutral)).toBe(true);
    await (await object(page, 'Správca')).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect
      .poll(async () => (await faceImage(page, actor)).equals(neutral))
      .toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(async () => (await faceImage(page, actor)).equals(neutral))
      .toBe(true);
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    await expect(
      page.getByRole('status', { name: 'Stav editora' }),
    ).toContainText('Zdroj načítaný');
    await page
      .getByLabel('Vybraný objekt', { exact: true })
      .selectOption('caretaker');
    await page.locator('.animation-panel > summary').click();
    await expect(
      page.getByLabel('Animácia počas dialógu', { exact: true }),
    ).not.toHaveValue('');
    const saved = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    expect(saved.animations).toHaveLength(2);
    expect(saved.animations!.find((a) => a.id === blink.result!.id)!.fps).toBe(
      6,
    );
    // Publish the authored fixture as a static build: it must play the same
    // PNGs without a dev server, API credentials or any editor code.
    // createServer initializes NODE_ENV=development in this worker. The CLI
    // build has its own process; reproduce its production environment here.
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await build({
        configFile: false,
        root: workspace.root,
        plugins: [react()],
        base: './',
        logLevel: 'silent',
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
    const production = await preview({
      configFile: false,
      root: workspace.root,
      base: './',
      preview: { host: '127.0.0.1', port: 0 },
    });
    try {
      await page.goto(production.resolvedUrls!.local[0]!);
      await ready(page);
      await expect(
        page.getByRole('button', { name: 'Dev Mode', exact: true }),
      ).toHaveCount(0);
      const productionNeutral = await faceImage(page, actor);
      await (await object(page, 'Správca')).click();
      await expect
        .poll(async () =>
          (await faceImage(page, actor)).equals(productionNeutral),
        )
        .toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        production.httpServer.close((error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }
    expect(errors).toEqual([]);
  });
});

test.describe('video cancellation', () => {
  test.use({
    videoGenerator: {
      model: 'blocked-video-provider',
      generate: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.throwIfAborted();
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    },
  });
  test('cancellation leaves no published video or changed project', async ({
    page,
    workspace,
  }) => {
    await openEditor(page, workspace.url);
    await actorPanel(page);
    const original = await readFile(workspace.source, 'utf8');
    const animationDirectory = path.join(
      workspace.root,
      'src/assets/animations',
    );
    const originalFolders = await readdir(animationDirectory).catch(() => []);
    await page
      .getByRole('button', { name: 'Vygenerovať / regenerovať video' })
      .click();
    await expect(page.locator('.generation-progress')).toBeVisible();
    await page
      .getByRole('button', { name: 'Zrušiť generovanie', exact: true })
      .click();
    await expect(
      page.getByRole('status', { name: 'Stav animácie' }),
    ).toContainText('zrušené');
    await expect(page.locator('.animation-video')).toHaveCount(0);
    expect(await readFile(workspace.source, 'utf8')).toBe(original);
    expect(await readdir(animationDirectory)).toEqual(originalFolders);
  });
});
