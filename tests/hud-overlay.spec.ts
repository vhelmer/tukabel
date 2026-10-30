import { expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test } from './editorFixture';
import { dragItem, hudClick, ready } from './helpers';
import type { GameContent } from '../src/game/types';

async function fullScenePixels(page: Page) {
  const canvas = page.locator('.canvas-host canvas');
  const box = (await canvas.boundingBox())!;
  const geometry = await canvas.evaluate((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
    x: Number(node.parentElement!.dataset.sceneX),
    y: Number(node.parentElement!.dataset.sceneY),
    imageWidth: Number(node.parentElement!.dataset.sceneWidth),
  }));
  const units = box.width / geometry.width;
  const scale = (geometry.imageWidth / 1280) * units;
  expect(scale).toBeCloseTo(
    Math.max(
      Math.min(geometry.width / 1280, geometry.height / 720),
      960 / 1280,
    ) * units,
    3,
  );
  const left = geometry.x * units,
    top = geometry.y * units;
  const visible = {
    left: Math.max(0, left),
    right: Math.min(box.width, left + 1280 * scale),
    top: Math.max(0, top),
    bottom: Math.min(box.height, top + 720 * scale),
  };
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
  // The whole viewport stays available to the scene. Sample visible rows;
  // the original top/bottom stripes may be outside a cropped mobile view.
  const sampleX = (visible.left + visible.right) / 2;
  for (const screenY of [
    visible.top + 2,
    (visible.top + visible.bottom) / 2,
    visible.bottom - 3,
  ]) {
    const worldY = (screenY - top) / scale;
    const color =
      worldY < 16
        ? [208, 143, 76]
        : worldY >= 704
          ? [87, 163, 114]
          : [56, 100, 122];
    const px = Math.floor(sampleX * ratio),
      py = Math.floor(screenY * ratio);
    const offset = (py * info.width + px) * 3;
    color.forEach((channel, i) =>
      expect(Math.abs(data[offset + i]! - channel)).toBeLessThanOrEqual(2),
    );
  }
  const shelf = (await page
    .getByRole('group', { name: 'Inventár', exact: true })
    .boundingBox())!;
  const book = (await page
    .getByRole('button', { name: /^Denník/ })
    .boundingBox())!;
  for (const control of [shelf, book]) {
    expect(control.y).toBeGreaterThanOrEqual(box.y + visible.top);
    expect(control.y + control.height).toBeLessThanOrEqual(
      box.y + visible.bottom,
    );
    expect(control.x).toBeGreaterThanOrEqual(box.x + visible.left);
    expect(control.x + control.width).toBeLessThanOrEqual(
      box.x + visible.right,
    );
  }
}

