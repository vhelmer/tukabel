import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, openEditor } from './editorFixture';
import { ready, pointInScene, dragItem } from './helpers';
import { centre, rotateAround } from '../src/game/transforms';
import type { Point } from '../src/game/transforms';
import type { GameContent } from '../src/game/types';

async function seed(workspace: { root: string; source: string }) {
  await writeFile(
    path.join(workspace.root, 'src/assets/polygon-background.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><path fill="#283d42" d="M0 0h1280v720H0z"/><path fill="#5f9d88" stroke="#dec08c" stroke-width="8" d="M300 170H700V300H480V480H300Z"/></svg>',
  );
  const project: GameContent = {
    id: 'polygon-test',
    startScene: 'room',
    initialMessage: '',
    flags: [],
    dialogues: [],
    combinations: [],
    items: [{ id: 'token', label: 'Žetón', description: 'Test', icon: '●' }],
    scenes: [
      {
        id: 'room',
        title: 'Polygóny',
        width: 1280,
        height: 720,
        background: 'polygon-background.svg',
        hotspots: [
          {
            id: 'under',
            label: 'Podklad',
            bounds: { x: 100, y: 50, width: 1080, height: 600 },
            onClick: [
              {
                message: 'Klik: podklad',
                effects: [{ type: 'addItem', id: 'token' }],
              },
            ],
            uses: { token: [{ message: 'Drop: podklad' }] },
          },
        ],
      },
    ],
  };
  await writeFile(workspace.source, JSON.stringify(project));
}
async function editorPoint(page: Page, p: Point) {
  return page.locator('.editor-stage').evaluate((svg: SVGSVGElement, point) => {
    const p = new DOMPoint(point.x, point.y).matrixTransform(
      svg.getScreenCTM()!,
    );
    return { x: p.x, y: p.y };
  }, p);
}
async function tap(page: Page, p: Point, touch: boolean) {
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
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
    for (let i = 1; i <= 8; i++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * i) / 8,
            y: start.y + ((end.y - start.y) * i) / 8,
            id: 1,
          },
        ],
      });
    await session.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  }
}
async function saved(page: Page, source: string) {
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
  return JSON.parse(await readFile(source, 'utf8')) as GameContent;
}

