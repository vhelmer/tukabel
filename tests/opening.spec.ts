import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from './editorFixture';
import { hudClick, ready } from './helpers';
import type { GameContent } from '../src/game/types';

async function opening(source: string, cutscene = false) {
  const content = JSON.parse(await readFile(source, 'utf8')) as GameContent;
  const dialogue = content.dialogues.find((d) => d.id === 'animation-demo')!;
  const node = dialogue.nodes.find((n) => n.speech)!;
  await writeFile(
    source,
    JSON.stringify({
      ...content,
      startDialogue: dialogue.id,
      startScene: 'animation-lab',
      ...(cutscene ? { openingCutscene: 'blackout' } : {}),
      dialogues: content.dialogues.map((d) =>
        d.id !== dialogue.id
          ? d
          : {
              ...d,
              entry: 'speech',
              start: node.id,
              nodes: d.nodes.map((n) =>
                n.id !== node.id
                  ? n
                  : {
                      ...n,
                      choices: [{ id: 'accept', text: 'Prípad beriem.' }],
                    },
              ),
            },
      ),
    }),
  );
}

test('opening waits one second after the scene is ready and blocks all game input before playing once', async ({
  page,
  workspace,
  isMobile,
}) => {
  await opening(workspace.source);
  await page.addInitScript(() => {
    const events: number[] = [];
    Object.assign(window, { openingPlays: events });
    HTMLMediaElement.prototype.play = function () {
      if (this.closest('.dialogue-panel')) {
        events.push(Date.now());
        this.dispatchEvent(new Event('play'));
      }
      return Promise.resolve();
    };
  });
  await page.clock.install({ time: new Date('2026-10-29T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-29T00:01:00Z'));
  await page.goto(workspace.url);
  await ready(page);
  const game = page.getByRole('region', { name: 'Herné okno' });
  await expect(game).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
  await expect(page.locator('.reaction')).toHaveCount(0);
  const menu = page.getByRole('button', {
    name: 'Menu',
    exact: true,
    includeHidden: true,
  });
  const bounds = (await menu.boundingBox())!;
  if (isMobile)
    await page.touchscreen.tap(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  else
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Herné menu' })).toHaveCount(0);
  await page.clock.runFor(999);
  await expect(game).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { openingPlays: number[] }).openingPlays.length,
      ),
    )
    .toBe(1);
  await page.clock.runFor(350);
  await page
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  await page.clock.runFor(350);
  await page
    .getByRole('button', { name: 'Prípad beriem.', exact: true })
    .click();
  await hudClick(
    page,
    page.getByRole('button', { name: 'Menu', exact: true }),
    isMobile,
  );
  await page.getByRole('button', { name: 'Nová hra', exact: true }).click();
  await ready(page);
  await expect(game).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { openingPlays: number[] }).openingPlays.length,
      ),
    )
    .toBe(2);
});

test('blocked opening autoplay resumes from the subtitle gesture without skipping the line', async ({
  page,
  workspace,
  isMobile,
}) => {
  await opening(workspace.source);
  await page.addInitScript(() => {
    let calls = 0;
    Object.assign(window, { openingPlayCount: 0 });
    HTMLMediaElement.prototype.play = function () {
      if (!this.closest('.dialogue-panel')) return Promise.resolve();
      calls++;
      Object.assign(window, { openingPlayCount: calls });
      if (calls === 1)
        return Promise.reject(
          new DOMException('Gesture required', 'NotAllowedError'),
        );
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
  });
  await page.goto(workspace.url);
  await ready(page);
  const start = page.getByRole('button', {
    name: 'Spustiť dabing',
    exact: true,
  });
  await expect(start).toBeEnabled();
  if (isMobile) await start.tap();
  else await start.click();
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
  await expect(
    page.getByRole('button', { name: 'Prípad beriem.', exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { openingPlayCount: number }).openingPlayCount,
      ),
    )
    .toBe(2);
  const caption = page.getByRole('button', {
    name: 'Dokončiť repliku',
    exact: true,
  });
  await expect(caption).toBeDisabled();
  await expect(caption).toBeEnabled();
  await caption.click();
  await expect(
    page.getByRole('button', { name: 'Prípad beriem.', exact: true }),
  ).toBeEnabled();
});

test('an opening with audio blocked even after a gesture still allows subtitle-only progress', async ({
  page,
  workspace,
}) => {
  await opening(workspace.source);
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return this.closest('.dialogue-panel')
        ? Promise.reject(new DOMException('Audio disabled', 'NotAllowedError'))
        : Promise.resolve();
    };
  });
  await page.goto(workspace.url);
  await ready(page);
  await page
    .getByRole('button', { name: 'Spustiť dabing', exact: true })
    .click();
  const caption = page.getByRole('button', {
    name: 'Dokončiť repliku',
    exact: true,
  });
  await expect(caption).toBeEnabled();
  await caption.click();
  await expect(
    page.getByRole('button', { name: 'Prípad beriem.', exact: true }),
  ).toBeEnabled();
});