test('drawn HUD overlays the full location; shelf alpha blocks only visible timber and transparent gaps accept scene drops', async ({
  page,
  workspace,
  isMobile,
}, info) => {
  test.setTimeout(60000);
  await writeFile(
    path.join(workspace.root, 'src/assets/overlay-background.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><path fill="#38647a" d="M0 0h1280v720H0z"/><path fill="#d08f4c" d="M0 0h1280v16H0z"/><path fill="#57a372" d="M0 704h1280v16H0z"/></svg>',
  );
  const project: GameContent = {
    id: 'hud-overlay-fixture',
    startScene: 'room',
    initialMessage: '',
    flags: [],
    dialogues: [],
    combinations: [],
    items: [
      {
        id: 'token',
        label: 'Žetón',
        icon: '◆',
        description: 'Predmet na poličke.',
      },
    ],
    tasks: [
      {
        id: 'note',
        text: 'Preskúmať podozrivú poličku.',
        startWhen: { all: [] },
      },
    ],
    scenes: [
      {
        id: 'room',
        title: 'Zátišie s poličkou',
        width: 1280,
        height: 720,
        background: 'overlay-background.svg',
        hotspots: [
          {
            id: 'under',
            label: 'Pozadie pod HUD',
            bounds: { x: 0, y: 0, width: 1280, height: 720 },
            onClick: [
              {
                message: 'Priehľadné miesto patrí scéne.',
                effects: [{ type: 'addItem', id: 'token' }],
              },
            ],
            uses: {
              token: [{ message: 'Predmet prešiel cez priehľadné miesto.' }],
            },
          },
        ],
      },
    ],
  };
  await writeFile(workspace.source, JSON.stringify(project));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(workspace.url);
  await ready(page);
  await fullScenePixels(page);
  const shelf = (await page
    .getByRole('group', { name: 'Inventár', exact: true })
    .boundingBox())!;
  const solid = {
    x: shelf.x + shelf.width * 0.5,
    y: shelf.y + shelf.height * 0.64,
  };
  const gap = { x: shelf.x + shelf.width - 12, y: shelf.y + 8 };
  const token = page.getByRole('button', { name: 'Žetón', exact: true });
  if (isMobile) await page.touchscreen.tap(solid.x, solid.y);
  else await page.mouse.click(solid.x, solid.y);
  await expect(token).toHaveCount(0);
  await expect(page.locator('.scene-label')).toHaveCount(0);
  if (isMobile) await page.touchscreen.tap(gap.x, gap.y);
  else {
    await page.mouse.move(gap.x, gap.y);
    await expect(page.locator('.scene-label')).toHaveText('Pozadie pod HUD');
    await page.mouse.click(gap.x, gap.y);
  }
  await expect(token).toBeVisible();
  if (!isMobile) {
    const item = (await token.boundingBox())!;
    await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2);
    await expect(page.locator('.scene-label')).toHaveCount(0);
  }
  await dragItem(page, token, solid, isMobile);
  await expect(token).toBeVisible();
  await expect(page.getByRole('status', { name: 'Reakcia' })).toHaveText(
    /Priehľadné miesto patrí scéne/,
  );
  await dragItem(page, token, gap, isMobile);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toHaveText(
    /Predmet prešiel/,
  );
  if (!isMobile) {
    // The Pixi button gets replaced when the menu opens. Its old
    // pointerout will never run, so its tooltip must be explicitly discarded.
    await page.mouse.move(0, 0);
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    const control = (await menu.boundingBox())!;
    const canvas = page.locator('.canvas-host canvas');
    const box = (await canvas.boundingBox())!;
    async function belowButton() {
      const bytes = await canvas.screenshot({
        animations: 'disabled',
        style: '.reaction,.scene-label{visibility:hidden!important}',
      });
      const meta = await sharp(bytes).metadata();
      const ratio = meta.width! / box.width;
      return sharp(bytes)
        .extract({
          left: Math.round((control.x - box.x - 16) * ratio),
          top: Math.round((control.y + control.height + 5 - box.y) * ratio),
          width: Math.floor((control.width + 32) * ratio),
          height: Math.floor(32 * ratio),
        })
        .raw()
        .toBuffer();
    }
    const before = await belowButton();
    await hudClick(page, menu);
    await page
      .getByRole('button', { name: 'Pokračovať v hre', exact: true })
      .click();
    // Closing the menu restores keyboard focus, which legitimately shows its
    // label. Tab away before checking for an abandoned pointer tooltip.
    await page.keyboard.press('Tab');
    await page.mouse.move(0, 0);
    expect(
      (await belowButton()).equals(before),
      'Replaced HUD controls left a stale tooltip over the scene',
    ).toBe(true);
  }
  for (const size of [
    { width: 720, height: 400 },
    { width: 430, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await ready(page);
    await page.mouse.move(0, 0);
    await fullScenePixels(page);
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = '0.85';
  });
  await ready(page);
  await fullScenePixels(page);
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('zoom');
  });
  await ready(page);
  await hudClick(page, page.getByRole('button', { name: /^Denník/ }), isMobile);
  await expect(page.getByRole('dialog', { name: 'Denník úloh' })).toContainText(
    'Preskúmať podozrivú poličku.',
  );
  await hudClick(
    page,
    page.getByRole('button', { name: 'Zavrieť denník', exact: true }),
    isMobile,
  );
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await fullScenePixels(page);
  await expect(
    page.locator('.game-topbar,.game-dock,.game-help,.task-journal'),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('drawn-overlay-on-full-location.png'),
    animations: 'disabled',
  });
});