test('draw, edit, transform and persist a concave polygon; clicks and drops follow its outline at any viewport', async ({
  page,
  workspace,
  isMobile,
}, testInfo) => {
  await seed(workspace);
  await openEditor(page, workspace.url);
  await page
    .getByRole('button', { name: 'Nakreslit polygon', exact: true })
    .click();
  await page.locator('.editor-stage').scrollIntoViewIfNeeded();
  const points = [
    { x: 300, y: 170 },
    { x: 700, y: 170 },
    { x: 700, y: 300 },
    { x: 480, y: 300 },
    { x: 480, y: 480 },
    { x: 300, y: 480 },
  ];
  for (const p of points) await tap(page, await editorPoint(page, p), isMobile);
  // Closing at the first vertex works for mouse and touch without a double click.
  await tap(page, await editorPoint(page, points[0]!), isMobile);
  const id = await page
    .getByLabel('Vybraný objekt', { exact: true })
    .inputValue();
  expect(id).not.toBe('under');
  const outline = page.locator(
    `[data-hotspot-id="${id}"] polygon.editor-region`,
  );
  await expect(page.locator('[data-vertex-index]')).toHaveCount(6);
  await page
    .getByLabel('Název objektu', { exact: true })
    .fill('Nepravidelné okno');
  await page.getByLabel('Reakce', { exact: true }).fill('Klik: polygon');
  await page
    .getByLabel('Přiblížení scény', { exact: true })
    .selectOption('1.5');
  await outline.scrollIntoViewIfNeeded();
  await drag(
    page,
    await editorPoint(page, points[2]!),
    await editorPoint(page, { x: 760, y: 320 }),
    isMobile,
  );
  const edited = await outline.getAttribute('points');
  expect(edited).toContain('760');
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(outline).toHaveAttribute(
    'points',
    points.map((p) => `${p.x},${p.y}`).join(' '),
  );
  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  await expect(outline).toHaveAttribute('points', edited!);
  await page.locator('[data-edge-index="1"]').click();
  await expect(page.locator('[data-vertex-index]')).toHaveCount(7);
  await page
    .getByRole('button', { name: 'Odstranit vybraný vrchol', exact: true })
    .click();
  await expect(page.locator('[data-vertex-index]')).toHaveCount(6);
  await expect(outline).toHaveAttribute('points', edited!);
  await outline.scrollIntoViewIfNeeded();
  await drag(
    page,
    await editorPoint(page, { x: 360, y: 400 }),
    await editorPoint(page, { x: 400, y: 420 }),
    isMobile,
  );
  await expect(page.getByLabel('Oblast x', { exact: true })).toHaveValue('340');
  await page.getByLabel('Oblast width', { exact: true }).fill('500');
  await page.getByLabel('Otočení objektu (°)', { exact: true }).fill('30');
  await page.getByLabel('Přiblížení scény', { exact: true }).selectOption('1');
  await outline.scrollIntoViewIfNeeded();
  const beforeCancel = await outline.getAttribute('points');
  const handleBox = (await page
    .locator('[data-vertex-index="2"]')
    .boundingBox())!;
  await drag(
    page,
    {
      x: handleBox.x + handleBox.width / 2,
      y: handleBox.y + handleBox.height / 2,
    },
    { x: handleBox.x + 15, y: handleBox.y + 25 },
    isMobile,
    true,
  );
  await expect(outline).toHaveAttribute('points', beforeCancel!);
  await page
    .locator('.editor-stage')
    .screenshot({ path: testInfo.outputPath('polygon-editor.png') });
  const project = await saved(page, workspace.source);
  const hotspot = project.scenes[0]!.hotspots.find((h) => h.id === id)!;
  expect(hotspot.polygon).toHaveLength(6);
  expect(hotspot.rotation).toBe(30);
  expect(hotspot.bounds.width).toBe(500);
  await outline.scrollIntoViewIfNeeded();
  for (const [fx, fy, expected] of [
    [0.8, 0.8, 'under'],
    [0.15, 0.75, id],
  ] as const) {
    const p = rotateAround(
      {
        x: hotspot.bounds.x + hotspot.bounds.width * fx,
        y: hotspot.bounds.y + hotspot.bounds.height * fy,
      },
      centre(hotspot.bounds),
      hotspot.rotation ?? 0,
    );
    const screen = await editorPoint(page, p);
    if (!isMobile) {
      await page.mouse.move(screen.x, screen.y);
      await expect(page.locator('.editor-stage')).toHaveAttribute(
        'data-hovered-id',
        expected,
      );
    }
    await tap(page, screen, isMobile);
    await expect(
      page.getByLabel('Vybraný objekt', { exact: true }),
    ).toHaveValue(expected);
  }

  const endpoint = new URL('__tukabel/editor/project', workspace.url).href;
  const snapshot = (await (await page.request.get(endpoint)).json()) as {
    revision: string;
  };
  const originalDisk = await readFile(workspace.source, 'utf8');
  const invalid = {
    ...project,
    scenes: project.scenes.map((s) => ({
      ...s,
      hotspots: s.hotspots.map((h) =>
        h.id === id
          ? {
              ...h,
              polygon: [
                { x: 350, y: 200 },
                { x: 450, y: 300 },
                { x: 350, y: 300 },
                { x: 450, y: 200 },
              ],
            }
          : h,
      ),
    })),
  };
  const rejected = await page.request.put(endpoint, {
    headers: { Origin: new URL(workspace.url).origin, 'X-Tukabel-Editor': '1' },
    data: { revision: snapshot.revision, content: invalid },
  });
  expect(rejected.status()).toBe(422);
  expect(await readFile(workspace.source, 'utf8')).toBe(originalDisk);
  await page.reload();
  await ready(page);
  const sample = (fx: number, fy: number) =>
    rotateAround(
      {
        x: hotspot.bounds.x + hotspot.bounds.width * fx,
        y: hotspot.bounds.y + hotspot.bounds.height * fy,
      },
      centre(hotspot.bounds),
      hotspot.rotation ?? 0,
    );
  for (const [fx, fy, label] of [
    [0.8, 0.8, 'Podklad'],
    [0.15, 0.75, 'Nepravidelné okno'],
  ] as const) {
    const p = sample(fx, fy),
      screen = await pointInScene(page, p.x, p.y);
    if (!isMobile) {
      await page.mouse.move(screen.x, screen.y);
      await expect(page.locator('.scene-label')).toHaveText(label);
    }
    await tap(page, screen, isMobile);
    await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
      label === 'Podklad' ? 'Klik: podklad' : 'Klik: polygon',
    );
    await dragItem(
      page,
      page.getByRole('button', { name: 'Žetón', exact: true }),
      screen,
      isMobile,
    );
    await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
      label === 'Podklad' ? 'Drop: podklad' : 'Toto tu nepomôže',
    );
  }
  await page
    .locator('.game-window')
    .screenshot({ path: testInfo.outputPath('polygon-game.png') });
  await page.setViewportSize(
    isMobile ? { width: 740, height: 390 } : { width: 940, height: 720 },
  );
  await page.evaluate(() => {
    document.documentElement.style.zoom = '0.85';
  });
  await ready(page);
  const p = sample(0.15, 0.75);
  await tap(page, await pointInScene(page, p.x, p.y), isMobile);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Klik: polygon',
  );
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.getByLabel('Vybraný objekt', { exact: true }).selectOption(id);
  expect(await outline.getAttribute('points')).toBe(beforeCancel);
});

