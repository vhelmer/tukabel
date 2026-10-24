import { pointInScene } from './helpers';
import { hudClick } from './helpers';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { test, openEditor } from './editorFixture';
import { object, ready } from './helpers';
import type { GameContent } from '../src/game/types';

const output = path.resolve('experiments/woman-blink/output');
test.beforeEach(async ({ workspace }) => {
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...project,
      animations: [],
      scenes: project.scenes.map((scene) => ({
        ...scene,
        hotspots: scene.hotspots.map((h) => ({
          ...h,
          animation: undefined,
          ...(h.id === 'caretaker'
            ? {
                image: 'woman.png',
                bounds: { x: 850, y: 60, width: 300, height: 500 },
              }
            : {}),
        })),
      })),
    }),
  );
});
async function actorPanel(page: Page) {
  await page.getByRole('button', { name: 'Lokace', exact: true }).click();
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('caretaker');
  await page
    .getByRole('button', { name: 'Otevřít animační studio', exact: true })
    .click();
  const importSummary = page.getByText('Import hotové animace', {
    exact: true,
  });
  if (
    !(await page
      .getByLabel('PNG snímky nebo atlas', { exact: true })
      .isVisible())
  )
    await importSummary.click();
  await expect(
    page.getByRole('button', { name: 'Importovat animaci', exact: true }),
  ).toBeVisible();
}
async function saveProject(page: Page) {
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
}
async function actorPixels(page: Page, baseline?: Buffer) {
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  const bytes = await canvas.screenshot({ animations: 'disabled' });
  const metadata = await sharp(bytes).metadata();
  const head = await pointInScene(page, 850, 60);
  const edge = await pointInScene(page, 1150, 270);
  const scale = (edge.x - head.x) / 300;
  const resolution = metadata.width! / box.width;
  // Crop the character's head above reaction/dialogue overlays. Locator
  // screenshots include overlapping DOM, even when the locator is a canvas.
  const { data, info } = await sharp(bytes)
    .extract({
      left: Math.round((head.x - box.x) * resolution),
      top: Math.round((head.y - box.y) * resolution),
      width: Math.floor(300 * scale * resolution),
      height: Math.floor(210 * scale * resolution),
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (baseline) {
    expect(data.length).toBe(baseline.length);
    const unit = scale * resolution;
    let outsideEyes = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data.subarray(i, i + 4).equals(baseline.subarray(i, i + 4))) continue;
      const x = (i / 4) % info.width;
      const y = Math.floor(i / 4 / info.width);
      // Source eye footprint after fixed contain placement, plus raster filter margin.
      if (
        x < 103 * unit - 2 ||
        x > 143 * unit + 2 ||
        y < 91 * unit - 2 ||
        y > 116 * unit + 2
      )
        outsideEyes++;
    }
    expect(
      outsideEyes,
      'A frame swap changed pixels outside the eyes (position/scale drift)',
    ).toBe(0);
  }
  return data;
}

