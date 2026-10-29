import { hudClick } from './helpers';
import { expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test, openEditor } from './editorFixture';
import {
  activate,
  dragItem,
  finishLine,
  getTape,
  menuAction,
  object,
  pointInScene,
  ready,
} from './helpers';
import type { GameContent } from '../src/game/types';
import sharp from 'sharp';

async function openJournal(page: Page, touch: boolean) {
  const button = page.getByRole('button', { name: /^Denník/ });
  await hudClick(page, button, touch);
  const journal = page.getByRole('dialog', {
    name: 'Denník úloh',
    exact: true,
  });
  await expect(journal).toBeVisible();
  return journal;
}
async function closeJournal(page: Page, touch: boolean) {
  const button = page.getByRole('button', {
    name: 'Zavrieť denník',
    exact: true,
  });
  await hudClick(page, button, touch);
  await expect(
    page.getByRole('dialog', { name: 'Denník úloh', exact: true }),
  ).toHaveCount(0);
}
async function saveProject(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/project') && r.request().method() === 'PUT',
  );
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(page.locator('.saved-badge')).toBeVisible();
}

test('upper HUD supports real drags; journal discovers and strikes tasks through the puzzle, saves, reloads and resets', async ({
  page,
  workspace,
  isMobile,
}, info) => {
  await page.goto(workspace.url);
  await ready(page);
  const inventory = await page
    .getByRole('group', { name: 'Inventár', exact: true })
    .boundingBox();
  const sceneTop = await pointInScene(page, 0, 0);
  expect(inventory!.y).toBeGreaterThanOrEqual(sceneTop.y);
  expect(inventory!.y + inventory!.height).toBeLessThan(sceneTop.y + 90);
  let journal = await openJournal(page, isMobile);
  await expect(
    journal.locator('[data-task-id="power-router"]'),
  ).toHaveAttribute('data-status', 'active');
  await expect(journal.locator('[data-task-id="find-tape"]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(
    journal.getByRole('button', { name: 'Zavrieť denník' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Denník/ })).toBeFocused();
  await activate(page, 190, 630, isMobile);
  journal = await openJournal(page, isMobile);
  await expect(journal.locator('[data-task-id="find-tape"]')).toHaveAttribute(
    'data-status',
    'active',
  );
  await closeJournal(page, isMobile);
  await getTape(page);
  journal = await openJournal(page, isMobile);
  await expect(journal.locator('[data-task-id="find-tape"] s')).toHaveText(
    'Získať izolačnú pásku od správcu.',
  );
  await page.screenshot({
    path: info.outputPath('journal-and-upper-hud.png'),
    animations: 'disabled',
  });
  await closeJournal(page, isMobile);
  const cable = page.getByRole('button', {
    name: 'Poškodený kábel',
    exact: true,
  });
  const tape = page.getByRole('button', {
    name: 'Izolačná páska',
    exact: true,
  });
  await dragItem(page, tape, cable, isMobile);
  const fixed = page.getByRole('button', {
    name: 'Opravený kábel',
    exact: true,
  });
  await dragItem(page, fixed, await pointInScene(page, 440, 480), isMobile);
  journal = await openJournal(page, isMobile);
  await expect(
    journal.locator('[data-task-id="power-router"]'),
  ).toHaveAttribute('data-status', 'completed');
  await expect(
    journal.locator('[data-task-id="visit-courtyard"]'),
  ).toHaveAttribute('data-status', 'active');
  await expect(journal.locator('[data-task-id="find-tape"]')).toHaveAttribute(
    'data-status',
    'completed',
  );
  await page.setViewportSize({ width: 720, height: 400 });
  await ready(page);
  const book = await journal.boundingBox(),
    game = await page.locator('.game-window').boundingBox();
  expect(book!.x).toBeGreaterThanOrEqual(game!.x);
  expect(book!.y).toBeGreaterThanOrEqual(game!.y);
  expect(book!.y + book!.height).toBeLessThanOrEqual(game!.y + game!.height);
  await page.screenshot({
    path: info.outputPath('journal-landscape.png'),
    animations: 'disabled',
  });
  await closeJournal(page, isMobile);
  await ready(page);
  await activate(page, 1220, 440, isMobile);
  await ready(page);
  await activate(page, 820, 320, isMobile);
  journal = await openJournal(page, isMobile);
  await expect(journal.locator('[data-status="completed"]')).toHaveCount(3);
  await closeJournal(page, isMobile);
  await menuAction(page, 'Uložiť hru');
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('tukabel.save.v1')!).state.tasks,
  );
  expect(Object.values(saved)).toEqual(['completed', 'completed', 'completed']);
  await page.reload();
  await ready(page);
  await menuAction(page, 'Načítať hru');
  journal = await openJournal(page, isMobile);
  await expect(journal.locator('[data-status="completed"]')).toHaveCount(3);
  await closeJournal(page, isMobile);
  await menuAction(page, 'Nová hra');
  journal = await openJournal(page, isMobile);
  await expect(journal.locator('[data-task-id]')).toHaveCount(1);
  await expect(journal.locator('[data-status="active"]')).toHaveCount(1);
});

