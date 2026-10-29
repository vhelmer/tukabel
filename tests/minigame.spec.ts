import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { initialState } from '../src/game/state';
import { SAVE_KEY } from '../src/game/storage';
import type { GameContent } from '../src/game/types';
import { menuAction, object, ready } from './helpers';

const project = JSON.parse(
  readFileSync('src/game/content/project.json', 'utf8'),
) as GameContent;

test('Šuter k čiare is played from the playground and returns to the scene', async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto('/');
  await ready(page);
  const state = {
    ...initialState(project),
    sceneId: 'scene7',
    dialogue: null,
    message: '',
  };
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: SAVE_KEY,
    value: JSON.stringify({ version: 1, contentId: project.id, state }),
  });
  await menuAction(page, 'Načítať hru');
  await ready(page);
  await (await object(page, 'Čiara v hline')).press('Enter');

  const game = page.getByRole('dialog', { name: 'Šuter k čiare' });
  await expect(game).toBeVisible();
  // The overlay covers the HUD and hides the scene controls.
  await expect(page.locator('.scene-accessibility')).toHaveCount(0);
  await game.getByRole('button', { name: 'Hádzať' }).click();

  const stage = game.locator('.skc-stage');
  for (let i = 0; i < 3; i++) {
    await expect(stage).toHaveAttribute('data-phase', 'aim', {
      timeout: 60000,
    });
    const box = (await stage.boundingBox())!;
    const x = box.x + box.width * 0.55;
    const y = box.y + box.height * 0.6;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - box.width * 0.1, y + box.height * 0.08, {
      steps: 6,
    });
    await page.mouse.up();
    await expect(stage).not.toHaveAttribute('data-phase', 'aim');
  }
  await expect(stage).toHaveAttribute('data-phase', 'done', {
    timeout: 60000,
  });
  await expect(game.getByRole('button', { name: 'Ešte raz' })).toBeVisible();
  await game.getByRole('button', { name: 'Späť' }).click();

  await expect(game).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    /Špľuch prehral|tehlou/,
  );
  await expect(await object(page, 'Čiara v hline')).toBeVisible();
});
