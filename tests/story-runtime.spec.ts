import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { test, openEditor } from './editorFixture';
import { ready, hudClick, object } from './helpers';
import type { GameContent } from '../src/game/types';
import { SAVE_KEY } from '../src/game/storage';

async function seed(source: string) {
  const project = JSON.parse(await readFile(source, 'utf8')) as GameContent;
  const start = project.scenes[0]!;
  const content: GameContent = {
    ...project,
    startScene: start.id,
    startDialogue: 'opening',
    flags: [...project.flags, 'ending-test'],
    endings: [
      {
        id: 'good',
        when: { flag: 'ending-test' },
        title: 'Svetlo pre dedinu',
        text: 'Spolu sme to zvládli.',
        ambient: 'ambience/ending.wav',
      },
    ],
    dialogues: [
      ...project.dialogues,
      {
        id: 'opening',
        entry: 'speech',
        start: 'hi',
        nodes: [
          { id: 'hi', speaker: 'Fero', text: 'Kábel sa stratil.', choices: [] },
        ],
      },
    ],
    scenes: project.scenes.map((s) =>
      s.id !== start.id
        ? s
        : {
            ...s,
            ambient: 'ambience/village.wav',
            hotspots: [
              {
                id: 'finish',
                label: 'Zapojiť kábel',
                bounds: { x: 450, y: 200, width: 300, height: 300 },
                onClick: [
                  {
                    effects: [{ type: 'flag', id: 'ending-test', value: true }],
                  },
                ],
              },
            ],
          },
    ),
  };
  await writeFile(source, JSON.stringify(content));
}

test('opening, epilogue, manual save/load and new game stay inside the game window', async ({
  page,
  workspace,
}) => {
  await seed(workspace.source);
  await page.goto(workspace.url);
  await ready(page);
  const opening = page.getByRole('button', {
    name: 'Dokončiť repliku',
    exact: true,
  });
  await expect(opening).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Objekty', exact: true }),
  ).toHaveCount(0);
  await opening.click();
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  await page.getByRole('button', { name: 'Uložiť hru', exact: true }).click();
  const beforeFinale = await page.evaluate(
    (key) => localStorage.getItem(key),
    SAVE_KEY,
  );
  await page
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  await (await object(page, 'Zapojiť kábel')).press('Enter');
  const epilogue = page.getByRole('dialog', {
    name: 'Svetlo pre dedinu',
    exact: true,
  });
  await expect(epilogue).toContainText('Spolu sme to zvládli.');
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
  await epilogue
    .getByRole('button', { name: 'Menu a uložené hry', exact: true })
    .click();
  await page.getByRole('button', { name: 'Uložiť hru', exact: true }).click();
  await page.reload();
  await ready(page);
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  await page.getByRole('button', { name: 'Načítať hru', exact: true }).click();
  await expect(epilogue).toBeVisible();
  // Loading an earlier save removes the derived ending and restores world input.
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value!), {
    key: SAVE_KEY,
    value: beforeFinale,
  });
  await epilogue
    .getByRole('button', { name: 'Menu a uložené hry', exact: true })
    .click();
  await page.getByRole('button', { name: 'Načítať hru', exact: true }).click();
  await page
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  await expect(epilogue).toHaveCount(0);
  await (await object(page, 'Zapojiť kábel')).press('Enter');
  await expect(epilogue).toBeVisible();
  await epilogue.getByRole('button', { name: 'Nová hra', exact: true }).click();
  await expect(epilogue).toHaveCount(0);
  await expect(opening).toBeEnabled();
});

