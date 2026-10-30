import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { test } from './editorFixture';
import { ready, hudClick, dragItem } from './helpers';
import type { GameContent } from '../src/game/types';

async function setup(page: Page, source: string, url: string) {
  const content: GameContent = {
    id: 'scene-pan-test',
    startScene: 'room',
    initialMessage: '',
    flags: ['used'],
    scenes: [
      {
        id: 'room',
        title: 'Posúvanie',
        width: 1280,
        height: 720,
        background: 'demo-room.svg',
        hotspots: [
          {
            id: 'left',
            label: 'Ľavý okraj',
            bounds: { x: 20, y: 300, width: 80, height: 80 },
            placeholder: true,
            onClick: [{ message: 'Ľavý okraj funguje.' }],
          },
          {
            id: 'npc',
            label: 'Postava',
            bounds: { x: 590, y: 300, width: 100, height: 100 },
            placeholder: true,
            onClick: [{ effects: [{ type: 'dialogue', id: 'hello' }] }],
          },
          {
            id: 'pickup',
            label: 'Náradie na zemi',
            bounds: { x: 550, y: 470, width: 80, height: 80 },
            placeholder: true,
            visibleWhen: { not: { item: 'tool' } },
            onClick: [{ effects: [{ type: 'addItem', id: 'tool' }] }],
          },
          {
            id: 'right',
            label: 'Pravý okraj',
            bounds: { x: 1180, y: 300, width: 80, height: 80 },
            placeholder: true,
            onClick: [{ message: 'Pravý okraj funguje.' }],
            uses: {
              tool: [
                {
                  message: 'Náradie funguje aj po posune.',
                  effects: [{ type: 'flag', id: 'used', value: true }],
                },
              ],
            },
          },
        ],
      },
    ],
    items: [
      {
        id: 'tool',
        label: 'Náradie',
        description: 'Skúšobné náradie.',
        icon: '✦',
        image: 'story/wrench.svg',
      },
    ],
    dialogues: [
      {
        id: 'hello',
        start: 'hello',
        entry: 'speech',
        nodes: [
          {
            id: 'hello',
            speaker: 'Postava',
            text: 'Kliknutie funguje aj po posune.',
            choices: [],
          },
        ],
      },
    ],
    combinations: [],
  };
  await writeFile(source, JSON.stringify(content));
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(url);
  await ready(page);
}
async function bounds(page: Page, id: string) {
  const box = await page.locator(`[data-hotspot-id="${id}"]`).boundingBox();
  if (!box) throw Error('Missing hotspot ' + id);
  return box;
}
async function tap(page: Page, x: number, y: number, touch: boolean) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
async function swipe(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  touch: boolean,
  cancel = false,
) {
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let n = 1; n <= 8; n++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * n) / 8, y: y + (dy * n) / 8, id: 1 }],
      });
    await session.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  }
}

test('a small window keeps the scene readable and swipes never activate an NPC', async ({
  page,
  workspace,
  isMobile,
}, info) => {
  await setup(page, workspace.source, workspace.url);
  const start = await bounds(page, 'npc');
  expect(start.width).toBeCloseTo(75, 0);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  const menuBefore = await menu.boundingBox();
  await swipe(
    page,
    start.x + start.width / 2,
    start.y + start.height / 2,
    -110,
    0,
    isMobile,
  );
  await expect(page.getByRole('dialog', { name: 'Rozhovor' })).toHaveCount(0);
  await expect
    .poll(async () => (await bounds(page, 'npc')).x)
    .toBeLessThan(start.x - 90);
  expect(await menu.boundingBox()).toEqual(menuBefore);
  const shifted = await bounds(page, 'npc');
  await tap(
    page,
    shifted.x + shifted.width / 2,
    shifted.y + shifted.height / 2,
    isMobile,
  );
  const dialogue = page.getByRole('dialog', { name: 'Rozhovor' });
  await expect(dialogue).toContainText('Kliknutie funguje');
  await dialogue
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  await expect(dialogue).toHaveCount(0);
  await page.locator('[data-hotspot-id="left"]').focus();
  const left = await bounds(page, 'left');
  await tap(page, left.x + left.width / 2, left.y + left.height / 2, isMobile);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Ľavý okraj',
  );
  await page.locator('[data-hotspot-id="right"]').focus();
  const right = await bounds(page, 'right');
  await tap(
    page,
    right.x + right.width / 2,
    right.y + right.height / 2,
    isMobile,
  );
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Pravý okraj',
  );
  await page.screenshot({ path: info.outputPath('mobile-panned-scene.png') });
});

