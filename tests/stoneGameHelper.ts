import { expect, type Page } from '@playwright/test';
import {
  LINE_X,
  MAX_SPEED,
  MIN_SPEED,
  solveSpeed,
} from '../src/minigames/suter-k-ciare/physics';

// Exercise real throws and scoring. Only opponent randomness is made repeatable;
// no save state, result callback or winning flag is injected.
export async function winStoneGame(page: Page, isMobile: boolean) {
  const game = page.getByRole('dialog', { name: 'Šuter k čiare', exact: true });
  await expect(game).toBeVisible();
  await page.evaluate(() => {
    Reflect.set(window, Symbol.for('stone-game-original-random'), Math.random);
    Math.random = () => 0.5;
  });
  const touch = isMobile ? await page.context().newCDPSession(page) : undefined;
  try {
    await game.getByRole('button', { name: 'Hádzať', exact: true }).click();
    const stage = game.locator('.skc-stage');
    const angle = 35;
    const speed = solveSpeed(angle, LINE_X - 10);
    const pull = (240 * (speed - MIN_SPEED)) / (MAX_SPEED - MIN_SPEED);
    const radians = (angle * Math.PI) / 180;
    for (let i = 0; i < 3; i++) {
      await expect(stage).toHaveAttribute('data-phase', 'aim', {
        timeout: 60000,
      });
      const box = (await stage.locator('canvas').boundingBox())!;
      const scale = Math.min(box.width / 1280, box.height / 720);
      const start = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 };
      const end = {
        x: start.x - Math.cos(radians) * pull * scale,
        y: start.y + Math.sin(radians) * pull * scale,
      };
      if (touch) {
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...start, id: 1 }],
        });
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ ...end, id: 1 }],
        });
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
      } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 6 });
        await page.mouse.up();
      }
      await expect(stage).not.toHaveAttribute('data-phase', 'aim');
    }
    await expect(
      game.getByRole('heading', { name: 'Vyhral si!', exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await game.getByRole('button', { name: 'Späť', exact: true }).click();
    await expect(game).toHaveCount(0);
  } finally {
    await touch?.detach();
    await page.evaluate(() => {
      const key = Symbol.for('stone-game-original-random');
      Math.random = Reflect.get(window, key);
      Reflect.deleteProperty(window, key);
    });
  }
}