test('editor saves task definitions and dialogue effects; the notebook pauses dialogue and respects invalid references', async ({
  page,
  workspace,
  isMobile,
}) => {
  await openEditor(page, workspace.url);
  await page.getByRole('button', { name: 'Úkoly', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Editor úkolů', exact: true });
  await panel.getByRole('button', { name: '+ Úkol', exact: true }).click();
  const taskId = await panel
    .getByLabel('Úkol na úpravu', { exact: true })
    .inputValue();
  await panel
    .getByLabel('Text v deníku', { exact: true })
    .fill('Zapísať si radu od správcu.');
  await panel
    .getByLabel('Kdy přidat úkol', { exact: true })
    .selectOption('event');
  await page.getByRole('button', { name: 'Dialogy', exact: true }).click();
  const content = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const caretaker = content.dialogues.find((d) =>
    d.nodes.some((n) => n.id === 'repair'),
  )!;
  await page.getByLabel('Dialog', { exact: true }).selectOption(caretaker.id);
  await page
    .getByLabel('Uzel dialogu', { exact: true })
    .selectOption('greeting');
  let choice = page.locator('.choice-card').filter({
    has: page.locator('summary', { hasText: 'Ako opravím router?' }),
  });
  await choice.getByRole('button', { name: '+ Efekt', exact: true }).click();
  await choice.getByLabel('Efekt', { exact: true }).selectOption('startTask');
  await choice.getByLabel('Cíl efektu', { exact: true }).selectOption(taskId);
  await page.getByLabel('Uzel dialogu', { exact: true }).selectOption('repair');
  choice = page.locator('.choice-card').filter({
    has: page.locator('summary', { hasText: 'Môžem si vziať pásku?' }),
  });
  await choice.getByRole('button', { name: '+ Efekt', exact: true }).click();
  await choice
    .getByLabel('Efekt', { exact: true })
    .last()
    .selectOption('completeTask');
  await choice
    .getByLabel('Cíl efektu', { exact: true })
    .last()
    .selectOption(taskId);
  await saveProject(page);
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(saved.tasks!.find((t) => t.id === taskId)).toEqual({
    id: taskId,
    text: 'Zapísať si radu od správcu.',
  });
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Mapa logiky', exact: true }).click();
  await page.locator('.logic-panel input').fill(taskId);
  await expect(page.locator('.logic-panel')).toContainText('+ úkol');
  await expect(page.locator('.logic-panel')).toContainText('✓ úkol');
  await page.getByRole('button', { name: 'Úkoly', exact: true }).click();
  await panel
    .getByLabel('Úkol na úpravu', { exact: true })
    .selectOption(taskId);
  await panel
    .getByRole('button', { name: 'Odstranit úkol', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Uložit do projektu', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await page
    .getByRole('button', { name: 'Otestovat odsud ↗', exact: true })
    .click();
  await ready(page);
  let journal = await openJournal(page, isMobile);
  await expect(journal.locator('[data-task-id="' + taskId + '"]')).toHaveCount(
    0,
  );
  await closeJournal(page, isMobile);
  await (await object(page, 'Správca')).press('Enter');
  await page.getByRole('button', { name: 'Ako opravím router?' }).click();
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
  journal = await openJournal(page, isMobile);
  await expect(
    journal.locator('[data-task-id="' + taskId + '"]'),
  ).toHaveAttribute('data-status', 'active');
  await closeJournal(page, isMobile);
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
  await finishLine(page, isMobile);
  await page.getByRole('button', { name: 'Môžem si vziať pásku?' }).click();
  await finishLine(page, isMobile);
  await page.getByRole('button', { name: 'Zatiaľ sa rozhliadnem.' }).click();
  journal = await openJournal(page, isMobile);
  await expect(journal.locator('[data-task-id="' + taskId + '"] s')).toHaveText(
    'Zapísať si radu od správcu.',
  );
});

test('projects without tasks keep a readable empty notebook', async ({
  page,
  workspace,
  isMobile,
}) => {
  const content = JSON.parse(await readFile(workspace.source, 'utf8'));
  content.tasks = [];
  await writeFile(workspace.source, JSON.stringify(content));
  await page.goto(workspace.url);
  await ready(page);
  const journal = await openJournal(page, isMobile);
  await expect(journal).toContainText('Zatiaľ nemám nič zapísané.');
  await expect(journal.locator('[data-task-id]')).toHaveCount(0);
});

test('HUD and notebook pixels belong to the canvas; semantic HTML never captures a pointer', async ({
  page,
  workspace,
  isMobile,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(workspace.url);
  await ready(page);
  await activate(page, 190, 630, isMobile);
  await expect(
    page.getByRole('button', { name: 'Poškodený kábel', exact: true }),
  ).toBeVisible();
  const canvas = page.locator('.canvas-host canvas');
  const semantics = page.locator('.hud-accessibility');
  await expect(semantics).toHaveCSS('opacity', '0');
  await expect(semantics.locator('button').first()).toHaveCSS(
    'pointer-events',
    'none',
  );
  await page.mouse.move(0, 0);
  const hudImage = await canvas.screenshot({ animations: 'disabled' });
  const box = (await canvas.boundingBox())!;
  const inventoryBox = (await page
    .getByRole('group', { name: 'Inventár', exact: true })
    .boundingBox())!;
  async function hudPixels(bytes: Buffer) {
    const meta = await sharp(bytes).metadata();
    return sharp(bytes)
      .extract({
        // Exclude the outer CSS frame's rounded/composited antialiasing.
        left: 16,
        top: 3,
        width: meta.width! - 32,
        height:
          Math.floor(
            ((inventoryBox.y + inventoryBox.height - box.y) * meta.width!) /
              box.width,
          ) - 3,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
  }
  const baseline = await hudPixels(hudImage);
  await semantics.evaluate((element) => {
    element.style.display = 'none';
  });
  const withoutSemantics = await canvas.screenshot({ animations: 'disabled' });
  if (!(await hudPixels(withoutSemantics)).equals(baseline)) {
    await info.attach('before-hide', {
      body: hudImage,
      contentType: 'image/png',
    });
    await info.attach('after-hide', {
      body: withoutSemantics,
      contentType: 'image/png',
    });
  }
  expect((await hudPixels(withoutSemantics)).equals(baseline)).toBe(true);
  await semantics.evaluate((element) => {
    element.style.removeProperty('display');
  });
  const journal = await openJournal(page, isMobile);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  const bookImage = await canvas.screenshot({ animations: 'disabled' });
  expect(bookImage.equals(hudImage)).toBe(false);
  const book = (await journal.boundingBox())!,
    area = (await canvas.boundingBox())!;
  const { data, info: pixels } = await sharp(bookImage)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scale = pixels.width / area.width;
  const x = Math.floor((book.x + book.width * 0.5 - area.x) * scale),
    y = Math.floor((book.y + book.height * 0.23 - area.y) * scale);
  const offset = (y * pixels.width + x) * pixels.channels;
  expect(data[offset]).toBeGreaterThan(180);
  expect(data[offset + 1]).toBeGreaterThan(150);
  await semantics.evaluate((element) => {
    element.style.display = 'none';
  });
  const hiddenBook = await canvas.screenshot({ animations: 'disabled' });
  async function bookPixels(bytes: Buffer) {
    return sharp(bytes)
      .extract({
        left: Math.ceil((book.x + 5 - area.x) * scale),
        top: Math.ceil((book.y + 5 - area.y) * scale),
        width: Math.floor((book.width - 10) * scale),
        height: Math.floor((book.height - 10) * scale),
      })
      .removeAlpha()
      .raw()
      .toBuffer();
  }
  expect(
    (await bookPixels(hiddenBook)).equals(await bookPixels(bookImage)),
  ).toBe(true);
  await semantics.evaluate((element) => {
    element.style.removeProperty('display');
  });
  await page.screenshot({
    path: info.outputPath('pixi-notebook.png'),
    animations: 'disabled',
  });
  await closeJournal(page, isMobile);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect(page.locator('.game-window canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await openJournal(page, isMobile);
  await expect(
    page.locator('.game-topbar, .game-dock, .task-journal'),
  ).toHaveCount(0);
});

test('canvas inventory pages and notebook scrolling remain usable after resize and CSS zoom', async ({
  page,
  workspace,
  isMobile,
}, info) => {
  const content = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: 'pocket-' + i,
    label: 'Skúšobný predmet ' + (i + 1),
    description: 'Predmet do vrecka.',
    icon: '◆',
  }));
  const room = content.scenes.find((s) => s.id === content.startScene)!;
  const project: GameContent = {
    ...content,
    items: [...content.items, ...items],
    tasks: Array.from({ length: 8 }, (_, i) => ({
      id: 'note-' + i,
      text:
        'Poznámka ' +
        (i + 1) +
        ': ' +
        'Skontrolovať podozrivý predmet a zapísať si, prečo sa na mňa stále tak škaredo pozerá. '.repeat(
          2,
        ),
      startWhen: { all: [] },
    })),
    scenes: content.scenes.map((s) =>
      s.id !== room.id
        ? s
        : {
            ...s,
            hotspots: [
              ...s.hotspots,
              {
                id: 'pockets',
                label: 'Naplniť vrecká',
                bounds: { x: 100, y: 60, width: 250, height: 80 },
                onClick: [
                  {
                    effects: items.map((item) => ({
                      type: 'addItem' as const,
                      id: item.id,
                    })),
                  },
                ],
              },
            ],
          },
    ),
  };
  await writeFile(workspace.source, JSON.stringify(project));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(workspace.url);
  await ready(page);
  await (await object(page, 'Naplniť vrecká')).press('Enter');
  const next = page.getByRole('button', {
    name: 'Ďalšie predmety',
    exact: true,
  });
  const previous = page.getByRole('button', {
    name: 'Predchádzajúce predmety',
    exact: true,
  });
  await expect(previous).toBeDisabled();
  await hudClick(page, next, isMobile);
  await expect(previous).toBeEnabled();
  await hudClick(page, previous, isMobile);
  const first = page.getByRole('button', {
    name: items[0]!.label,
    exact: true,
  });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 720, height: 400 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '0.85';
  });
  await ready(page);
  await hudClick(page, next, isMobile);
  await expect(previous).toBeEnabled();
  await openJournal(page, isMobile);
  const down = page.getByRole('button', {
    name: 'Posunúť denník nadol',
    exact: true,
  });
  const up = page.getByRole('button', {
    name: 'Posunúť denník nahor',
    exact: true,
  });
  await expect(up).toBeDisabled();
  const before = await page
    .locator('canvas')
    .screenshot({ animations: 'disabled' });
  await hudClick(page, down, isMobile);
  await expect(up).toBeEnabled();
  expect(
    (
      await page.locator('canvas').screenshot({ animations: 'disabled' })
    ).equals(before),
  ).toBe(false);
  for (let i = 0; i < 25 && (await down.isEnabled()); i++)
    await hudClick(page, down, isMobile);
  await expect(down).toBeDisabled();
  await hudClick(page, up, isMobile);
  await expect(down).toBeEnabled();
  await page.screenshot({
    path: info.outputPath('pixi-overflow-zoom.png'),
    animations: 'disabled',
  });
  await closeJournal(page, isMobile);
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('zoom');
  });
  await ready(page);
  await hudClick(page, previous, isMobile);
});