test('rectangle conversion, polygon cancellation and invalid crossings keep authoring predictable', async ({
  page,
  workspace,
  isMobile,
}) => {
  await seed(workspace);
  await openEditor(page, workspace.url);
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('under');
  await page
    .getByRole('button', { name: 'Převést na polygon', exact: true })
    .click();
  await expect(page.locator('[data-vertex-index]')).toHaveCount(4);
  await page
    .getByRole('button', { name: 'Použít obdélník', exact: true })
    .click();
  await expect(page.locator('[data-vertex-index]')).toHaveCount(0);
  await expect(
    page.locator('[data-hotspot-id="under"] rect.editor-region'),
  ).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Nakreslit polygon', exact: true })
    .click();
  await page.locator('.editor-stage').scrollIntoViewIfNeeded();
  for (const p of [
    { x: 200, y: 200 },
    { x: 500, y: 500 },
    { x: 200, y: 500 },
    { x: 500, y: 200 },
  ])
    await tap(page, await editorPoint(page, p), isMobile);
  await page
    .getByRole('button', { name: 'Dokončit polygon', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('bez křížení');
  await expect(page.locator('[data-hotspot-id]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Nakreslit polygon', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page
    .getByRole('button', { name: 'Nakreslit polygon', exact: true })
    .click();
  await page.locator('.editor-stage').scrollIntoViewIfNeeded();
  for (const p of [
    { x: 300, y: 200 },
    { x: 600, y: 200 },
    { x: 450, y: 400 },
  ])
    await tap(page, await editorPoint(page, p), isMobile);
  // A cancelled press on the closing vertex must not publish a hotspot.
  const closing = await editorPoint(page, { x: 300, y: 200 });
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...closing, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(closing.x, closing.y);
    await page.mouse.down();
    await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  await expect(page.locator('[data-hotspot-id]')).toHaveCount(1);
  if (!isMobile) {
    await page
      .getByRole('button', { name: 'Nakreslit polygon', exact: true })
      .click();
    await page.locator('.editor-stage').scrollIntoViewIfNeeded();
    for (const p of [
      { x: 300, y: 200 },
      { x: 600, y: 200 },
      { x: 450, y: 400 },
    ])
      await tap(page, await editorPoint(page, p), false);
  }
  await page.locator('.editor-stage').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-vertex-index]')).toHaveCount(3);
  const vertex = page.getByRole('button', { name: 'Vrchol 2', exact: true });
  await vertex.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-vertex-index]')).toHaveCount(3);
  // A silent polygon remains interactive without requiring a commentary rule.
  await page
    .getByRole('button', { name: 'Odebrat pravidlo', exact: true })
    .click();
  await saved(page, workspace.source);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await tap(page, await pointInScene(page, 450, 270), isMobile);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toHaveCount(0);
});
