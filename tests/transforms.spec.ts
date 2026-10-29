import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { ready, object, dragItem, pointInScene } from './helpers';
import type { GameContent, Hotspot } from '../src/game/types';
import { rotatedBounds } from '../src/game/transforms';

async function seed(workspace: { root: string; source: string }) {
  await writeFile(
    path.join(workspace.root, 'src/assets/transform-background.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><path fill="#172a35" d="M0 0h1280v720H0z"/></svg>',
  );
  await writeFile(
    path.join(workspace.root, 'src/assets/transform-wide.webp'),
    await sharp({
      create: { width: 160, height: 60, channels: 4, background: '#19d9df' },
    })
      .webp({ lossless: true })
      .toBuffer(),
  );
  const project: GameContent = {
    id: 'transform-fixture',
    startScene: 'room',
    initialMessage: '',
    flags: [],
    dialogues: [],
    combinations: [],
    items: [
      {
        id: 'token',
        label: 'Žetón',
        description: 'Skúšobný predmet.',
        icon: '●',
      },
    ],
    scenes: [
      {
        id: 'room',
        title: 'Transformácie',
        width: 1280,
        height: 720,
        background: 'transform-background.svg',
        hotspots: [
          {
            id: 'actor',
            label: 'Postava',
            bounds: { x: 100, y: 120, width: 300, height: 300 },
            image: 'animation-actor.png',

            onClick: [
              {
                message: 'Tu je žetón.',
                effects: [{ type: 'addItem', id: 'token' }],
              },
            ],
            uses: { token: [{ message: 'Predmet zasiahol otočenú postavu.' }] },
          },
          {
            id: 'wide',
            label: 'Široký WebP',
            bounds: { x: 650, y: 140, width: 400, height: 260 },
            rotation: 20,
            image: 'transform-wide.webp',

            onClick: [{ message: 'Široký obrázok.' }],
          },
          {
            id: 'vector',
            label: 'SVG',
            bounds: { x: 1000, y: 480, width: 180, height: 180 },
            image: 'cable.svg',

            onClick: [{ message: 'Vektor.' }],
          },
        ],
      },
    ],
  };
  await writeFile(workspace.source, JSON.stringify(project));
}
async function readBounds(page: Page) {
  const [x, y, width, height] = await Promise.all(
    ['x', 'y', 'width', 'height'].map(async (key) =>
      Number(
        await page.getByLabel(`Oblast ${key}`, { exact: true }).inputValue(),
      ),
    ),
  );
  return { x: x!, y: y!, width: width!, height: height! };
}
async function select(page: Page, id: string) {
  await page.getByLabel('Vybraný objekt', { exact: true }).selectOption(id);
}
async function gesture(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  touch: boolean,
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
      type: 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  }
}
async function centreOf(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function svgPoint(page: Page, x: number, y: number) {
  return page.locator('.editor-stage').evaluate(
    (svg: SVGSVGElement, p) => {
      const result = new DOMPoint(p.x, p.y).matrixTransform(
        svg.getScreenCTM()!,
      );
      return { x: result.x, y: result.y };
    },
    { x, y },
  );
}
async function editorImage(page: Page) {
  await page.getByLabel('Přiblížení scény', { exact: true }).selectOption('1');
  await page
    .getByRole('checkbox', { name: 'Pomůcky scény', exact: true })
    .uncheck();
  await page.mouse.move(0, 0);
  return sharp(
    await page.locator('.editor-stage').screenshot({ animations: 'disabled' }),
  )
    .resize(1280, 720)
    .removeAlpha()
    .raw()
    .toBuffer();
}
async function gameImage(page: Page) {
  await page.mouse.move(0, 0);
  // ResizeObserver must settle after a viewport/browser-zoom change before
  // measuring the canvas and cropping its screenshot with those dimensions.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const bytes = await page
    .locator('canvas')
    .screenshot({ animations: 'disabled' });
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // The fixture has a solid #172a35 background. Locate its rendered edges:
  // fractional mobile CSS zoom can include a few border pixels in a screenshot,
  // making a crop inferred from rounded DOM dimensions drift by several pixels.
  let left = info.width,
    top = info.height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (data[i] === 23 && data[i + 1] === 42 && data[i + 2] === 53) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  const width = right - left + 1,
    height = bottom - top + 1;
  expect(Math.abs(width / height - 1280 / 720)).toBeLessThan(0.02);
  const canvasBox = (await page.locator('canvas').boundingBox())!;
  const ratio = info.width / canvasBox.width;
  const controls = await page
    .locator(
      '.hud-accessibility [data-hud-control], .hud-accessibility [aria-label="Inventár"]',
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
  const overlays = controls.map((r) => ({
    x: (((r.x - canvasBox.x) * ratio - left) / width) * 1280 - 3,
    y: (((r.y - canvasBox.y) * ratio - top) / height) * 720 - 3,
    width: ((r.width * ratio) / width) * 1280 + 6,
    height: ((r.height * ratio) / height) * 720 + 6,
  }));
  return {
    pixels: await sharp(bytes)
      .extract({ left, top, width, height })
      .resize(1280, 720)
      .removeAlpha()
      .raw()
      .toBuffer(),
    overlays,
  };
}
function difference(
  a: Buffer,
  image: Awaited<ReturnType<typeof gameImage>>,
  hotspot: Hotspot,
) {
  const r = rotatedBounds(hotspot.bounds, hotspot.rotation);
  let sum = 0,
    count = 0;
  for (let y = Math.ceil(r.y); y < Math.floor(r.y + r.height); y++)
    for (let x = Math.ceil(r.x); x < Math.floor(r.x + r.width); x++) {
      // The game intentionally overlays artwork with the HUD. Compare the
      // visible scene pixels; the HUD itself has independent raster tests.
      if (
        image.overlays.some(
          (b) =>
            x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height,
        )
      )
        continue;
      for (let c = 0; c < 3; c++) {
        const i = (y * 1280 + x) * 3 + c;
        sum += Math.abs(a[i]! - image.pixels[i]!);
        count++;
      }
    }
  expect(
    count,
    'Too little unobscured artwork for a meaningful comparison',
  ).toBeGreaterThan(300);
  return sum / count;
}

async function save(page: Page) {
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
}

test('proportional handles, numeric edits, zoom and explicit distortion persist and match the game', async ({
  page,
  workspace,
  isMobile,
}, testInfo) => {
  await seed(workspace);
  await openEditor(page, workspace.url);
  await select(page, 'actor');
  const baseline = await editorImage(page);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  let project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const runtime = await gameImage(page);
  // The layer dock reduces the desktop SVG raster size. Allow 5/255 mean colour
  // error after resampling its antialiased edges to the game's larger canvas.
  for (const hotspot of project.scenes[0]!.hotspots)
    expect(difference(baseline, runtime, hotspot)).toBeLessThan(
      isMobile ? 7 : 5,
    );
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page
    .getByRole('button', { name: 'Rám podle obrázku', exact: true })
    .click();
  await page.getByLabel('Oblast width', { exact: true }).fill('210');
  let bounds = await readBounds(page);
  expect(bounds.width / bounds.height).toBeCloseTo(180 / 290, 3);
  // Clearing a number while typing does not save zero/NaN or break proportions.
  await page.getByLabel('Oblast width', { exact: true }).fill('');
  await page.getByLabel('Oblast width', { exact: true }).fill('220');
  await page.getByLabel('Oblast width', { exact: true }).blur();
  bounds = await readBounds(page);
  expect(bounds.width / bounds.height).toBeCloseTo(180 / 290, 3);
  await page
    .getByRole('checkbox', { name: 'Pomůcky scény', exact: true })
    .check();
  await page
    .getByLabel('Přiblížení scény', { exact: true })
    .selectOption('1.5');
  const before = await readBounds(page);
  const corner = await centreOf(page, '[data-resize-id="actor"]');
  await gesture(page, corner, { x: corner.x + 25, y: corner.y - 4 }, isMobile);
  const enlarged = await readBounds(page);
  expect(enlarged.width).toBeGreaterThan(before.width);
  expect(enlarged.width / enlarged.height).toBeCloseTo(
    before.width / before.height,
    3,
  );
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  expect(await readBounds(page)).toEqual(before);
  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  expect(await readBounds(page)).toEqual(enlarged);
  // Zoom and scrolling change screen coordinates, never authored coordinates.
  await page.getByLabel('Přiblížení scény', { exact: true }).selectOption('2');
  const start = await centreOf(
    page,
    '[data-hotspot-id="actor"] .editor-region',
  );
  const svgBox = (await page.locator('.editor-stage').boundingBox())!;
  await gesture(page, start, { x: start.x + 20, y: start.y }, isMobile);
  expect((await readBounds(page)).x - enlarged.x).toBeCloseTo(
    (20 * 1280) / svgBox.width,
    1,
  );
  await page.getByLabel('Přiblížení scény', { exact: true }).selectOption('1');
  await page.getByLabel('Oblast x', { exact: true }).fill('400');
  await page.getByLabel('Oblast y', { exact: true }).fill('160');
  bounds = await readBounds(page);
  const knob = await centreOf(page, '[data-rotate-id="actor"]');
  const right = await svgPoint(
    page,
    bounds.x + bounds.width / 2 + bounds.height / 2,
    bounds.y + bounds.height / 2,
  );
  await gesture(page, knob, right, isMobile);
  expect(
    Number(
      await page
        .getByLabel('Otočení objektu (°)', { exact: true })
        .inputValue(),
    ),
  ).toBeCloseTo(90, 0);
  await page
    .getByLabel('Transformační nástroj', { exact: true })
    .selectOption('stretch');
  const oldHeight = (await readBounds(page)).height;
  await page.getByLabel('Oblast width', { exact: true }).fill('160');
  expect((await readBounds(page)).height).toBe(oldHeight);
  await save(page);
  project = JSON.parse(await readFile(workspace.source, 'utf8')) as GameContent;
  const actor = project.scenes[0]!.hotspots[0]!;
  expect(actor.imageFit).toBe('stretch');
  expect(actor.rotation).toBe(90);
  const editor = await editorImage(page);
  await page
    .locator('.editor-stage')
    .screenshot({ path: testInfo.outputPath('transforms-editor.png') });
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  expect(difference(editor, await gameImage(page), actor)).toBeLessThan(
    isMobile ? 7 : 5,
  );
  await page.setViewportSize(
    isMobile ? { width: 740, height: 390 } : { width: 980, height: 760 },
  );
  await page.evaluate(() => {
    document.documentElement.style.zoom = '0.85';
  });
  await ready(page);
  // Fractional browser zoom changes edge sampling at the short viewport size.
  expect(difference(editor, await gameImage(page), actor)).toBeLessThan(10);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  expect(await readBounds(page)).toEqual(actor.bounds);
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await select(page, 'actor');
  await expect(
    page.getByLabel('Transformační nástroj', { exact: true }),
  ).toHaveValue('stretch');
  await expect(
    page.getByLabel('Otočení objektu (°)', { exact: true }),
  ).toHaveValue('90');
});

test('rotated hotspots accept scene clicks and inventory drops at their visible transformed position', async ({
  page,
  workspace,
  isMobile,
}) => {
  await seed(workspace);
  await openEditor(page, workspace.url);
  // Selecting an asset while starting a drag must not move the scene toolbar.
  const initialStart = await centreOf(
    page,
    '[data-hotspot-id="actor"] .editor-region',
  );
  const initialBox = (await page.locator('.editor-stage').boundingBox())!;
  await gesture(
    page,
    initialStart,
    { x: initialStart.x + 16, y: initialStart.y },
    isMobile,
  );
  expect((await readBounds(page)).x - 100).toBeCloseTo(
    (16 * 1280) / initialBox.width,
    1,
  );
  expect((await readBounds(page)).y).toBe(120);
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await page
    .getByRole('button', { name: 'Rám podle obrázku', exact: true })
    .click();
  await page.getByLabel('Oblast x', { exact: true }).fill('350');
  await page.getByLabel('Oblast y', { exact: true }).fill('210');
  await page.getByLabel('Otočení objektu (°)', { exact: true }).fill('90');
  const bounds = await readBounds(page);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  // Inside the rotated rectangle, outside the old unrotated one.
  const target = await pointInScene(
    page,
    bounds.x + bounds.width / 2 + bounds.height / 2 - 20,
    bounds.y + bounds.height / 2,
  );
  if (isMobile) await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.click(target.x, target.y);
  await expect(
    page.getByRole('button', { name: 'Žetón', exact: true }),
  ).toBeVisible();
  await dragItem(
    page,
    page.getByRole('button', { name: 'Žetón', exact: true }),
    target,
    isMobile,
  );
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Predmet zasiahol otočenú postavu.',
  );
  // Scene controls remain a usable keyboard alternative.
  await (await object(page, 'Postava')).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Tu je žetón.',
  );
});

