import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test, openEditor } from './editorFixture';
import { activate, object, ready, pointInScene } from './helpers';
import type { GameContent } from '../src/game/types';

test('pickup flies into a distinct inventory icon; hover shows a name and a conversation cursor', async ({
  page,
  workspace,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(workspace.url);
  await ready(page);
  if (!isMobile) {
    const data = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const actor = data.scenes[0]!.hotspots.find((h) => h.id === 'caretaker')!;
    const p = await pointInScene(
      page,
      actor.bounds.x + actor.bounds.width / 2,
      actor.bounds.y + actor.bounds.height / 2,
    );
    await page.mouse.move(p.x, p.y);
    await expect(page.locator('.scene-label')).toHaveText('Správca');
    await expect(page.locator('.scene-cursor')).toHaveAttribute(
      'data-cursor-kind',
      'talk',
    );
    await page.mouse.move(0, 0);
  }
  await activate(page, 190, 630, isMobile);
  await expect(page.locator('.canvas-host')).toHaveAttribute(
    'data-pickups',
    '1',
  );
  const flightSrc = await page
    .locator('.canvas-host')
    .getAttribute('data-pickup-image');
  const cable = page.getByRole('button', {
    name: 'Poškodený kábel',
    exact: true,
  });
  const inventorySrc = await cable.getAttribute('data-image');
  expect(flightSrc).toBeTruthy();
  expect(inventorySrc).toBeTruthy();
  expect(inventorySrc).not.toEqual(flightSrc);
  await expect(page.locator('.canvas-host')).toHaveAttribute(
    'data-pickups',
    '0',
  );
  await page.screenshot({ path: testInfo.outputPath('context-game.png') });
  await expect(page.locator('.verb-controls')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('editor saves silent click rules, custom cursor animation and inventory icon; dialogue omits portraits', async ({
  page,
  workspace,
  isMobile,
}, testInfo) => {
  const configured = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...configured,
      animations: configured.animations?.map((clip) =>
        clip.id === 'woman-blink'
          ? { ...clip, loop: true, durationsMs: [120, 120, 120, 120, 120] }
          : clip,
      ),
    }),
  );
  await openEditor(page, workspace.url);
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('cable');
  await page.getByLabel('Typ kurzoru', { exact: true }).selectOption('talk');
  await page
    .getByLabel('Vlastní obrázek kurzoru', { exact: true })
    .selectOption('woman.png');
  await page
    .getByLabel('Animace kurzoru', { exact: true })
    .selectOption('woman-blink');
  await page.getByLabel('Velikost kurzoru (px)', { exact: true }).fill('52');
  await page.getByLabel('Špička kurzoru x', { exact: true }).fill('8');
  await page
    .getByRole('button', { name: 'Odebrat pravidlo', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Dialogy', exact: true }).click();
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const mug = saved.scenes[0]!.hotspots.find((h) => h.id === 'cable')!;
  expect(mug.onClick).toEqual([]);
  expect(mug.cursorAnimation).toBe('woman-blink');
  expect(mug.cursorOffset).toEqual([8, 0]);
  await page.reload();
  await ready(page);
  if (!isMobile) {
    const p = await pointInScene(
      page,
      mug.bounds.x + mug.bounds.width * (120 / 180),
      mug.bounds.y + mug.bounds.height * (50 / 95),
    );
    await page.mouse.move(p.x, p.y);
    const cursor = page.locator('.scene-cursor img');
    await expect(cursor).toBeVisible();
    const src = await cursor.getAttribute('src');
    await expect
      .poll(() => cursor.getAttribute('src'), {
        timeout: 5000,
        intervals: [60],
      })
      .not.toBe(src);
    await page.mouse.move(0, 0);
  }
  await (await object(page, 'Kábel pri stoličke')).click();
  await expect(page.getByRole('status', { name: 'Reakcia' })).toHaveCount(0);
  await (await object(page, 'Správca')).click();
  await expect(page.locator('.dialogue-portrait')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Ako opravím router?', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('conversation.png') });
});
