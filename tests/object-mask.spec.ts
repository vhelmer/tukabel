import { expect, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { ready } from './helpers';
import type { GameContent } from '../src/game/types';
import type { EditorJob } from '../src/editor/jobs';

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
    .getByRole('button', { name: 'Vybrať obdĺžnik', exact: true })
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
  test.setTimeout(60000);
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
    .getByLabel('Grafická operácia', { exact: true })
    .selectOption('extract');
  await art
    .getByLabel('Názov výslednej vrstvy alebo lokácie', { exact: true })
    .fill('Presné hodiny');
  await selectClock(page, isMobile);
  await art
    .getByRole('button', {
      name: 'Spresniť / upraviť masku objektu',
      exact: true,
    })
    .click();
  const editor = page.getByRole('dialog', { name: 'Maska objektu' });
  const canvas = editor.getByLabel('Plátno segmentačnej masky', {
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await expect(
    editor.getByRole('button', { name: 'Použiť masku', exact: true }),
  ).toBeEnabled();
  await editor
    .getByLabel('Priblíženie masky', { exact: true })
    .selectOption('2');
  // Paint then undo at source coordinates; all later output remains aligned.
  await mark(page, canvas, 820, 120, isMobile);
  await editor
    .getByRole('button', { name: 'Späť v maske', exact: true })
    .click();
  await mark(page, canvas, 905, 105, isMobile);
  await editor
    .getByLabel('Polomer štetca (px zdroja)', { exact: true })
    .fill('2');
  await mark(page, canvas, 849, 120, isMobile);
  await editor
    .getByLabel('Nástroj masky', { exact: true })
    .selectOption('erase');
  await mark(page, canvas, 965, 180, isMobile);
  await editor
    .getByLabel('Priblíženie masky', { exact: true })
    .selectOption('1');
  const refine = editor.getByRole('button', {
    name: 'Spresniť hranice objektu',
    exact: true,
  });
  // This test deliberately uses the real local CLI, never a fake segmented mask.
  const status = await page.request.get(
    `${workspace.url}__tukabel/editor/art/status`,
  );
  const available = (await status.json()).segmentation.grabcut;
  if (available) {
    await expect(refine).toBeEnabled();
    await refine.click();
    await expect(editor.getByRole('status')).toContainText('Skontroluj obrys', {
      timeout: 20000,
    });
  } else {
    await expect(refine).toBeDisabled();
    await expect(editor).toContainText('npm run setup:segmentation');
  }
  await editor
    .getByLabel('Zobrazenie masky', { exact: true })
    .selectOption('cutout');
  await editor
    .getByRole('button', { name: 'Priblížiť objekt', exact: true })
    .click();
  await editor.screenshot({ path: info.outputPath('mask-editor.png') });
  await editor
    .getByRole('button', { name: 'Použiť masku', exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(art).toContainText('Maska pripravená');
  await art
    .getByRole('button', {
      name: 'Spustiť AI úpravu (API kredit)',
      exact: true,
    })
    .click();
  await expect(
    art.getByRole('status', { name: 'Stav grafickej operácie' }),
  ).toContainText('Assety sú uložené');
  const comparison = art.getByRole('region', { name: 'Porovnanie oddelenia' });
  await expect(comparison).toContainText('0 zmenených viditeľných pixelov');
  await comparison
    .getByLabel('Posuvník porovnania', { exact: true })
    .fill('70');
  await comparison.screenshot({
    path: info.outputPath('exact-reassembly.png'),
  });
  await comparison
    .getByLabel('Porovnanie výrezu', { exact: true })
    .selectOption('difference');
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
  expect(
    await sharp(asset(result.reassembled!)).ensureAlpha().raw().toBuffer(),
  ).toEqual(original);
  const mask = await sharp(asset(result.objectMask!))
    .greyscale()
    .raw()
    .toBuffer();
  if (available) {
    expect(mask[60 * 1280 + 835]).toBe(0);
    expect(mask[105 * 1280 + 905]).toBe(255);
  }
  const cutout = await sharp(asset(result.cutout!))
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect(cutout[(105 * 1280 + 905) * 4 + 3]).toBe(255);
  // Reopen/import the saved mask to confirm it remains editable in source pixels.
  await art
    .getByRole('button', {
      name: 'Spresniť / upraviť masku objektu',
      exact: true,
    })
    .click();
  await expect(canvas).toBeVisible();
  await editor
    .getByLabel('Načítať PNG masku')
    .setInputFiles(asset(result.objectMask!));
  await expect(editor.getByRole('status')).toContainText('Maska načítaná');
  await editor
    .getByRole('button', { name: 'Zavrieť bez použitia', exact: true })
    .click();
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
  const disk = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(disk.scenes[0]!.background).toBe(result.image);
  expect(
    disk.scenes[0]!.hotspots.find((h) => h.label === 'Presné hodiny'),
  ).toMatchObject({
    image: result.cutout,
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    decorative: true,
  });
  const recipe = JSON.parse(await readFile(asset(result.manifest), 'utf8'));
  expect(recipe.reconstruction.changedPixels).toBe(0);
  expect(recipe.objectMask.method).toBe(available ? 'grabcut' : 'manual');
  await page
    .getByRole('button', { name: 'Otestovať odtiaľto ↗', exact: true })
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
