import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test } from './editorFixture';
import { activate, hudClick, pointInScene, ready } from './helpers';
import type { GameContent } from '../src/game/types';

test('game hides object hints, keeps keyboard interaction and uses drawn cursors across the window', async ({
  page,
  workspace,
  isMobile,
}) => {
  await writeFile(
    path.join(workspace.root, 'src/assets/controls-test.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><path fill="#293746" d="M0 0h1280v720H0z"/></svg>',
  );
  const content: GameContent = {
    id: 'controls-fixture',
    startScene: 'room',
    initialMessage: '',
    flags: [],
    items: [],
    dialogues: [],
    combinations: [],
    scenes: [
      {
        id: 'room',
        title: 'Izba',
        width: 1280,
        height: 720,
        background: 'controls-test.svg',
        hotspots: [
          {
            id: 'quiet',
            label: 'Tichá kulisa',
            bounds: { x: 200, y: 200, width: 150, height: 150 },
            onClick: [],
          },
          {
            id: 'active',
            label: 'Použiteľný predmet',
            bounds: { x: 500, y: 200, width: 150, height: 150 },
            onClick: [{ message: 'Predmet reaguje.' }],
          },
          {
            id: 'map',
            label: 'Otvoriť mapu',
            bounds: { x: 500, y: 640, width: 200, height: 60 },
            openMap: true,
            onClick: [],
          },
        ],
      },
    ],
    worldMap: {
      image: 'controls-test.svg',
      width: 1280,
      height: 720,
      points: [{ id: 'room', label: 'Izba', sceneId: 'room', x: 600, y: 300 }],
    },
  };
  await writeFile(workspace.source, JSON.stringify(content));
  await page.goto(workspace.url);
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Objekty', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.objects-popover')).toHaveCount(0);
  let restingCursor = '';
  if (!isMobile) {
    const blank = await pointInScene(page, 400, 400);
    await page.mouse.move(blank.x, blank.y);
    await expect(page.locator('.scene-cursor')).toHaveCount(0);
    restingCursor = await page
      .locator('canvas')
      .evaluate((e) => getComputedStyle(e).cursor);
    expect(restingCursor).toContain('url(');
    const quiet = await pointInScene(page, 275, 275);
    await page.mouse.move(quiet.x, quiet.y);
    await expect(page.locator('.scene-cursor')).toHaveCount(0);
    const active = await pointInScene(page, 575, 275);
    await page.mouse.move(active.x, active.y);
    await expect(page.locator('.scene-cursor img')).toHaveAttribute(
      'src',
      /^(data:image\/svg\+xml|.*grab\.svg)/,
    );
    await expect(page.locator('.scene-cursor')).toHaveAttribute(
      'data-cursor-kind',
      'interact',
    );
    // The map opens from the bottom edge, so its cursor points down.
    const mapEdge = await pointInScene(page, 600, 670);
    await page.mouse.move(mapEdge.x, mapEdge.y);
    await expect(page.locator('.scene-cursor')).toHaveAttribute(
      'data-cursor-kind',
      'exit',
    );
    await expect(page.locator('.scene-cursor img')).toHaveAttribute(
      'src',
      // Vite inlines small SVGs as data URIs; match the downward arrow path.
      /exit-down\.svg|M17%204L17%2027/,
    );
  }
  await activate(page, 575, 275, isMobile);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Predmet reaguje.',
  );
  const target = page.locator('[data-hotspot-id="active"]');
  await target.focus();
  await target.press('Enter');
  await expect(page.locator('.scene-label')).toHaveText('Použiteľný predmet');
  await activate(page, 600, 670, isMobile);
  const close = page.getByRole('button', { name: 'Zavrieť mapu', exact: true });
  await expect(close).toBeFocused();
  // A focused map control must not paint the old 3px yellow outline.
  const box = (await close.boundingBox())!;
  const canvas = page.locator('.canvas-host canvas');
  const frame = (await canvas.boundingBox())!;
  const { data, info } = await sharp(await canvas.screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ratio = info.width / frame.width;
  let yellow = 0;
  const y = Math.round((box.y - frame.y + 3) * ratio);
  for (
    let x = Math.ceil((box.x - frame.x + 8) * ratio);
    x < (box.x - frame.x + box.width - 8) * ratio;
    x++
  ) {
    const offset = (y * info.width + x) * 3;
    if (
      Math.abs(data[offset]! - 255) < 4 &&
      Math.abs(data[offset + 1]! - 226) < 4 &&
      Math.abs(data[offset + 2]! - 161) < 4
    )
      yellow++;
  }
  expect(yellow, 'Map close still draws a yellow focus border').toBeLessThan(5);
  await close.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Mapa lokácií' })).toHaveCount(
    0,
  );
  await expect(page.locator('[data-hotspot-id="map"]')).toBeFocused();
  await hudClick(
    page,
    page.getByRole('button', { name: 'Menu', exact: true }),
    isMobile,
  );
  if (!isMobile) {
    const menu = page.getByRole('button', {
      name: 'Pokračovať v hre',
      exact: true,
    });
    const activeCursor = await menu.evaluate((e) => getComputedStyle(e).cursor);
    expect(activeCursor).toContain('url(');
    expect(activeCursor).not.toBe(restingCursor);
  }
});
