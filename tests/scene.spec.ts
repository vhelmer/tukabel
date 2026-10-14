import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

async function pointInScene(canvas: Locator, x: number, y: number) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Scene canvas has no bounds');
  return {
    x: box.x + (x / 1280) * box.width,
    y: box.y + (y / 720) * box.height,
  };
}
const reaction = (page: Page) => page.locator('.reaction');
async function ready(page: Page) {
  await expect(page.locator('.canvas-host canvas')).toHaveCount(1);
  await expect(page.locator('.scene-notice')).toHaveCount(0);
}
async function getTape(page: Page) {
  await page.getByRole('button', { name: 'Správca', exact: true }).click();
  const dialogue = page.getByRole('dialog');
  await dialogue.getByRole('button', { name: 'Ako opravím router?' }).click();
  await dialogue.getByRole('button', { name: 'Môžem si vziať pásku?' }).click();
  await expect(page.locator('.inventory')).toContainText('Izolačná páska');
  await dialogue
    .getByRole('button', { name: 'Zatiaľ sa rozhliadnem.' })
    .click();
}

test('complete adventure uses canvas, dialogue, combinations, dynamic world, transitions and save/load', async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await ready(page);
  const canvas = page.locator('.canvas-host canvas');
  const activate = async (x: number, y: number) => {
    const point = await pointInScene(canvas, x, y);
    if (isMobile) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  };
  // Locked exit and wrong item use must preserve a solvable game.
  await activate(1220, 440);
  await expect(reaction(page)).toContainText('Zamknuté.');
  if (!isMobile) {
    await page.mouse.move(0, 0);
    const before = await canvas.screenshot();
    const point = await pointInScene(canvas, 440, 480);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('.footer')).toContainText('Preskúmať: Router');
    expect((await canvas.screenshot()).equals(before)).toBe(false);
  }
  await activate(440, 480);
  await expect(reaction(page)).toContainText('Dve antény.');
  await page.setViewportSize(
    isMobile ? { width: 700, height: 900 } : { width: 800, height: 900 },
  );
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) =>
        Math.abs(element.clientWidth - element.parentElement!.clientWidth),
      ),
    )
    .toBeLessThan(2);
  await activate(150, 620);
  await expect(
    page.getByRole('button', { name: 'Kábel pri stoličke' }),
  ).toHaveCount(0);
  const cable = page.getByRole('button', {
    name: 'Poškodený kábel',
    exact: true,
  });
  await cable.click();
  await activate(440, 480);
  await expect(reaction(page)).toContainText('Najprv ho opravím páskou.');
  await expect(cable).toBeVisible();
  await getTape(page);
  // The reward cannot be farmed by repeating the conversation.
  await page.getByRole('button', { name: 'Správca', exact: true }).click();
  await page.getByRole('button', { name: 'Ako opravím router?' }).click();
  await expect(
    page.getByRole('button', { name: 'Môžem si vziať pásku?' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Idem na to.' }).click();
  await page
    .getByRole('button', { name: 'Izolačná páska', exact: true })
    .click();
  await cable.click();
  const fixed = page.getByRole('button', {
    name: 'Opravený kábel',
    exact: true,
  });
  await expect(fixed).toBeVisible();
  await expect(cable).toHaveCount(0);
  await fixed.click();
  await page
    .getByRole('button', { name: 'Preskúmať predmet', exact: true })
    .click();
  await expect(reaction(page)).toContainText('Izolácia drží.');
  await page.getByRole('button', { name: 'Zásuvka', exact: true }).click();
  await expect(reaction(page)).toContainText('Toto tu nepomôže.');
  await expect(fixed).toBeVisible();
  await fixed.click();
  const unpowered = await canvas.screenshot();
  await activate(440, 480);
  await expect(reaction(page)).toContainText('Zapojené!');
  await expect(fixed).toHaveCount(0);
  expect((await canvas.screenshot()).equals(unpowered)).toBe(false);
  await activate(1220, 440);
  await ready(page);
  await expect(page.locator('.scene-toolbar')).toContainText('Skúšobný dvor');
  await activate(820, 320);
  await expect(reaction(page)).toContainText('Ukážka dokončená!');
  await page.getByRole('button', { name: 'Uložiť hru', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Ukladanie' })).toContainText(
    'Hra je uložená',
  );
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Načítať hru', exact: true }).click();
  await ready(page);
  await expect(page.locator('.scene-toolbar')).toContainText('Skúšobný dvor');
  await activate(180, 350);
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Kábel pri stoličke' }),
  ).toHaveCount(0);
  await activate(440, 480);
  await expect(reaction(page)).toContainText('Router svieti.');
  await page.getByRole('button', { name: 'Nová hra', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Kábel pri stoličke' }),
  ).toBeVisible();
  await expect(page.locator('.inventory-items .inventory-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Načítať hru', exact: true }).click();
  await ready(page);
  await expect(page.locator('.scene-toolbar')).toContainText('Skúšobný dvor');
  expect(errors).toEqual([]);
});

test('keyboard controls, hint outlines and dialogue focus share the same game state', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  const hints = page.getByRole('button', { name: 'Ukázať predmety' });
  await hints.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Skryť predmety' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Kontextová akcia' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Preskúmať', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hrnček', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(reaction(page)).toContainText('Káva už vychladla.');
  await page.getByRole('button', { name: 'Vziať', exact: true }).click();
  await page.getByRole('button', { name: 'Hrnček', exact: true }).click();
  await expect(reaction(page)).toContainText('Hrnček patrí správcovi.');
  await page.getByRole('button', { name: 'Kontextová akcia' }).click();
  await page.getByRole('button', { name: 'Správca', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Ako opravím router?' }),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Router', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Môžem si vziať pásku?' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Uložiť hru', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Načítať hru', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Kábel leží pri stoličke.',
  );
  await page.keyboard.press('Escape');
  // Complete the inventory interactions using only keyboard activation.
  await page
    .getByRole('button', { name: 'Kábel pri stoličke', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  const cable = page.getByRole('button', {
    name: 'Poškodený kábel',
    exact: true,
  });
  await cable.focus();
  await page.keyboard.press('Enter');
  await expect(cable).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(cable).toHaveAttribute('aria-pressed', 'false');
});

test('corrupt, incompatible and unavailable saves preserve current progress', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Kábel pri stoličke' }).click();
  for (const raw of ['{', '{"version":99}']) {
    await page.evaluate(
      (value) => localStorage.setItem('tukabel.save.v1', value),
      raw,
    );
    await page
      .getByRole('button', { name: 'Načítať hru', exact: true })
      .click();
    await expect(page.getByRole('status', { name: 'Ukladanie' })).toContainText(
      raw === '{' ? 'nepodarilo prečítať' : 'inej verzii',
    );
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
  await page.getByRole('button', { name: 'Uložiť hru', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Ukladanie' })).toContainText(
    'nepovolil uloženie',
  );
  await page.getByRole('button', { name: 'Načítať hru', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Ukladanie' })).toContainText(
    'nepovolil čítanie',
  );
});

test('an unavailable background shows a recoverable loading error', async ({
  page,
}) => {
  await page.route('**/demo-room.svg', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText(
    'Scénu sa nepodarilo načítať.',
  );
  await expect(page.locator('.canvas-host canvas')).toHaveCount(0);
  await page.unroute('**/demo-room.svg');
  await page.getByRole('button', { name: 'Obnoviť stránku' }).click();
  await ready(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
