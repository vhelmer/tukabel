import { hudClick } from './helpers';
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { GameContent } from '../src/game/types';
import { test as editorTest } from './editorFixture';
import {
  activate,
  finishLine,
  dragItem,
  getTape,
  menuAction,
  object,
  pointInScene,
  ready,
} from './helpers';

const reaction = (page: import('@playwright/test').Page) =>
  page.getByRole('status', { name: 'Reakcia' });

editorTest(
  'bus stop conversations, conditional gossip and bottle exchange survive save/load on mouse and touch',
  async ({ page, workspace, isMobile }, info) => {
    editorTest.setTimeout(60000);
    const project = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    await writeFile(
      workspace.source,
      JSON.stringify({ ...project, startScene: 'scene1' }),
    );
    await page.goto(workspace.url);
    await ready(page);
    for (const [x, y, comment] of [
      [1000, 120, 'Najčastejšie'],
      [480, 420, 'diagnózy'],
      [950, 480, 'optimizmu'],
      [100, 421, 'čuch'],
      [1138, 407, 'dôvod'],
    ] as const) {
      await activate(page, x, y, isMobile);
      await expect(reaction(page)).toContainText(comment);
    }
    await activate(page, 1010, 300, isMobile);
    await expect(reaction(page)).toContainText('7:10');
    await activate(page, 730, 400, isMobile);
    const dialogue = page.getByRole('dialog', { name: 'Rozhovor' });
    await expect(
      dialogue.getByRole('button', { name: 'V poriadku píšu' }),
    ).toBeVisible();
    await expect(
      dialogue.getByRole('button', { name: 'Cigy vravel' }),
    ).toHaveCount(0);
    await dialogue
      .getByRole('button', { name: 'Čo máte v tej taške?' })
      .click();
    await expect(dialogue).toContainText('urnu po mužovi');
    await expect(dialogue).not.toContainText('[whispers]');
    await finishLine(page, isMobile);
    await dialogue
      .getByRole('button', { name: 'A páčia sa mu tie výlety?' })
      .click();
    await expect(dialogue).toContainText('štyridsať rokov');
    await finishLine(page, isMobile);
    await dialogue
      .getByRole('button', { name: 'Maj sa. Idem sa rozhliadnuť.' })
      .click();

    await activate(page, 250, 360, isMobile);
    await dialogue
      .getByRole('button', { name: 'Čo vláčiš v tom batohu?' })
      .click();
    await expect(dialogue).toContainText('rotopedom');
    await expect(dialogue).not.toContainText('[proud]');
    await page.screenshot({ path: info.outputPath('bus-stop-dialogue.png') });
    await finishLine(page, isMobile);
    await dialogue
      .getByRole('button', { name: 'A odkiaľ to železo máš?' })
      .click();
    await expect(dialogue).toContainText('Legálny zber');
    await finishLine(page, isMobile);
    await dialogue
      .getByRole('button', { name: 'Maj sa. Idem sa rozhliadnuť.' })
      .click();
    await activate(page, 250, 360, isMobile);
    await dialogue
      .getByRole('button', { name: 'Tá babka tu čaká dlho?' })
      .click();
    await finishLine(page, isMobile);
    await dialogue
      .getByRole('button', { name: 'Spýtam sa jej na tú rezerváciu.' })
      .click();
    await expect(dialogue).toHaveCount(0);
    await activate(page, 730, 400, isMobile);
    await dialogue
      .getByRole('button', {
        name: 'Cigy vravel niečo o rezervácii na cintoríne.',
      })
      .click();
    await expect(dialogue).toContainText('Dvojhrob pri chodníku');
    await finishLine(page, isMobile);
    await dialogue
      .getByRole('button', { name: 'Maj sa. Idem sa rozhliadnuť.' })
      .click();

    await activate(page, 1053, 559, isMobile);
    await expect(reaction(page)).toContainText('nástupište');
    await activate(page, 525, 578, isMobile);
    const bottle = page.getByRole('button', {
      name: 'Prázdna pivová fľaša',
      exact: true,
    });
    await expect(bottle).toBeVisible();
    await activate(page, 525, 578, isMobile);
    await expect(bottle).toHaveCount(1);
    await dragItem(page, bottle, await pointInScene(page, 730, 430), isMobile);
    await expect(dialogue).toHaveClass(/is-speaking/);
    await expect(dialogue).toContainText('Prázdna?');
    await expect(dialogue.locator('audio')).toHaveCount(1);
    await expect(dialogue.locator('.dialogue-choices')).toHaveCount(0);
    await expect(bottle).toBeVisible();
    await expect
      .poll(() =>
        dialogue
          .locator('audio')
          .evaluate((el) => (el as HTMLAudioElement).paused),
      )
      .toBe(false);
    await dialogue
      .getByRole('button', { name: 'Dokončiť repliku', exact: true })
      .click();
    await expect(dialogue).toHaveCount(0);
    await dragItem(page, bottle, await pointInScene(page, 250, 400), isMobile);
    await expect(dialogue).toHaveClass(/is-speaking/);
    await expect(dialogue).toContainText('Pätnásť centov');
    await expect(dialogue.locator('audio')).toHaveCount(1);
    await expect(bottle).toHaveCount(0);
    await expect
      .poll(() =>
        dialogue
          .locator('audio')
          .evaluate((el) => Number.isFinite((el as HTMLAudioElement).duration)),
      )
      .toBe(true);
    await expect
      .poll(() =>
        dialogue
          .locator('audio')
          .evaluate((el) => (el as HTMLAudioElement).paused),
      )
      .toBe(false);
    await page.screenshot({ path: info.outputPath('voiced-item-handoff.png') });
    await dialogue.locator('audio').evaluate(async (el) => {
      const audio = el as HTMLAudioElement;
      audio.currentTime = audio.duration - 0.08;
      await audio.play();
    });
    await expect(dialogue).toHaveCount(0);
    await activate(page, 250, 360, isMobile);
    await expect(
      dialogue.getByRole('button', { name: 'Čo podnikneš s tou zálohou?' }),
    ).toBeVisible();
    await expect(
      dialogue.getByRole('button', { name: 'Nechceš túto prázdnu fľašu?' }),
    ).toHaveCount(0);
    await dialogue
      .getByRole('button', { name: 'Maj sa. Idem sa rozhliadnuť.' })
      .click();
    await menuAction(page, 'Uložiť hru');
    await page.reload();
    await ready(page);
    await menuAction(page, 'Načítať hru');
    await ready(page);
    await expect(bottle).toHaveCount(0);
    await expect(await object(page, 'Pivová fľaša')).toHaveCount(0);
    await (await object(page, 'Cigy')).click();
    await dialogue
      .getByRole('button', { name: 'Čo podnikneš s tou zálohou?' })
      .click();
    await expect(dialogue).toContainText('Diverzifikujem');
  },
);