test('canceling a transform restores the preview and leaves the authored source unchanged', async ({
  page,
  workspace,
  isMobile,
}) => {
  await seed(workspace);
  await openEditor(page, workspace.url);
  await select(page, 'actor');
  const original = await readFile(workspace.source, 'utf8');
  const before = await readBounds(page),
    start = await centreOf(page, '[data-resize-id="actor"]');
  const region = page.locator('[data-hotspot-id="actor"] .editor-region');
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x + 25, y: start.y + 15, id: 1 }],
    });
    await expect(region).not.toHaveAttribute('width', String(before.width));
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 25, start.y + 15, { steps: 5 });
    await expect(region).not.toHaveAttribute('width', String(before.width));
    await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  await expect(region).toHaveAttribute('width', String(before.width));
  expect(await readBounds(page)).toEqual(before);
  expect(await readFile(workspace.source, 'utf8')).toBe(original);
  if (isMobile) {
    await page
      .getByLabel('Přiblížení scény', { exact: true })
      .selectOption('2');
    await page
      .getByRole('checkbox', { name: 'Posun pohledu', exact: true })
      .check();
    const viewport = page.locator('.editor-stage-viewport');
    await viewport.scrollIntoViewIfNeeded();
    await viewport.evaluate((element) => {
      element.scrollLeft = 0;
    });
    const background = await svgPoint(page, 550, 25);
    await gesture(
      page,
      background,
      { x: background.x - 65, y: background.y },
      true,
    );
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    expect(await readBounds(page)).toEqual(before);
    expect(await readFile(workspace.source, 'utf8')).toBe(original);
  }
});
