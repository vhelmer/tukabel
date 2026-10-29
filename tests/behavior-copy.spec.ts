import { expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test, openEditor } from './editorFixture';
import type { GameContent, Hotspot } from '../src/game/types';
import { activate, object, ready } from './helpers';

async function seed(source: string) {
  const content = JSON.parse(await readFile(source, 'utf8')) as GameContent;
  const original: Hotspot = {
    id: 'original',
    label: 'Pôvodná rekvizita',
    placeholder: true,
    bounds: { x: 600, y: 260, width: 240, height: 200 },
    visibleWhen: { not: { flag: 'cableTaken' } },
    onClick: [
      {
        message: 'Kábel je môj.',
        effects: [
          { type: 'addItem', id: 'cable' },
          { type: 'flag', id: 'cableTaken', value: true },
        ],
      },
    ],
    uses: {
      tape: [
        {
          message: 'Lepí to.',
          effects: [{ type: 'flag', id: 'tapeGiven', value: true }],
        },
      ],
    },
    cursor: 'interact',
    cursorImage: 'cursors/cable-icon.svg',
    cursorSize: 44,
    cursorOffset: [3, 4],
  };
  const target: Hotspot = {
    id: 'artwork',
    label: 'Nová grafika',
    image: 'cable.svg',
    decorative: true,
    bounds: { x: 600, y: 260, width: 240, height: 200 },
    rotation: 12,
    imageFit: 'stretch',
    hitTest: 'bounds',
    polygon: [
      { x: 600, y: 260 },
      { x: 840, y: 260 },
      { x: 720, y: 460 },
    ],
    opacity: 0.85,
    cursor: 'exit',
    onClick: [{ message: 'Staré pravidlo.' }],
    uses: { fixedCable: [{ message: 'Staré použitie.' }] },
  };
  const locked: Hotspot = {
    id: 'locked',
    label: 'Zamknutá grafika',
    locked: true,
    bounds: { x: 950, y: 200, width: 180, height: 160 },
    onClick: [{ message: 'Nedotýkať.' }],
  };
  const tape: Hotspot = {
    id: 'tape-source',
    label: 'Skúšobná páska',
    bounds: { x: 100, y: 100, width: 100, height: 100 },
    onClick: [{ effects: [{ type: 'addItem', id: 'tape' }] }],
  };
  const scene = {
    ...content.scenes[0]!,
    hotspots: [target, original, locked, tape],
  };
  await writeFile(
    source,
    JSON.stringify(
      { ...content, scenes: [scene, ...content.scenes.slice(1)] },
      null,
      2,
    ),
  );
  return { original, target, locked };
}
async function stagePoint(page: Page, x: number, y: number) {
  const svg = page.locator('svg.editor-stage');
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate(
    (node, p) => {
      const result = new DOMPoint(p.x, p.y).matrixTransform(
        (node as SVGSVGElement).getScreenCTM()!,
      );
      return { x: result.x, y: result.y };
    },
    { x, y },
  );
}
async function arm(page: Page) {
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('original');
  await page
    .getByRole('button', { name: 'Kopírovat chování', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Kopírování chování' }),
  ).toContainText('Pôvodná rekvizita');
}
async function save(page: Page) {
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
}

test('copy behavior onto artwork without moving it, undo, delete placeholder and play saved rules', async ({
  page,
  workspace,
}, testInfo) => {
  const { original, target } = await seed(workspace.source);
  await openEditor(page, workspace.url);
  await arm(page);
  const p = await stagePoint(page, 720, 340);
  if (testInfo.project.name === 'touch') await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await expect(page.getByLabel('Vybraný objekt', { exact: true })).toHaveValue(
    'artwork',
  );
  await expect(
    page.getByRole('status', { name: 'Kopírování chování' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect(
    page.getByLabel('Interaktivní objekt', { exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Znovu', exact: true }).click();
  await expect(
    page.getByLabel('Interaktivní objekt', { exact: true }),
  ).toBeChecked();
  await save(page);
  const copied = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(copied.scenes[0]!.hotspots.find((h) => h.id === 'original')).toEqual(
    original,
  );
  expect(copied.scenes[0]!.hotspots.find((h) => h.id === 'artwork')).toEqual({
    ...target,
    decorative: undefined,
    openMap: undefined,
    visibleWhen: original.visibleWhen,
    onClick: original.onClick,
    uses: original.uses,
    cursor: original.cursor,
    cursorImage: original.cursorImage,
    cursorSize: original.cursorSize,
    cursorOffset: original.cursorOffset,
  });
  await page
    .getByLabel('Vybraný objekt', { exact: true })
    .selectOption('original');
  await page
    .getByRole('button', { name: 'Odstranit objekt', exact: true })
    .click();
  await save(page);
  await page.reload();
  await ready(page);
  await (await object(page, 'Skúšobná páska')).press('Enter');
  await page
    .getByRole('button', { name: 'Izolačná páska', exact: true })
    .press('Enter');
  await activate(page, 720, 340, testInfo.project.name === 'touch');
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Lepí to.',
  );
  await activate(page, 720, 340, testInfo.project.name === 'touch');
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Kábel je môj.',
  );
  await expect(await object(page, 'Nová grafika')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Poškodený kábel', exact: true }),
  ).toHaveCount(1);
});

test('cancel copying and refuse locked layers; layer list provides a keyboard target', async ({
  page,
  workspace,
}) => {
  const { locked } = await seed(workspace.source);
  await openEditor(page, workspace.url);
  await arm(page);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('status', { name: 'Kopírování chování' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Zpět', exact: true }),
  ).toBeDisabled();
  await arm(page);
  const p = await stagePoint(page, 1040, 280);
  await page.mouse.click(p.x, p.y);
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('zamknut');
  await expect(
    page.getByRole('button', { name: 'Zpět', exact: true }),
  ).toBeDisabled();
  await page.locator('[data-layer-id="artwork"] .layer-name').press('Enter');
  await expect(page.getByLabel('Vybraný objekt', { exact: true })).toHaveValue(
    'artwork',
  );
  await save(page);
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(saved.scenes[0]!.hotspots.find((h) => h.id === 'locked')).toEqual(
    locked,
  );
  expect(
    saved.scenes[0]!.hotspots.find((h) => h.id === 'artwork')!.onClick[0]!
      .message,
  ).toBe('Kábel je môj.');
});

test('target picking cannot drag artwork and scene changes cancel the pending copy', async ({
  page,
  workspace,
}) => {
  await seed(workspace.source);
  await openEditor(page, workspace.url);
  await arm(page);
  const p = await stagePoint(page, 720, 340);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 20, p.y + 10, { steps: 3 });
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Zpět', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('status', { name: 'Kopírování chování' }),
  ).toBeVisible();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.locator('svg.editor-stage').dispatchEvent('pointercancel', {
    pointerId: 1,
    clientX: p.x,
    clientY: p.y,
  });
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Zpět', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel('Aktivní lokace', { exact: true })
    .selectOption('courtyard');
  await expect(
    page.getByRole('status', { name: 'Kopírování chování' }),
  ).toHaveCount(0);
  await page
    .getByLabel('Aktivní lokace', { exact: true })
    .selectOption('workshop');
  await expect(
    page.getByRole('status', { name: 'Kopírování chování' }),
  ).toHaveCount(0);
});
