import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { ready, pointInScene, dragItem } from './helpers';
import { centre, imagePlacement, rotateAround } from '../src/game/transforms';
import type { GameContent, Hotspot } from '../src/game/types';

// Two padded PNGs overlap a manual hotspot. The front PNG has transparent,
// below-threshold, translucent and opaque stripes on its original full canvas.
async function seed(workspace: { source: string; root: string }) {
  const pixels = Buffer.alloc(200 * 100 * 4);
  for (let y = 20; y < 80; y++)
    for (let x = 20; x < 180; x++) {
      const i = (y * 200 + x) * 4;
      pixels[i] = 240;
      pixels[i + 1] = 60;
      pixels[i + 2] = 80;
      pixels[i + 3] = x < 60 ? 16 : x < 100 ? 128 : x < 140 ? 255 : 0;
    }
  await writeFile(
    path.join(workspace.root, 'src/assets/alpha-front.png'),
    await sharp(pixels, { raw: { width: 200, height: 100, channels: 4 } })
      .png()
      .toBuffer(),
  );
  await writeFile(
    path.join(workspace.root, 'src/assets/alpha-back.png'),
    await sharp({
      create: { width: 200, height: 100, channels: 4, background: '#36bcd3' },
    })
      .extend({
        top: 50,
        bottom: 50,
        left: 100,
        right: 100,
        background: '#00000000',
      })
      .png()
      .toBuffer(),
  );
  const make = (id: string, image?: string): Hotspot => ({
    id,
    label: id,
    image,
    bounds: { x: 300, y: 160, width: 600, height: 360 },
    rotation: 25,
    onClick: [
      { message: `Klik: ${id}`, effects: [{ type: 'addItem', id: 'token' }] },
    ],
    uses: { token: [{ message: `Drop: ${id}` }] },
  });
  const project: GameContent = {
    id: 'alpha-fixture',
    startScene: 'room',
    initialMessage: '',
    flags: [],
    dialogues: [],
    combinations: [],
    items: [{ id: 'token', label: 'Žetón', description: '', icon: '●' }],
    scenes: [
      {
        id: 'room',
        title: 'Alfa test',
        width: 1280,
        height: 720,
        background: 'demo-room.svg',
        hotspots: [
          make('under'),
          make('back', 'alpha-back.png'),
          make('front', 'alpha-front.png'),
        ],
      },
    ],
  };
  await writeFile(workspace.source, JSON.stringify(project));
  return project.scenes[0]!.hotspots[2]!;
}
function sourcePoint(hotspot: Hotspot, x: number, y: number) {
  const p = imagePlacement(
    hotspot.bounds,
    { width: 200, height: 100 },
    hotspot.imageFit,
  );
  return rotateAround(
    { x: p.x + (x / 200) * p.width, y: p.y + (y / 100) * p.height },
    centre(hotspot.bounds),
    hotspot.rotation ?? 0,
  );
}
async function editorPoint(page: Page, p: { x: number; y: number }) {
  return page.locator('.editor-stage').evaluate((svg: SVGSVGElement, point) => {
    const p = new DOMPoint(point.x, point.y).matrixTransform(
      svg.getScreenCTM()!,
    );
    return { x: p.x, y: p.y };
  }, p);
}
async function selectAt(
  page: Page,
  p: { x: number; y: number },
  mobile: boolean,
) {
  const screen = await editorPoint(page, p);
  if (mobile) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
}

