import sharp from 'sharp';
import { expect } from '@playwright/test';
import { test, openEditor } from './editorFixture';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GameContent } from '../src/game/types';
import { object, ready } from './helpers';

test('visual edits save real JSON, survive reload, preview immediately and detect disk conflicts', async ({
  page,
  workspace,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page, workspace.url);
  const originalDisk = await readFile(workspace.source, 'utf8');
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('cable');
  await page
    .getByLabel('Název objektu', { exact: true })
    .fill('Skúšobný kábel');
  const region = page.locator('[data-move-id="cable"]');
  await region.scrollIntoViewIfNeeded();
  const box = (await region.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 - 15,
    { steps: 6 },
  );
  await page.mouse.up();
  const movedX = Number(
    await page.getByLabel('Oblast x', { exact: true }).inputValue(),
  );
  expect(movedX).toBeGreaterThan(70);
  const handle = page.locator('[data-resize-id="cable"]');
  await handle.scrollIntoViewIfNeeded();
  const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 15, handleBox.y - 10, { steps: 5 });
  await page.mouse.up();
  expect(
    Number(await page.getByLabel('Oblast width', { exact: true }).inputValue()),
  ).toBeLessThan(180);
  await page
    .getByRole('button', { name: 'Nakreslit hotspot', exact: true })
    .click();
  await page.locator('.editor-stage').scrollIntoViewIfNeeded();
  const stage = (await page.locator('.editor-stage').boundingBox())!;
  const start = {
    x: stage.x + stage.width * 0.35,
    y: stage.y + stage.height * 0.1,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(
    start.x + stage.width * 0.12,
    start.y + stage.height * 0.16,
    { steps: 5 },
  );
  await page.mouse.up();
  const createdObjectId = await page
    .getByLabel('Vybraný objekt', { exact: true })
    .inputValue();
  expect(createdObjectId).not.toBe('cable');
  await page
    .getByLabel('Název objektu', { exact: true })
    .fill('Testovací terminál');
  await page
    .getByLabel('Obrázek objektu', { exact: true })
    .selectOption('cable.svg');
  await page
    .getByLabel('Reakce', { exact: true })
    .fill('Terminál reaguje zo zdrojového JSON.');
  await expect(page.getByText('● Neuložené změny')).toBeVisible();
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await (await object(page, 'Testovací terminál')).click();
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Terminál reaguje zo zdrojového JSON.',
  );
  expect(await readFile(workspace.source, 'utf8')).toBe(originalDisk);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect(page.getByLabel('Název objektu', { exact: true })).toHaveValue(
    'Testovací terminál',
  );

  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do src/game/content/project.json');
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const cable = saved.scenes[0]!.hotspots.find(
    (entry) => entry.id === 'cable',
  )!;
  expect(cable.label).toBe('Skúšobný kábel');
  expect(cable.bounds.x).toBe(movedX);
  expect(
    saved.scenes[0]!.hotspots.find((entry) => entry.id === createdObjectId)!
      .image,
  ).toBe('cable.svg');
  await page.screenshot({
    path: testInfo.outputPath('editor.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await (await object(page, 'Testovací terminál')).click();
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Terminál reaguje zo zdrojového JSON.',
  );
  await page.reload();
  await ready(page);
  await (await object(page, 'Testovací terminál')).click();
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Terminál reaguje zo zdrojového JSON.',
  );
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Zdroj načtený');
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption(createdObjectId);
  await page
    .getByLabel('Název objektu', { exact: true })
    .fill('Neuložená lokálna zmena');
  const external = { ...saved, initialMessage: 'Externá zmena zo súboru.' };
  const externalRaw = JSON.stringify(external, null, 2) + '\n';
  await writeFile(workspace.source, externalRaw);
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('mezitím změnil');
  expect(await readFile(workspace.source, 'utf8')).toBe(externalRaw);
  await expect(page.getByLabel('Název objektu', { exact: true })).toHaveValue(
    'Neuložená lokálna zmena',
  );
  await page
    .getByRole('button', { name: 'Zahodit změny a načíst', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Zdroj znovu načtený');
  await expect(page.getByLabel('Název objektu', { exact: true })).toHaveValue(
    'Testovací terminál',
  );
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(page.getByLabel('Název objektu', { exact: true })).toHaveValue(
    'Neuložená lokálna zmena',
  );
  expect(errors).toEqual([]);
});

test('forms create linked locations, items, uploaded assets, branching dialogue and effects', async ({
  page,
  workspace,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page, workspace.url);
  await page.getByRole('button', { name: 'Předměty', exact: true }).click();
  await page.getByRole('button', { name: '+ Předmět', exact: true }).click();
  await page
    .getByLabel('Název předmětu', { exact: true })
    .fill('Testovací žetón');
  const png = await sharp({
    create: { width: 16, height: 16, channels: 4, background: '#edc176' },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'token.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.asset-field [role=status]')).toContainText(
    'Uložené do src/assets/imported/',
  );
  const uploaded = await page
    .getByLabel('Inventární ikonka', { exact: true })
    .inputValue();
  expect(
    (await readFile(path.join(workspace.root, 'src/assets', uploaded))).equals(
      png,
    ),
  ).toBe(true);
  await expect(page.getByLabel('Název předmětu', { exact: true })).toHaveValue(
    'Testovací žetón',
  );
  await page.getByRole('button', { name: 'Dialogy', exact: true }).click();
  await page.getByRole('button', { name: '+ Dialog', exact: true }).click();
  await page
    .getByLabel('Replika', { exact: true })
    .fill('Tu je testovací žetón.');
  await page.getByLabel('Text odpovědi', { exact: true }).fill('Zobrať žetón');
  await page.getByRole('button', { name: '+ Efekt', exact: true }).click();
  await page.getByLabel('Efekt', { exact: true }).selectOption('addItem');
  await page.getByLabel('Cíl efektu', { exact: true }).selectOption('item1');
  await page.getByRole('button', { name: '+ Uzel', exact: true }).click();
  await page
    .getByLabel('Replika', { exact: true })
    .fill('To je druhá vetva rozhovoru.');
  await page.getByLabel('Uzel dialogu', { exact: true }).selectOption('start');
  await page.getByLabel('Další uzel', { exact: true }).selectOption('node1');
  await page.getByLabel('Podmínka: typ', { exact: true }).selectOption('flag');
  await page.getByLabel('Příznak', { exact: true }).selectOption('powered');
  await page.getByLabel('Hodnota', { exact: true }).selectOption('false');
  await page.getByRole('button', { name: 'Lokace', exact: true }).click();
  await page.getByRole('button', { name: '+ Lokace', exact: true }).click();
  await page
    .getByLabel('Název lokace', { exact: true })
    .fill('Testovací ateliér');
  await page
    .getByLabel('Pozadí lokace', { exact: true })
    .selectOption('courtyard.svg');
  await page.getByRole('button', { name: '+ Objekt', exact: true }).click();
  await page
    .getByLabel('Název objektu', { exact: true })
    .fill('Testovací správca');
  await page
    .getByLabel('Reakce', { exact: true })
    .fill('Začína testovací rozhovor.');
  await page.getByRole('button', { name: '+ Efekt', exact: true }).click();
  await page.getByLabel('Efekt', { exact: true }).selectOption('dialogue');
  await page
    .getByLabel('Cíl efektu', { exact: true })
    .selectOption('dialogue1');
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
  await page.getByRole('button', { name: 'Mapa logiky', exact: true }).click();
  await page
    .getByLabel('Hledat ID, objekt, předmět nebo příznak')
    .fill('dialogue1');
  await expect(
    page.getByRole('img', { name: 'Graf podmínek, interakcí a následků' }),
  ).toContainText('dialog: dialogue1');
  await page.screenshot({
    path: testInfo.outputPath('graph.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: /Upravit Testovací ateliér/ }).click();
  await expect(page.getByLabel('Název objektu', { exact: true })).toHaveValue(
    'Testovací správca',
  );
  await page
    .getByRole('button', { name: 'Otestovat odsud', exact: false })
    .click();
  await ready(page);
  await expect(page.locator('.scene-frame')).toHaveAttribute(
    'aria-label',
    'Lokácia: Testovací ateliér',
  );
  await (await object(page, 'Testovací správca')).click();
  await expect(page.getByRole('dialog')).not.toContainText(
    'Tu je testovací žetón',
  );
  await page.getByRole('button', { name: 'Zobrať žetón', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'To je druhá vetva rozhovoru',
  );
  await page
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  await page.getByRole('button', { name: 'Dovidenia.', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Testovací žetón', exact: true }),
  ).toBeVisible();
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(saved.items.find((entry) => entry.id === 'item1')!.image).toBe(
    uploaded,
  );
  expect(
    saved.dialogues.find((entry) => entry.id === 'dialogue1')!.nodes[0]!
      .choices[0]!.next,
  ).toBe('node1');
  expect(errors).toEqual([]);
});

test('write API rejects foreign origins, malformed data, missing assets and stale revisions', async ({
  page,
  workspace,
}) => {
  await openEditor(page, workspace.url);
  const endpoint = new URL('__tukabel/editor/project', workspace.url).href;
  const headers = {
    Origin: new URL(workspace.url).origin,
    'X-Tukabel-Editor': '1',
  };
  const original = await readFile(workspace.source, 'utf8');
  const snapshot = (await (await page.request.get(endpoint)).json()) as {
    content: GameContent;
    revision: string;
  };
  for (const content of [
    null,
    { ...snapshot.content, scenes: [{ id: 42 }] },
    { ...snapshot.content, startScene: 'missing' },
    {
      ...snapshot.content,
      scenes: snapshot.content.scenes.map((scene) => ({
        ...scene,
        background: '../secret.png',
      })),
    },
    {
      ...snapshot.content,
      scenes: snapshot.content.scenes.map((scene) => ({
        ...scene,
        background: 'missing.png',
      })),
    },
  ]) {
    const response = await page.request.put(endpoint, {
      headers,
      data: { revision: snapshot.revision, content },
    });
    expect(response.status()).toBe(422);
  }
  expect(
    (
      await page.request.put(endpoint, {
        headers: { ...headers, Origin: 'https://foreign.example' },
        data: snapshot,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.put(endpoint, {
        headers,
        data: { ...snapshot, revision: 'stale' },
      })
    ).status(),
  ).toBe(409);
  const upload = await page.request.post(
    new URL('__tukabel/editor/assets', workspace.url).href,
    { headers, data: { name: 'evil.svg', data: btoa('<svg/>') } },
  );
  expect(upload.status()).toBe(400);
  expect(await readFile(workspace.source, 'utf8')).toBe(original);
  // Invalid drafts stay editable, but neither preview nor save can run them.
  await page.getByLabel('Název lokace', { exact: true }).fill('Lokálna zmena');
  await page.getByLabel('Šířka lokace', { exact: true }).fill('0');
  await expect(page.getByRole('alert')).toContainText('invalid dimensions');
  await expect(
    page.getByRole('button', { name: 'Uložit do projektu', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Game Mode', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Šířka lokace', { exact: true }).fill('1280');
  await page.getByRole('button', { name: '+ Lokace', exact: true }).click();
  await page.getByLabel('Šířka lokace', { exact: true }).fill('64');
  await page.getByLabel('Výška lokace', { exact: true }).fill('48');
  await page.getByRole('button', { name: '+ Objekt', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const x = Number(
    await page.getByLabel('Oblast x', { exact: true }).inputValue(),
  );
  const y = Number(
    await page.getByLabel('Oblast y', { exact: true }).inputValue(),
  );
  const width = Number(
    await page.getByLabel('Oblast width', { exact: true }).inputValue(),
  );
  const height = Number(
    await page.getByLabel('Oblast height', { exact: true }).inputValue(),
  );
  expect(x + width).toBeLessThanOrEqual(64);
  expect(y + height).toBeLessThanOrEqual(48);
  await expect(
    page.getByRole('button', { name: 'Game Mode', exact: true }),
  ).toBeEnabled();
});
