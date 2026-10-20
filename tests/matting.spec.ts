import { expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { ready } from './helpers';
import { createArtwork } from '../dev/sceneArt';
import { artHash } from '../dev/artSource';
import { maskPng } from '../dev/objectMask';
import type { GameContent } from '../src/game/types';
import type { EditorJob } from '../src/editor/jobs';

test('real matting previews, lossless mask import/undo and source-sized PNG export work in the editor', async ({
  page,
  workspace,
  isMobile,
}, info) => {
  test.setTimeout(120000);
  const status = await (
    await page.request.get(`${workspace.url}__tukabel/editor/art/status`)
  ).json();
  test.skip(!status.segmentation.closedForm, 'npm run setup:matting');
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const folder = path.join(
    workspace.root,
    'src/assets/scene-art/matte-fixture',
  );
  await mkdir(folder, { recursive: true });
  const source = await sharp('src/assets/demo-room.svg').png().toBuffer();
  await writeFile(path.join(folder, 'source.png'), source);
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...project,
      scenes: project.scenes.map((s, i) =>
        i ? s : { ...s, background: 'scene-art/matte-fixture/source.png' },
      ),
    }),
  );
  await openEditor(page, workspace.url);
  const art = page.getByRole('region', { name: 'Grafické nástroje scény' });
  await page
    .getByRole('button', { name: 'Vybrať obdĺžnik', exact: true })
    .click();
  const stage = page.locator('.editor-stage');
  await stage.scrollIntoViewIfNeeded();
  const [start, end] = await stage.evaluate((el) =>
    [
      { x: 830, y: 55 },
      { x: 975, y: 195 },
    ].map((p) => {
      const point = new DOMPoint(p.x, p.y).matrixTransform(
        (el as SVGSVGElement).getScreenCTM()!,
      );
      return { x: point.x, y: point.y };
    }),
  );
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start!, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...end!, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(start!.x, start!.y);
    await page.mouse.down();
    await page.mouse.move(end!.x, end!.y);
    await page.mouse.up();
  }
  await art
    .getByRole('button', {
      name: 'Spresniť / upraviť masku objektu',
      exact: true,
    })
    .click();
  const editor = page.getByRole('dialog', { name: 'Maska objektu' });
  await editor
    .getByRole('button', { name: 'Spresniť hranice objektu', exact: true })
    .click();
  await expect(editor.getByRole('status')).toContainText('Skontroluj obrys', {
    timeout: 90000,
  });
  const method = status.segmentation.vitmatte ? 'vitmatte' : 'closed-form';
  await editor
    .getByLabel('Metóda alpha mattingu', { exact: true })
    .selectOption(method);
  await editor
    .getByRole('button', { name: 'Vypočítať jemnú alfu', exact: true })
    .click();
  await expect(editor.getByRole('status')).toContainText('Alfa je hotová', {
    timeout: 90000,
  });
  const canvas = editor.getByLabel('Plátno segmentačnej masky', {
    exact: true,
  });
  const values = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement,
      data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const levels = new Set<number>();
    for (let i = 3; i < data.length; i += 4) levels.add(data[i]!);
    return levels.size;
  });
  expect(values).toBeGreaterThan(16);
  await editor
    .getByRole('button', { name: 'Priblížiť objekt', exact: true })
    .click();
  await editor
    .getByLabel('Pozadie kontroly hrán', { exact: true })
    .selectOption('white');
  await editor.locator('.mask-viewport').scrollIntoViewIfNeeded();
  await editor.screenshot({ path: info.outputPath('matte-white.png') });
  await editor
    .getByLabel('Pozadie kontroly hrán', { exact: true })
    .selectOption('black');
  await editor.locator('.mask-viewport').scrollIntoViewIfNeeded();
  await editor.screenshot({ path: info.outputPath('matte-black.png') });
  // Manual changes invalidate the estimated boundary colors. Undo restores
  // both matte and preview; export cannot silently differ from that preview.
  await editor
    .getByLabel('Nástroj masky', { exact: true })
    .selectOption('unknown');
  await editor.locator('.mask-viewport').scrollIntoViewIfNeeded();
  const viewport = await editor.locator('.mask-viewport').boundingBox();
  const x = viewport!.x + viewport!.width / 2,
    y = viewport!.y + viewport!.height / 2;
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(
    editor.getByRole('button', { name: 'Použiť masku', exact: true }),
  ).toBeDisabled();
  await editor
    .getByRole('button', { name: 'Späť v maske', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Použiť masku', exact: true }),
  ).toBeEnabled();
  // A known fractional value must survive PNG -> Canvas -> PNG, not snap to 128.
  const imported = Buffer.alloc(1280 * 720);
  imported[100 * 1280 + 900] = 73;
  imported[101 * 1280 + 900] = 211;
  await editor.getByLabel('Načítať PNG masku').setInputFiles({
    name: 'fractional.png',
    mimeType: 'image/png',
    buffer: await maskPng(imported, 1280, 720),
  });
  await expect(editor.getByRole('status')).toContainText('Maska načítaná');
  expect(
    await canvas.evaluate(
      (el) =>
        (el as HTMLCanvasElement).getContext('2d')!.getImageData(900, 100, 1, 1)
          .data[3],
    ),
  ).toBe(73);
  await editor
    .getByRole('button', { name: 'Späť v maske', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Použiť masku', exact: true })
    .click();
  await art
    .getByRole('button', { name: 'Vytvoriť lokálny asset', exact: true })
    .click();
  await expect(
    art.getByRole('status', { name: 'Stav grafickej operácie' }),
  ).toContainText('Assety sú uložené', { timeout: 90000 });
  const jobs = (
    await (
      await page.request.get(`${workspace.url}__tukabel/editor/jobs`)
    ).json()
  ).jobs as EditorJob[];
  const result = jobs.find(
    (j): j is Extract<EditorJob, { kind: 'art' }> =>
      j.kind === 'art' && !!j.result,
  )!.result!;
  const asset = (id: string) => path.join(workspace.root, 'src/assets', id);
  const exported = await sharp(asset(result.image))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([exported.info.width, exported.info.height]).toEqual([1280, 720]);
  const alpha = await sharp(asset(result.objectMask!))
    .greyscale()
    .raw()
    .toBuffer();
  let mismatches = 0;
  for (let p = 0; p < alpha.length; p++)
    if (exported.data[p * 4 + 3] !== alpha[p]) mismatches++;
  expect(mismatches).toBe(0);
  expect(new Set(alpha).size).toBeGreaterThan(16);
  expect(
    JSON.parse(await readFile(asset(result.manifest), 'utf8')).objectMask,
  ).toMatchObject({
    pixelOwnership: 'alpha',
    matting: { method, decontaminate: true },
  });
  await art
    .getByRole('button', { name: 'Použiť výsledok v scéne', exact: true })
    .click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/project') && r.request().method() === 'PUT',
  );
  await page
    .getByRole('button', { name: 'Uložiť do projektu', exact: true })
    .click();
  expect((await saved).ok()).toBe(true);
  expect(await readFile(workspace.source, 'utf8')).toContain(result.image);
  await page
    .getByRole('button', { name: 'Otestovať odtiaľto ↗', exact: true })
    .click();
  await ready(page);
});

