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
  const scene = await page.locator('.play-area').boundingBox();
  expect(inventory!.y).toBeGreaterThanOrEqual(scene!.y);
  expect(inventory!.y + inventory!.height).toBeLessThan(scene!.y + 130);
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
  await (await object(page, 'Správca')).click();
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
