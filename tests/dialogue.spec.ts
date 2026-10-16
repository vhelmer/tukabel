import { expect, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from './editorFixture';
import { finishLine, object, ready } from './helpers';
import type { DialogueNode, GameContent } from '../src/game/types';

async function seed(source: string, voiced = true) {
  const project = JSON.parse(await readFile(source, 'utf8')) as GameContent;
  const text = 'Ahoj. Mrkám a rozprávam. Oči a ústa fungujú nezávisle.';
  const line: DialogueNode = {
    id: 'reply',
    speaker: 'Skúšobná postava',
    text,
    actor: { sceneId: 'animation-lab', hotspotId: 'blink-character' },
    speech: voiced
      ? {
          text,
          audio: 'speech/animation-demo/audio.wav',
          lipSync: 'speech/animation-demo/track.lipsync.json',
        }
      : undefined,
    choices: [
      {
        id: 'reward',
        text: 'Vezmem si pásku.',
        effects: [
          { type: 'addItem', id: 'tape' },
          { type: 'flag', id: 'tapeGiven', value: true },
        ],
        next: 'reply',
        when: { not: { flag: 'tapeGiven' } },
      },
      { id: 'again', text: 'Povedz to ešte raz.', next: 'reply' },
      { id: 'bye', text: 'Už musím ísť.' },
    ],
  };
  await writeFile(
    source,
    JSON.stringify({
      ...project,
      startScene: 'animation-lab',
      dialogues: project.dialogues.map((d) =>
        d.id === 'animation-demo'
          ? {
              ...d,
              start: 'topics',
              nodes: [
                {
                  ...line,
                  id: 'topics',
                  text: 'Úvod sa nesmie prehrať.',
                  speech: voiced
                    ? { ...line.speech!, text: 'Úvod sa nesmie prehrať.' }
                    : undefined,
                  choices: [
                    { id: 'ask', text: 'Opýtať sa na kábel.', next: 'reply' },
                    {
                      id: 'hidden',
                      text: 'Tajná téma.',
                      next: 'reply',
                      when: { flag: 'powered' },
                    },
                    { id: 'bye', text: 'Odísť.' },
                  ],
                },
                line,
              ],
            }
          : d,
      ),
    }),
  );
}
async function burst(button: Locator) {
  await expect(button).toBeEnabled();
  await button.evaluate((el) => {
    for (let i = 0; i < 12; i++) (el as HTMLButtonElement).click();
  });
}

test('choices and voiced replies alternate, resist spam, pause, end naturally and close without leaving audio', async ({
  page,
  workspace,
}, testInfo) => {
  await seed(workspace.source);
  await page.goto(workspace.url);
  await ready(page);
  await (await object(page, 'Skúšobná postava')).click();
  const panel = page.locator('.dialogue-panel');
  await expect(panel).toHaveClass(/is-choosing/);
  await expect(panel.locator('audio')).toHaveCount(0);
  await expect(panel.locator('#dialogue-text')).toHaveCount(0);
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(panel).not.toContainText('Úvod sa nesmie prehrať');
  await expect(panel).not.toContainText('Tajná téma');
  await expect(
    page.getByRole('button', { name: 'Opýtať sa na kábel.', exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath('conversation-topics.png'),
  });
  await burst(
    page.getByRole('button', { name: 'Opýtať sa na kábel.', exact: true }),
  );
  await expect(panel).toHaveClass(/is-speaking/);
  await expect(panel.locator('.dialogue-choices')).toHaveCount(0);
  const audio = panel.locator('audio');
  await expect(audio).toHaveCount(1);
  await expect(audio).not.toHaveAttribute('controls');
  await expect(panel.locator('#dialogue-text')).toContainText('Ahoj.');
  await expect(
    page.getByRole('button', { name: 'Vezmem si pásku.', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Pozastaviť repliku', exact: true })
    .click();
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(true);
  const position = await audio.evaluate(
    (el) => (el as HTMLAudioElement).currentTime,
  );
  await page.waitForTimeout(150);
  expect(
    await audio.evaluate((el) => (el as HTMLAudioElement).currentTime),
  ).toBeCloseTo(position, 2);
  await page
    .getByRole('button', { name: 'Prehrať repliku', exact: true })
    .click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(true);
  await expect(panel).toHaveAttribute('inert', '');
  await page.screenshot({ path: testInfo.outputPath('styled-menu.png') });
  await page
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  // Natural audio completion, rather than a synthetic ended event, opens choices.
  const firstAudio = await audio.elementHandle();
  await audio.evaluate(async (el) => {
    const a = el as HTMLAudioElement;
    a.currentTime = a.duration - 0.15;
    await a.play();
  });
  await expect(panel).toHaveClass(/is-choosing/);
  await expect(panel.locator('audio')).toHaveCount(0);
  expect(
    await firstAudio!.evaluate((el) => (el as HTMLAudioElement).paused),
  ).toBe(true);
  await burst(
    page.getByRole('button', { name: 'Vezmem si pásku.', exact: true }),
  );
  await expect(panel).toHaveClass(/is-speaking/);
  await expect(
    page.getByRole('button', { name: 'Izolačná páska', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('conversation-subtitles.png'),
  });
  await burst(
    page.getByRole('button', { name: 'Preskočiť repliku', exact: true }),
  );
  await expect(panel).toHaveClass(/is-choosing/);
  await expect(
    page.getByRole('button', { name: 'Vezmem si pásku.', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Povedz to ešte raz.', exact: true })
    .click();
  await expect(panel).toHaveClass(/is-speaking/);
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime))
    .toBeLessThan(1);
  const lastAudio = await audio.elementHandle();
  await page
    .getByRole('button', { name: 'Ukončiť rozhovor', exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  expect(
    await lastAudio!.evaluate((el) => (el as HTMLAudioElement).paused),
  ).toBe(true);
  await (await object(page, 'Skúšobná postava')).click();
  await expect(panel).toHaveClass(/is-choosing/);
  await expect(panel.locator('audio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Odísť.', exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test('text-only replies wait for confirmation, preserve branches and remain usable on a small viewport', async ({
  page,
  workspace,
  isMobile,
}, testInfo) => {
  await seed(workspace.source, false);
  await page.setViewportSize(
    isMobile ? { width: 390, height: 740 } : { width: 780, height: 380 },
  );
  await page.goto(workspace.url);
  await ready(page);
  await (await object(page, 'Skúšobná postava')).click();
  await page
    .getByRole('button', { name: 'Opýtať sa na kábel.', exact: true })
    .click();
  const panel = page.locator('.dialogue-panel');
  await expect(panel.locator('.dialogue-choices')).toHaveCount(0);
  await expect(panel.locator('#dialogue-text')).toContainText('Oči a ústa');
  await expect(panel.locator('audio')).toHaveCount(0);
  await finishLine(page);
  await expect(
    page.getByRole('button', { name: 'Vezmem si pásku.', exact: true }),
  ).toBeEnabled();
  const game = await page.locator('.game-window').boundingBox(),
    box = await panel.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(game!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(game!.y + game!.height);
  await page.screenshot({
    path: testInfo.outputPath('small-conversation.png'),
  });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('missing voice audio keeps readable subtitles and a working skip path', async ({
  page,
  workspace,
}) => {
  await seed(workspace.source);
  await page.route('**/speech/animation-demo/audio.wav*', (route) =>
    route.request().resourceType() === 'media'
      ? route.abort()
      : route.continue(),
  );
  await page.goto(workspace.url);
  await ready(page);
  await (await object(page, 'Skúšobná postava')).click();
  await page
    .getByRole('button', { name: 'Opýtať sa na kábel.', exact: true })
    .click();
  const panel = page.locator('.dialogue-panel');
  await expect(panel).toContainText('Dabing sa nepodarilo prehrať');
  await expect(panel.locator('#dialogue-text')).toContainText('Oči a ústa');
  await finishLine(page);
  await expect(
    page.getByRole('button', { name: 'Povedz to ešte raz.', exact: true }),
  ).toBeVisible();
});
