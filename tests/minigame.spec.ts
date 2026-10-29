import {
  LINE_X,
  MIN_SPEED,
  MAX_SPEED,
  solveSpeed,
} from '../src/minigames/suter-k-ciare/physics';
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

test('keyboard-only throws win the mandatory prize and scissors release the quest string', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto('/');
  await ready(page);
  const state = {
    ...initialState(project),
    sceneId: 'scene7',
    dialogue: null,
    inventory: ['scissors'],
    message: '',
  };
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: SAVE_KEY,
    value: JSON.stringify({ version: 1, contentId: project.id, state }),
  });
  await menuAction(page, 'Načítať hru');
  await ready(page);
  await (await object(page, 'Čiara v hline')).press('Enter');
  const game = page.getByRole('dialog', { name: 'Šuter k čiare', exact: true });
  await page.evaluate(() => {
    Math.random = () => 0.5;
  });
  await game
    .getByRole('button', { name: 'Hádzať', exact: true })
    .press('Enter');
  const aim = game.getByRole('application', { name: /Mierenie/ });
  await expect(aim).toBeFocused();
  await expect(aim).toHaveAttribute('data-phase', 'aim', { timeout: 60000 });
  await page.keyboard.press('ArrowUp');
  await expect(aim).toHaveAccessibleName(/36°/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(aim).toHaveAccessibleName(/51 %/);
  await page.keyboard.press('ArrowLeft');
  const power = Math.round(
    (100 * (solveSpeed(35, LINE_X - 10) - MIN_SPEED)) / (MAX_SPEED - MIN_SPEED),
  );
  for (let i = 0; i < Math.abs(power - 50); i++)
    await page.keyboard.press(power > 50 ? 'ArrowRight' : 'ArrowLeft');
  for (let turn = 0; turn < 3; turn++) {
    await expect(aim).toHaveAttribute('data-phase', 'aim', { timeout: 60000 });
    await page.keyboard.press(turn === 1 ? 'Space' : 'Enter');
    await expect(aim).toHaveAttribute('data-phase', 'busy');
    // A repeated held key must not become the next player's throw.
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
  }
  await expect(
    game.getByRole('heading', { name: 'Vyhral si!', exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await game.getByRole('button', { name: 'Späť', exact: true }).press('Enter');
  await (await object(page, 'Špľuch')).press('Enter');
  await expect(page.locator('[data-inventory-id="potato-medal"]')).toHaveCount(
    1,
  );
  const caption = page.getByRole('button', {
    name: 'Dokončiť repliku',
    exact: true,
  });
  await expect(caption).toBeEnabled();
  await caption.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Rozhovor', exact: true }),
  ).toHaveCount(0);
  await page.locator('[data-inventory-id="scissors"]').press('Enter');
  await page.locator('[data-inventory-id="potato-medal"]').press('Enter');
  await expect(page.locator('[data-inventory-id="string"]')).toHaveCount(1);
  await expect(page.locator('[data-inventory-id="potato"]')).toHaveCount(1);
  await expect(page.locator('[data-inventory-id="potato-medal"]')).toHaveCount(
    0,
  );
});
