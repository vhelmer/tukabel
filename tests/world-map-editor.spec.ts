import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { GameContent } from '../src/game/types';
import { openEditor, test } from './editorFixture';

test('map authoring keeps native coordinates, commits complete gestures, imports images and saves reversible changes', async ({
  page,
  workspace,
}, testInfo) => {
  const original = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const initialDisk =
    JSON.stringify({ ...original, worldMap: undefined }, null, 2) + '\n';
  await writeFile(workspace.source, initialDisk);
  await openEditor(page, workspace.url);
  await page.getByRole('button', { name: 'Mapa lokací', exact: true }).click();
  await page.getByRole('button', { name: 'Vytvořit mapu lokací' }).click();
  const map = page.getByRole('group', { name: 'Náhled mapy lokací' });
  await expect(map).toBeVisible();
  const width = Number(
    await page.getByLabel('Šířka mapy', { exact: true }).inputValue(),
  );
  const height = Number(
    await page.getByLabel('Výška mapy', { exact: true }).inputValue(),
  );
  await page
    .getByRole('button', { name: '+ Bod doprostřed mapy', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Pozice X', { exact: true })).toHaveValue(
    String(width / 2),
  );
  await expect(page.getByLabel('Pozice Y', { exact: true })).toHaveValue(
    String(height / 2),
  );
  await page.getByLabel('Popisek lokace', { exact: true }).fill('Námestie');
  await page
    .getByLabel('Kdy odemknout lokaci', { exact: true })
    .selectOption('initial');
  await page
    .getByLabel('Cestování z mapy', { exact: true })
    .selectOption('transition');
  await page.getByLabel('Pozice X', { exact: true }).fill('120');
  await page.getByLabel('Pozice Y', { exact: true }).fill('180');
  await map.scrollIntoViewIfNeeded();
  const screenPoint = (x: number, y: number) =>
    map.evaluate(
      (node, point) => {
        const p = new DOMPoint(point.x, point.y).matrixTransform(
          (node as SVGSVGElement).getScreenCTM()!,
        );
        return { x: p.x, y: p.y };
      },
      { x, y },
    );
  const drag = async (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) => {
    await map.scrollIntoViewIfNeeded();
    const from = await screenPoint(fromX, fromY);
    const to = await screenPoint(toX, toY);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
  };
  const markerEdge = await screenPoint(120 + width / 120, 180);
  await page.mouse.click(markerEdge.x, markerEdge.y);
  await expect(page.getByLabel('Pozice X', { exact: true })).toHaveValue('120');
  await expect(page.getByLabel('Pozice Y', { exact: true })).toHaveValue('180');
  await drag(120, 180, 270, 230);
  await expect(page.getByLabel('Pozice X', { exact: true })).toHaveValue('120');
  await page.mouse.up();
  expect(
    Number(await page.getByLabel('Pozice X', { exact: true }).inputValue()),
  ).toBeCloseTo(270, 1);
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(page.getByLabel('Pozice X', { exact: true })).toHaveValue('120');
  await expect(page.getByLabel('Pozice Y', { exact: true })).toHaveValue('180');
  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  await drag(270, 230, 360, 260);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(
    Number(await page.getByLabel('Pozice X', { exact: true }).inputValue()),
  ).toBeCloseTo(270, 1);
  await drag(270, 230, 390, 290);
  await map.dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  });
  await page.mouse.up();
  expect(
    Number(await page.getByLabel('Pozice X', { exact: true }).inputValue()),
  ).toBeCloseTo(270, 1);
  await page.getByLabel('Pozice X', { exact: true }).fill(String(width / 4));
  await page.getByLabel('Pozice Y', { exact: true }).fill(String(height / 4));
  const png = await sharp({
    create: { width: 640, height: 360, channels: 4, background: '#d0b476' },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByLabel('Šířka mapy', { exact: true })).toHaveValue(
    '640',
  );
  await expect(page.getByLabel('Výška mapy', { exact: true })).toHaveValue(
    '360',
  );
  await expect(page.getByLabel('Pozice X', { exact: true })).toHaveValue('160');
  await expect(page.getByLabel('Pozice Y', { exact: true })).toHaveValue('90');
  const imported = await page
    .getByLabel('Obrázek mapy', { exact: true })
    .inputValue();
  expect(
    (await readFile(path.join(workspace.root, 'src/assets', imported))).equals(
      png,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(page.getByLabel('Šířka mapy', { exact: true })).toHaveValue(
    String(width),
  );
  await expect(page.getByLabel('Pozice X', { exact: true })).toHaveValue(
    String(width / 4),
  );
  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  await page
    .getByRole('button', { name: 'Umístit další bod', exact: true })
    .click();
  const otherScene = original.scenes[1]!;
  await page
    .getByLabel('Lokace nového bodu', { exact: true })
    .selectOption(otherScene.id);
  await map.scrollIntoViewIfNeeded();
  const target = await screenPoint(480, 270);
  if (testInfo.project.name === 'touch')
    await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.click(target.x, target.y);
  await expect(page.getByLabel('Cílová lokace', { exact: true })).toHaveValue(
    otherScene.id,
  );
  await page
    .getByLabel('Kdy odemknout lokaci', { exact: true })
    .selectOption('condition');
  await page
    .getByLabel('Příznak', { exact: true })
    .selectOption(original.flags[0]!);
  const secondPoint = await page
    .getByLabel('Bod na úpravu', { exact: true })
    .inputValue();
  await page
    .getByRole('button', { name: 'Odstranit bod', exact: true })
    .click();
  await expect(
    page.getByLabel('Bod na úpravu', { exact: true }).locator('option'),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await page
    .getByLabel('Bod na úpravu', { exact: true })
    .selectOption(secondPoint);
  await expect(
    page.getByLabel('Kdy odemknout lokaci', { exact: true }),
  ).toHaveValue('condition');
  await page
    .getByRole('button', { name: 'Odstranit mapu', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Vytvořit mapu lokací' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(map).toBeVisible();
  expect(await readFile(workspace.source, 'utf8')).toBe(initialDisk);
  await page.getByRole('button', { name: 'Dialogy', exact: true }).click();
  await page.getByRole('button', { name: '+ Dialog', exact: true }).click();
  await page.getByRole('button', { name: '+ Efekt', exact: true }).click();
  await page.getByLabel('Efekt', { exact: true }).selectOption('unlockScene');
  await page
    .getByLabel('Cíl efektu', { exact: true })
    .selectOption(otherScene.id);
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do src/game/content/project.json');
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(saved.worldMap).toMatchObject({
    image: imported,
    width: 640,
    height: 360,
  });
  expect(saved.worldMap!.points).toHaveLength(2);
  expect(saved.worldMap!.points[0]).toMatchObject({
    label: 'Námestie',
    x: 160,
    y: 90,
    fastTravel: false,
    unlockWhen: { all: [] },
  });
  expect(saved.worldMap!.points[1]).toMatchObject({
    sceneId: otherScene.id,
    unlockWhen: { flag: original.flags[0] },
  });
  expect(saved.dialogues.at(-1)!.nodes[0]!.choices[0]!.effects).toContainEqual({
    type: 'unlockScene',
    id: otherScene.id,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Zdroj načtený');
  await page.getByRole('button', { name: 'Mapa lokací', exact: true }).click();
  await expect(map).toBeVisible();
  await page
    .getByLabel('Bod na úpravu', { exact: true })
    .selectOption(saved.worldMap!.points[0]!.id);
  await expect(page.getByLabel('Popisek lokace', { exact: true })).toHaveValue(
    'Námestie',
  );
  await expect(
    page.getByLabel('Cestování z mapy', { exact: true }),
  ).toHaveValue('transition');
});