test('padded PNGs pass clicks, hover and inventory drops through transparent pixels in both modes', async ({
  page,
  workspace,
  isMobile,
}, testInfo) => {
  const front = await seed(workspace);
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.getImageData;
    Object.assign(window, { alphaReads: 0 });
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const counter = window as typeof window & { alphaReads: number };
      counter.alphaReads++;
      return original.apply(this, args);
    };
  });
  await openEditor(page, workspace.url);
  await expect(page.getByText('Načítám klikatelné oblasti…')).toHaveCount(0);
  await page.locator('.editor-stage').scrollIntoViewIfNeeded();
  // Padding on both PNGs, low-alpha front over the back, and opaque front.
  const samples = [
    [10, 50, 'under'],
    [40, 50, 'under'],
    [80, 50, 'front'],
    [120, 50, 'front'],
    [145, 50, 'back'],
  ] as const;
  for (const [x, y, id] of samples) {
    if (!isMobile) {
      const p = await editorPoint(page, sourcePoint(front, x, y));
      await page.mouse.move(p.x, p.y);
      await expect(page.locator('.editor-stage')).toHaveAttribute(
        'data-hovered-id',
        id,
      );
    }
    await selectAt(page, sourcePoint(front, x, y), isMobile);
    await expect(
      page.getByLabel('Vybraný objekt', { exact: true }),
    ).toHaveValue(id);
  }
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('front');
  await page
    .getByLabel('Práh neprůhlednosti (1–255)', { exact: true })
    .fill('200');
  await page.locator('.editor-stage').scrollIntoViewIfNeeded();
  await selectAt(page, sourcePoint(front, 80, 50), isMobile);
  await expect(page.getByLabel('Vybraný objekt', { exact: true })).toHaveValue(
    'back',
  );
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('front');
  await page
    .getByLabel('Přiblížení scény', { exact: true })
    .selectOption('1.5');
  // Keep the tested point in the scrolled/zoomed SVG viewport.
  await page
    .locator('[data-hotspot-id="front"] .editor-region')
    .scrollIntoViewIfNeeded();
  await selectAt(page, sourcePoint(front, 120, 50), isMobile);
  await expect(page.getByLabel('Vybraný objekt', { exact: true })).toHaveValue(
    'front',
  );
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
  const disk = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(disk.scenes[0]!.hotspots[2]!.alphaThreshold).toBe(200);
  await page.reload();
  await ready(page);
  const reads = await page.evaluate(
    () => (window as typeof window & { alphaReads: number }).alphaReads,
  );
  for (const [x, y, id] of [
    [10, 50, 'under'],
    [80, 50, 'back'],
    [120, 50, 'front'],
    [145, 50, 'back'],
  ] as const) {
    const p = sourcePoint(front, x, y);
    const screen = await pointInScene(page, p.x, p.y);
    if (!isMobile) {
      await page.mouse.move(screen.x, screen.y);
      await expect(page.locator('.scene-label')).toHaveText(id);
    }
    if (isMobile) await page.touchscreen.tap(screen.x, screen.y);
    else await page.mouse.click(screen.x, screen.y);
    await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
      `Klik: ${id}`,
    );
    await dragItem(
      page,
      page.getByRole('button', { name: 'Žetón', exact: true }),
      screen,
      isMobile,
    );
    await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
      `Drop: ${id}`,
    );
  }
  expect(
    await page.evaluate(
      () => (window as typeof window & { alphaReads: number }).alphaReads,
    ),
  ).toBe(reads);
  await page
    .locator('.game-window')
    .screenshot({ path: testInfo.outputPath('alpha-overlap-game.png') });
  await page.setViewportSize(
    isMobile ? { width: 430, height: 900 } : { width: 1000, height: 760 },
  );
  await page.evaluate(() => {
    document.documentElement.style.zoom = '0.85';
  });
  await ready(page);
  const resizedPoint = sourcePoint(front, 120, 50);
  const resizedScreen = await pointInScene(
    page,
    resizedPoint.x,
    resizedPoint.y,
  );
  if (isMobile) await page.touchscreen.tap(resizedScreen.x, resizedScreen.y);
  else await page.mouse.click(resizedScreen.x, resizedScreen.y);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Klik: front',
  );
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('front');
  await page
    .getByLabel('Klikatelná oblast', { exact: true })
    .selectOption('bounds');
  await page.locator('.editor-stage').scrollIntoViewIfNeeded();
  await selectAt(page, sourcePoint(front, 10, 50), isMobile);
  await expect(page.getByLabel('Vybraný objekt', { exact: true })).toHaveValue(
    'front',
  );
  // Explicit manual frames persist on disk and win on transparent pixels.
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
  const manual = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(manual.scenes[0]!.hotspots[2]!.hitTest).toBe('bounds');
  await page.reload();
  await ready(page);
  const p = sourcePoint(front, 10, 50),
    screen = await pointInScene(page, p.x, p.y);
  if (isMobile) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Klik: front',
  );
});

test('animated alpha follows the displayed frame and stationary hover; reduced motion restores source picking', async ({
  page,
  workspace,
  isMobile,
}) => {
  const front = await seed(workspace);
  await writeFile(
    path.join(workspace.root, 'src/assets/alpha-empty.png'),
    await sharp({
      create: { width: 200, height: 100, channels: 4, background: '#00000000' },
    })
      .png()
      .toBuffer(),
  );
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...project,
      animations: [
        {
          id: 'fade',
          label: 'Fade',
          source: front.image,
          kind: 'idle',
          frames: [front.image, 'alpha-empty.png'],
          fps: 2,
          loop: false,
        },
      ],
      scenes: project.scenes.map((scene) => ({
        ...scene,
        hotspots: scene.hotspots.map((h) =>
          h.id === 'front'
            ? {
                ...h,
                imageFit: 'stretch',
                animation: { idle: 'fade', motion: 'sway' },
              }
            : h,
        ),
      })),
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(workspace.url);
  await ready(page);
  const p = sourcePoint({ ...front, imageFit: 'stretch' }, 120, 50);
  const screen = await pointInScene(page, p.x, p.y);
  if (isMobile) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Klik: front',
  );
  if (!isMobile) await expect(page.locator('.scene-label')).toHaveText('front');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (!isMobile) {
    // No mouse move: The existing animation ticker must refresh the stationary hover.
    await expect(page.locator('.scene-label')).toHaveText('back');
  } else {
    // Wait for the non-looping clip to finish; touch has no stationary hover.
    await page.waitForTimeout(900);
  }
  if (isMobile) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Klik: back',
  );
  await dragItem(
    page,
    page.getByRole('button', { name: 'Žetón', exact: true }),
    screen,
    isMobile,
  );
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Drop: back',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!isMobile) await expect(page.locator('.scene-label')).toHaveText('front');
  if (isMobile) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Klik: front',
  );
});