test('inventory drops, canceled gestures, menu blocking and rotation respect the current scene view', async ({
  page,
  workspace,
  isMobile,
}) => {
  await setup(page, workspace.source, workspace.url);
  const pickup = await bounds(page, 'pickup');
  await tap(
    page,
    pickup.x + pickup.width / 2,
    pickup.y + pickup.height / 2,
    isMobile,
  );
  const item = page.getByRole('button', { name: 'Náradie', exact: true });
  await expect(item).toBeVisible();
  await page.locator('[data-hotspot-id="right"]').focus();
  const right = await bounds(page, 'right');
  await dragItem(
    page,
    item,
    { x: right.x + right.width / 2, y: right.y + right.height / 2 },
    isMobile,
  );
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Náradie funguje aj po posune.',
  );
  const before = await bounds(page, 'right');
  await swipe(page, 200, before.y + before.height / 2, 90, 0, isMobile, true);
  await expect(page.getByRole('dialog', { name: 'Rozhovor' })).toHaveCount(0);
  await hudClick(
    page,
    page.getByRole('button', { name: 'Menu', exact: true }),
    isMobile,
  );
  const locked = await page
    .locator('.canvas-host')
    .getAttribute('data-scene-x');
  await page.mouse.move(200, 450);
  await page.mouse.wheel(400, 0);
  await expect(page.locator('.canvas-host')).toHaveAttribute(
    'data-scene-x',
    locked!,
  );
  await page
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  await page.setViewportSize({ width: 800, height: 400 });
  await ready(page);
  await page.locator('[data-hotspot-id="right"]').focus();
  const rotated = await bounds(page, 'right');
  const canvas = await page.locator('.canvas-host canvas').boundingBox();
  expect(rotated.x + rotated.width / 2).toBeGreaterThan(canvas!.x);
  expect(rotated.x + rotated.width / 2).toBeLessThan(canvas!.x + canvas!.width);
  await dragItem(
    page,
    item,
    { x: rotated.x + rotated.width / 2, y: rotated.y + rotated.height / 2 },
    isMobile,
  );
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Náradie funguje aj po posune.',
  );
});

test('keyboard arrows pan both axes and a second touch never starts a conversation', async ({
  page,
  workspace,
  isMobile,
}) => {
  await setup(page, workspace.source, workspace.url);
  await page.locator('.scene-frame').focus();
  const initial = await bounds(page, 'npc');
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await bounds(page, 'npc')).x)
    .toBeCloseTo(initial.x - 80, 0);
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => (await bounds(page, 'npc')).x)
    .toBeCloseTo(initial.x, 0);
  await page.setViewportSize({ width: 800, height: 400 });
  await ready(page);
  await page.locator('.scene-frame').focus();
  const wide = await bounds(page, 'npc');
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => (await bounds(page, 'npc')).y)
    .toBeCloseTo(wide.y - 80, 0);
  await page.keyboard.press('ArrowUp');
  await expect
    .poll(async () => (await bounds(page, 'npc')).y)
    .toBeCloseTo(wide.y, 0);
  if (isMobile) {
    await page.setViewportSize({ width: 400, height: 800 });
    await ready(page);
    const npc = await bounds(page, 'npc');
    const first = {
      x: npc.x + npc.width / 2 - 10,
      y: npc.y + npc.height / 2,
      id: 1,
    };
    const second = { x: first.x + 20, y: first.y, id: 2 };
    const session = await page.context().newCDPSession(page);
    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [first],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [first, second],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    } finally {
      await session.detach();
    }
    await expect(page.getByRole('dialog', { name: 'Rozhovor' })).toHaveCount(0);
    await tap(page, first.x, first.y, true);
    await expect(page.getByRole('dialog', { name: 'Rozhovor' })).toContainText(
      'Kliknutie funguje',
    );
  }
});
