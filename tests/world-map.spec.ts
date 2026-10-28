import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test } from './editorFixture';
import { ready, hudClick, object, pointInScene, menuAction } from './helpers';
import type { GameContent } from '../src/game/types';

test('polygon entrances and map regions preserve unlocks without shortcut or game HUD', async ({
  page,
  workspace,
  isMobile,
}) => {
  const doc = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    path.join(workspace.root, 'src/assets/map-hover-test.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><path fill="#39586a" d="M0 0h1280v720H0z"/></svg>',
  );
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...doc,
      worldMap: {
        image: 'map-hover-test.svg',
        width: 1280,
        height: 720,
        points: [
          {
            id: 'home',
            label: 'Skúšobňa',
            sceneId: 'workshop',
            x: 300,
            y: 250,
            polygon: [
              { x: 200, y: 180 },
              { x: 400, y: 180 },
              { x: 400, y: 320 },
              { x: 200, y: 320 },
            ],
          },
          {
            id: 'yard',
            label: 'Dvor',
            sceneId: 'courtyard',
            x: 825,
            y: 275,
            polygon: [
              { x: 650, y: 150 },
              { x: 1000, y: 150 },
              { x: 1000, y: 240 },
              { x: 750, y: 240 },
              { x: 750, y: 400 },
              { x: 650, y: 400 },
            ],
            unlockWhen: { flag: 'powered' },
          },
          {
            id: 'lab',
            label: 'Ateliér',
            sceneId: 'animation-lab',
            x: 400,
            y: 550,
            polygon: [
              { x: 300, y: 480 },
              { x: 500, y: 480 },
              { x: 500, y: 620 },
              { x: 300, y: 620 },
            ],
            unlockWhen: { all: [] },
            fastTravel: false,
          },
        ],
      },
      scenes: doc.scenes.map((s) => ({
        ...s,
        hotspots: [
          ...(s.id === 'workshop'
            ? [
                {
                  id: 'unlock-test',
                  label: 'Sprístupniť dvor',
                  bounds: { x: 100, y: 220, width: 200, height: 100 },
                  onClick: [
                    { effects: [{ type: 'flag', id: 'powered', value: true }] },
                  ],
                },
                {
                  id: 'transition-test',
                  label: 'Prechod do ateliéru',
                  bounds: { x: 500, y: 220, width: 220, height: 100 },
                  onClick: [
                    { effects: [{ type: 'scene', id: 'animation-lab' }] },
                  ],
                },
              ]
            : s.hotspots),
          {
            id: 'map-entry',
            label: 'Otvoriť mapu',
            openMap: true,
            cursor: 'exit',
            bounds: { x: 100, y: 600, width: 300, height: 110 },
            polygon: [
              { x: 100, y: 600 },
              { x: 250, y: 600 },
              { x: 250, y: 650 },
              { x: 400, y: 650 },
              { x: 400, y: 710 },
              { x: 100, y: 710 },
            ],
            onClick: [],
          },
        ],
      })),
    }),
  );
  await page.goto(workspace.url);
  await ready(page);
  const map = page.getByRole('dialog', { name: 'Mapa lokácií', exact: true });
  const tapScene = async (x: number, y: number) => {
    const p = await pointInScene(page, x, y);
    if (isMobile) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  };
  const openMap = async () => {
    await tapScene(180, 680);
    await expect(map).toBeVisible();
  };
  await page.keyboard.press('m');
  await expect(map).toHaveCount(0);
  // The old fixed entry and the empty corner of the new concave entry are inert.
  await tapScene(640, 710);
  await tapScene(350, 620);
  await expect(map).toHaveCount(0);
  await openMap();
  await expect(
    page.getByRole('group', { name: 'Inventár', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-hud-control="menu"], [data-hud-control="journal"], [data-hud-control="objects"]',
    ),
  ).toHaveCount(0);
  await expect(page.getByLabel('Reakcia', { exact: true })).toHaveCount(0);
  const close = map.getByRole('button', { name: 'Zavrieť mapu', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expect(
    map.getByRole('button', { name: 'Zamknuté: Dvor', exact: true }),
  ).toBeDisabled();
  await expect(
    map.getByRole('button', { name: 'Iba prechodom: Ateliér', exact: true }),
  ).toBeDisabled();
  const lockedYard = map.getByRole('button', {
    name: 'Zamknuté: Dvor',
    exact: true,
  });
  const lockedBox = (await lockedYard.boundingBox())!;
  const canvas = page.locator('.canvas-host canvas');
  const canvasBox = (await canvas.boundingBox())!;
  const pixels = async () =>
    sharp(await canvas.screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  const outsidePoint = {
    x: lockedBox.x - lockedBox.width * 1.6,
    y: lockedBox.y + lockedBox.height * 2,
  };
  const mapColor = async (point: { x: number; y: number }) => {
    const frame = await pixels();
    const ratio = frame.info.width / canvasBox.width;
    const offset =
      (Math.floor((point.y - canvasBox.y) * ratio) * frame.info.width +
        Math.floor((point.x - canvasBox.x) * ratio)) *
      3;
    return [...frame.data.subarray(offset, offset + 3)];
  };
  const waitForDim = async () => {
    await expect
      .poll(async () => (await mapColor(outsidePoint))[0])
      .toBeLessThan(30);
  };
  const waitForRestored = async () => {
    await expect.poll(() => mapColor(outsidePoint)).toEqual([57, 88, 106]);
  };
  const expectMapPixel = (
    frame: Awaited<ReturnType<typeof pixels>>,
    x: number,
    y: number,
  ) => {
    const scale = frame.info.width / canvasBox.width;
    const offset =
      (Math.floor((y - canvasBox.y) * scale) * frame.info.width +
        Math.floor((x - canvasBox.x) * scale)) *
      3;
    expect([...frame.data.subarray(offset, offset + 3)]).toEqual([57, 88, 106]);
  };
  // Both the fill and the border of an unavailable polygon stay invisible.
  const closedLabelFrame = await pixels();
  expectMapPixel(
    closedLabelFrame,
    lockedBox.x + lockedBox.width * 0.2,
    lockedBox.y + lockedBox.height * 0.8,
  );
  expectMapPixel(
    closedLabelFrame,
    lockedBox.x + lockedBox.width * 0.005,
    lockedBox.y + lockedBox.height * 0.5,
  );
  await page.mouse.move(
    lockedBox.x + lockedBox.width * 0.2,
    lockedBox.y + lockedBox.height * 0.2,
  );
  const mapScale = lockedBox.width / 350;
  const mapPixels = async (frame: Awaited<ReturnType<typeof pixels>>) => {
    const ratio = frame.info.width / canvasBox.width;
    return sharp(frame.data, {
      raw: { width: frame.info.width, height: frame.info.height, channels: 3 },
    })
      .extract({
        left: Math.ceil(
          (lockedBox.x - 650 * mapScale - canvasBox.x + 2) * ratio,
        ),
        top: Math.ceil(
          (lockedBox.y - 150 * mapScale - canvasBox.y + 2) * ratio,
        ),
        width: Math.floor((1280 * mapScale - 4) * ratio),
        height: Math.floor((720 * mapScale - 4) * ratio),
      })
      .toBuffer();
  };
  expect(
    (await mapPixels(await pixels())).equals(await mapPixels(closedLabelFrame)),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
  await (await object(page, 'Sprístupniť dvor')).click();
  await openMap();
  const yard = map.getByRole('button', { name: 'Cestovať: Dvor', exact: true });
  const box = await yard.boundingBox();
  expect(box).not.toBeNull();
  const tapRegion = async (x: number, y: number) => {
    const p = { x: box!.x + box!.width * x, y: box!.y + box!.height * y };
    if (isMobile) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  };
  await close.evaluate((node) => (node as HTMLElement).blur());
  const beforeHover = await pixels();
  expectMapPixel(
    beforeHover,
    box!.x + box!.width * 0.2,
    box!.y + box!.height * 0.8,
  );
  // Keyboard focus reveals the same wooden sign, without drawing the polygon.
  await yard.focus();
  await waitForDim();
  const focusedFrame = await pixels();
  expect(focusedFrame.data.equals(beforeHover.data)).toBe(false);
  if (!isMobile)
    expect(
      (
        await mapColor({
          x: box!.x + box!.width * 0.6,
          y: box!.y + box!.height * 0.8,
        })
      )[0],
    ).toBeLessThan(30);
  if (!isMobile)
    expectMapPixel(
      focusedFrame,
      box!.x + box!.width * 0.1,
      box!.y + box!.height * 0.8,
    );
  await close.focus();
  await page.mouse.move(0, 0);
  await waitForRestored();
  const beforeMouseHover = await pixels();
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.2);
  await waitForDim();
  const hoveredFrame = await pixels();
  expect(hoveredFrame.data.equals(beforeMouseHover.data)).toBe(false);
  if (!isMobile)
    expectMapPixel(
      hoveredFrame,
      box!.x + box!.width * 0.1,
      box!.y + box!.height * 0.8,
    );
  await page.mouse.move(0, 0);
  await waitForRestored();
  // Centre is inside the bounding rectangle but outside this L-shaped region.
  await tapRegion(0.5, 0.5);
  await expect(map).toBeVisible();
  await tapRegion(0.2, 0.2);
  await ready(page);
  await expect(
    page.getByLabel('Lokácia: Skúšobný dvor', { exact: true }),
  ).toBeVisible();
  await openMap();
  await map
    .getByRole('button', { name: 'Cestovať: Skúšobňa', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await menuAction(page, 'Uložiť hru');
  await page.reload();
  await ready(page);
  await menuAction(page, 'Načítať hru');
  await openMap();
  await expect(
    map.getByRole('button', { name: 'Cestovať: Dvor', exact: true }),
  ).toBeEnabled();
  await hudClick(
    page,
    map.getByRole('button', { name: 'Zavrieť mapu', exact: true }),
    isMobile,
  );
  await (await object(page, 'Otvoriť mapu')).focus();
  await page.keyboard.press('Enter');
  await expect(map).toBeVisible();
  await page.keyboard.press('Escape');
  await (await object(page, 'Prechod do ateliéru')).click();
  await ready(page);
  await expect(
    page.getByLabel('Lokácia: Animačný ateliér', { exact: true }),
  ).toBeVisible();
});
