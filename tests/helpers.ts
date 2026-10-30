import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { gameViewport } from '../src/game/hudLayout';

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
          Boolean(host) &&
          canvas.clientWidth === host.clientWidth &&
          canvas.clientHeight === host.clientHeight &&
          (!host.closest('.game-window') ||
            (host.parentElement?.querySelector<HTMLElement>(
              '.hud-accessibility',
            )?.dataset.width === String(canvas.clientWidth) &&
              host.parentElement?.querySelector<HTMLElement>(
                '.hud-accessibility',
              )?.dataset.height === String(canvas.clientHeight)))
        );
      }),
    )
    .toBe(true);
  await skipCutscene(page);
}
// Gameplay tests start after the authored opening cutscene; opening.spec covers it.
export async function skipCutscene(page: Page) {
  const skip = page.locator('.cutscene-skip');
  if (!(await skip.count())) return;
  await skip.click();
  await expect(page.locator('.cutscene')).toHaveCount(0);
}
export async function pointInScene(page: Page, x: number, y: number) {
  const box = await page.locator('.canvas-host canvas').boundingBox();
  if (!box) throw new Error('Scene has no bounds');
  const dimensions = await page
    .locator('.canvas-host canvas')
    .evaluate((canvas) => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      frame: canvas.parentElement?.dataset.sceneWidth
        ? {
            x: Number(canvas.parentElement.dataset.sceneX),
            y: Number(canvas.parentElement.dataset.sceneY),
            width: Number(canvas.parentElement.dataset.sceneWidth),
            height: Number(canvas.parentElement.dataset.sceneHeight),
          }
        : null,
    }));
  const area = gameViewport(dimensions.width, dimensions.height);
  const fit = Math.min(area.width / 1280, area.height / 720);
  const frame = dimensions.frame ?? {
    x: (area.width - 1280 * fit) / 2,
    y: area.y + (area.height - 720 * fit) / 2,
    width: 1280 * fit,
    height: 720 * fit,
  };
  const scale = frame.width / 1280;
  return {
    x: box.x + ((frame.x + x * scale) * box.width) / dimensions.width,
    y: box.y + ((frame.y + y * scale) * box.height) / dimensions.height,
  };
}
// Actions reveal their target through real scrolling. Pure coordinate sampling
// above deliberately keeps the camera still (e.g. screenshot/scale assertions).
export async function revealPointInScene(page: Page, x: number, y: number) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const point = await pointInScene(page, x, y);
    const canvas = page.locator('.canvas-host canvas');
    const box = (await canvas.boundingBox())!;
    const view = await canvas.evaluate((node) => ({
      w: node.clientWidth,
      h: node.clientHeight,
      x: Number(node.parentElement!.dataset.sceneX),
      y: Number(node.parentElement!.dataset.sceneY),
      width: Number(node.parentElement!.dataset.sceneWidth),
      height: Number(node.parentElement!.dataset.sceneHeight),
    }));
    if (!Number.isFinite(view.width)) return point;
    let dx =
      Math.max(box.x + 24, Math.min(box.x + box.width - 24, point.x)) - point.x;
    let dy =
      Math.max(box.y + 110, Math.min(box.y + box.height - 24, point.y)) -
      point.y;
    if (view.width <= view.w) dx = 0;
    if (view.height <= view.h) dy = 0;
    dx = Math.max(-box.width * 0.4, Math.min(box.width * 0.4, dx));
    dy = Math.max(-box.height * 0.4, Math.min(box.height * 0.4, dy));
    // Touch gestures have a deliberate drag threshold; a small remaining
    // margin is already visible and must not trigger another sub-threshold drag.
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return point;
    const expectedX =
      view.width <= view.w
        ? view.x
        : Math.max(
            Math.min(0, view.w - view.width),
            Math.min(0, view.x + (dx * view.w) / box.width),
          );
    const expectedY =
      view.height <= view.h
        ? view.y
        : Math.max(
            view.h - view.height,
            Math.min(0, view.y + (dy * view.h) / box.height),
          );
    if (
      Math.abs(expectedX - view.x) < 0.5 &&
      Math.abs(expectedY - view.y) < 0.5
    )
      return point;
    const start = {
      x: box.x + box.width / 2,
      y: box.y + Math.max(115, box.height * 0.55),
    };
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      const session = await page.context().newCDPSession(page);
      try {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...start, id: 1 }],
        });
        for (let step = 1; step <= 6; step++)
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              {
                x: start.x + (dx * step) / 6,
                y: start.y + (dy * step) / 6,
                id: 1,
              },
            ],
          });
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
      } finally {
        await session.detach();
      }
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.wheel(-dx, -dy);
    }
    const horizontal = Math.abs(expectedX - view.x) > 0.5;
    const previous = horizontal ? view.x : view.y;
    const expected = horizontal ? expectedX : expectedY;
    const moved = expect.poll(async () =>
      Number(
        await page
          .locator('.canvas-host')
          .getAttribute(horizontal ? 'data-scene-x' : 'data-scene-y'),
      ),
    );
    if (expected > previous) await moved.toBeGreaterThan(previous + 0.5);
    else await moved.toBeLessThan(previous - 0.5);
  }
  return pointInScene(page, x, y);
}

export async function activate(
  page: Page,
  x: number,
  y: number,
  touch = false,
) {
  const point = await revealPointInScene(page, x, y);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}
export async function object(page: Page, name: string) {
  return page
    .locator('.scene-accessibility')
    .getByRole('button', { name: `${name} ↗`, exact: true });
}
export async function getTape(page: Page) {
  await (await object(page, 'Správca')).press('Enter');
  const dialogue = page.getByRole('dialog');
  await dialogue.getByRole('button', { name: 'Ako opravím router?' }).click();
  await finishLine(page);
  await dialogue.getByRole('button', { name: 'Môžem si vziať pásku?' }).click();
  await finishLine(page);
  await dialogue
    .getByRole('button', { name: 'Zatiaľ sa rozhliadnem.' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Izolačná páska', exact: true }),
  ).toBeVisible();
}
export async function finishLine(page: Page, touch = false) {
  const panel = page.locator('.dialogue-panel');
  await expect(panel).toHaveClass(/is-speaking/);
  const caption = panel.getByRole('button', {
    name: 'Dokončiť repliku',
    exact: true,
  });
  if (touch) await caption.tap();
  else await caption.click();
  await expect(panel).toHaveClass(/is-choosing/);
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
    await expect(page.locator('.canvas-host')).toHaveAttribute(
      'data-dragging',
      'true',
    );
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await expect(page.locator('.canvas-host')).toHaveAttribute(
      'data-dragging',
      'true',
    );
    await page.mouse.up();
  }
  await expect(page.locator('.canvas-host')).toHaveAttribute(
    'data-dragging',
    'false',
  );
}
export async function menuAction(page: Page, name: string, close = true) {
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  await page
    .getByRole('dialog', { name: 'Herné menu' })
    .getByRole('button', { name, exact: true })
    .click();
  if (close && name !== 'Nová hra')
    await page.getByRole('button', { name: 'Pokračovať v hre' }).click();
}

// Semantic controls have the same bounds as their Pixi targets, but never
// intercept a pointer. Exercise the canvas itself, not a DOM handler.
export async function hudClick(page: Page, control: Locator, touch = false) {
  await expect(control).toBeEnabled();
  await expect
    .poll(() => control.evaluate((element) => !element.closest('[inert]')))
    .toBe(true);
  const box = await control.boundingBox();
  if (!box) throw new Error('HUD control has no bounds');
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
