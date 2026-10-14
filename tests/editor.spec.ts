import { test as base, expect } from '@playwright/test';
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import type { GameContent } from '../src/game/types';
import { object, ready } from './helpers';

// Every test gets an isolated source checkout. Browser saves never touch the real
// project, developer notes, or another test's JSON/assets.
const test = base.extend<{
  workspace: { url: string; source: string; root: string };
}>({
  workspace: async ({ browserName }, use) => {
    const root = await mkdtemp(
      path.join(tmpdir(), `tukabel-editor-${browserName}-`),
    );
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      for (const file of [
        'src',
        'dev',
        'index.html',
        'package.json',
        'vite.config.ts',
        'tsconfig.json',
      ])
        await cp(path.resolve(file), path.join(root, file), {
          recursive: true,
        });
      await symlink(
        path.resolve('node_modules'),
        path.join(root, 'node_modules'),
        'dir',
      );
      server = await createServer({
        root,
        cacheDir: path.join(root, '.vite-cache'),
        server: { host: '127.0.0.1', port: 0, strictPort: false },
      });
      await server.listen();
      const url = server.resolvedUrls!.local[0]!;
      await use({
        root,
        url,
        source: path.join(root, 'src/game/content/project.json'),
      });
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
});
async function openEditor(page: import('@playwright/test').Page, url: string) {
  await page.goto(url);
  await ready(page);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'Stav editora' }),
  ).toContainText('Zdroj načítaný');
}

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
    .getByLabel('Názov objektu', { exact: true })
    .fill('Skúšobný kábel');
  const region = page.locator('[data-hotspot-id="cable"] .editor-region');
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
    await page.getByLabel('Oblasť x', { exact: true }).inputValue(),
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
    Number(await page.getByLabel('Oblasť width', { exact: true }).inputValue()),
  ).toBeLessThan(180);
  await page
    .getByRole('button', { name: 'Nakresliť hotspot', exact: true })
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
  await expect(page.getByLabel('Vybraný objekt', { exact: true })).toHaveValue(
    'object1',
  );
  await page
    .getByLabel('Názov objektu', { exact: true })
    .fill('Testovací terminál');
  await page
    .getByLabel('Obrázok objektu', { exact: true })
    .selectOption('cable.svg');
  await page
    .getByLabel('Reakcia', { exact: true })
    .fill('Terminál reaguje zo zdrojového JSON.');
  await expect(page.getByText('● Neuložené zmeny')).toBeVisible();
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await (await object(page, 'Testovací terminál')).click();
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Terminál reaguje zo zdrojového JSON.',
  );
  expect(await readFile(workspace.source, 'utf8')).toBe(originalDisk);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect(page.getByLabel('Názov objektu', { exact: true })).toHaveValue(
    'Testovací terminál',
  );

  await page
    .getByRole('button', { name: 'Uložiť do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editora' }),
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
    saved.scenes[0]!.hotspots.find((entry) => entry.id === 'object1')!.image,
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
    page.getByRole('status', { name: 'Stav editora' }),
  ).toContainText('Zdroj načítaný');
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('object1');
  await page
    .getByLabel('Názov objektu', { exact: true })
    .fill('Neuložená lokálna zmena');
  const external = { ...saved, initialMessage: 'Externá zmena zo súboru.' };
  const externalRaw = JSON.stringify(external, null, 2) + '\n';
  await writeFile(workspace.source, externalRaw);
  await page
    .getByRole('button', { name: 'Uložiť do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editora' }),
  ).toContainText('medzitým zmenil');
  expect(await readFile(workspace.source, 'utf8')).toBe(externalRaw);
  await expect(page.getByLabel('Názov objektu', { exact: true })).toHaveValue(
    'Neuložená lokálna zmena',
  );
  await page
    .getByRole('button', { name: 'Zahodiť zmeny a načítať', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editora' }),
  ).toContainText('Zdroj znovu načítaný');
  await expect(page.getByLabel('Názov objektu', { exact: true })).toHaveValue(
    'Testovací terminál',
  );
  await page.getByRole('button', { name: 'Späť', exact: true }).click();
  await expect(page.getByLabel('Názov objektu', { exact: true })).toHaveValue(
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
  await page.getByRole('button', { name: 'Predmety', exact: true }).click();
  await page.getByRole('button', { name: '+ Predmet', exact: true }).click();
  await page
    .getByLabel('Názov predmetu', { exact: true })
    .fill('Testovací žetón');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'token.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.asset-field [role=status]')).toContainText(
    'Uložené do src/assets/imported/',
  );
  const uploaded = await page
    .getByLabel('Obrázok predmetu', { exact: true })
    .inputValue();
  expect(
    (await readFile(path.join(workspace.root, 'src/assets', uploaded))).equals(
      png,
    ),
  ).toBe(true);
  await expect(page.getByLabel('Názov predmetu', { exact: true })).toHaveValue(
    'Testovací žetón',
  );
  await page.getByRole('button', { name: 'Dialógy', exact: true }).click();
  await page.getByRole('button', { name: '+ Dialóg', exact: true }).click();
  await page
    .getByLabel('Replika', { exact: true })
    .fill('Tu je testovací žetón.');
  await page.getByLabel('Text odpovede', { exact: true }).fill('Zobrať žetón');
  await page.getByRole('button', { name: '+ Efekt', exact: true }).click();
  await page.getByLabel('Efekt', { exact: true }).selectOption('addItem');
  await page.getByLabel('Cieľ efektu', { exact: true }).selectOption('item1');
  await page.getByRole('button', { name: '+ Uzol', exact: true }).click();
  await page
    .getByLabel('Replika', { exact: true })
    .fill('To je druhá vetva rozhovoru.');
  await page.getByLabel('Uzol dialógu', { exact: true }).selectOption('start');
  await page.getByLabel('Ďalší uzol', { exact: true }).selectOption('node1');
  await page.getByLabel('Podmienka: typ', { exact: true }).selectOption('flag');
  await page.getByLabel('Príznak', { exact: true }).selectOption('powered');
  await page.getByLabel('Hodnota', { exact: true }).selectOption('false');
  await page.getByRole('button', { name: 'Lokácie', exact: true }).click();
  await page.getByRole('button', { name: '+ Lokácia', exact: true }).click();
  await page
    .getByLabel('Názov lokácie', { exact: true })
    .fill('Testovací ateliér');
  await page
    .getByLabel('Pozadie lokácie', { exact: true })
    .selectOption('courtyard.svg');
  await page.getByRole('button', { name: '+ Objekt', exact: true }).click();
  await page
    .getByLabel('Názov objektu', { exact: true })
    .fill('Testovací správca');
  await page
    .getByLabel('Kontextová akcia', { exact: true })
    .selectOption('talk');
  await page.getByRole('button', { name: 'talk', exact: true }).click();
  await page
    .getByRole('button', { name: '+ Pravidlo', exact: true })
    .first()
    .click();
  await page
    .getByLabel('Reakcia', { exact: true })
    .fill('Začína testovací rozhovor.');
  await page.getByRole('button', { name: '+ Efekt', exact: true }).click();
  await page.getByLabel('Efekt', { exact: true }).selectOption('dialogue');
  await page
    .getByLabel('Cieľ efektu', { exact: true })
    .selectOption('dialogue1');
  await page
    .getByRole('button', { name: 'Uložiť do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editora' }),
  ).toContainText('Uložené do');
  await page.getByRole('button', { name: 'Mapa logiky', exact: true }).click();
  await page
    .getByLabel('Hľadať ID, objekt, predmet alebo príznak')
    .fill('dialogue1');
  await expect(
    page.getByRole('img', { name: 'Graf podmienok, interakcií a následkov' }),
  ).toContainText('dialóg: dialogue1');
  await page.screenshot({
    path: testInfo.outputPath('graph.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: /Upraviť Testovací ateliér/ }).click();
  await expect(page.getByLabel('Názov objektu', { exact: true })).toHaveValue(
    'Testovací správca',
  );
  await page
    .getByRole('button', { name: 'Otestovať odtiaľto', exact: false })
    .click();
  await ready(page);
  await expect(page.locator('.scene-title')).toHaveText('Testovací ateliér');
  await (await object(page, 'Testovací správca')).click();
  await expect(page.getByRole('dialog')).toContainText('Tu je testovací žetón');
  await page.getByRole('button', { name: 'Zobrať žetón', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'To je druhá vetva rozhovoru',
  );
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
  await page.getByLabel('Názov lokácie', { exact: true }).fill('Lokálna zmena');
  await page.getByLabel('Šírka lokácie', { exact: true }).fill('0');
  await expect(page.getByRole('alert')).toContainText('invalid dimensions');
  await expect(
    page.getByRole('button', { name: 'Uložiť do projektu', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Game Mode', exact: true }),
  ).toBeDisabled();
});
