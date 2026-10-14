import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

async function pointInScene(canvas: Locator, x: number, y: number) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounds');
  return {
    x: box.x + (x / 1280) * box.width,
    y: box.y + (y / 720) * box.height,
  };
}

test('renders once in StrictMode and handles canvas input after resizing', async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  const canvas = page.locator('.canvas-host canvas');
  await expect(canvas).toHaveCount(1);
  await expect(page.locator('.scene-notice')).toHaveCount(0);
  const point = await pointInScene(canvas, 440, 480);
  if (isMobile) {
    await page.touchscreen.tap(point.x, point.y);
  } else {
    const before = await canvas.screenshot();
    const visiblePoint = await pointInScene(canvas, 440, 480);
    await page.mouse.move(visiblePoint.x, visiblePoint.y);
    await expect(page.locator('.footer')).toContainText('Obzrieť: Router');
    const highlighted = await canvas.screenshot();
    expect(highlighted.equals(before)).toBe(false);
    await page.mouse.click(visiblePoint.x, visiblePoint.y);
  }
  await expect(page.getByRole('status')).toContainText('Dve antény.');
  await expect(page.locator('.interaction-count strong')).toHaveText('01');

  await page.setViewportSize(
    isMobile ? { width: 700, height: 900 } : { width: 800, height: 900 },
  );
  await expect
    .poll(async () => {
      return canvas.evaluate((element: HTMLCanvasElement) =>
        Math.abs(element.clientWidth - element.parentElement!.clientWidth),
      );
    })
    .toBeLessThan(2);
  const socket = await pointInScene(canvas, 1090, 380);
  if (isMobile) await page.touchscreen.tap(socket.x, socket.y);
  else await page.mouse.click(socket.x, socket.y);
  await expect(page.getByRole('status')).toContainText(
    'Zásuvka je pripravená.',
  );
  await expect(page.locator('.interaction-count strong')).toHaveText('02');
  await page.getByRole('button', { name: 'Reset ukážky' }).click();
  await expect(page.locator('.interaction-count strong')).toHaveText('00');
  await expect(page.getByRole('status')).toContainText('Každá veľká záhada');
  await expect(canvas).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('keyboard controls and hotspot hints update the same scene', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.locator('.canvas-host canvas');
  await expect(canvas).toHaveCount(1);
  await expect(page.locator('.scene-notice')).toHaveCount(0);
  const hints = page.getByRole('button', { name: 'Ukázať predmety' });
  await hints.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Skryť predmety' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // Tab moves through the actual UI; no synthetic canvas events or game internals.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '02 Hrnček' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Káva už vychladla.');
  await expect(page.locator('.interaction-count strong')).toHaveText('01');
  await page.getByRole('button', { name: 'Reset ukážky' }).click();
  await expect(
    page.getByRole('button', { name: 'Ukázať predmety' }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('an unavailable background shows a recoverable loading error', async ({
  page,
}) => {
  await page.route('**/demo-room.svg', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText(
    'Scénu sa nepodarilo načítať.',
  );
  await expect(page.locator('.canvas-host canvas')).toHaveCount(0);
  await page.unroute('**/demo-room.svg');
  await page.getByRole('button', { name: 'Obnoviť stránku' }).click();
  await expect(page.locator('.canvas-host canvas')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