test('complete adventure supports real inventory drags, scene drops, transitions and persistence', async ({
  page,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await ready(page);
  const original = await page.locator('canvas').elementHandle();
  await page.screenshot({ path: testInfo.outputPath('game.png') });
  await activate(page, 1220, 440, isMobile);
  await expect(reaction(page)).toContainText('Zamknuté');
  if (!isMobile) {
    const point = await pointInScene(page, 440, 480);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('.scene-label')).toContainText('Router');
  }
  await activate(page, 190, 630, isMobile);
  const cable = page.getByRole('button', {
    name: 'Poškodený kábel',
    exact: true,
  });
  await expect(cable).toBeVisible();
  await dragItem(page, cable, await pointInScene(page, 440, 480), isMobile);
  await expect(reaction(page)).toContainText('Najprv ho opravím páskou');
  await expect(cable).toBeVisible();
  await getTape(page);
  await (await object(page, 'Správca')).click();
  await page.getByRole('button', { name: 'Ako opravím router?' }).click();
  await finishLine(page);
  await expect(
    page.getByRole('button', { name: 'Môžem si vziať pásku?' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Idem na to.' }).click();
  const tape = page.getByRole('button', {
    name: 'Izolačná páska',
    exact: true,
  });
  // A canceled / invalid drop must preserve both ingredients.
  await dragItem(page, cable, { x: 5, y: 5 }, isMobile);
  await expect(cable).toBeVisible();
  await expect(tape).toBeVisible();
  await dragItem(page, tape, cable, isMobile);
  const fixed = page.getByRole('button', {
    name: 'Opravený kábel',
    exact: true,
  });
  await expect(fixed).toBeVisible();
  await expect(cable).toHaveCount(0);
  await expect(tape).toHaveCount(0);
  await dragItem(page, fixed, await pointInScene(page, 1090, 375), isMobile);
  await expect(reaction(page)).toContainText('Toto tu nepomôže');
  await expect(fixed).toBeVisible();
  await dragItem(page, fixed, await pointInScene(page, 440, 480), isMobile);
  await expect(reaction(page)).toContainText('Zapojené!');
  await expect(fixed).toHaveCount(0);
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  await activate(page, 1220, 440, isMobile);
  await ready(page);
  await expect(page.locator('.scene-frame')).toHaveAttribute(
    'aria-label',
    'Lokácia: Skúšobný dvor',
  );
  await activate(page, 820, 320, isMobile);
  await expect(reaction(page)).toContainText('Ukážka dokončená!');
  await menuAction(page, 'Uložiť hru');
  await page.reload();
  await ready(page);
  await menuAction(page, 'Načítať hru');
  await ready(page);
  await expect(page.locator('.scene-frame')).toHaveAttribute(
    'aria-label',
    'Lokácia: Skúšobný dvor',
  );
  await activate(page, 180, 350, isMobile);
  await ready(page);
  await activate(page, 440, 480, isMobile);
  await expect(reaction(page)).toContainText('Router svieti');
  await menuAction(page, 'Nová hra');
  await activate(page, 190, 630, isMobile);
  await expect(cable).toBeVisible();
  // The whole game, including inventory and overlays, fits one viewport.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight + 1,
    ),
  ).toBe(true);
  for (const selector of [
    '.play-area',
    '.hud-accessibility [aria-label="Inventár"]',
  ]) {
    const box = await page.locator(selector).boundingBox();
    const game = await page.locator('.game-window').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(game!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(game!.y + game!.height);
  }
  expect(errors).toEqual([]);
});

test('context clicks, silent props, keyboard dialogue and resizing remain usable', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await ready(page);
  await expect(page.locator('.verb-controls')).toHaveCount(0);
  for (const name of [
    'Preskúmať',
    'Vziať',
    'Hovoriť',
    'Použiť',
    'Ukázať predmety',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
      0,
    );
  await (await object(page, 'Hrnček')).focus();
  await page.keyboard.press('Enter');
  await expect(reaction(page)).toContainText('Káva už vychladla');
  await (await object(page, 'Škrabanec')).click();
  await expect(reaction(page)).toHaveCount(0);
  await (await object(page, 'Správca')).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Ako opravím router?' }),
  ).toBeFocused();
  await expect(
    page.getByRole('group', { name: 'Inventár', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await finishLine(page);
  await expect(
    page.getByRole('button', { name: 'Môžem si vziať pásku?' }),
  ).toBeFocused();
  await menuAction(page, 'Uložiť hru');
  await page.getByRole('button', { name: 'Idem na to.', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await menuAction(page, 'Načítať hru');
  await expect(page.getByRole('dialog')).toContainText('Môžem si vziať pásku?');
  await page.getByRole('button', { name: 'Idem na to.', exact: true }).click();
  await (await object(page, 'Kábel pri stoličke')).focus();
  await page.keyboard.press('Enter');
  const cable = page.getByRole('button', {
    name: 'Poškodený kábel',
    exact: true,
  });
  await cable.focus();
  await page.keyboard.press('Enter');
  await expect(reaction(page)).toContainText('Prerušená izolácia');
  await page.keyboard.press('Escape');
  await expect(cable).toHaveAttribute('aria-pressed', 'false');
  await page.setViewportSize(
    isMobile ? { width: 740, height: 390 } : { width: 780, height: 700 },
  );
  await expect
    .poll(() =>
      page
        .locator('canvas')
        .evaluate((element: HTMLCanvasElement) =>
          Math.abs(element.clientWidth - element.parentElement!.clientWidth),
        ),
    )
    .toBeLessThan(2);
  await activate(page, 1140, 375, isMobile);
  await expect(reaction(page)).toContainText('Zásuvka je len kulisa');
});

test('corrupt or unavailable storage never replaces player progress', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await (await object(page, 'Kábel pri stoličke')).click();
  for (const raw of ['{', '{"version":99}']) {
    await page.evaluate(
      (value) => localStorage.setItem('tukabel.save.v1', value),
      raw,
    );
    await menuAction(page, 'Načítať hru', false);
    await expect(page.getByRole('status', { name: 'Ukladanie' })).toContainText(
      raw === '{' ? 'nepodarilo prečítať' : 'inej verzii',
    );
    await page.getByRole('button', { name: 'Pokračovať v hre' }).click();
    await expect(
      page.getByRole('button', { name: 'Poškodený kábel', exact: true }),
    ).toBeVisible();
  }
  await page.evaluate(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Blocked');
      },
    });
  });
  await menuAction(page, 'Uložiť hru', false);
  await expect(page.getByRole('status', { name: 'Ukladanie' })).toContainText(
    'nepovolil uloženie',
  );
});

test('missing background is recoverable and late loads cannot recreate an abandoned canvas', async ({
  page,
}) => {
  await page.route('**/demo-room.svg', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText(
    'Scénu sa nepodarilo načítať',
  );
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.unroute('**/demo-room.svg');
  await page.getByRole('button', { name: 'Obnoviť stránku' }).click();
  await ready(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/demo-room.svg', async (route) => {
    await gate;
    await route.continue();
  });
  const request = page.waitForRequest('**/demo-room.svg');
  await page.reload();
  await request;
  // HUD now mounts with its Pixi canvas. Leave the loading scene through the
  // development workspace instead of relying on an unrelated HTML inventory.
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page
    .getByLabel('Aktivní lokace', { exact: true })
    .selectOption('courtyard');
  await page
    .getByRole('button', { name: 'Otestovat odsud ↗', exact: true })
    .click();
  await ready(page);
  const response = page.waitForResponse('**/demo-room.svg');
  release();
  await response;
  await (await object(page, 'Späť do skúšobne')).click();
  await ready(page);
  await (await object(page, 'Router')).click();
  await expect(reaction(page)).toContainText('Chýba mu opravený kábel');
});

test('canceling drags never selects an item and menu keyboard focus stays contained', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await ready(page);
  await activate(page, 190, 630, isMobile);
  const cable = page.getByRole('button', {
    name: 'Poškodený kábel',
    exact: true,
  });
  const box = (await cable.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start, id: 1 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x + 14, y: start.y, id: 1 }],
    });
    await expect(page.locator('.canvas-host')).toHaveAttribute(
      'data-dragging',
      'true',
    );
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await expect(page.locator('.canvas-host')).toHaveAttribute(
      'data-dragging',
      'false',
    );
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 14, start.y, { steps: 3 });
    await expect(page.locator('.canvas-host')).toHaveAttribute(
      'data-dragging',
      'true',
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.canvas-host')).toHaveAttribute(
      'data-dragging',
      'false',
    );
  }
  await expect(cable).toHaveAttribute('aria-pressed', 'false');
  await cable.focus();
  await page.keyboard.press('Enter');
  await expect(cable).toHaveAttribute('aria-pressed', 'true');
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  await expect(
    page.getByRole('button', { name: 'Uložiť hru', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('button', { name: 'Pokračovať v hre', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Uložiť hru', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Menu', exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
