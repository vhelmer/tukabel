import { expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { ready, object, activate } from './helpers';
import type { GameContent } from '../src/game/types';

async function seed(root: string, source: string) {
  const project = JSON.parse(await readFile(source, 'utf8')) as GameContent;
  const image = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#325c60"/><path d="M0 8 Q8 0 16 8T32 8M0 24 Q8 16 16 24T32 24" stroke="#b8e6d1" fill="none" stroke-width="4"/></pattern></defs><rect width="1280" height="720" fill="#bd9a6a"/><rect x="40" y="50" width="700" height="500" fill="url(#p)"/></svg>`,
  );
  // Seed through the same watched namespace as editor-created assets. A delayed
  // create event for an unrelated root PNG would intentionally trigger Vite HMR.
  await mkdir(path.join(root, 'src/assets/scene-art/test-source'), {
    recursive: true,
  });
  await writeFile(
    path.join(root, 'src/assets/scene-art/test-source/art-test.png'),
    await sharp(image).png().toBuffer(),
  );
  const sceneId = project.scenes[0]!.id;
  await writeFile(
    source,
    JSON.stringify({
      ...project,
      startScene: sceneId,
      scenes: project.scenes.map((s) =>
        s.id === sceneId
          ? { ...s, background: 'scene-art/test-source/art-test.png' }
          : s,
      ),
    }),
  );
  return sceneId;
}
async function rectangle(
  page: Page,
  touch: boolean,
  start = { x: 100, y: 100 },
  end = { x: 420, y: 290 },
) {
  await page
    .getByRole('button', { name: 'Vybrať obdĺžnik', exact: true })
    .click();
  const stage = page.locator('.editor-stage');
  await stage.scrollIntoViewIfNeeded();
  const p = await stage.evaluate(
    (el, points) => {
      const m = (el as SVGSVGElement).getScreenCTM()!;
      return points.map((p) => {
        const point = new DOMPoint(p.x, p.y).matrixTransform(m);
        return { x: point.x, y: point.y };
      });
    },
    [start, end],
  );
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...p[0]!, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...p[1]!, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(p[0]!.x, p[0]!.y);
    await page.mouse.down();
    await page.mouse.move(p[1]!.x, p[1]!.y, { steps: 4 });
    await page.mouse.up();
  }
  await expect(stage.locator('[data-art-selection]')).toHaveCount(1);
}
async function save(page: Page) {
  const button = page.getByRole('button', {
    name: 'Uložiť do projektu',
    exact: true,
  });
  await expect(button).toBeEnabled();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/__tukabel/editor/project') &&
      response.request().method() === 'PUT',
  );
  await button.click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('.saved-badge')).toBeVisible();
  await expect(
    page.getByRole('status', { name: 'Stav editora' }),
  ).toContainText('Uložené do');
}
const art = (page: Page) =>
  page.getByRole('region', { name: 'Grafické nástroje scény' });

