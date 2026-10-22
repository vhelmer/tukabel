import { expect, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { ready } from './helpers';
import type { GameContent } from '../src/game/types';
import type { EditorJob } from '../src/editor/jobs';
import { artFingerprint } from '../src/editor/jobs';

async function sourcePoint(canvas: Locator, x: number, y: number) {
  await canvas.scrollIntoViewIfNeeded();
  return canvas.evaluate(
    (el, p) => {
      const c = el as HTMLCanvasElement,
        view = el.parentElement!;
      const scale = c.getBoundingClientRect().width / c.width;
      view.scrollLeft = Math.max(0, p.x * scale - view.clientWidth / 2);
      view.scrollTop = Math.max(0, p.y * scale - view.clientHeight / 2);
      const box = c.getBoundingClientRect();
      return {
        x: box.x + (p.x * box.width) / c.width,
        y: box.y + (p.y * box.height) / c.height,
      };
    },
    { x, y },
  );
}
async function mark(
  page: Page,
  canvas: Locator,
  x: number,
  y: number,
  touch: boolean,
) {
  const p = await sourcePoint(canvas, x, y);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function selectClock(page: Page, touch: boolean) {
  await page
    .getByRole('button', { name: 'Vybrat obdélník', exact: true })
    .click();
  const stage = page.locator('.editor-stage');
  await stage.scrollIntoViewIfNeeded();
  const [start, end] = await stage.evaluate((el) => {
    const m = (el as SVGSVGElement).getScreenCTM()!;
    return [
      { x: 830, y: 55 },
      { x: 975, y: 195 },
    ].map((p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(m);
      return { x: q.x, y: q.y };
    });
  });
  if (touch) {
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
    await page.mouse.move(end!.x, end!.y, { steps: 4 });
    await page.mouse.up();
  }
  await expect(stage.locator('[data-art-selection]')).toHaveCount(1);
}

test.use({
  artTools: {
    apiKey: 'mock-art-mask-key',
    fetch: (async (_url, init) => {
      const body = JSON.parse(init!.body as string),
        [width, height] = body.size.split('x').map(Number);
      const png = await sharp({
        create: { width, height, channels: 4, background: '#d2b782' },
      })
        .png()
        .toBuffer();
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    }) as typeof fetch,
  },
});

test('source-pixel masks support real segmentation, manual touchups, zoom, comparison, saving and static game playback', async ({
  page,
  workspace,
  isMobile,
}, info) => {
  test.setTimeout(120000);
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const folder = path.join(workspace.root, 'src/assets/scene-art/mask-fixture');
  await mkdir(folder, { recursive: true });
  const png = await sharp('src/assets/demo-room.svg').png().toBuffer();
  await writeFile(path.join(folder, 'source.png'), png);
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...project,
      scenes: project.scenes.map((s, i) =>
        i ? s : { ...s, background: 'scene-art/mask-fixture/source.png' },
      ),
    }),
  );
  await openEditor(page, workspace.url);
  const art = page.getByRole('region', { name: 'Grafické nástroje scény' });
  await art
    .getByLabel('Grafická operace', { exact: true })
    .selectOption('extract');
  await art
    .getByLabel('Název výsledné vrstvy nebo lokace', { exact: true })
    .fill('Presné hodiny');
  const cleanup = art.getByLabel('Dočištění pozadí za obrysem (px zdroje)', {
    exact: true,
  });
  await expect(cleanup).toHaveValue('12');
  await cleanup.fill('10');
  await selectClock(page, isMobile);
  await art
    .getByRole('button', {
      name: 'Zpřesnit / upravit masku objektu',
      exact: true,
    })
    .click();
  const editor = page.getByRole('dialog', { name: 'Maska objektu' });
  const canvas = editor.getByLabel('Plátno segmentační masky', {
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await expect(
    editor.getByRole('button', { name: 'Použít masku', exact: true }),
  ).toBeEnabled();
  await editor
    .getByLabel('Přiblížení masky', { exact: true })
    .selectOption('2');
  // Paint then undo at source coordinates; all later output remains aligned.
  await mark(page, canvas, 820, 120, isMobile);
  await editor
    .getByRole('button', { name: 'Zpět v masce', exact: true })
    .click();
  await mark(page, canvas, 905, 105, isMobile);
  await editor
    .getByLabel('Poloměr štětce (px zdroje)', { exact: true })
    .fill('2');
  await mark(page, canvas, 849, 120, isMobile);
  await editor
    .getByLabel('Nástroj masky', { exact: true })
    .selectOption('erase');
  await mark(page, canvas, 965, 180, isMobile);
  await editor
    .getByLabel('Přiblížení masky', { exact: true })
    .selectOption('1');
  const refine = editor.getByRole('button', {
    name: 'Zpřesnit hranice objektu',
    exact: true,
  });
  // This test deliberately uses the real local CLI, never a fake segmented mask.
  const status = await page.request.get(
    `${workspace.url}__tukabel/editor/art/status`,
  );
  const segmentation = (await status.json()).segmentation;
  const available = segmentation.grabcut;
  const method = segmentation.sam2 ? 'sam2' : 'grabcut';
  // Installed alternatives (e.g. SAM 3) may change the editor's default.
  // Exercise this test's declared method rather than relying on that default.
  if (available)
    await editor
      .getByLabel('Segmentace hranic', { exact: true })
      .selectOption(method);
  if (segmentation.sam2) {
    const detail = editor.getByRole('checkbox', {
      name: 'Detailní přechod · experimentální',
      exact: true,
    });
    await expect(detail).not.toBeChecked();
    await detail.check();
    const edges = editor.getByRole('checkbox', {
      name: 'Dotáhnout obrysy a tenké části',
      exact: true,
    });
    await expect(edges).toBeChecked();
    await edges.uncheck();
    await expect(edges).not.toBeChecked();
    await edges.check();
  }
  if (available) {
    await expect(refine).toBeEnabled();
    const request = page.waitForRequest(
      (r) => r.url().endsWith('/art/segment') && r.method() === 'POST',
    );
    await refine.click();
    const sent = (await request).postDataJSON();
    expect(sent.method).toBe(method);
    expect(sent.refineEdges).toBe(true);
    expect(sent.detailPass).toBe(segmentation.sam2);
    await expect(editor.getByRole('status')).toContainText('Zkontroluj obrys', {
      timeout: 90000,
    });
  } else {
    await expect(refine).toBeDisabled();
    await expect(editor).toContainText('npm run setup:segmentation');
  }
  await editor
    .getByLabel('Zobrazení masky', { exact: true })
    .selectOption('cutout');
  await editor
    .getByRole('button', { name: 'Přiblížit objekt', exact: true })
    .click();
  await editor.screenshot({ path: info.outputPath('mask-editor.png') });
  await editor
    .getByRole('button', { name: 'Použít masku', exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(art).toContainText('Maska připravená');
  await art
    .getByRole('button', {
      name: 'Spustit AI úpravu (API kredit)',
      exact: true,
    })
    .click();
  await expect(
    art.getByRole('status', { name: 'Stav grafické operace' }),
  ).toContainText('Assety jsou uložené');
  const comparison = art.getByRole('region', { name: 'Porovnání oddělení' });
  await expect(comparison).toContainText(
    '0 chyb při zachování původních pixelů',
  );
  await comparison.getByLabel('Posuvník porovnání', { exact: true }).fill('70');
  await comparison.screenshot({
    path: info.outputPath('exact-reassembly.png'),
  });
  await comparison
    .getByLabel('Porovnání výřezu', { exact: true })
    .selectOption('difference');
  await comparison
    .getByLabel('Porovnání výřezu', { exact: true })
    .selectOption('repair');
  const jobs = (
    await (
      await page.request.get(`${workspace.url}__tukabel/editor/jobs`)
    ).json()
  ).jobs as EditorJob[];
  const result = jobs.find(
    (j): j is Extract<EditorJob, { kind: 'art' }> =>
      j.kind === 'art' && j.result?.operation === 'extract',
  )!.result!;
  const asset = (id: string) => path.join(workspace.root, 'src/assets', id);
  const original = await sharp(asset(result.original!))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const combined = await sharp(asset(result.reassembled!))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const repair = await sharp(asset(result.repairMask!))
    .greyscale()
    .raw()
    .toBuffer();
  const mask = await sharp(asset(result.objectMask!))
    .greyscale()
    .raw()
    .toBuffer();
  let unexpected = 0;
  for (let p = 0; p < mask.length; p++)
    if (
      (mask[p] || !repair[p]) &&
      !combined
        .subarray(p * 4, p * 4 + 4)
        .equals(original.subarray(p * 4, p * 4 + 4))
    )
      unexpected++;
  expect(unexpected).toBe(0);
  expect(result.reconstruction?.cleanupPixels).toBeGreaterThan(0);
  if (available) {
    expect(mask[60 * 1280 + 835]).toBe(0);
    expect(mask[105 * 1280 + 905]).toBe(255);
  }
  const cutout = await sharp(asset(result.cutoutFull!))
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect(cutout[(105 * 1280 + 905) * 4 + 3]).toBe(255);
  // Reopen/import the saved mask to confirm it remains editable in source pixels.
  await art
    .getByRole('button', {
      name: 'Zpřesnit / upravit masku objektu',
      exact: true,
    })
    .click();
  await expect(canvas).toBeVisible();
  await editor
    .getByLabel('Načíst PNG masku')
    .setInputFiles(asset(result.objectMask!));
  await expect(editor.getByRole('status')).toContainText('Maska načtená');
  await editor
    .getByRole('button', { name: 'Zavřít bez použití', exact: true })
    .click();
  await art
    .getByRole('button', { name: 'Použít výsledek ve scéně', exact: true })
    .click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/project') && r.request().method() === 'PUT',
  );
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  expect((await saved).ok()).toBe(true);
  const disk = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(disk.scenes[0]!.background).toBe(result.backgrounds!.restored);
  expect(
    disk.scenes[0]!.hotspots.find((h) => h.label === 'Presné hodiny'),
  ).toMatchObject({
    image: result.cutout,
    bounds: {
      x: result.cutoutFrame!.x,
      y: result.cutoutFrame!.y,
      width: result.cutoutFrame!.width,
      height: result.cutoutFrame!.height,
    },
    decorative: true,
  });
  const recipe = JSON.parse(await readFile(asset(result.manifest), 'utf8'));
  expect(recipe.reconstruction.unexpectedPixels).toBe(0);
  expect(recipe.repairPadding).toBe(10);
  expect(recipe.objectMask.method).toBe(available ? method : 'manual');
  if (segmentation.sam2) expect(recipe.objectMask.refineEdges).toBe(true);
  await page
    .getByRole('button', { name: 'Otestovat odsud ↗', exact: true })
    .click();
  await ready(page);
  await page
    .locator('.canvas-host canvas')
    .screenshot({ path: info.outputPath('reassembled-game.png') });
  expect(await readFile(path.join(folder, 'source.png'))).toEqual(png);
  const foreign = await page.request.post(
    `${workspace.url}__tukabel/editor/art/segment`,
    {
      headers: { Origin: 'https://foreign.invalid', 'X-Tukabel-Editor': '1' },
      data: {},
    },
  );
  expect(foreign.status()).toBe(403);
});

async function selectBackgroundPolygon(page: Page, touch: boolean) {
  await page
    .getByRole('button', { name: 'Vybrat polygon', exact: true })
    .click();
  const stage = page.locator('.editor-stage');
  await stage.scrollIntoViewIfNeeded();
  const points = await stage.evaluate((el) => {
    const matrix = (el as SVGSVGElement).getScreenCTM()!;
    return [
      { x: 300, y: 400 },
      { x: 650, y: 400 },
      { x: 650, y: 650 },
      { x: 300, y: 650 },
      { x: 300, y: 400 },
    ].map((p) => {
      const screen = new DOMPoint(p.x, p.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  });
  for (const p of points) {
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  }
  await expect(stage.locator('[data-art-selection]')).toHaveCount(1);
}

test('a background polygon opens the mask editor even when a character was selected earlier', async ({
  page,
  workspace,
  isMobile,
}) => {
  await openEditor(page, workspace.url);
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('caretaker');
  await selectBackgroundPolygon(page, isMobile);
  const art = page.getByRole('region', { name: 'Grafické nástroje scény' });
  await expect(
    art.getByLabel('Zdroj grafické úpravy', { exact: true }),
  ).toHaveValue('background');
  await art
    .getByRole('button', {
      name: 'Zpřesnit / upravit masku objektu',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Maska objektu' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Plátno segmentační masky', { exact: true }),
  ).toBeVisible();
});

test('mask launch errors remain visible beside the button and source switching preserves the polygon and restores object jobs', async ({
  page,
  workspace,
  isMobile,
}) => {
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const scene = project.scenes[0]!,
    actor = scene.hotspots.find((h) => h.id === 'caretaker')!;
  await openEditor(page, workspace.url);
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption(actor.id);
  const art = page.getByRole('region', { name: 'Grafické nástroje scény' });
  const source = art.getByLabel('Zdroj grafické úpravy', { exact: true });
  await source.selectOption('object');
  const actorSize = await sharp(
    path.join(workspace.root, 'src/assets', actor.image!),
  ).metadata();
  const response = await page.request.post(
    `${workspace.url}__tukabel/editor/jobs`,
    {
      headers: {
        Origin: new URL(workspace.url).origin,
        'X-Tukabel-Editor': '1',
      },
      data: {
        kind: 'art',
        label: 'Predchádzajúci výrez',
        context: {
          sceneId: scene.id,
          targetId: actor.id,
          label: 'Predchádzajúci výrez',
          fingerprint: artFingerprint(scene, actor.id),
          placement: {
            bounds: actor.bounds,
            rotation: actor.rotation,
            imageFit: actor.imageFit,
          },
        },
        input: {
          source: actor.image,
          operation: 'cutout',
          selection: [
            { x: 0, y: 0 },
            { x: actorSize.width!, y: 0 },
            { x: actorSize.width!, y: actorSize.height! },
            { x: 0, y: actorSize.height! },
          ],
        },
      },
    },
  );
  expect(response.status()).toBe(202);
  await expect(
    art.getByRole('status', { name: 'Stav grafické operace' }),
  ).toContainText('Assety jsou uložené');
  await selectBackgroundPolygon(page, isMobile);
  await source.selectOption('background');
  await expect(page.locator('[data-art-selection]')).toHaveCount(1);
  // Opening an object job must restore its explicit target even without a remount.
  await page
    .getByRole('button', { name: 'Otevřít výsledek', exact: true })
    .click();
  await expect(source).toHaveValue('object');
  await art
    .getByRole('button', {
      name: 'Zpřesnit / upravit masku objektu',
      exact: true,
    })
    .click();
  await expect(page.getByRole('dialog', { name: 'Maska objektu' })).toHaveCount(
    0,
  );
  await expect(art.locator('.mask-launcher').getByRole('alert')).toContainText(
    'Pozadí lokace',
  );
  // The older job's success message must not hide the new launch error.
  await expect(
    art.getByRole('status', { name: 'Stav grafické operace' }),
  ).toContainText('Assety jsou uložené');
  await source.selectOption('background');
  await expect(page.locator('[data-art-selection]')).toHaveCount(1);
  await expect(art.locator('.mask-launcher').getByRole('alert')).toHaveCount(0);
  await art
    .getByRole('button', {
      name: 'Zpřesnit / upravit masku objektu',
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel('Plátno segmentační masky', { exact: true }),
  ).toBeVisible();
});
