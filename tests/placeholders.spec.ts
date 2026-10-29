import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test } from './editorFixture';
import { activate, pointInScene, ready } from './helpers';
import type { GameContent } from '../src/game/types';

test('explicit placeholder art shows a label, receives input and yields to visibility and replacement images', async ({
  page,
  workspace,
  isMobile,
}) => {
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const placeholder = {
    id: 'test-placeholder',
    label: 'Skúšobný predmet',
    placeholder: true,
    bounds: { x: 400, y: 240, width: 300, height: 180 },
    visibleWhen: { not: { flag: 'cableTaken' } },
    onClick: [
      {
        message: 'Predmet je vo vrecku.',
        effects: [{ type: 'flag' as const, id: 'cableTaken', value: true }],
      },
    ],
  };
  const source = {
    ...project,
    scenes: project.scenes.map((scene, index) =>
      index
        ? scene
        : {
            ...scene,
            backgroundHidden: true,
            hotspots: [
              placeholder,
              {
                id: 'invisible-target',
                label: 'Neviditeľný predmet',
                bounds: { x: 800, y: 240, width: 100, height: 100 },
                onClick: [],
              },
            ],
          },
    ),
  };
  await writeFile(workspace.source, JSON.stringify(source));
  await page.goto(workspace.url);
  await ready(page);
  const sample = async (x: number, y: number, width = 1, height = 1) => {
    const corner = await pointInScene(page, x, y);
    const opposite = await pointInScene(page, x + width, y + height);
    return sharp(
      await page.screenshot({
        clip: {
          x: corner.x,
          y: corner.y,
          width: Math.max(1, opposite.x - corner.x),
          height: Math.max(1, opposite.y - corner.y),
        },
      }),
    )
      .removeAlpha()
      .raw()
      .toBuffer();
  };
  const fill = await sample(420, 260);
  const empty = await sample(820, 260);
  expect(fill.equals(empty)).toBe(false);
  const labelPixels = await sample(440, 300, 220, 60);
  let brightPixels = 0;
  for (let i = 0; i < labelPixels.length; i += 3)
    if (
      labelPixels[i]! > 210 &&
      labelPixels[i + 1]! > 210 &&
      labelPixels[i + 2]! > 180
    )
      brightPixels++;
  expect(brightPixels).toBeGreaterThan(10);
  await activate(page, 550, 330, isMobile);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Predmet je vo vrecku.',
  );
  expect((await sample(420, 260)).equals(empty)).toBe(true);

  await writeFile(
    path.join(workspace.root, 'src/assets/placeholder-replacement.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><circle cx="150" cy="90" r="30" fill="#00ffff"/></svg>',
  );
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...source,
      scenes: source.scenes.map((scene, index) =>
        index
          ? scene
          : {
              ...scene,
              hotspots: [
                { ...placeholder, image: 'placeholder-replacement.svg' },
              ],
            },
      ),
    }),
  );
  await page.reload();
  await ready(page);
  expect((await sample(420, 260)).equals(empty)).toBe(true);
  const sprite = await sample(550, 330);
  expect(sprite[1]).toBeGreaterThan(220);
  expect(sprite[2]).toBeGreaterThan(220);
});
