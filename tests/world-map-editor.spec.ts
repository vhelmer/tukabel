import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { GameContent } from '../src/game/types';
import type { Point } from '../src/game/transforms';
import { openEditor, test } from './editorFixture';

async function screenPoint(page: Page, point: Point) {
  return page.locator('.editor-stage').evaluate((node, p) => {
    const screen = new DOMPoint(p.x, p.y).matrixTransform(
      (node as SVGSVGElement).getScreenCTM()!,
    );
    return { x: screen.x, y: screen.y };
  }, point);
}
async function drag(
  page: Page,
  start: Point,
  end: Point,
  touch: boolean,
  cancel = false,
) {
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...end, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  }
}

test('map regions use scene polygon tools, preserve gestures and native image coordinates through save and reload', async ({
  page,
  workspace,
  isMobile,
}) => {
  const original = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const initialDisk =
    JSON.stringify({ ...original, worldMap: undefined }, null, 2) + '\n';
  await writeFile(workspace.source, initialDisk);
  await openEditor(page, workspace.url);
  await page.getByRole('button', { name: 'Mapa lokací', exact: true }).click();
  await page.getByRole('button', { name: 'Vytvořit mapu lokací' }).click();
  const stage = page.locator('.world-map-layout .editor-stage');
  await expect(stage).toBeVisible();
  const width = Number(
    await page.getByLabel('Šířka mapy', { exact: true }).inputValue(),
  );
  const height = Number(
    await page.getByLabel('Výška mapy', { exact: true }).inputValue(),
  );
  const points = [
    { x: 100, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 200 },
    { x: 250, y: 200 },
    { x: 250, y: 320 },
    { x: 100, y: 320 },
  ];
  await page
    .getByRole('button', { name: 'Nakreslit polygon', exact: true })
    .click();
  await stage.scrollIntoViewIfNeeded();
  for (const p of [...points, points[0]!]) {
    const target = await screenPoint(page, p);
    if (isMobile) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
  }
  const outline = stage.locator('polygon.editor-region');
  await expect(stage.locator('[data-vertex-index]')).toHaveCount(6);
  await expect(outline).toHaveAttribute(
    'points',
    points.map((p) => `${p.x},${p.y}`).join(' '),
  );
  await page.getByLabel('Popisek lokace', { exact: true }).fill('Námestie');
  await page
    .getByLabel('Kdy odemknout lokaci', { exact: true })
    .selectOption('initial');
  await page
    .getByLabel('Cestování z mapy', { exact: true })
    .selectOption('transition');
  await stage.scrollIntoViewIfNeeded();
  await drag(
    page,
    await screenPoint(page, points[2]!),
    await screenPoint(page, { x: 450, y: 210 }),
    isMobile,
  );
  const edited = await outline.getAttribute('points');
  expect(edited).toContain('450,210');
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(outline).toHaveAttribute(
    'points',
    points.map((p) => `${p.x},${p.y}`).join(' '),
  );
  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  await stage.scrollIntoViewIfNeeded();
  await drag(
    page,
    await screenPoint(page, { x: 450, y: 210 }),
    await screenPoint(page, { x: 480, y: 230 }),
    isMobile,
    true,
  );
  await expect(outline).toHaveAttribute('points', edited!);
  await stage.locator('[data-vertex-index="2"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(outline).toHaveAttribute(
    'points',
    edited!.replace('450,210', '451,210'),
  );
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(outline).toHaveAttribute('points', edited!);
  await stage.scrollIntoViewIfNeeded();
  await drag(
    page,
    await screenPoint(page, { x: 150, y: 260 }),
    await screenPoint(page, { x: 170, y: 280 }),
    isMobile,
  );
  await expect(outline).toHaveAttribute('points', /^120,120 /);
  await expect(page.getByLabel('Oblast x', { exact: true })).toHaveValue('120');
  await expect(stage.locator('[data-vertex-index]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(outline).toHaveAttribute('points', edited!);
  await page.getByLabel('Oblast width', { exact: true }).fill('400');
  await expect(page.getByLabel('Oblast width', { exact: true })).toHaveValue(
    '400',
  );
  await expect(outline).toHaveAttribute('points', /500,/);
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(outline).toHaveAttribute('points', edited!);
  const beforeImport = edited!.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number);
    return { x: x!, y: y! };
  });
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
  const imported = await page
    .getByLabel('Obrázek mapy', { exact: true })
    .inputValue();
  expect(
    (await readFile(path.join(workspace.root, 'src/assets', imported))).equals(
      png,
    ),
  ).toBe(true);
  const scaled = beforeImport.map((p) => ({
    x: (p.x / width) * 640,
    y: (p.y / height) * 360,
  }));
  await expect(outline).toHaveAttribute(
    'points',
    scaled.map((p) => `${p.x},${p.y}`).join(' '),
  );
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(outline).toHaveAttribute('points', edited!);
  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  const otherScene = original.scenes[1]!;
  await page
    .getByRole('button', { name: 'Přidat další oblast', exact: true })
    .click();
  await page
    .getByLabel('Lokace nové oblasti', { exact: true })
    .selectOption(otherScene.id);
  await page
    .getByRole('button', { name: '+ Oblast doprostřed mapy', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page
    .getByLabel('Kdy odemknout lokaci', { exact: true })
    .selectOption('condition');
  await page
    .getByLabel('Příznak', { exact: true })
    .selectOption(original.flags[0]!);
  expect(await readFile(workspace.source, 'utf8')).toBe(initialDisk);
  await page.getByRole('button', { name: 'Lokace', exact: true }).click();
  await page
    .getByLabel('Aktivní lokace', { exact: true })
    .selectOption(original.scenes[0]!.id);
  const entryPolygon = [
    { x: 800, y: 150 },
    { x: 1100, y: 150 },
    { x: 1100, y: 450 },
    { x: 800, y: 450 },
  ];
  await page
    .getByRole('button', { name: 'Nakreslit polygon', exact: true })
    .click();
  await page.locator('.editor-stage').scrollIntoViewIfNeeded();
  for (const p of [...entryPolygon, entryPolygon[0]!]) {
    const target = await screenPoint(page, p);
    if (isMobile) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
  }
  const entryId = await page
    .getByLabel('Vybraný objekt', { exact: true })
    .inputValue();
  await page.getByLabel('Otevřít mapu lokací', { exact: true }).check();
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(saved.worldMap).toMatchObject({
    image: imported,
    width: 640,
    height: 360,
  });
  expect(saved.worldMap!.points[0]).toMatchObject({
    label: 'Námestie',
    polygon: scaled,
    fastTravel: false,
    unlockWhen: { all: [] },
  });
  expect(saved.worldMap!.points[0]!.x).toBe(((100 + 450) / 2 / width) * 640);
  expect(saved.worldMap!.points[1]).toMatchObject({
    sceneId: otherScene.id,
    unlockWhen: { flag: original.flags[0] },
  });
  expect(saved.scenes[0]!.hotspots.find((h) => h.id === entryId)).toMatchObject(
    {
      openMap: true,
      polygon: entryPolygon,
      onClick: [{ message: 'Zatiaľ nenápadný objekt.' }],
    },
  );
  expect(saved.scenes[0]!.hotspots[0]).toEqual(original.scenes[0]!.hotspots[0]);
  await page.reload();
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Mapa lokací', exact: true }).click();
  await expect(stage.locator('polygon.editor-region')).toHaveCount(2);
  await page
    .getByLabel('Oblast na úpravu', { exact: true })
    .selectOption(saved.worldMap!.points[0]!.id);
  await expect(page.getByLabel('Popisek lokace', { exact: true })).toHaveValue(
    'Námestie',
  );
  await expect(
    page.getByLabel('Cestování z mapy', { exact: true }),
  ).toHaveValue('transition');
});
