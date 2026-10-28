import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
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
    workspace.source,
    JSON.stringify({
      ...doc,
      worldMap: {
        image: 'demo-room.svg',
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
