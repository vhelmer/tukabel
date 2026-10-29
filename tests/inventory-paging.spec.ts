import { expect, type Locator, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from './editorFixture';
import { hudClick, object, ready } from './helpers';
import type { GameContent } from '../src/game/types';

const COUNT = 40;
const MESSAGE = 'Prvý a posledný predmet sa našli.';

async function fillPockets(page: Page, source: string, url: string) {
  const content = JSON.parse(await readFile(source, 'utf8')) as GameContent;
  const items = Array.from({ length: COUNT }, (_, i) => ({
    id: 'pocket-' + i,
    label: 'Skúšobný predmet ' + (i + 1),
    description: 'Predmet do vrecka.',
    icon: '◆',
  }));
  const room = content.scenes.find((s) => s.id === content.startScene)!;
  const project: GameContent = {
    ...content,
    items: [...content.items, ...items],
    combinations: [
      ...content.combinations,
      {
        items: ['pocket-0', 'pocket-' + (COUNT - 1)],
        rules: [{ message: MESSAGE }],
      },
    ],
    scenes: content.scenes.map((s) =>
      s.id !== room.id
        ? s
        : {
            ...s,
            hotspots: [
              ...s.hotspots,
              {
                id: 'pockets',
                label: 'Naplniť vrecká',
                bounds: { x: 100, y: 60, width: 250, height: 80 },
                onClick: [
                  {
                    effects: items.map((item) => ({
                      type: 'addItem' as const,
                      id: item.id,
                    })),
                  },
                ],
              },
            ],
          },
    ),
  };
  await writeFile(source, JSON.stringify(project));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await ready(page);
  await (await object(page, 'Naplniť vrecká')).press('Enter');
  const next = page.getByRole('button', {
    name: 'Ďalšie predmety',
    exact: true,
  });
  await expect(next).toBeEnabled();
  return {
    next,
    first: page.locator('[data-inventory-id="pocket-0"]'),
    last: page.locator(`[data-inventory-id="pocket-${COUNT - 1}"]`),
    reaction: page.getByRole('status', { name: 'Reakcia' }),
  };
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Missing bounds');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('a selected item stays selected while paging to combine with an item on another page', async ({
  page,
  workspace,
  isMobile,
}) => {
  const { next, first, last, reaction } = await fillPockets(
    page,
    workspace.source,
    workspace.url,
  );
  await hudClick(page, first, isMobile);
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  while (!(await last.count())) await hudClick(page, next, isMobile);
  await hudClick(page, last, isMobile);
  await expect(reaction).toContainText(MESSAGE);
});

test('holding a dragged item over the page arrow turns pages for a drop combination', async ({
  page,
  workspace,
  isMobile,
}) => {
  const { next, first, last, reaction } = await fillPockets(
    page,
    workspace.source,
    workspace.url,
  );
  const start = await center(first);
  const arrow = await center(next);
  const host = page.locator('.canvas-host');
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      point?: { x: number; y: number },
    ) =>
      session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: point ? [{ ...point, id: 1 }] : [],
      });
    await touch('touchStart', start);
    for (let step = 1; step <= 8; step++)
      await touch('touchMove', {
        x: start.x + ((arrow.x - start.x) * step) / 8,
        y: start.y + ((arrow.y - start.y) * step) / 8,
      });
    await expect(host).toHaveAttribute('data-dragging', 'true');
    await expect(last).toHaveCount(1, { timeout: 15000 });
    const end = await center(last);
    await touch('touchMove', end);
    await touch('touchEnd');
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(arrow.x, arrow.y, { steps: 8 });
    await expect(host).toHaveAttribute('data-dragging', 'true');
    await expect(last).toHaveCount(1, { timeout: 15000 });
    const end = await center(last);
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
  }
  await expect(host).toHaveAttribute('data-dragging', 'false');
  await expect(reaction).toContainText(MESSAGE);
});