test('PNG blink imports, previews, saves, reloads and plays with stable placement and interaction triggers', async ({
  page,
  workspace,
}, testInfo) => {
  const clickProject = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...clickProject,
      scenes: clickProject.scenes.map((scene) => ({
        ...scene,
        hotspots: scene.hotspots.map((h) =>
          h.id === 'caretaker'
            ? { ...h, onClick: [{ message: 'Skúšobná reakcia.' }] }
            : h,
        ),
      })),
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page, workspace.url);
  await actorPanel(page);
  await expect(page.getByText('fal.ai', { exact: false })).toHaveCount(0);
  const initial = await readFile(workspace.source, 'utf8');
  await page
    .getByLabel('PNG snímky nebo atlas', { exact: true })
    .setInputFiles(
      [5, 3, 1, 4, 2].map((i) => path.join(output, `frame-0${i}.png`)),
    );
  await page
    .getByRole('button', { name: 'Importovat animaci', exact: true })
    .click();
  await expect(page.locator('.animation-timeline button')).toHaveCount(5);
  expect(await readFile(workspace.source, 'utf8')).toBe(initial);
  await page.getByLabel('Název animace', { exact: true }).fill('Codex blink');
  await page.getByLabel('Rychlost animace (fps)', { exact: true }).fill('8');
  await page.getByLabel('Opakovat klip', { exact: true }).uncheck();
  await page
    .getByRole('button', { name: 'Přehrát náhled', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Přehrát náhled', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Snímek 5', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Snímek 3', exact: true }).click();
  await page
    .locator('.animation-preview')
    .screenshot({ path: testInfo.outputPath('codex-blink-preview.png') });
  await page
    .getByRole('button', { name: 'Přiřadit postavě', exact: true })
    .click();
  await page.getByLabel('Mrkání min. (sekundy)', { exact: true }).fill('0.1');
  await page.getByLabel('Mrkání max. (sekundy)', { exact: true }).fill('0.1');
  await saveProject(page);
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const blink = saved.animations![0]!;
  expect(blink.frames).toHaveLength(5);
  expect(blink.fps).toBe(8);
  expect(blink.loop).toBe(false);
  for (let i = 0; i < 5; i++)
    expect(
      await readFile(path.join(workspace.root, 'src/assets', blink.frames[i]!)),
    ).toEqual(await readFile(path.join(output, `frame-0${i + 1}.png`)));
  const actor = saved.scenes[0]!.hotspots.find((h) => h.id === 'caretaker')!;
  expect(actor.animation?.blink).toBe(blink.id);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  // Keep the pointer off the character, so hover outlines cannot fake motion.
  await page.mouse.move(0, 0);
  const first = await actorPixels(page);
  await expect
    .poll(async () => (await actorPixels(page, first)).equals(first))
    .toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await actorPixels(page);
  await page.waitForTimeout(250);
  expect((await actorPixels(page)).equals(still)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  const paused = await actorPixels(page);
  await page.waitForTimeout(200);
  expect((await actorPixels(page)).equals(paused)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.getByLabel('Automatické mrkání', { exact: true }).selectOption('');
  await page.getByText('Animace při interakci', { exact: true }).click();
  await page.getByLabel('Při kliknutí', { exact: true }).selectOption(blink.id);
  await saveProject(page);
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await actorPanel(page);
  await expect(
    page.getByLabel('Automatické mrkání', { exact: true }),
  ).toHaveValue('');
  await page.getByText('Animace při interakci', { exact: true }).click();
  await expect(page.getByLabel('Při kliknutí', { exact: true })).toHaveValue(
    blink.id,
  );
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  const neutral = await actorPixels(page);
  await (await object(page, 'Správca')).click();
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => (await actorPixels(page)).equals(neutral))
    .toBe(false);
  await expect
    .poll(async () => (await actorPixels(page)).equals(neutral))
    .toBe(true);
  expect(errors).toEqual([]);
});

test('Codex atlas retains timing, supports dialogue playback, and works as a static published game', async ({
  page,
  workspace,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page, workspace.url);
  await actorPanel(page);
  await page
    .getByLabel('Typ importované animace', { exact: true })
    .selectOption('talk');
  await page
    .getByLabel('PNG snímky nebo atlas', { exact: true })
    .setInputFiles(path.join(output, 'spritesheet.png'));
  await page
    .getByLabel('Spritesheet metadata (JSON, volitelné)', { exact: true })
    .setInputFiles(path.join(output, 'spritesheet.json'));
  await expect(
    page.getByLabel('Sekvence v atlase', { exact: true }),
  ).toHaveValue('blink');
  await page
    .getByRole('button', { name: 'Importovat animaci', exact: true })
    .click();
  await expect(page.locator('.animation-timeline button')).toHaveCount(5);
  // Shorten the experiment's long open-eye holds for a visible test loop.
  await page.getByRole('button', { name: 'Snímek 1', exact: true }).click();
  await page
    .getByLabel('Délka aktuální snímky (ms)', { exact: true })
    .fill('50');
  await page.getByRole('button', { name: 'Snímek 5', exact: true }).click();
  await page
    .getByLabel('Délka aktuální snímky (ms)', { exact: true })
    .fill('50');
  await page.getByLabel('Rychlost přehrávání (×)', { exact: true }).fill('0.5');
  await page
    .getByRole('button', { name: 'Přiřadit postavě', exact: true })
    .click();
  await page
    .getByLabel('Dialog postavy', { exact: true })
    .selectOption('caretaker');
  await saveProject(page);
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const talk = saved.animations![0]!;
  expect(talk.durationsMs).toEqual([50, 60, 90, 80, 50]);
  expect(talk.speed).toBe(0.5);
  const folders = await readdir(
    path.join(workspace.root, 'src/assets/animations'),
  );
  expect(folders).toContain(talk.frames[0]!.split('/')[1]);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  const neutral = await actorPixels(page);
  await (await object(page, 'Správca')).click();
  await page.mouse.move(0, 0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('button', { name: 'Ako opravím router?', exact: true })
    .click();
  await expect
    .poll(async () => (await actorPixels(page)).equals(neutral))
    .toBe(false);
  await page
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  await page.getByRole('button', { name: 'Idem na to.', exact: true }).click();
  await expect
    .poll(async () => (await actorPixels(page)).equals(neutral))
    .toBe(true);
  const previous = process.env.NODE_ENV;
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
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
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
    const base = await actorPixels(page);
    await (await object(page, 'Správca')).click();
    await page
      .getByRole('button', { name: 'Ako opravím router?', exact: true })
      .click();
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => (await actorPixels(page)).equals(base))
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

test('invalid import and mismatched frame replacement cannot publish broken content', async ({
  page,
  workspace,
}) => {
  await openEditor(page, workspace.url);
  await actorPanel(page);
  const initial = await readFile(workspace.source, 'utf8');
  const api = new URL('__tukabel/editor/animations/import', workspace.url).href;
  const headers = {
    Origin: new URL(workspace.url).origin,
    'X-Tukabel-Editor': '1',
  };
  const bad = await page.request.post(api, {
    headers,
    data: {
      source: 'woman.png',
      label: 'Bad',
      kind: 'blink',
      fps: 14,
      files: [
        {
          name: 'bad.png',
          data: (
            await sharp({
              create: { width: 1, height: 1, channels: 4, background: 'red' },
            })
              .png()
              .toBuffer()
          ).toString('base64'),
        },
      ],
    },
  });
  expect(bad.status()).toBe(400);
  expect(await readFile(workspace.source, 'utf8')).toBe(initial);
  expect((await page.request.post(api, { data: {} })).status()).toBe(403);
  expect(
    (
      await page.request.post(
        new URL('__tukabel/editor/animations/jobs', workspace.url).href,
        { headers, data: {} },
      )
    ).status(),
  ).toBe(404);
  await page
    .getByLabel('PNG snímky nebo atlas', { exact: true })
    .setInputFiles(path.join(output, 'frame-01.png'));
  await page
    .getByRole('button', { name: 'Importovat animaci', exact: true })
    .click();
  await expect(page.locator('.animation-timeline button')).toHaveCount(1);
  await page
    .getByLabel('Obrázek aktuální snímky', { exact: true })
    .selectOption('cable.svg');
  await page
    .getByRole('button', { name: 'Přiřadit postavě', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('plátno');
  expect(await readFile(workspace.source, 'utf8')).toBe(initial);
});