test('Canvas, PNG export and Pixi agree on straight alpha and transparent colors do not bleed during transforms', async ({
  page,
  workspace,
}) => {
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const assetRoot = path.join(workspace.root, 'src/assets');
  const folder = path.join(assetRoot, 'scene-art/render-fixture');
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'black.png'),
    await sharp({
      create: { width: 1280, height: 720, channels: 4, background: '#000' },
    })
      .png()
      .toBuffer(),
  );
  const bytes = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 240, g: 80, b: 24, alpha: 128 / 255 },
    },
  })
    .png()
    .toBuffer();
  await writeFile(path.join(folder, 'half.png'), bytes);
  const cutout = await createArtwork(assetRoot, {
    source: 'scene-art/render-fixture/half.png',
    operation: 'cutout',
    objectMask: {
      data: (await maskPng(Buffer.alloc(1024, 128), 32, 32)).toString('base64'),
      width: 32,
      height: 32,
      sourceSha256: artHash(bytes),
      method: 'manual',
      matting: { method: 'import', radius: 0, decontaminate: false },
    },
  });
  const raw = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      raw.set(x < 16 ? [0, 240, 0, 255] : [255, 0, 255, 0], (y * 32 + x) * 4);
  await writeFile(
    path.join(folder, 'hidden-colors.png'),
    await sharp(raw, { raw: { width: 32, height: 32, channels: 4 } })
      .png()
      .toBuffer(),
  );
  const scenes = project.scenes.map((s, i) =>
    i
      ? s
      : {
          ...s,
          background: 'scene-art/render-fixture/black.png',
          hotspots: [
            ...s.hotspots.map((h) => ({ ...h, hidden: true })),
            {
              id: 'half-alpha',
              label: 'Alpha',
              bounds: { x: 80, y: 150, width: 128, height: 128 },
              image: cutout.image,
              decorative: true,
              onClick: [],
            },
            {
              id: 'hidden-color',
              label: 'PMA',
              bounds: { x: 400, y: 150, width: 128, height: 128 },
              rotation: 17,
              image: 'scene-art/render-fixture/hidden-colors.png',
              decorative: true,
              onClick: [],
            },
          ],
        },
  );
  await writeFile(workspace.source, JSON.stringify({ ...project, scenes }));
  await page.goto(workspace.url);
  await ready(page);
  const screenshot = await sharp(
    await page.locator('.canvas-host canvas').screenshot(),
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = screenshot.info,
    scale = Math.min(width / 1280, height / 720),
    ox = (width - 1280 * scale) / 2,
    oy = (height - 720 * scale) / 2;
  const pixel = (x: number, y: number) =>
    screenshot.data.subarray(
      (Math.round(oy + y * scale) * width + Math.round(ox + x * scale)) * 3,
      (Math.round(oy + y * scale) * width + Math.round(ox + x * scale)) * 3 + 3,
    );
  const center = pixel(144, 214);
  for (const [i, expected] of [120, 40, 12].entries())
    expect(Math.abs(center[i]! - expected)).toBeLessThanOrEqual(2);
  let coloredFringes = 0,
    filteredEdge = 0;
  for (let y = 135; y < 295; y++)
    for (let x = 385; x < 545; x++) {
      const p = pixel(x, y);
      if (p[0]! > 2 || p[2]! > 2) coloredFringes++;
      if (p[1]! > 2 && p[1]! < 235) filteredEdge++;
    }
  expect(coloredFringes).toBe(0);
  expect(filteredEdge).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  // Guides intentionally tint bounds and show hidden layers. Compare the
  // authored image with those editing aids disabled, as in Game Mode.
  await page.getByLabel('Pomôcky scény', { exact: true }).uncheck();
  const stage = page.locator('.editor-stage');
  await expect(stage).toBeVisible();
  const point = await stage.evaluate((el) => {
    const p = new DOMPoint(144, 214).matrixTransform(
      (el as SVGSVGElement).getScreenCTM()!,
    );
    const b = el.getBoundingClientRect();
    return {
      x: p.x - b.left,
      y: p.y - b.top,
      width: b.width,
      height: b.height,
    };
  });
  const dev = await sharp(await stage.screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const x = Math.round((point.x * dev.info.width) / point.width),
    y = Math.round((point.y * dev.info.height) / point.height);
  const devColor = dev.data.subarray(
    (y * dev.info.width + x) * 3,
    (y * dev.info.width + x) * 3 + 3,
  );
  for (const [i, expected] of [120, 40, 12].entries())
    expect(Math.abs(devColor[i]! - expected)).toBeLessThanOrEqual(2);
});
