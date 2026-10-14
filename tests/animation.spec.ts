import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
import type { ImageEditor } from '../dev/imageEdit';

// This provider exists only in isolated tests. It deliberately changes the
// entire image so local compositing must protect the reference outside the ROI.
const controlledProvider: ImageEditor = {
  model: 'controlled-test-provider',
  async edit({ prompt, signal }) {
    signal.throwIfAborted();
    const fraction = Number(
      /(?:Eyelids are |Speaking pose )(\d+)%/.exec(prompt)?.[1] ?? '50',
    );
    return sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 20 + fraction * 2, g: 30, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
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
  await expect(page.getByLabel('Maska x', { exact: true })).toBeVisible();
}
async function mask(
  page: Page,
  region = { x: 55, y: 55, width: 70, height: 25 },
) {
  for (const [key, value] of Object.entries(region))
    await page.getByLabel(`Maska ${key}`, { exact: true }).fill(String(value));
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

test('without an API key the UI is explicit, manual clips and procedural motion remain usable', async ({
  page,
  workspace,
}) => {
  await openEditor(page, workspace.url);
  await actorPanel(page);
  await mask(page);
  await expect(page.locator('.ai-unavailable')).toContainText('OPENAI_API_KEY');
  await expect(
    page.getByRole('button', { name: 'Vygenerovať / regenerovať animáciu' }),
  ).toBeDisabled();
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
    frameCount: 5,
    quality: 'medium',
    mode: 'region',
    region: { x: 55, y: 55, width: 70, height: 25 },
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

test.describe('controlled image-provider workflow', () => {
  test.use({ imageEditor: controlledProvider });
  test('mask drawing, generation, preview, persistence and in-game blink/talk use the same local frames', async ({
    page,
    workspace,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openEditor(page, workspace.url);
    await actorPanel(page);
    // Author the ROI visually in source pixels, just as a real user would.
    await page.locator('.mask-stage').scrollIntoViewIfNeeded();
    const bounds = (await page.locator('.mask-stage').boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width * 0.3,
      bounds.y + bounds.height * 0.19,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.7,
      bounds.y + bounds.height * 0.27,
      { steps: 5 },
    );
    await page.mouse.up();
    expect(
      Number(
        await page.getByLabel('Maska width', { exact: true }).inputValue(),
      ),
    ).toBeGreaterThan(4);
    await page
      .getByLabel('Prompt animácie', { exact: true })
      .fill('Vytvoř mrknutí na 5 snímků. Pouze oči.');
    await expect(page.getByLabel('Počet snímkov', { exact: true })).toHaveValue(
      '5',
    );
    await page
      .getByRole('button', { name: 'Vygenerovať / regenerovať animáciu' })
      .click();
    await expect(
      page.getByRole('status', { name: 'Stav animácie' }),
    ).toContainText('Snímky sú uložené');
    await expect(page.locator('.animation-timeline button')).toHaveCount(5);
    const jobs = (await (
      await page.request.get(
        new URL('__tukabel/editor/animations/jobs', workspace.url).href,
      )
    ).json()) as AnimationJob[];
    const blink = jobs.at(-1)!;
    expect(blink.total).toBe(2);
    expect(blink.completed).toBe(2);
    const original = await sharp(
      await readFile(
        path.join(workspace.root, 'src/assets/animation-actor.png'),
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const edited = await sharp(
      await readFile(
        path.join(workspace.root, 'src/assets', blink.result!.frames[2]!),
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const roi = blink.request.region!;
    const protectedPixels = Buffer.from(edited);
    for (let y = 0; y < 290; y++)
      for (let x = 0; x < 180; x++) {
        const index = (y * 180 + x) * 4;
        if (
          x >= roi.x &&
          x < roi.x + roi.width &&
          y >= roi.y &&
          y < roi.y + roi.height
        )
          original.copy(protectedPixels, index, index, index + 4);
      }
    expect(protectedPixels.equals(original)).toBe(true);
    const firstPreview = await page
      .locator('.animation-image img')
      .getAttribute('src');
    await page.getByRole('button', { name: 'Prehrať náhľad' }).click();
    await expect
      .poll(() => page.locator('.animation-image img').getAttribute('src'))
      .not.toBe(firstPreview);
    await page.getByRole('button', { name: 'Zastaviť náhľad' }).click();
    await page
      .getByLabel('Názov animácie', { exact: true })
      .fill('Testovacie mrkanie');
    await page.getByLabel('Rýchlosť animácie (fps)', { exact: true }).fill('6');
    await page
      .getByRole('button', { name: 'Priradiť postave', exact: true })
      .click();
    await page
      .getByLabel('Mrkanie min. (sekundy)', { exact: true })
      .fill('0.2');
    await page
      .getByLabel('Mrkanie max. (sekundy)', { exact: true })
      .fill('0.2');
    await page.locator('.animation-preview').scrollIntoViewIfNeeded();
    await page.locator('.animation-preview').screenshot({
      path: testInfo.outputPath('animation-preview.png'),
    });
    await page.getByLabel('Oblasť y', { exact: true }).fill('120');
    await saveProject(page);
    await page.screenshot({
      path: testInfo.outputPath('animation-editor.png'),
      fullPage: true,
    });
    const savedBlink = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const actor = savedBlink.scenes[0]!.hotspots.find(
      (entry) => entry.id === 'caretaker',
    )!;
    expect(actor.animation!.blink).toBe(blink.result!.id);
    await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
    await ready(page);
    const face = await faceImage(page, actor);
    await expect
      .poll(async () => (await faceImage(page, actor)).equals(face))
      .toBe(false);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    await page.getByRole('button', { name: 'Snímka 3', exact: true }).click();
    await page.getByRole('button', { name: 'Regenerovať túto snímku' }).click();
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
    ).toContainText('Snímky sú uložené');
    const regenerationJobs = (await (
      await page.request.get(
        new URL('__tukabel/editor/animations/jobs', workspace.url).href,
      )
    ).json()) as AnimationJob[];
    expect(regenerationJobs.at(-1)!.total).toBe(1);
    expect(regenerationJobs.at(-1)!.request.frameIndex).toBe(2);
    await page
      .getByRole('button', { name: 'Pridať / aktualizovať animáciu' })
      .click();
    await page.getByLabel('Typ animácie', { exact: true }).selectOption('talk');
    await page
      .getByLabel('Prompt animácie', { exact: true })
      .fill('Vytvor rozprávanie na 3 snímky. Pohyb iba úst.');
    await mask(page, { x: 65, y: 83, width: 50, height: 22 });
    await page
      .getByRole('button', { name: 'Vygenerovať / regenerovať animáciu' })
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
    await expect(page.locator('.animation-timeline button')).toHaveCount(3);
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
    expect(
      saved.animations!.find((entry) => entry.id === blink.result!.id)!.fps,
    ).toBe(6);
    expect(saved.animations).toHaveLength(2);
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

test.describe('cancellation', () => {
  test.use({
    imageEditor: {
      model: 'blocked-test-provider',
      edit: async ({ signal }) =>
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
  test('generation remains cancellable without publishing files or changing the source project', async ({
    page,
    workspace,
  }) => {
    await openEditor(page, workspace.url);
    await actorPanel(page);
    await mask(page);
    const original = await readFile(workspace.source, 'utf8');
    await page
      .getByRole('button', { name: 'Vygenerovať / regenerovať animáciu' })
      .click();
    await expect(page.locator('.generation-progress')).toContainText(
      'Generujem',
    );
    await page
      .getByRole('button', { name: 'Zrušiť generovanie', exact: true })
      .click();
    await expect(
      page.getByRole('status', { name: 'Stav animácie' }),
    ).toContainText('zrušené');
    await expect(page.locator('.animation-timeline')).toHaveCount(0);
    expect(await readFile(workspace.source, 'utf8')).toBe(original);
  });
});
