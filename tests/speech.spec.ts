import { pointInScene } from './helpers';
import { hudClick } from './helpers';
import { expect, type Locator, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test as base, stopTest, openEditor } from './editorFixture';
import { ready, object, finishLine } from './helpers';
import type { GameContent, LipSyncTrack } from '../src/game/types';
import { mouthFrame } from '../src/game/speech';
import { imagePlacement } from '../src/game/transforms';

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
        if (init?.method === 'DELETE') return Response.json({ status: 'ok' });
        if (String(url).includes('/text-to-voice/design')) {
          const frame = Buffer.alloc(417);
          frame.set([0xff, 0xfb, 0x90, 0x64]);
          return Response.json({
            previews: [0, 1, 2].map((index) => ({
              audio_base_64: Buffer.concat([frame, frame]).toString('base64'),
              generated_voice_id: `generated-character-${index}`,
              duration_secs: 1,
              media_type: 'audio/mpeg',
            })),
          });
        }
        if (String(url).endsWith('/text-to-voice'))
          return Response.json({ voice_id: 'saved-designed-character' });
        if (String(url).includes('/text-to-speech/')) {
          const text = String(JSON.parse(String(init?.body)).text),
            characters = [...text];
          const pivot = text.indexOf('Druhá');
          const duration = pivot > 0 ? 15 : 4;
          const pcm = Buffer.alloc(duration * 22050 * 2);
          for (let i = 0; i < pcm.length / 2; i++)
            pcm.writeInt16LE(Math.round(Math.sin(i * 0.13) * 4000), i * 2);
          const starts = characters.map((_, i) =>
            pivot > 0
              ? i < pivot
                ? (i / pivot) * 3
                : 8 + ((i - pivot) / (characters.length - pivot)) * 6
              : (i / characters.length) * 3.5,
          );
          return Response.json({
            audio_base64: pcm.toString('base64'),
            alignment: {
              characters,
              character_start_times_seconds: starts,
              character_end_times_seconds: starts.map((t) => t + 0.01),
            },
          });
        }
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
                  {
                    model_id: 'eleven_v3',
                    name: 'Eleven v3',
                    can_do_text_to_speech: true,
                    can_use_style: false,
                    can_use_speaker_boost: false,
                    languages: [{ language_id: 'sk' }],
                  },
                  {
                    model_id: 'eleven_v4',
                    name: 'Eleven v4',
                    can_do_text_to_speech: true,
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
  await page.getByRole('button', { name: 'Animace', exact: true }).click();
  await page
    .getByLabel('Animovaná postava', { exact: true })
    .selectOption(JSON.stringify(['animation-lab', 'blink-character']));
}
async function save(page: Page) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith('/__tukabel/editor/project'),
  );
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  expect((await saved).ok()).toBe(true);
  await expect(
    page.getByRole('status', { name: 'Stav editoru' }),
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

stopTest(
  'bus stop recorded voices drive mapped mouth poses while eyes blink independently; skip and natural completion stop audio',
  async ({ page, workspace }, info) => {
    base.setTimeout(60000);
    const project = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const scene = project.scenes.find((s) => s.id === 'scene1')!;
    await writeFile(
      workspace.source,
      JSON.stringify({
        ...project,
        startScene: scene.id,
        scenes: project.scenes.map((s) =>
          s.id === scene.id
            ? {
                ...s,
                hotspots: s.hotspots.map((h) =>
                  ['layer1', 'layer2'].includes(h.id)
                    ? {
                        ...h,
                        animation: {
                          ...h.animation,
                          motion: undefined,
                          blinkIntervalMs: [120, 120],
                        },
                      }
                    : h,
                ),
              }
            : s,
        ),
      }),
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const sharp = (await import('sharp')).default;
    for (const [actorId, dialogueId, nodeId, topic] of [
      ['layer2', 'stop-cigy', 'iron', 'Čo vláčiš v tom batohu?'],
      ['layer1', 'stop-granny', 'bag', 'Čo máte v tej taške?'],
    ]) {
      const actor = scene.hotspots.find((h) => h.id === actorId)!;
      const binding = actor.animation!;
      const node = project.dialogues
        .find((d) => d.id === dialogueId)!
        .nodes.find((n) => n.id === nodeId)!;
      expect(node.speech?.text).toBe(node.text);
      const track = JSON.parse(
        await readFile(
          path.join(workspace.root, 'src/assets', node.speech!.lipSync!),
          'utf8',
        ),
      ) as LipSyncTrack;
      const closed = track.mouthCues.find(
        (c) => c.value === 'A' || c.value === 'X',
      )!;
      const open = track.mouthCues.find(
        (c) =>
          mouthFrame(binding, c.value) !== mouthFrame(binding, closed.value),
      )!;
      expect(closed).toBeDefined();
      expect(open).toBeDefined();
      expect(binding.mouthShapes?.X).toBe(4);
      expect(binding.mouthShapes?.A).toBe(4);
      await page.goto(workspace.url);
      await ready(page);
      await (await object(page, actor.label)).press('Enter');
      const timingLoaded = page.waitForResponse((response) =>
        response.url().includes(node.speech!.lipSync!),
      );
      await page.getByRole('button', { name: topic, exact: true }).click();
      await (await timingLoaded).body();
      const panel = page.locator('.dialogue-panel'),
        audio = panel.locator('audio');
      await expect(audio).toHaveCount(1);
      await expect(audio).toHaveAttribute('src', /\.wav/);
      await expect(panel.locator('.dialogue-choices')).toHaveCount(0);
      await audioAt(audio, (open.start + open.end) / 2);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const canvas = page.locator('canvas');
      const screenshot = () =>
        canvas.screenshot({
          style:
            '.dialogue-panel,.reaction,.scene-label,.scene-cursor{visibility:hidden!important}',
        });
      const size = await sharp(
        path.join(workspace.root, 'src/assets', actor.image!),
      ).metadata();
      const placed = imagePlacement(
        actor.bounds,
        { width: size.width!, height: size.height! },
        actor.imageFit,
      );
      const box = (await canvas.boundingBox())!;
      const origin = await pointInScene(page, 0, 0),
        edge = await pointInScene(page, 1280, 720);
      const scale = (edge.x - origin.x) / 1280;
      async function patch(bytes: Buffer, clipId: string) {
        const authored = project.animations!.find(
          (c) => c.id === clipId,
        )!.region!;
        // Cigy's eye/mouth regions are one source pixel apart. At mobile
        // scales, bilinear sampling mixes their boundary pixels; compare the
        // mouth interior so blinking cannot contaminate the held-pose check.
        const inset = clipId === binding.talk ? 3 : 0;
        const region = {
          x: authored.x + inset,
          y: authored.y + inset,
          width: authored.width - inset * 2,
          height: authored.height - inset * 2,
        };
        const ratio = (await sharp(bytes).metadata()).width! / box.width;
        return sharp(bytes)
          .extract({
            left: Math.round(
              (origin.x -
                box.x +
                (placed.x + (region.x / size.width!) * placed.width) * scale) *
                ratio,
            ),
            top: Math.round(
              (origin.y -
                box.y +
                (placed.y + (region.y / size.height!) * placed.height) *
                  scale) *
                ratio,
            ),
            width: Math.max(
              1,
              Math.floor(
                (region.width / size.width!) * placed.width * scale * ratio,
              ),
            ),
            height: Math.max(
              1,
              Math.floor(
                (region.height / size.height!) * placed.height * scale * ratio,
              ),
            ),
          })
          .raw()
          .toBuffer();
      }
      const still = await screenshot(),
        mouth = await patch(still, binding.talk!),
        eyes = await patch(still, binding.blink!);
      await sharp(still)
        .png()
        .toFile(info.outputPath(`${dialogueId}-paused-baseline.png`));
      await expect
        .poll(
          async () =>
            !(await patch(await screenshot(), binding.blink!)).equals(eyes),
          { intervals: [50] },
        )
        .toBe(true);
      expect(
        (await patch(await screenshot(), binding.talk!)).equals(mouth),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${dialogueId}-recorded-lipsync.png`),
      });
      await audioAt(audio, (closed.start + closed.end) / 2);
      await expect
        .poll(
          async () =>
            !(await patch(await screenshot(), binding.talk!)).equals(mouth),
        )
        .toBe(true);
      const handle = await audio.elementHandle();
      if (actorId === 'layer2') await finishLine(page);
      else {
        await audioAt(audio, track.metadata.duration - 0.1);
        await audio.evaluate((el) => (el as HTMLAudioElement).play());
        await expect(panel).toHaveClass(/is-choosing/);
      }
      await expect(panel.locator('.dialogue-choices')).toBeVisible();
      await expect(audio).toHaveCount(0);
      expect(
        await handle!.evaluate((el) => (el as HTMLAudioElement).paused),
      ).toBe(true);
    }
  },
);

test('Voice Design archives three previews and saves only the selected custom voice with persistent provenance', async ({
  page,
  workspace,
  speechMock,
}) => {
  test.setTimeout(90000);
  await studio(page, workspace.url);
  await page.getByText('Voice Design · nový charakterový hlas').click();
  const generate = page.getByRole('button', {
    name: 'Vygenerovat 3 ukázky (čerpá kredity)',
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await page
    .getByLabel('Popis hlasu (20–1000 znaků)', { exact: true })
    .fill(
      'An extremely gravelly, roaring Slovak cartoon character with clear words.',
    );
  expect(speechMock.requests).toHaveLength(0);
  await generate.click();
  const design = page.locator('.voice-design');
  await expect(design.locator('audio')).toHaveCount(3);
  expect(
    speechMock.requests.filter((r) => r.url.includes('/text-to-voice/design')),
  ).toHaveLength(1);
  expect(
    speechMock.requests.filter((r) => r.url.endsWith('/text-to-voice')),
  ).toHaveLength(0);
  const previewUrl = await design.locator('audio').nth(1).getAttribute('src');
  expect((await page.request.get(previewUrl!)).ok()).toBe(true);
  await design.getByLabel('Ukázka 2', { exact: true }).check();
  await design.getByLabel('Název uloženého hlasu').fill('TUKABEL · drsný hlas');
  const register = design.getByRole('button', {
    name: 'Uložit vybraný hlas a přiřadit do návrhu',
    exact: true,
  });
  await register.click();
  await expect(register).toBeDisabled();
  await expect(page.getByLabel('ElevenLabs Voice ID')).toHaveValue(
    'saved-designed-character',
  );
  const registrations = speechMock.requests.filter((r) =>
    r.url.endsWith('/text-to-voice'),
  );
  expect(registrations).toHaveLength(1);
  expect(registrations[0]!.body).toMatchObject({
    generated_voice_id: 'generated-character-1',
  });
  await save(page);
  const disk = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const voice = disk.scenes
    .find((s) => s.id === 'animation-lab')!
    .hotspots.find((h) => h.id === 'blink-character')!.animation!.voice!;
  expect(voice.voiceId).toBe('saved-designed-character');
  expect(voice.designRegistration).toMatch(
    /^speech\/[\w-]+\/registration\.json$/,
  );
  const archive = JSON.parse(
    await readFile(
      path.join(workspace.root, 'src/assets', voice.designRegistration!),
      'utf8',
    ),
  );
  expect(archive.voiceId).toBe(voice.voiceId);
  expect(archive.previewIndex).toBe(1);
  await page.reload();
  await studio(page, workspace.url);
  await expect(page.getByLabel('ElevenLabs Voice ID')).toHaveValue(
    voice.voiceId,
  );
  expect(
    speechMock.requests.filter((r) => r.url.includes('/text-to-voice/design')),
  ).toHaveLength(1);
  await page.getByText('Hlas ElevenLabs', { exact: true }).click();
  await expect(page.getByLabel('Správa hlasového slotu')).toHaveValue(
    'rotating',
  );
  await page
    .getByRole('button', { name: 'Dabing a lip-sync', exact: true })
    .click();
  await page
    .getByLabel('Potvrzuji placené generování této repliky', { exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Vygenerovat dabing ElevenLabs', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav dabingu' }),
  ).toContainText('Hotovo');
  await page
    .getByRole('button', { name: 'Analyzovat Rhubarb', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav dabingu' }),
  ).toContainText('Hotovo');
  await save(page);
  const release = page.getByRole('button', {
    name: 'Ověřit dabing a uvolnit rotační hlas (smaže z účtu)',
    exact: true,
  });
  await release.click();
  await expect(
    page.getByText('Hlas byl uvolněn z účtu.', { exact: false }),
  ).toBeVisible();
  expect(
    speechMock.requests.filter((r) =>
      r.url.endsWith('/v1/voices/saved-designed-character'),
    ),
  ).toHaveLength(1);
  await expect(
    page.getByRole('button', {
      name: 'Vygenerovat dabing ElevenLabs',
      exact: true,
    }),
  ).toBeDisabled();
  await save(page);
  const retired = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const retiredVoice = retired.scenes
    .find((s) => s.id === 'animation-lab')!
    .hotspots.find((h) => h.id === 'blink-character')!.animation!.voice!;
  expect(retiredVoice.retired).toBe(true);
  const receipt = JSON.parse(
    await readFile(
      path.join(workspace.root, 'src/assets', retiredVoice.retirementManifest!),
      'utf8',
    ),
  );
  expect(receipt.operation).toBe('voice-retirement');
  expect(receipt.verifiedLines).toBe(1);
  expect(
    retired.dialogues.find((d) => d.id === 'animation-demo')!.nodes[0]!.speech
      ?.lipSync,
  ).toBeTruthy();
});

test('studio explicitly generates, analyzes, previews, saves and reloads speech without exposing provider credentials', async ({
  page,
  workspace,
  speechMock,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await studio(page, workspace.url);
  await page.getByText('Hlas ElevenLabs', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Načíst hlasy a modely', exact: true })
    .click();
  await expect(page.locator('.voice-settings')).toContainText('Hlasy načtené');
  await page
    .getByLabel('ElevenLabs Voice ID', { exact: true })
    .fill('mock-voice');
  await page
    .getByRole('button', { name: 'Dabing a lip-sync', exact: true })
    .click();
  const generate = page.getByRole('button', {
    name: 'Vygenerovat dabing ElevenLabs',
    exact: true,
  });
  await expect(generate).toBeDisabled();
  expect(
    speechMock.requests.filter((r) => r.url.includes('/text-to-speech/')),
  ).toHaveLength(0);
  await page
    .getByLabel('Text dabované repliky', { exact: true })
    .fill('Skúšam nový dabing.');
  await expect(page.getByRole('alert')).toContainText('Text se změnil');
  await page
    .getByLabel('Potvrzuji placené generování této repliky', {
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
    .getByRole('button', { name: 'Analyzovat Rhubarb', exact: true })
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
    .getByLabel('Přiblížení postavy', { exact: true })
    .selectOption('4');
  await expect(page.locator('.character-preview-canvas canvas')).toHaveCount(1);
  await audio.evaluate((el) => void (el as HTMLAudioElement).play());
  await page
    .getByRole('button', { name: 'Pozastavit kombinaci', exact: true })
    .click();
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(true);
  await page
    .getByRole('button', { name: 'Přehrát kombinaci', exact: true })
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
    page.getByLabel('Text dabované repliky', { exact: true }),
  ).toHaveValue('Skúšam nový dabing.');
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await (await object(page, 'Skúšobná postava')).press('Enter');
  await page
    .getByRole('button', { name: 'Porozprávať sa.', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Skúšam nový dabing');
  const gameAudio = page.locator('.dialogue-panel audio');
  await audioAt(gameAudio, 0.9);
  await gameAudio.evaluate((el) => void (el as HTMLAudioElement).play());
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
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
  const oldAudio = await gameAudio.elementHandle();
  await finishLine(page);
  await page
    .getByRole('button', { name: 'Ukončiť skúšku animácií.', exact: true })
    .click();
  await expect(page.locator('audio')).toHaveCount(0);
  expect(
    await oldAudio!.evaluate((el) => (el as HTMLAudioElement).paused),
  ).toBe(true);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Animace', exact: true }).click();
  await page
    .getByRole('button', { name: 'Dabing a lip-sync', exact: true })
    .click();
  await page
    .getByLabel('Nahrát dabing WAV', { exact: true })
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
    const demoText = 'Ahoj. Mrkám a rozprávam. Oči a ústa fungujú nezávisle.';
    const demoSpeech = {
      text: demoText,
      audio: 'speech/animation-demo/audio.wav',
      lipSync: 'speech/animation-demo/track.lipsync.json',
    };
    const configured = {
      ...project,
      startScene: 'animation-lab',
      dialogues: project.dialogues.map((d) =>
        d.id === 'animation-demo'
          ? {
              ...d,
              start: 'topics',
              nodes: [
                {
                  id: 'topics',
                  speaker: 'Test',
                  text: 'Vyber skúšku.',
                  choices: [
                    {
                      id: 'begin',
                      text: 'Spustiť skúšobnú repliku.',
                      next: d.nodes[0]!.id,
                    },
                  ],
                },
                {
                  ...d.nodes[0]!,
                  text: demoText,
                  speech: demoSpeech,
                  choices: [
                    { id: 'next', text: 'Ďalšia replika', next: 'second' },
                  ],
                },
                {
                  ...d.nodes[0]!,
                  text: demoText,
                  speech: demoSpeech,
                  id: 'second',
                },
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
    await (await object(page, actor.label)).press('Enter');
    await page
      .getByRole('button', { name: 'Spustiť skúšobnú repliku.', exact: true })
      .click();
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
    const box = (await canvas.boundingBox())!;
    const origin = await pointInScene(page, 0, 0),
      edge = await pointInScene(page, 1280, 720);
    const scale = (edge.x - origin.x) / 1280;
    const sharp = (await import('sharp')).default;
    async function patch(bytes: Buffer, id: string) {
      const r = project.animations!.find((c) => c.id === id)!.region!,
        meta = await sharp(bytes).metadata(),
        ratio = meta.width! / box.width;
      return sharp(bytes)
        .extract({
          left: Math.round(
            (origin.x -
              box.x +
              (placed.x + (r.x / 1086) * placed.width) * scale) *
              ratio,
          ),
          top: Math.round(
            (origin.y -
              box.y +
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
    await finishLine(page);
    await page
      .getByRole('button', { name: 'Ďalšia replika', exact: true })
      .click();
    await expect
      .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime))
      .toBeLessThan(0.5);
    const handle = await audio.elementHandle();
    await finishLine(page);
    await page
      .getByRole('button', { name: 'Ukončiť skúšku animácií.', exact: true })
      .click();
    await expect(page.locator('audio')).toHaveCount(0);
    expect(
      await handle!.evaluate((el) => (el as HTMLAudioElement).paused),
    ).toBe(true);
  },
);

test('models and editable subtitle segments survive save/reload and follow the audio playhead in both modes', async ({
  page,
  workspace,
  speechMock,
}, testInfo) => {
  await studio(page, workspace.url);
  await page.getByText('Hlas ElevenLabs', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Načíst hlasy a modely', exact: true })
    .click();
  await expect(page.locator('.voice-settings')).toContainText(
    'Modely načtené z API',
  );
  await page
    .getByLabel('ElevenLabs Voice ID', { exact: true })
    .fill('mock-voice');
  await page
    .getByLabel('Model ElevenLabs', { exact: true })
    .selectOption('eleven_v3');
  await expect(page.locator('.voice-settings')).toContainText(
    'Podporuje [laughs]',
  );
  await expect(
    page.getByLabel('Rychlost řeči', { exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Dabing a lip-sync', exact: true })
    .click();
  const raw =
    '[laughs] Prvá dlhšia veta má jasný začiatok aj koniec. [whispers] Druhá dlhšia veta prichádza po krátkej prestávke. Tretia veta pokračuje úplne pokojným hlasom. Štvrtá veta tento skúšobný rozhovor uzatvára.';
  await page.getByLabel('Text dabované repliky', { exact: true }).fill(raw);
  await page
    .getByLabel('Potvrzuji placené generování této repliky', {
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: 'Vygenerovat dabing ElevenLabs', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Stav dabingu' }),
  ).toContainText('Hotovo');
  await expect(
    page.getByRole('status', { name: 'Časování titulků' }),
  ).toContainText('podle ElevenLabs');
  const editor = page.getByRole('region', { name: 'Editor titulků' });
  await expect(editor.locator('li')).toHaveCount(4);
  const preview = page.getByRole('status', { name: 'Náhled titulků' });
  const audio = page.locator('.speech-studio audio');
  await audioAt(audio, 0.9);
  await expect(preview).toContainText('Prvá dlhšia veta');
  await expect(preview).not.toContainText('[laughs]');
  await expect(preview).not.toContainText('Druhá');
  await audioAt(audio, 5);
  await expect(preview).toHaveText('');
  await audioAt(audio, 8.5);
  await expect(preview).toContainText('Druhá dlhšia veta');
  const custom =
    'Prvá dlhšia veta má jasný začiatok aj koniec. Druhá vlastná veta prichádza po krátkej prestávke. Tretia veta pokračuje úplne pokojným hlasom. Štvrtá veta tento skúšobný rozhovor uzatvára.';
  await page
    .getByLabel('Vlastní text titulků (volitelné)', { exact: true })
    .fill(custom);
  await expect(
    page.getByRole('status', { name: 'Časování titulků' }),
  ).toContainText('Odhad');
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime))
    .toBeCloseTo(8.5, 1);
  await page
    .getByRole('button', { name: 'Obnovit automatické titulky', exact: true })
    .click();
  await page
    .getByLabel('Text titulku 2', { exact: true })
    .fill('Druhá upravená veta pre hráča.');
  await page
    .getByRole('button', { name: 'Rozdělit úsek 2', exact: true })
    .click();
  await expect(editor.locator('li')).toHaveCount(5);
  await page
    .getByRole('button', { name: 'Sloučit úsek 2 s dalším', exact: true })
    .click();
  await expect(editor.locator('li')).toHaveCount(4);
  await page.getByLabel('Začátek titulku 2', { exact: true }).fill('4.5');
  await page.getByLabel('Konec titulku 2', { exact: true }).fill('7.5');
  await page
    .getByRole('button', { name: 'Náhled úseku 2', exact: true })
    .click();
  await expect(preview).toHaveText('Druhá upravená veta pre hráča.');
  const paid = speechMock.requests.filter((r) =>
    r.url.includes('/text-to-speech/'),
  );
  expect(paid).toHaveLength(1);
  expect(paid[0]!.body).toMatchObject({ text: raw, model_id: 'eleven_v3' });
  expect(
    (paid[0]!.body as { voice_settings: object }).voice_settings,
  ).not.toHaveProperty('speed');
  await save(page);
  const disk = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const saved = disk.dialogues.find((d) => d.id === 'animation-demo')!
    .nodes[0]!;
  expect(saved.text).toBe(raw);
  expect(saved.subtitle).toBe(custom);
  expect(saved.speech!.subtitles!.timing).toBe('manual');
  expect(saved.speech!.subtitles!.cues[1]).toEqual({
    start: 4.5,
    end: 7.5,
    text: 'Druhá upravená veta pre hráča.',
  });
  expect(
    JSON.parse(
      await readFile(
        path.join(workspace.root, 'src/assets', saved.speech!.alignment!),
        'utf8',
      ),
    ).characters.join(''),
  ).toBe(raw);
  await page.screenshot({ path: testInfo.outputPath('subtitle-editor.png') });
  await page.reload();
  await ready(page);
  await studio(page, workspace.url);
  await page.getByText('Hlas ElevenLabs', { exact: true }).click();
  await expect(
    page.getByLabel('Model ElevenLabs', { exact: true }),
  ).toHaveValue('eleven_v3');
  await page
    .getByRole('button', { name: 'Dabing a lip-sync', exact: true })
    .click();
  await expect(
    page.getByLabel('Vlastní text titulků (volitelné)', { exact: true }),
  ).toHaveValue(custom);
  await expect(page.getByLabel('Text titulku 2', { exact: true })).toHaveValue(
    'Druhá upravená veta pre hráča.',
  );
  await page.getByRole('button', { name: 'Game Mode', exact: true }).click();
  await ready(page);
  await (await object(page, 'Skúšobná postava')).press('Enter');
  await page
    .getByRole('button', { name: 'Porozprávať sa.', exact: true })
    .click();
  const gameAudio = page.locator('.dialogue-panel audio');
  await audioAt(gameAudio, 6.5);
  await expect(page.locator('#dialogue-text')).toHaveText(
    'Druhá upravená veta pre hráča.',
  );
  await page.waitForTimeout(150);
  await expect(page.locator('#dialogue-text')).toHaveText(
    'Druhá upravená veta pre hráča.',
  );
  await gameAudio.evaluate((el) => void (el as HTMLAudioElement).play());
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  await expect
    .poll(() => gameAudio.evaluate((el) => (el as HTMLAudioElement).paused))
    .toBe(true);
  await expect(page.locator('#dialogue-text')).toHaveText(
    'Druhá upravená veta pre hráča.',
  );
  await page
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  await audioAt(gameAudio, 0.9);
  await expect(page.locator('#dialogue-text')).toContainText(
    'Prvá dlhšia veta',
  );
  await expect(page.getByRole('dialog')).not.toContainText('[laughs]');
  await page.screenshot({ path: testInfo.outputPath('subtitles-in-game.png') });
  await finishLine(page);
  await expect(page.locator('#dialogue-text')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Ukončiť skúšku animácií.', exact: true })
    .click();
  await expect(page.locator('audio')).toHaveCount(0);
});
