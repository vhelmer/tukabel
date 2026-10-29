import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test } from './editorFixture';
import { ready } from './helpers';
import type { GameContent } from '../src/game/types';

// A decorative layer with clipMask shows only where the location mask is
// opaque: clouds pass behind trees instead of being painted over them.
test('clip masks keep decorative layers inside the sky in location coordinates', async ({
  page,
  workspace,
}) => {
  await writeFile(
    path.join(workspace.root, 'src/assets/clip-background.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><path fill="#3c8ce6" d="M0 0h1280v720H0z"/><path fill="#202814" d="M600 0h120v720H600z"/></svg>',
  );
  // Sky everywhere except the dark "tree" column.
  const mask = Buffer.alloc(1280 * 720 * 4, 255);
  for (let y = 0; y < 720; y++)
    for (let x = 600; x < 720; x++) mask[(y * 1280 + x) * 4 + 3] = 0;
  await sharp(mask, { raw: { width: 1280, height: 720, channels: 4 } })
    .png()
    .toFile(path.join(workspace.root, 'src/assets/clip-sky.png'));
  await writeFile(
    path.join(workspace.root, 'src/assets/clip-cloud.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><path fill="#ffffff" d="M0 0h400v200H0z"/></svg>',
  );
  const project: GameContent = {
    id: 'clip-mask-fixture',
    startScene: 'sky',
    initialMessage: '',
    flags: [],
    dialogues: [],
    combinations: [],
    items: [],
    scenes: [
      {
        id: 'sky',
        title: 'Obloha',
        width: 1280,
        height: 720,
        background: 'clip-background.svg',
        hotspots: [
          {
            id: 'cloud',
            label: 'Mrak',
            bounds: { x: 460, y: 100, width: 400, height: 200 },
            image: 'clip-cloud.svg',
            imageFit: 'stretch',
            decorative: true,
            clipMask: 'clip-sky.png',
            onClick: [],
          },
          {
            id: 'tilted',
            label: 'Natočený mrak',
            bounds: { x: 460, y: 420, width: 400, height: 200 },
            image: 'clip-cloud.svg',
            imageFit: 'stretch',
            rotation: 20,
            decorative: true,
            clipMask: 'clip-sky.png',
            onClick: [],
          },
        ],
      },
    ],
  };
  await writeFile(workspace.source, JSON.stringify(project));
  await page.goto(workspace.url);
  await ready(page);
  const canvas = page.locator('.canvas-host canvas');
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(box.width / 1280, box.height / 720);
  const left = (box.width - 1280 * scale) / 2;
  const top = (box.height - 720 * scale) / 2;
  const { data, info } = await sharp(
    await canvas.screenshot({
      animations: 'disabled',
      style: '.reaction,.scene-label{visibility:hidden!important}',
    }),
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ratio = info.width / box.width;
  const color = (x: number, y: number) => {
    const o =
      (Math.floor((top + y * scale) * ratio) * info.width +
        Math.floor((left + x * scale) * ratio)) *
      3;
    return [data[o]!, data[o + 1]!, data[o + 2]!];
  };
  const near = (actual: number[], expected: number[]) =>
    actual.every((channel, i) => Math.abs(channel - expected[i]!) <= 6);
  for (const y of [270, 520]) {
    expect(near(color(530, y), [255, 255, 255]), `sky ${y}`).toBe(true);
    expect(near(color(660, y), [32, 40, 20]), `tree ${y}`).toBe(true);
    expect(near(color(790, y), [255, 255, 255]), `sky right ${y}`).toBe(true);
  }
  expect(near(color(300, 400), [60, 140, 230])).toBe(true);
});
