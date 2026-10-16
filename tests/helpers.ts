import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export async function ready(page: Page) {
  await expect(page.locator('.canvas-host canvas')).toHaveCount(1);
  await expect(page.locator('.scene-notice')).toHaveCount(0);
  // The existing canvas remains mounted during resize/zoom. Wait for its
  // ResizeObserver update before computing coordinates for a pointer action.
  await expect
    .poll(() =>
      page.locator('.canvas-host canvas').evaluate((canvas) => {
        const host = canvas.parentElement!;
        return (
          canvas.clientWidth === host.clientWidth &&
          canvas.clientHeight === host.clientHeight
        );
      }),
    )
    .toBe(true);
}
export async function pointInScene(page: Page, x: number, y: number) {
  const box = await page.locator('.canvas-host canvas').boundingBox();
  if (!box) throw new Error('Scene has no bounds');
  const scale = Math.min(box.width / 1280, box.height / 720);
  return {
    x: box.x + (box.width - 1280 * scale) / 2 + x * scale,
    y: box.y + (box.height - 720 * scale) / 2 + y * scale,
  };
}
export async function activate(
  page: Page,
  x: number,
  y: number,
  touch = false,
) {
  const point = await pointInScene(page, x, y);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}
export async function object(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: 'Objekty', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  return page
    .locator('.objects-popover')
    .getByRole('button', { name: `${name} ↗`, exact: true });
}
export async function getTape(page: Page) {
  await (await object(page, 'Správca')).click();
  const dialogue = page.getByRole('dialog');
  await dialogue.getByRole('button', { name: 'Ako opravím router?' }).click();
  await dialogue.getByRole('button', { name: 'Môžem si vziať pásku?' }).click();
  await dialogue
    .getByRole('button', { name: 'Zatiaľ sa rozhliadnem.' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Izolačná páska', exact: true }),
  ).toBeVisible();
}
export async function dragItem(
  page: Page,
  source: Locator,
  destination: Locator | { x: number; y: number },
  touch: boolean,
) {
  const startBox = await source.boundingBox();
  if (!startBox) throw new Error('Drag source has no bounds');
  const start = {
    x: startBox.x + startBox.width / 2,
    y: startBox.y + startBox.height / 2,
  };
  const box =
    'boundingBox' in destination ? await destination.boundingBox() : null;
  const end = box
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : (destination as { x: number; y: number });
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 8; step++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 8,
            y: start.y + ((end.y - start.y) * step) / 8,
            id: 1,
          },
        ],
      });
    await expect(page.locator('.drag-ghost')).toBeVisible();
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await expect(page.locator('.drag-ghost')).toBeVisible();
    await page.mouse.up();
  }
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
}
export async function menuAction(page: Page, name: string, close = true) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Herné menu' })
    .getByRole('button', { name, exact: true })
    .click();
  if (close && name !== 'Nová hra')
    await page.getByRole('button', { name: 'Pokračovať v hre' }).click();
}
