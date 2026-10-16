import { expect, type Locator, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test as base, openEditor } from './editorFixture';
import { ready, object } from './helpers';
import type { GameContent } from '../src/game/types';

const test = base.extend<{
  speechMock: { bin: string; requests: { url: string; body: unknown }[] };
}>({
  speechMock: async ({ browserName }, use) => {
    const root = await mkdtemp(
      path.join(tmpdir(), `tukabel-speech-provider-${browserName}-`),
    );
    const bin = path.join(root, 'rhubarb');
    const track = {
      metadata: { duration: 4 },
      mouthCues: [
        { start: 0, end: 0.7, value: 'X' },
        { start: 0.7, end: 1.4, value: 'D' },
        { start: 1.4, end: 2, value: 'B' },
        { start: 2, end: 2.6, value: 'X' },
        { start: 2.6, end: 3.5, value: 'D' },
        { start: 3.5, end: 4, value: 'X' },
      ],
    };
    await writeFile(
      bin,
      `#!${process.execPath}\nprocess.stdout.write(process.argv.includes('--version')?'Rhubarb mock':${JSON.stringify(JSON.stringify(track))});\n`,
      { mode: 0o755 },
    );
    try {
      await use({ bin, requests: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  speechTools: async ({ speechMock }, use) => {
    await use({
      apiKey: 'private-test-key-never-client',
      rhubarbBin: speechMock.bin,
      fetch: async (url, init) => {
        speechMock.requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (String(url).includes('/text-to-speech/'))
          return new Response(new Uint8Array(4 * 22050 * 2), { status: 200 });
        return new Response(
          JSON.stringify(
            String(url).includes('/voices')
              ? { voices: [{ voice_id: 'mock-voice', name: 'Skúšobný hlas' }] }
              : [
                  {
                    model_id: 'eleven_multilingual_v2',
                    name: 'Multilingual v2',
                    can_do_text_to_speech: true,
                    can_use_style: true,
                    can_use_speaker_boost: true,
                    languages: [{ language_id: 'sk' }],
                  },
                ],
          ),
        );
      },
    });
  },
});
async function studio(page: Page, url: string) {
  await openEditor(page, url);
  await page.getByRole('button', { name: 'Animácie', exact: true }).click();
  await page
    .getByLabel('Animovaná postava', { exact: true })
    .selectOption(JSON.stringify(['animation-lab', 'blink-character']));
}
async function save(page: Page) {
  await page
    .getByRole('button', { name: 'Uložiť do projektu', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav editora' }),
  ).toContainText('Uložené do');
}
async function audioAt(audio: Locator, seconds: number) {
  await audio.evaluate(async (el, t) => {
    const a = el as HTMLAudioElement;
    await a.play();
    a.pause();
    a.currentTime = t;
  }, seconds);
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime))
    .toBeCloseTo(seconds, 1);
}

test('studio explicitly generates, analyzes, previews, saves and reloads speech without exposing provider credentials', async ({
  page,
  workspace,
  speechMock,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await studio(page, workspace.url);
  await page.locator('.voice-settings summary').click();
  await page
    .getByRole('button', { name: 'Načítať hlasy a modely', exact: true })
    .click();
  await expect(page.locator('.voice-settings')).toContainText('Hlasy načítané');
  await page
    .getByLabel('ElevenLabs Voice ID', { exact: true })
    .fill('mock-voice');
  await page
    .getByRole('button', { name: 'Dabing a lip-sync', exact: true })
    .click();
  const generate = page.getByRole('button', {
    name: 'Vygenerovať dabing ElevenLabs',
    exact: true,
  });
  await expect(generate).toBeDisabled();
  expect(
    speechMock.requests.filter((r) => r.url.includes('/text-to-speech/')),
  ).toHaveLength(0);
  await page
    .getByLabel('Text dabovanej repliky', { exact: true })
    .fill('Skúšam nový dabing.');
  await expect(page.getByRole('alert')).toContainText('Text sa zmenil');
  await page
    .getByLabel('Potvrdzujem platené generovanie tejto repliky', {
      exact: true,
    })
    .check();
  await generate.click();
  await expect(
    page.getByRole('status', { name: 'Stav dabingu' }),
  ).toContainText('Hotovo');
  expect(
    speechMock.requests.filter((r) => r.url.includes('/text-to-speech/')),
  ).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Analyzovať Rhubarb', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav dabingu' }),
  ).toContainText('Hotovo');
  await expect(page.locator('.speech-studio')).toContainText(
    'track.lipsync.json',
  );
  await page.getByLabel('Tvar úst D', { exact: true }).selectOption('2');
  const audio = page.locator('.speech-studio audio');
  await audioAt(audio, 0.9);
  await page
    .getByLabel('Priblíženie postavy', { exact: true })
    .selectOption('4');
  await expect(page.locator('.character-preview-canvas canvas')).toHaveCount(1);
  await audio.evaluate((el) => void (el as HTMLAudioElement).play());
  await page
    .getByRole('button', { name: 'Pozastaviť kombináciu', exact: true })
    .click();
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(true);
  await page
    .getByRole('button', { name: 'Prehrať kombináciu', exact: true })
    .click();
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(false);
  await save(page);
  const disk = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const node = disk.dialogues.find((d) => d.id === 'animation-demo')!.nodes[0]!;
  expect(node.speech?.text).toBe(node.text);
  expect(
    (
      await readFile(
        path.join(workspace.root, 'src/assets', node.speech!.audio),
      )
    )
      .subarray(0, 4)
      .toString(),
  ).toBe('RIFF');
  expect(
    JSON.parse(
      await readFile(
        path.join(workspace.root, 'src/assets', node.speech!.lipSync!),
        'utf8',
      ),
    ).mouthCues[1].value,
  ).toBe('D');
  expect(await page.content()).not.toContain('private-test-key-never-client');
  expect(await readFile(workspace.source, 'utf8')).not.toContain(
    'private-test-key-never-client',
  );
  await page.screenshot({ path: testInfo.outputPath('speech-studio.png') });
  await page.reload();
  await ready(page);
  await studio(page, workspace.url);
  await page
    .getByRole('button', { name: 'Dabing a lip-sync', exact: true })
    .click();
  await expect(
    page.getByLabel('Text dabovanej repliky', { exact: true }),
  ).toHaveValue('Skúšam nový dabing.');
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await (await object(page, 'Skúšobná postava')).click();
  await expect(page.getByRole('dialog')).toContainText('Skúšam nový dabing');
  const gameAudio = page.locator('.dialogue-panel audio');
  await audioAt(gameAudio, 0.9);
  await gameAudio.evaluate((el) => void (el as HTMLAudioElement).play());
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect
    .poll(() => gameAudio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(true);
  const time = await gameAudio.evaluate(
    (el) => (el as HTMLAudioElement).currentTime,
  );
  await page.waitForTimeout(150);
  expect(
    await gameAudio.evaluate((el) => (el as HTMLAudioElement).currentTime),
  ).toBeCloseTo(time, 2);
  await page
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  await expect
    .poll(() => gameAudio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(false);
  await page
    .getByRole('button', { name: 'Preskočiť dabing', exact: true })
    .click();
  await expect
    .poll(() => gameAudio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(true);
  const oldAudio = await gameAudio.elementHandle();
  await page
    .getByRole('button', { name: 'Ukončiť rozhovor', exact: true })
    .click();
  await expect(page.locator('audio')).toHaveCount(0);
  expect(
    await oldAudio!.evaluate((el) => (el as HTMLAudioElement).paused),
  ).toBe(true);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Animácie', exact: true }).click();
  await page
    .getByRole('button', { name: 'Dabing a lip-sync', exact: true })
    .click();
  await page
    .getByLabel('Nahrať dabing WAV', { exact: true })
    .setInputFiles(
      path.join(workspace.root, 'src/assets/speech/animation-demo/audio.wav'),
    );
  await expect(
    page.getByRole('status', { name: 'Stav dabingu' }),
  ).toContainText('Hotovo');
  expect(
    speechMock.requests.filter((r) => r.url.includes('/text-to-speech/')),
  ).toHaveLength(1);
});

base(
  'real Slovak Rhubarb track drives mouth pixels independently of blinking, seek and dialogue lifetime',
  async ({ page, workspace }, testInfo) => {
    const project = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const actor = project.scenes
      .find((s) => s.id === 'animation-lab')!
      .hotspots.find((h) => h.id === 'blink-character')!;
    const configured = {
      ...project,
      startScene: 'animation-lab',
      dialogues: project.dialogues.map((d) =>
        d.id === 'animation-demo'
          ? {
              ...d,
              nodes: [
                {
                  ...d.nodes[0]!,
                  choices: [
                    { id: 'next', text: 'Ďalšia replika', next: 'second' },
                  ],
                },
                { ...d.nodes[0]!, id: 'second' },
              ],
            }
          : d,
      ),
      scenes: project.scenes.map((s) =>
        s.id === 'animation-lab'
          ? {
              ...s,
              hotspots: s.hotspots.map((h) =>
                h.id === actor.id
                  ? {
                      ...h,
                      animation: {
                        ...h.animation,
                        motion: undefined,
                        blinkIntervalMs: [100, 100],
                      },
                    }
                  : h,
              ),
            }
          : s,
      ),
    };
    await writeFile(workspace.source, JSON.stringify(configured));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(workspace.url);
    await ready(page);
    await (await object(page, actor.label)).click();
    const audio = page.locator('.dialogue-panel audio');
    await expect(audio).toHaveCount(1);
    await audioAt(audio, 0.1);
    const canvas = page.locator('canvas');
    const screenshot = () =>
      canvas.screenshot({
        style:
          '.dialogue-panel,.reaction,.scene-label,.scene-cursor{visibility:hidden!important}',
      });
    // A stationary audio playhead must hold the mouth while random eyes keep moving.
    const track = JSON.parse(
      await readFile(
        path.join(
          workspace.root,
          'src/assets/speech/animation-demo/track.lipsync.json',
        ),
        'utf8',
      ),
    );
    const open = track.mouthCues.find(
      (c: { value: string }) => c.value === 'D' || c.value === 'C',
    );
    await audioAt(audio, (open.start + open.end) / 2);
    await page.screenshot({
      path: testInfo.outputPath('real-slovak-speech.png'),
    });
    const original = await screenshot();
    await page.waitForTimeout(180);
    const another = await screenshot();

    // Isolate mouth and eye pixel areas using the same authored placement as Pixi.
    const { imagePlacement } = await import('../src/game/transforms');
    const placed = imagePlacement(
      actor.bounds,
      { width: 1086, height: 1448 },
      actor.imageFit,
    );
    const box = (await canvas.boundingBox())!,
      scale = Math.min(box.width / 1280, box.height / 720);
    const sharp = (await import('sharp')).default;
    async function patch(bytes: Buffer, id: string) {
      const r = project.animations!.find((c) => c.id === id)!.region!,
        meta = await sharp(bytes).metadata(),
        ratio = meta.width! / box.width;
      return sharp(bytes)
        .extract({
          left: Math.round(
            ((box.width - 1280 * scale) / 2 +
              (placed.x + (r.x / 1086) * placed.width) * scale) *
              ratio,
          ),
          top: Math.round(
            ((box.height - 720 * scale) / 2 +
              (placed.y + (r.y / 1448) * placed.height) * scale) *
              ratio,
          ),
          width: Math.max(
            1,
            Math.floor((r.width / 1086) * placed.width * scale * ratio),
          ),
          height: Math.max(
            1,
            Math.floor((r.height / 1448) * placed.height * scale * ratio),
          ),
        })
        .raw()
        .toBuffer();
    }
    const eyes = await patch(original, 'woman-blink');
    await expect
      .poll(
        async () =>
          !(await patch(await screenshot(), 'woman-blink')).equals(eyes),
        { intervals: [50] },
      )
      .toBe(true);
    const mouth = await patch(original, 'woman-talk');
    expect((await patch(another, 'woman-talk')).equals(mouth)).toBe(true);
    await audioAt(audio, 4.6);
    await expect
      .poll(
        async () =>
          !(await patch(await screenshot(), 'woman-talk')).equals(mouth),
      )
      .toBe(true);
    // Advancing a branch/end removes and stops the old audio immediately.
    await page
      .getByRole('button', { name: 'Ďalšia replika', exact: true })
      .click();
    await expect
      .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime))
      .toBeLessThan(0.5);
    const handle = await audio.elementHandle();
    await page
      .getByRole('button', { name: 'Ukončiť skúšku animácií.', exact: true })
      .click();
    await expect(page.locator('audio')).toHaveCount(0);
    expect(
      await handle!.evaluate((el) => (el as HTMLAudioElement).paused),
    ).toBe(true);
  },
);