test('layer editing, scene-space selection and local ambient clips save real assets and play in both modes', async ({
  page,
  workspace,
  isMobile,
}, info) => {
  await seed(workspace.root, workspace.source);
  const original = await readFile(workspace.source, 'utf8');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openEditor(page, workspace.url);
  await rectangle(page, isMobile);
  await art(page)
    .getByLabel('Názov výslednej vrstvy alebo lokácie', { exact: true })
    .fill('Vrstvený výrez');
  await art(page)
    .getByRole('button', { name: 'Vytvoriť lokálny asset', exact: true })
    .click();
  await expect(
    art(page).getByRole('status', {
      name: 'Stav grafickej operácie',
      exact: true,
    }),
  ).toContainText('Assety sú uložené');
  await expect(
    art(page).getByAltText('Výsledok grafickej operácie'),
  ).toBeVisible();
  expect(await readFile(workspace.source, 'utf8')).toBe(original);
  await art(page)
    .getByRole('button', { name: 'Použiť výsledok v scéne', exact: true })
    .click();
  const layers = page.getByRole('region', { name: 'Vrstvy scény' });
  const row = layers.locator('.layer-row').filter({
    has: page.getByRole('button', { name: '▧ Vrstvený výrez', exact: true }),
  });
  await expect(row).toHaveCount(1);
  await row.getByLabel('Zamknutie · Vrstvený výrez', { exact: true }).check();
  await expect(page.locator('[data-move-id]')).toHaveCount(0);
  await row.getByLabel('Zamknutie · Vrstvený výrez', { exact: true }).uncheck();
  await expect(page.locator('[data-move-id]')).toHaveCount(1);
  await row
    .getByRole('button', { name: 'Dopredu · Vrstvený výrez', exact: true })
    .click();
  await row
    .getByRole('button', { name: 'Dozadu · Vrstvený výrez', exact: true })
    .click();
  await layers.getByRole('slider', { name: 'Krytie vrstvy (%)' }).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await row
    .getByLabel('Viditeľnosť · Vrstvený výrez', { exact: true })
    .uncheck();
  await expect(
    page
      .locator('.editor-stage [data-hotspot-id]')
      .filter({ has: page.locator('[data-scene-image*="scene-art/"]') }),
  ).toHaveAttribute('opacity', '0.18');
  await row.getByLabel('Viditeľnosť · Vrstvený výrez', { exact: true }).check();
  await layers.getByRole('button', { name: '▣ Pozadie', exact: true }).click();
  await page
    .getByLabel('Priblíženie scény', { exact: true })
    .selectOption('1.5');
  await rectangle(page, isMobile, { x: 100, y: 90 }, { x: 360, y: 240 });
  await art(page)
    .getByLabel('Grafická operácia', { exact: true })
    .selectOption('loop');
  await art(page)
    .getByLabel('Názov výslednej vrstvy alebo lokácie', { exact: true })
    .fill('Živá rieka');
  await art(page).getByLabel('Počet snímok slučky', { exact: true }).fill('8');
  await art(page)
    .getByRole('button', { name: 'Vytvoriť lokálny asset', exact: true })
    .click();
  await expect(
    art(page).getByRole('status', {
      name: 'Stav grafickej operácie',
      exact: true,
    }),
  ).toContainText('Assety sú uložené');
  await art(page)
    .getByRole('button', { name: 'Prehrať náhľad', exact: true })
    .click();
  await expect(
    art(page).locator('.row-actions').filter({ hasText: '/ 8' }),
  ).not.toContainText('1 / 8');
  await art(page)
    .getByRole('button', { name: 'Zastaviť náhľad', exact: true })
    .click();
  await art(page)
    .getByRole('button', { name: 'Použiť výsledok v scéne', exact: true })
    .click();
  await save(page);
  const disk = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const layer = disk.scenes[0]!.hotspots.find((h) => h.label === 'Živá rieka')!;
  expect(layer.decorative).toBe(true);
  expect(layer.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  const clip = disk.animations!.find((c) => c.id === layer.animation!.idle)!;
  expect(clip.frames).toHaveLength(8);
  const recipe = JSON.parse(
    await readFile(
      path.join(
        workspace.root,
        'src/assets',
        layer.image!.replace('/image.png', '/recipe.json'),
      ),
      'utf8',
    ),
  );
  expect(recipe.selection).toEqual([
    { x: 100, y: 90 },
    { x: 360, y: 90 },
    { x: 360, y: 240 },
    { x: 100, y: 240 },
  ]);
  await page
    .getByRole('button', { name: 'Živý náhľad animácií', exact: true })
    .click();
  await ready(page);
  const canvas = page.locator('.scene-live-preview canvas');
  const first = await canvas.screenshot();
  await page.waitForTimeout(240);
  expect((await canvas.screenshot()).equals(first)).toBe(false);
  await page.screenshot({
    path: info.outputPath('layered-scene-editor.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Otestovať odtiaľto ↗', exact: true })
    .click();
  await ready(page);
  await expect(await object(page, 'Router')).toBeVisible();
  await expect(page.locator('.objects-popover')).not.toContainText(
    'Živá rieka',
  );
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Vrstvy scény' }),
  ).toContainText('Živá rieka');
  expect(
    await readFile(
      path.join(
        workspace.root,
        'src/assets/scene-art/test-source/art-test.png',
      ),
    ),
  ).toBeTruthy();
});

test.describe('scene AI provider boundary', () => {
  test.use({
    artTools: {
      apiKey: 'mock-openai-art-key',
      fetch: (async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        if (
          body.n !== 1 ||
          !body.images?.[0]?.image_url ||
          !body.prompt.includes('reference')
        )
          throw Error('Invalid image request');
        const [width, height] = (body.size as string).split('x').map(Number);
        const bytes = await sharp({
          create: {
            width: width!,
            height: height!,
            channels: 4,
            background: '#496947',
          },
        })
          .png()
          .toBuffer();
        return Response.json({
          data: [{ b64_json: bytes.toString('base64') }],
        });
      }) as typeof fetch,
    },
  });
  test('AI extraction previews before applying, protects newer edits and creates a separate editable object and location', async ({
    page,
    workspace,
    isMobile,
  }, info) => {
    await seed(workspace.root, workspace.source);
    await openEditor(page, workspace.url);
    await rectangle(page, isMobile);
    await art(page)
      .getByLabel('Grafická operácia', { exact: true })
      .selectOption('extract');
    await page
      .getByLabel('Názov lokácie', { exact: true })
      .fill('Rozpracovaná lokácia');
    await art(page)
      .getByLabel('Názov výslednej vrstvy alebo lokácie', { exact: true })
      .fill('Oddelený stôl');
    await art(page)
      .getByRole('button', {
        name: 'Spustiť AI úpravu (API kredit)',
        exact: true,
      })
      .click();
    await expect(
      art(page).getByRole('status', {
        name: 'Stav grafickej operácie',
        exact: true,
      }),
    ).toContainText('Assety sú uložené');
    await expect(
      art(page).getByAltText('Oddelený transparentný objekt'),
    ).toBeVisible();
    await expect(page.getByLabel('Názov lokácie', { exact: true })).toHaveValue(
      'Rozpracovaná lokácia',
    );
    await expect(page.locator('.unsaved-badge')).toBeVisible();
    await page
      .getByLabel('Názov lokácie', { exact: true })
      .fill('Zmenená scéna');
    await expect(
      art(page).getByRole('button', {
        name: 'Použiť výsledok v scéne',
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Späť', exact: true }).click();
    await expect(
      art(page).getByRole('button', {
        name: 'Použiť výsledok v scéne',
        exact: true,
      }),
    ).toBeEnabled();
    await page.screenshot({
      path: info.outputPath('ai-extraction-preview.png'),
      fullPage: true,
    });
    await art(page)
      .getByRole('button', { name: 'Použiť výsledok v scéne', exact: true })
      .click();
    await save(page);
    const disk = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    expect(disk.scenes[0]!.background).toMatch(/^scene-art\/.*\/image.png$/);
    expect(disk.scenes[0]!.hotspots[0]).toMatchObject({
      label: 'Oddelený stôl',
      decorative: true,
      image: expect.stringMatching(/\/cutout.png$/),
    });
    await art(page)
      .getByLabel('Grafická operácia', { exact: true })
      .selectOption('generate');
    await art(page)
      .getByLabel('Názov výslednej vrstvy alebo lokácie', { exact: true })
      .fill('AI skúšobný dvor');
    await art(page)
      .getByRole('button', {
        name: 'Spustiť AI úpravu (API kredit)',
        exact: true,
      })
      .click();
    await expect(
      art(page).getByRole('status', {
        name: 'Stav grafickej operácie',
        exact: true,
      }),
    ).toContainText('Assety sú uložené');
    await art(page)
      .getByRole('button', { name: 'Použiť výsledok v scéne', exact: true })
      .click();
    await save(page);
    const saved = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    expect(saved.scenes.at(-1)).toMatchObject({
      title: 'AI skúšobný dvor',
      width: 1280,
      height: 720,
      hotspots: [],
    });
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    await expect(
      page.getByLabel('Aktívna lokácia', { exact: true }).locator('option'),
    ).toContainText([
      'Rozpracovaná lokácia',
      'Skúšobný dvor',
      'Animačný ateliér',
      'AI skúšobný dvor',
    ]);
    const foreign = await page.request.post(
      `${workspace.url}__tukabel/editor/art/create`,
      {
        headers: { Origin: 'https://foreign.invalid', 'X-Tukabel-Editor': '1' },
        data: {},
      },
    );
    expect(foreign.status()).toBe(403);
    const status = await page.request.get(
      `${workspace.url}__tukabel/editor/art/status`,
    );
    expect(await status.text()).not.toContain('mock-openai-art-key');
  });
});

test('concave selections map through rotated contain-fit assets and decorative layers let game clicks pass underneath', async ({
  page,
  workspace,
  isMobile,
}) => {
  await seed(workspace.root, workspace.source);
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...project,
      scenes: project.scenes.map((s, i) =>
        i
          ? s
          : {
              ...s,
              hotspots: [
                ...s.hotspots,
                {
                  id: 'under-art',
                  label: 'Pod vrstvou',
                  bounds: { x: 260, y: 210, width: 80, height: 80 },
                  onClick: [{ message: 'Klik prešiel cez dekoráciu.' }],
                },
                {
                  id: 'rotated-art',
                  label: 'Natočený obraz',
                  image: 'scene-art/test-source/art-test.png',
                  decorative: true,
                  rotation: 30,
                  bounds: { x: 100, y: 100, width: 400, height: 300 },
                  onClick: [],
                },
              ],
            },
      ),
    }),
  );
  await openEditor(page, workspace.url);
  await page
    .getByRole('region', { name: 'Vrstvy scény' })
    .getByRole('button', { name: '▧ Natočený obraz', exact: true })
    .click();
  await page
    .getByLabel('Priblíženie scény', { exact: true })
    .selectOption('1.5');
  await page
    .getByRole('button', { name: 'Vybrať polygón', exact: true })
    .click();
  const stage = page.locator('.editor-stage');
  await stage.scrollIntoViewIfNeeded();
  const pixels = [
    { x: 300, y: 200 },
    { x: 800, y: 200 },
    { x: 800, y: 500 },
    { x: 550, y: 360 },
    { x: 300, y: 500 },
  ];
  // 400 × 225 source placement, centred vertically inside a 400 × 300 frame.
  const world = pixels.map((p) => {
    const x = 100 + (p.x * 400) / 1280 - 300,
      y = 137.5 + (p.y * 225) / 720 - 250;
    return {
      x: 300 + x * Math.cos(Math.PI / 6) - y * Math.sin(Math.PI / 6),
      y: 250 + x * Math.sin(Math.PI / 6) + y * Math.cos(Math.PI / 6),
    };
  });
  for (const p of world) {
    const screen = await stage.evaluate((el, p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(
        (el as SVGSVGElement).getScreenCTM()!,
      );
      return { x: q.x, y: q.y };
    }, p);
    if (isMobile) await page.touchscreen.tap(screen.x, screen.y);
    else await page.mouse.click(screen.x, screen.y);
  }
  await page
    .getByRole('button', { name: 'Dokončiť polygón', exact: true })
    .click();
  await expect(stage.locator('[data-art-selection]')).toHaveCount(1);
  await art(page)
    .getByLabel('Názov výslednej vrstvy alebo lokácie', { exact: true })
    .fill('Presný výrez');
  await art(page)
    .getByRole('button', { name: 'Vytvoriť lokálny asset', exact: true })
    .click();
  await expect(
    art(page).getByRole('status', {
      name: 'Stav grafickej operácie',
      exact: true,
    }),
  ).toContainText('Assety sú uložené');
  await art(page)
    .getByRole('button', { name: 'Použiť výsledok v scéne', exact: true })
    .click();
  await save(page);
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const layer = saved.scenes[0]!.hotspots.find(
    (h) => h.label === 'Presný výrez',
  )!;
  expect(layer.bounds).toEqual({ x: 100, y: 100, width: 400, height: 300 });
  expect(layer.rotation).toBe(30);
  const folder = path.join(
    workspace.root,
    'src/assets',
    path.dirname(layer.image!),
  );
  const recipe = JSON.parse(
    await readFile(path.join(folder, 'recipe.json'), 'utf8'),
  );
  for (let i = 0; i < pixels.length; i++) {
    expect(recipe.selection[i].x).toBeCloseTo(pixels[i]!.x, 1);
    expect(recipe.selection[i].y).toBeCloseTo(pixels[i]!.y, 1);
  }
  const cutout = await sharp(path.join(folder, 'image.png'))
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect(cutout[(450 * 1280 + 550) * 4 + 3]).toBe(0); // concave notch
  expect(cutout[(250 * 1280 + 400) * 4 + 3]).toBe(255);
  await page
    .getByRole('button', { name: 'Otestovať odtiaľto ↗', exact: true })
    .click();
  await ready(page);
  await activate(page, 300, 250, isMobile);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Klik prešiel cez dekoráciu.',
  );
});
