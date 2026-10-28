import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from './editorFixture';
import { ready, hudClick, object, pointInScene, menuAction } from './helpers';
import type { GameContent } from '../src/game/types';

test('map reveals at scene bottom, travels only to unlocked destinations and saves permanent unlocks', async ({
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
          },
          {
            id: 'yard',
            label: 'Dvor',
            sceneId: 'courtyard',
            x: 900,
            y: 300,
            unlockWhen: { flag: 'powered' },
          },
          {
            id: 'lab',
            label: 'Ateliér',
            sceneId: 'animation-lab',
            x: 400,
            y: 550,
            unlockWhen: { all: [] },
            fastTravel: false,
          },
        ],
      },
      scenes: doc.scenes.map((s) =>
        s.id === 'workshop'
          ? {
              ...s,
              hotspots: [
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
              ],
            }
          : s,
      ),
    }),
  );
  await page.goto(workspace.url);
  await ready(page);
  const entry = page.getByRole('button', { name: 'Otvoriť mapu', exact: true });
  if (!isMobile) {
    await expect(entry).toHaveAttribute('data-visible', 'false');
    const p = await pointInScene(page, 640, 710);
    await page.mouse.move(p.x, p.y);
  }
  await expect(entry).toHaveAttribute('data-visible', 'true');
  await hudClick(page, entry, isMobile);
  const map = page.getByRole('dialog', { name: 'Mapa lokácií', exact: true });
  await expect(map).toBeVisible();
  await expect(
    map.getByRole('button', { name: 'Zavrieť mapu', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    map.getByRole('button', { name: 'Zavrieť mapu', exact: true }),
  ).toBeFocused();
  await expect(
    map.getByRole('button', { name: 'Zamknuté: Dvor', exact: true }),
  ).toBeDisabled();
  await expect(
    map.getByRole('button', { name: 'Iba prechodom: Ateliér', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
  await (await object(page, 'Sprístupniť dvor')).click();
  await page.keyboard.press('m');
  await expect(map).toBeVisible();
  await hudClick(
    page,
    map.getByRole('button', { name: 'Cestovať: Dvor', exact: true }),
    isMobile,
  );
  await ready(page);
  await expect(
    page.getByLabel('Lokácia: Skúšobný dvor', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('m');
  await map
    .getByRole('button', { name: 'Cestovať: Skúšobňa', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await menuAction(page, 'Uložiť hru', isMobile);
  await page.reload();
  await ready(page);
  await menuAction(page, 'Načítať hru', isMobile);
  await page.keyboard.press('m');
  await expect(
    map.getByRole('button', { name: 'Cestovať: Dvor', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await (await object(page, 'Prechod do ateliéru')).click();
  await ready(page);
  await expect(
    page.getByLabel('Lokácia: Animačný ateliér', { exact: true }),
  ).toBeVisible();
});
