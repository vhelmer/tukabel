import { hudClick } from './helpers';
import { expect, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test, openEditor } from './editorFixture';
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
      {
        id: 'bye',
        text: 'Už musím ísť.',
        effects: [{ type: 'flag', id: 'powered', value: true }],
        message: 'Autorské ukončenie.',
      },
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

test('editor persists automatic speech entry; its opening line finishes into choices without replaying', async ({
  page,
  workspace,
}) => {
  await seed(workspace.source);
  await openEditor(page, workspace.url);
  await page.getByRole('button', { name: 'Dialogy', exact: true }).click();
  await page
    .getByLabel('Dialog', { exact: true })
    .selectOption('animation-demo');
  await page
    .getByLabel('Počáteční uzel', { exact: true })
    .selectOption('reply');
  await page
    .getByLabel('Začátek dialogu', { exact: true })
    .selectOption('speech');
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
  ).toContainText('Uložené do');
  const saved = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  expect(saved.dialogues.find((d) => d.id === 'animation-demo')).toMatchObject({
    entry: 'speech',
    start: 'reply',
  });
  await page.reload();
  await ready(page);
  await (await object(page, 'Skúšobná postava')).click();
  const panel = page.locator('.dialogue-panel');
  await expect(panel).toHaveClass(/is-speaking/);
  await expect(panel.locator('audio')).toHaveCount(1);
  await expect(panel.locator('.dialogue-choices')).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Porozprávať sa.', exact: true }),
  ).toHaveCount(0);
  await finishLine(page);
  await expect(
    panel.getByRole('button', { name: 'Vezmem si pásku.', exact: true }),
  ).toBeEnabled();
  await expect(panel.locator('audio')).toHaveCount(0);
  await panel
    .getByRole('button', { name: 'Už musím ísť.', exact: true })
    .click();
  await expect(panel).toHaveCount(0);
});

test('subtitle clicks finish voiced replies while authored choices control branching and exit', async ({
  page,
  workspace,
  isMobile,
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
  await expect(panel.locator('button')).toHaveCount(1);
  await expect(panel.locator('.dialogue-close,.speech-toggle')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveClass(/is-speaking/);
  await hudClick(page, page.getByRole('button', { name: /^Denník/ }));
  const journal = page.getByRole('dialog', {
    name: 'Denník úloh',
    exact: true,
  });
  await expect(journal).toBeVisible();
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(true);
  await expect(panel).toHaveAttribute('inert', '');
  const heldTime = await audio.evaluate(
    (el) => (el as HTMLAudioElement).currentTime,
  );
  await journal.screenshot({
    path: testInfo.outputPath('journal-pauses-speech.png'),
    animations: 'disabled',
  });
  expect(
    await audio.evaluate((el) => (el as HTMLAudioElement).currentTime),
  ).toBeCloseTo(heldTime, 2);
  await hudClick(page, journal.getByRole('button', { name: 'Zavrieť denník' }));
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(false);
  await expect(panel).toHaveClass(/is-speaking/);
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
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
    page.getByRole('button', { name: 'Dokončiť repliku', exact: true }),
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
  await finishLine(page, isMobile);
  await page
    .getByRole('button', { name: 'Už musím ísť.', exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Reakcia' })).toContainText(
    'Autorské ukončenie.',
  );
  expect(
    await lastAudio!.evaluate((el) => (el as HTMLAudioElement).paused),
  ).toBe(true);
  await (await object(page, 'Skúšobná postava')).click();
  await expect(panel).toHaveClass(/is-choosing/);
  await expect(panel.locator('audio')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Tajná téma.', exact: true }),
  ).toBeVisible();
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
  await finishLine(page, isMobile);
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
  await expect(panel).toHaveClass(/is-choosing/);
  await page
    .getByRole('button', { name: 'Už musím ísť.', exact: true })
    .click();
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
  await expect(panel).toContainText('Dabing nie je dostupný');
  await expect(panel.locator('#dialogue-text')).toContainText('Oči a ústa');
  await finishLine(page);
  await expect(
    page.getByRole('button', { name: 'Povedz to ešte raz.', exact: true }),
  ).toBeVisible();
});

test('rapid subtitle taps and held keys cannot skip into another branch', async ({
  page,
  workspace,
  isMobile,
}) => {
  await seed(workspace.source);
  await page.goto(workspace.url);
  await ready(page);
  await (await object(page, 'Skúšobná postava')).click();
  await page
    .getByRole('button', { name: 'Opýtať sa na kábel.', exact: true })
    .click();
  const panel = page.locator('.dialogue-panel'),
    caption = panel.getByRole('button', {
      name: 'Dokončiť repliku',
      exact: true,
    });
  const oldAudio = await panel.locator('audio').elementHandle();
  await finishLine(page, isMobile);
  const reward = page.getByRole('button', {
    name: 'Vezmem si pásku.',
    exact: true,
  });
  const box = (await reward.boundingBox())!;
  // Keep tapping longer than the initial lock: no tail tap may select a choice.
  for (let i = 0; i < 8; i++) {
    if (isMobile)
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
        clickCount: i + 2,
      });
    await page.waitForTimeout(80);
  }
  await expect(panel).toHaveClass(/is-choosing/);
  await expect(panel.locator('audio')).toHaveCount(0);
  expect(
    await oldAudio!.evaluate((el) => (el as HTMLAudioElement).paused),
  ).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Izolačná páska', exact: true }),
  ).toHaveCount(0);
  await expect(reward).toBeEnabled();
  if (isMobile) await reward.tap();
  else await reward.click();
  await expect(panel).toHaveClass(/is-speaking/);
  await expect(caption).toBeEnabled();
  await caption.focus();
  await page.keyboard.down('Enter');
  await expect(panel).toHaveClass(/is-choosing/);
  await expect(
    page.getByRole('button', { name: 'Povedz to ešte raz.', exact: true }),
  ).toBeEnabled();
  await page.keyboard.down('Enter'); // repeat=true while the key remains held
  await page.keyboard.up('Enter');
  await expect(panel).toHaveClass(/is-choosing/);
  await expect(panel.locator('audio')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Povedz to ešte raz.', exact: true })
    .click();
  await expect(caption).toBeEnabled();
  await caption.focus();
  await page.keyboard.press('Space');
  await expect(panel).toHaveClass(/is-choosing/);
  await page
    .getByRole('button', { name: 'Už musím ísť.', exact: true })
    .click();
  await expect(panel).toHaveCount(0);
});

test('a reply with no available choices finishes without an injected close control', async ({
  page,
  workspace,
}) => {
  await seed(workspace.source, false);
  const project = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...project,
      dialogues: project.dialogues.map((d) =>
        d.id === 'animation-demo'
          ? {
              ...d,
              nodes: d.nodes.map((n) =>
                n.id === 'reply'
                  ? {
                      ...n,
                      choices: [
                        {
                          id: 'hidden',
                          text: 'Skrytá voľba.',
                          when: { flag: 'powered' },
                        },
                      ],
                    }
                  : n,
              ),
            }
          : d,
      ),
    }),
  );
  await page.goto(workspace.url);
  await ready(page);
  await (await object(page, 'Skúšobná postava')).click();
  await page
    .getByRole('button', { name: 'Opýtať sa na kábel.', exact: true })
    .click();
  await burst(
    page.getByRole('button', { name: 'Dokončiť repliku', exact: true }),
  );
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
});