test('ambience waits for a gesture, pauses with the menu and obeys the sound control', async ({
  page,
  workspace,
}) => {
  await seed(workspace.source);
  await page.addInitScript(() => {
    (window as unknown as { soundEvents: string[] }).soundEvents = [];
    HTMLMediaElement.prototype.play = function () {
      (window as unknown as { soundEvents: string[] }).soundEvents.push(
        `play:${this.src}`,
      );
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      (window as unknown as { soundEvents: string[] }).soundEvents.push(
        `pause:${this.src}`,
      );
    };
  });
  await page.goto(workspace.url);
  await ready(page);
  const events = () =>
    page.evaluate(
      () => (window as unknown as { soundEvents: string[] }).soundEvents,
    );
  expect((await events()).filter((e) => e.startsWith('play:'))).toEqual([]);
  await page
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  await expect
    .poll(async () =>
      (await events()).some(
        (e) => e.startsWith('play:') && e.includes('village.wav'),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await events()).at(-1)).toContain('pause:');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await events()).at(-1)).toContain('play:');
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  await expect.poll(async () => (await events()).at(-1)).toContain('pause:');
  const toggle = page.getByRole('button', {
    name: 'Zvuk prostredia: zapnutý',
    exact: true,
  });
  await toggle.click();
  await expect(
    page.getByRole('button', { name: 'Zvuk prostredia: vypnutý', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  const played = (await events()).filter((e) => e.startsWith('play:')).length;
  await page
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  expect((await events()).filter((e) => e.startsWith('play:')).length).toBe(
    played,
  );
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  await page
    .getByRole('button', { name: 'Zvuk prostredia: vypnutý', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  await expect.poll(async () => (await events()).at(-1)).toContain('play:');
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect.poll(async () => (await events()).at(-1)).toContain('pause:');
});

test('Dev Mode previews another location without the opening while previewing the start preserves it', async ({
  page,
  workspace,
}) => {
  await seed(workspace.source);
  const source = await readFile(workspace.source, 'utf8');
  const content = JSON.parse(source) as GameContent;
  const target = content.scenes.find((scene) => scene.id === 'courtyard')!;
  const sign = target.hotspots.find((hotspot) => hotspot.id === 'sign')!;
  await openEditor(page, workspace.url);
  await page
    .getByLabel('Aktivní lokace', { exact: true })
    .selectOption(target.id);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await expect(page.locator('.scene-frame')).toHaveAttribute(
    'aria-label',
    `Lokácia: ${target.title}`,
  );
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Objekty', exact: true }),
  ).toHaveCount(0);
  await (await object(page, sign.label)).press('Enter');
  await expect(page.getByRole('status', { name: 'Reakcia' })).toHaveText(
    sign.onClick[0]!.message!,
  );
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page
    .getByLabel('Aktivní lokace', { exact: true })
    .selectOption(content.startScene);
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('dialog', { name: 'Rozhovor' })).toContainText(
    'Kábel sa stratil.',
  );
  await expect(
    page.getByRole('button', { name: 'Objekty', exact: true }),
  ).toHaveCount(0);
  expect(await readFile(workspace.source, 'utf8')).toBe(source);
});

test('interrupting a one-shot sound releases its source and listeners without waiting for ended', async ({
  page,
  workspace,
}) => {
  await seed(workspace.source);
  const content = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...content,
      items: [
        ...content.items,
        {
          id: 'audio-token-one',
          label: 'Prvá minca',
          description: 'Na skúšku zvuku.',
          icon: '●',
        },
        {
          id: 'audio-token-two',
          label: 'Druhá minca',
          description: 'Na skúšku zvuku.',
          icon: '●',
        },
      ],
      scenes: content.scenes.map((scene) =>
        scene.id !== content.startScene
          ? scene
          : {
              ...scene,
              hotspots: [
                ...scene.hotspots,
                ...['one', 'two'].map((id, index) => ({
                  id: `take-${id}`,
                  label: `Vziať mincu ${index + 1}`,
                  bounds: {
                    x: 100 + index * 150,
                    y: 100,
                    width: 100,
                    height: 100,
                  },
                  onClick: [
                    {
                      effects: [
                        { type: 'addItem' as const, id: `audio-token-${id}` },
                      ],
                    },
                  ],
                })),
              ],
            },
      ),
    }),
  );
  await page.addInitScript(() => {
    const scope = window as unknown as { playedSounds: HTMLMediaElement[] };
    scope.playedSounds = [];
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (
      type,
      callback,
      options,
    ) {
      if (
        this instanceof HTMLMediaElement &&
        (type === 'ended' || type === 'error')
      )
        this.dataset[`${type}Listeners`] = String(
          Number(this.dataset[`${type}Listeners`] ?? 0) + 1,
        );
      add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (
      type,
      callback,
      options,
    ) {
      if (
        this instanceof HTMLMediaElement &&
        (type === 'ended' || type === 'error')
      )
        this.dataset[`${type}Listeners`] = String(
          Number(this.dataset[`${type}Listeners`] ?? 0) - 1,
        );
      remove.call(this, type, callback, options);
    };
    HTMLMediaElement.prototype.play = function () {
      if (!scope.playedSounds.includes(this)) scope.playedSounds.push(this);
      this.dataset.playCount = String(Number(this.dataset.playCount ?? 0) + 1);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.pauseCount = String(
        Number(this.dataset.pauseCount ?? 0) + 1,
      );
    };
    HTMLMediaElement.prototype.load = function () {
      this.dataset.loadCount = String(Number(this.dataset.loadCount ?? 0) + 1);
    };
  });
  await page.goto(workspace.url);
  await ready(page);
  await page
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  for (const [index, interrupt] of ['menu', 'visibility'].entries()) {
    await (await object(page, `Vziať mincu ${index + 1}`)).press('Enter');
    const sound = await page.evaluateHandle(() =>
      (window as unknown as { playedSounds: HTMLMediaElement[] }).playedSounds
        .filter((audio) => audio.src.includes('pickup.wav'))
        .at(-1)!,
    );
    await expect
      .poll(() => sound.evaluate((audio) => audio.getAttribute('src')))
      .toContain('pickup.wav');
    expect(
      await sound.evaluate((audio) => [
        audio.dataset.endedListeners,
        audio.dataset.errorListeners,
      ]),
    ).toEqual(['1', '1']);
    if (interrupt === 'menu')
      await hudClick(
        page,
        page.getByRole('button', { name: 'Menu', exact: true }),
      );
    else
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    await expect
      .poll(() => sound.evaluate((audio) => audio.getAttribute('src')))
      .toBeNull();
    expect(
      await sound.evaluate((audio) => [
        audio.dataset.endedListeners,
        audio.dataset.errorListeners,
      ]),
    ).toEqual(['0', '0']);
    expect(
      await sound.evaluate((audio) => Number(audio.dataset.pauseCount)),
    ).toBe(1);
    expect(
      await sound.evaluate((audio) => Number(audio.dataset.loadCount)),
    ).toBe(1);
    // Source reset can generate late events. Released sounds must have no
    // remaining callbacks, and repeated pauses must not visit retained sounds.
    await sound.evaluate((audio) => {
      audio.dispatchEvent(new Event('ended'));
      audio.dispatchEvent(new Event('error'));
    });
    expect(
      await sound.evaluate((audio) => Number(audio.dataset.loadCount)),
    ).toBe(1);
    if (interrupt === 'menu')
      await page
        .getByRole('button', { name: 'Pokračovať v hre', exact: true })
        .click();
    else
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => false,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    await hudClick(
      page,
      page.getByRole('button', { name: 'Menu', exact: true }),
    );
    expect(
      await sound.evaluate((audio) => Number(audio.dataset.pauseCount)),
    ).toBe(1);
    expect(
      await sound.evaluate((audio) => Number(audio.dataset.loadCount)),
    ).toBe(1);
    await page
      .getByRole('button', { name: 'Pokračovať v hre', exact: true })
      .click();
    await sound.dispose();
  }
  expect(
    await page.evaluate(() =>
      (window as unknown as { playedSounds: HTMLMediaElement[] }).playedSounds
        .find((audio) => audio.loop)!
        .getAttribute('src'),
    ),
  ).toContain('village.wav');
});
