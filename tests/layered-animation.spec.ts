import { gameViewport } from '../src/game/hudLayout';
import { expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { ready, pointInScene, object, dragItem } from './helpers';
import type { GameContent } from '../src/game/types';

async function seed(workspace: { root: string; source: string }) {
  const width = 160,
    height = 240,
    pixels = Buffer.alloc(width * height * 4);
  const paint = (
    target: Buffer,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number[],
  ) => {
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++)
        for (let c = 0; c < 4; c++)
          target[(row * width + col) * 4 + c] = color[c]!;
  };
  paint(pixels, 40, 20, 80, 200, [40, 180, 120, 180]);
  paint(pixels, 60, 40, 40, 20, [250, 220, 0, 255]);
  paint(pixels, 60, 100, 40, 20, [160, 30, 40, 255]);
  const eyes = Buffer.from(pixels),
    mouth = Buffer.from(pixels);
  paint(eyes, 60, 40, 40, 20, [20, 40, 160, 255]);
  paint(eyes, 60, 100, 40, 20, [255, 0, 255, 255]);
  paint(eyes, 60, 140, 40, 20, [255, 0, 255, 255]);
  paint(mouth, 60, 100, 40, 20, [0, 0, 0, 0]);
  paint(mouth, 60, 40, 40, 20, [255, 0, 0, 255]);
  for (const [name, data] of [
    ['layer-source', pixels],
    ['layer-eyes', eyes],
    ['layer-mouth', mouth],
  ] as const)
    await writeFile(
      path.join(workspace.root, `src/assets/${name}.png`),
      await sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer(),
    );
  await writeFile(
    path.join(workspace.root, 'src/assets/layer-background.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><path fill="#101010" d="M0 0h1280v720H0z"/></svg>',
  );
  const project: GameContent = {
    id: 'layers',
    startScene: 'room',
    initialMessage: '',
    flags: [],
    combinations: [],
    items: [{ id: 'token', label: 'Žetón', icon: '●', description: 'Test' }],
    animations: [
      {
        id: 'eyes',
        label: 'Oči',
        source: 'layer-source.png',
        kind: 'blink',
        frames: ['layer-eyes.png'],
        fps: 1,
        durationsMs: [2000],
        region: { x: 60, y: 40, width: 40, height: 20 },
      },
      {
        id: 'mouth',
        label: 'Ústa',
        source: 'layer-source.png',
        kind: 'talk',
        frames: ['layer-mouth.png'],
        fps: 1,
        region: { x: 60, y: 100, width: 40, height: 20 },
      },
    ],
    dialogues: [
      {
        id: 'talk',
        start: 'start',
        nodes: [
          {
            id: 'start',
            speaker: 'Test',
            text: 'Mrkám aj rozprávam.',
            choices: [{ id: 'end', text: 'Konec' }],
          },
        ],
      },
    ],
    scenes: [
      {
        id: 'room',
        title: 'Vrstvy',
        width: 1280,
        height: 720,
        background: 'layer-background.svg',
        hotspots: [
          {
            id: 'under',
            label: 'Podklad',
            bounds: { x: 400, y: 100, width: 320, height: 480 },
            onClick: [
              {
                message: 'Podklad',
                effects: [{ type: 'addItem', id: 'token' }],
              },
            ],
            uses: { token: [{ message: 'Drop na podklad' }] },
          },
          {
            id: 'actor',
            label: 'Postava',
            image: 'layer-source.png',
            bounds: { x: 400, y: 100, width: 320, height: 480 },
            onClick: [{ effects: [{ type: 'dialogue', id: 'talk' }] }],
            animation: {
              blink: 'eyes',
              talk: 'mouth',
              dialogueId: 'talk',
              blinkIntervalMs: [100, 100],
            },
          },
        ],
      },
    ],
  };
  await writeFile(workspace.source, JSON.stringify(project));
}
async function pixel(
  canvas: Locator,
  sceneWidth: number,
  sceneHeight: number,
  x: number,
  y: number,
) {
  const dimensions = await canvas.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  const area = gameViewport(dimensions.width, dimensions.height);
  const { data, info } = await sharp(
    await canvas.screenshot({
      style:
        '.dialogue-panel,.reaction,.scene-label,.scene-cursor {visibility:hidden!important}',
    }),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scale = Math.min(area.width / sceneWidth, area.height / sceneHeight),
    resolution = info.width / dimensions.width;
  const px = Math.floor(
      ((area.width - sceneWidth * scale) / 2 + x * scale) * resolution,
    ),
    py = Math.floor(
      (area.y + (area.height - sceneHeight * scale) / 2 + y * scale) *
        resolution,
    );
  return [
    ...data.subarray(
      (py * info.width + px) * 4,
      (py * info.width + px) * 4 + 3,
    ),
  ];
}
async function color(
  canvas: Locator,
  w: number,
  h: number,
  x: number,
  y: number,
  expected: number[],
) {
  await expect
    .poll(async () =>
      (await pixel(canvas, w, h, x, y)).every(
        (value, i) => Math.abs(value - expected[i]!) <= 2,
      ),
    )
    .toBe(true);
}
async function save(page: Page) {
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
}

test('independent regional playback preserves alpha, ignores unrelated frame edits, and shares editor/game rendering', async ({
  page,
  workspace,
  isMobile,
}, testInfo) => {
  await seed(workspace);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openEditor(page, workspace.url);
  await page.getByRole('button', { name: 'Animace', exact: true }).click();
  await page
    .getByLabel('Animovaná postava', { exact: true })
    .selectOption(JSON.stringify(['room', 'actor']));
  const canvas = page.locator('.character-preview-canvas canvas');
  await expect(canvas).toHaveCount(1);
  await page.getByRole('button', { name: 'Mrknout teď', exact: true }).click();
  await color(canvas, 160, 240, 80, 50, [20, 40, 160]);
  await color(canvas, 160, 240, 80, 110, [28, 23, 32]);
  // Source alpha=180 is drawn once, not doubled by an overlay above the body.
  await color(canvas, 160, 240, 70, 150, [36, 134, 94]);
  await page.getByLabel('Testovat mrkání', { exact: true }).uncheck();
  await color(canvas, 160, 240, 80, 50, [250, 220, 0]);
  await color(canvas, 160, 240, 80, 110, [28, 23, 32]);
  await page.getByLabel('Testovat mluvení', { exact: true }).uncheck();
  await color(canvas, 160, 240, 80, 110, [160, 30, 40]);
  await page.getByLabel('Testovat mrkání', { exact: true }).check();
  await page.getByRole('button', { name: 'Mrknout teď', exact: true }).click();
  await color(canvas, 160, 240, 80, 50, [20, 40, 160]);
  await color(canvas, 160, 240, 80, 110, [160, 30, 40]);
  await page.getByLabel('Testovat mluvení', { exact: true }).check();
  await page
    .getByRole('button', { name: 'Pozastavit kombinaci', exact: true })
    .click();
  const still = await canvas.screenshot();
  await page.waitForTimeout(150);
  expect((await canvas.screenshot()).equals(still)).toBe(true);
  await page
    .getByRole('button', { name: 'Přehrát kombinaci', exact: true })
    .click();
  await page
    .getByLabel('Procedurální pohyb', { exact: true })
    .selectOption('breath');
  await save(page);
  await page
    .locator('.animation-workspace')
    .screenshot({ path: testInfo.outputPath('animation-workspace.png') });
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await (await object(page, 'Postava')).click();
  await page
    .getByRole('button', { name: 'Porozprávať sa.', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Mrkám aj rozprávam');
  const game = page.locator('.canvas-host canvas');
  await color(game, 1280, 720, 560, 200, [20, 40, 160]);
  await color(game, 1280, 720, 560, 320, [16, 16, 16]);
  await page
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  await page.getByRole('button', { name: 'Konec', exact: true }).click();
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page
    .getByLabel('Základní animace', { exact: true })
    .selectOption('mouth');
  await save(page);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  const target = await pointInScene(page, 560, 320);
  if (isMobile) await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.click(target.x, target.y);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Podklad',
  );
  await dragItem(
    page,
    page.getByRole('button', { name: 'Žetón', exact: true }),
    target,
    isMobile,
  );
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Drop na podklad',
  );
  await page.reload();
  await ready(page);
  const disk = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(disk.scenes[0]!.hotspots[1]!.animation).toMatchObject({
    blink: 'eyes',
    talk: 'mouth',
    idle: 'mouth',
    motion: 'breath',
  });
});

test('existing Codex blink and mouth demo run simultaneously in a dialogue', async ({
  page,
  workspace,
}, testInfo) => {
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...project,
      startScene: 'animation-lab',
      // This visual test exercises unsynchronized talk layering. Speech timing
      // and edited subtitle content are covered separately in speech.spec.ts.
      dialogues: project.dialogues.map((d) =>
        d.id === 'animation-demo'
          ? {
              ...d,
              nodes: d.nodes.map((n) => ({
                ...n,
                text: 'Oči a ústa fungujú nezávisle.',
                subtitle: undefined,
                speech: undefined,
              })),
            }
          : d,
      ),
      scenes: project.scenes.map((s) => ({
        ...s,
        hotspots: s.hotspots.map((h) =>
          h.id === 'blink-character'
            ? {
                ...h,
                animation: {
                  ...h.animation,
                  talk: 'woman-talk',
                  motion: undefined,
                  blinkIntervalMs: [100, 100],
                },
              }
            : h,
        ),
      })),
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(workspace.url);
  await ready(page);
  const canvas = page.locator('canvas');
  const baseline = await canvas.screenshot({
    style: '.reaction,.scene-label,.scene-cursor{visibility:hidden!important}',
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const demoActor = project.scenes
    .find((s) => s.id === 'animation-lab')!
    .hotspots.find((h) => h.id === 'blink-character')!;
  await (await object(page, demoActor.label)).click();
  await page
    .getByRole('button', { name: 'Porozprávať sa.', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Oči a ústa');
  const scene = project.scenes.find((s) => s.id === 'animation-lab')!,
    actor = scene.hotspots.find((h) => h.id === 'blink-character')!;
  const eyes = project.animations!.find((c) => c.id === 'woman-blink')!.region!,
    mouth = project.animations!.find((c) => c.id === 'woman-talk')!.region!;
  const { imagePlacement } = await import('../src/game/transforms');
  const placed = imagePlacement(
    actor.bounds,
    { width: 1086, height: 1448 },
    actor.imageFit,
  );
  const box = (await canvas.boundingBox())!;
  const origin = await pointInScene(page, 0, 0),
    edge = await pointInScene(page, 1280, 720);
  const scale = (edge.x - origin.x) / 1280;
  async function patches(bytes: Buffer) {
    const meta = await sharp(bytes).metadata(),
      ratio = meta.width! / box.width;
    return Promise.all(
      [eyes, mouth].map((r) =>
        sharp(bytes)
          .extract({
            left: Math.round(
              (origin.x -
                box.x +
                (placed.x + (r.x / 1086) * placed.width) * scale) *
                ratio,
            ),
            top: Math.round(
              (origin.y -
                box.y +
                (placed.y + (r.y / 1448) * placed.height) * scale) *
                ratio,
            ),
            width: Math.max(
              1,
              Math.floor((r.width / 1086) * placed.width * scale * ratio),
            ),
            height: Math.max(
              1,
              Math.floor((r.height / 1448) * placed.height * scale * ratio),
            ),
          })
          .raw()
          .toBuffer(),
      ),
    );
  }
  const neutral = await patches(baseline);
  await expect
    .poll(
      async () => {
        const sample = await patches(
          await canvas.screenshot({
            style:
              '.dialogue-panel,.reaction,.scene-label,.scene-cursor{visibility:hidden!important}',
          }),
        );
        return sample.every((bytes, i) => !bytes.equals(neutral[i]!));
      },
      { intervals: [50], timeout: 10000 },
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('codex-simultaneous-dialogue.png'),
  });
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Animace', exact: true }).click();
  await page
    .getByLabel('Animovaná postava', { exact: true })
    .selectOption(JSON.stringify(['animation-lab', 'blink-character']));
  await page
    .getByRole('button', { name: 'Zjistit změněnou oblast', exact: true })
    .click();
  await expect(page.getByLabel('Oblast · X (px)', { exact: true })).toHaveValue(
    String(eyes.x),
  );
  await expect(
    page.getByLabel('Oblast · šířka (px)', { exact: true }),
  ).toHaveValue(String(eyes.width));
  await page
    .getByLabel('Přiblížení postavy', { exact: true })
    .selectOption('4');
  await page.getByLabel('Zobrazit oblasti', { exact: true }).check();
  await expect(page.locator('.character-preview-canvas canvas')).toHaveCount(1);
  await expect(page.locator('.character-preview-canvas')).not.toContainText(
    'Načítám',
  );
  await page.screenshot({
    path: testInfo.outputPath('codex-animation-studio.png'),
  });
});