test('failed opening scene keeps the reload recovery usable instead of leaving the game inert', async ({
  page,
  workspace,
}) => {
  await opening(workspace.source);
  const content = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const background = content.scenes.find(
    (s) => s.id === content.startScene,
  )!.background;
  await page.route(`**/${background}`, (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.goto(workspace.url);
  const recovery = page.getByRole('button', {
    name: 'Obnoviť stránku',
    exact: true,
  });
  await expect(recovery).toBeVisible();
  await page.unrouteAll();
  await Promise.all([
    page.waitForEvent('load'),
    recovery.click({ timeout: 5000 }),
  ]);
  await ready(page);
  await expect(page.locator('.dialogue-panel')).toBeVisible();
});

// Cutscene recordings are detached Audio elements; finish them quickly.
const fastCutsceneAudio = (blockFirst: boolean) => {
  let blocked = blockFirst;
  const played: string[] = [];
  Object.assign(window, { cutscenePlays: played });
  HTMLMediaElement.prototype.play = function () {
    if (this.closest('.dialogue-panel')) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    }
    if (!this.src.includes('/cutscenes/')) return Promise.resolve();
    if (blocked) {
      blocked = false;
      return Promise.reject(
        new DOMException('Gesture required', 'NotAllowedError'),
      );
    }
    played.push(this.src.split('/').pop()!.split('?')[0]!);
    setTimeout(() => this.dispatchEvent(new Event('ended')), 50);
    return Promise.resolve();
  };
};
const cutscenePlays = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    (window as unknown as { cutscenePlays: string[] }).cutscenePlays.map(
      (name) => name.replace(/-[\w-]+(?=\.mp3$)/, ''),
    ),
  );

test('the blackout cutscene plays before the opening dialogue and hands over by itself', async ({
  page,
  workspace,
}) => {
  await opening(workspace.source, true);
  await page.addInitScript(fastCutsceneAudio, false);
  await page.goto(workspace.url);
  const cutscene = page.getByRole('dialog', { name: 'Úvod: výpadok prúdu' });
  await expect(cutscene).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Herné okno' }),
  ).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
  await expect(cutscene).toHaveCount(0, { timeout: 15000 });
  expect(await cutscenePlays(page)).toEqual([
    'switch.mp3',
    'electricity.mp3',
    'voice.mp3',
  ]);
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
});

test('skipping the cutscene opens Fero at once and a new game shows it again', async ({
  page,
  workspace,
  isMobile,
}) => {
  await opening(workspace.source, true);
  await page.addInitScript(fastCutsceneAudio, false);
  await page.goto(workspace.url);
  const cutscene = page.getByRole('dialog', { name: 'Úvod: výpadok prúdu' });
  const skip = cutscene.getByRole('button', { name: 'Preskočiť ›' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cutscene).toHaveCount(0);
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
  await page
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Prípad beriem.', exact: true })
    .click();
  await hudClick(
    page,
    page.getByRole('button', { name: 'Menu', exact: true }),
    isMobile,
  );
  await page.getByRole('button', { name: 'Nová hra', exact: true }).click();
  await expect(cutscene).toBeVisible();
  if (isMobile) await skip.tap();
  else await skip.click();
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
});

test('blocked cutscene sound waits for a start gesture', async ({
  page,
  workspace,
  isMobile,
}) => {
  await opening(workspace.source, true);
  await page.addInitScript(fastCutsceneAudio, true);
  await page.goto(workspace.url);
  const start = page.getByRole('button', { name: '▶ Spustiť úvod' });
  await expect(start).toBeVisible();
  if (isMobile) await start.tap();
  else await start.click();
  await expect(start).toHaveCount(0);
  await expect(
    page.getByRole('dialog', { name: 'Úvod: výpadok prúdu' }),
  ).toHaveCount(0, { timeout: 15000 });
  expect(await cutscenePlays(page)).toEqual([
    'switch.mp3',
    'electricity.mp3',
    'voice.mp3',
  ]);
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
});
