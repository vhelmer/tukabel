import { expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from './editorFixture';
import { object, ready } from './helpers';
import type { GameContent } from '../src/game/types';

// An actual browser mounts the production hook. Only browser audio hardware and
// WAV transfer are replaced so scheduling, gestures and disposal are observable.
async function harness(page: Page, workspace: { root: string; url: string }) {
  await writeFile(
    path.join(workspace.root, 'soundtrack.html'),
    '<div id="root"></div><script type="module" src="/soundtrack.tsx"></script>',
  );
  await writeFile(
    path.join(workspace.root, 'soundtrack.tsx'),
    `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { useSceneAudio } from '/src/ui/useSceneAudio';
    function Harness() {
      const [music,setMusic] = useState('/track-a.wav');
      const [ambient,setAmbient] = useState(undefined);
      const [paused,setPaused] = useState(false);
      const [ducked,setDucked] = useState(false);
      const sound = useSceneAudio(ambient, paused, {music,ducked});
      return React.createElement(React.Fragment, null,
        ...[
          ['gesture',()=>{}], ['same',()=>setAmbient('/ambient-next-scene.wav')],
          ['next',()=>setMusic('/track-b.wav')], ['third',()=>setMusic('/track-c.wav')], ['decode-late',()=>setMusic('/decode-late.wav')], ['late',()=>setMusic('/late.wav')],
          ['pause',()=>setPaused(v=>!v)], ['duck',()=>setDucked(v=>!v)],
          ['mute',sound.toggle], ['effect',()=>sound.playEffect('pickup')],
          ['effect-two',()=>sound.playEffect('combine')], ['effect-three',()=>sound.playEffect('travel')],
        ].map(([label,onClick])=>React.createElement('button',{key:label,onClick},label)));
    }
    const root=createRoot(document.getElementById('root'));
    window.disposeAudio=()=>root.unmount();
    root.render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
  `,
  );
  await page.addInitScript(() => {
    const scope = window as unknown as {
      audioLog: {
        type: string;
        id?: number;
        value?: number;
        at?: number;
        loop?: boolean;
      }[];
      releaseLate: () => void;
      releaseDecode: () => void;
    };
    scope.audioLog = [];
    let id = 0;
    const log = (entry: (typeof scope.audioLog)[number]) =>
      scope.audioLog.push(entry);
    class Context {
      state = 'suspended';
      currentTime = 10;
      destination = {};
      createGain() {
        const gainId = ++id;
        return {
          gain: {
            value: 0,
            cancelScheduledValues() {},
            cancelAndHoldAtTime() {},
            setValueAtTime(value: number, at: number) {
              log({ type: 'gain', id: gainId, value, at });
            },
            linearRampToValueAtTime(value: number, at: number) {
              log({ type: 'ramp', id: gainId, value, at });
            },
          },
          connect() {},
          disconnect() {
            log({ type: 'disconnect-gain', id: gainId });
          },
        };
      }
      createBufferSource() {
        const sourceId = ++id;
        const source = {
          buffer: null,
          loop: false,
          onended: null as (() => void) | null,
          connect() {},
          disconnect() {
            log({ type: 'disconnect', id: sourceId });
          },
          start(at = 0) {
            log({ type: 'start', id: sourceId, at, loop: source.loop });
          },
          stop(at = 0) {
            log({ type: 'stop', id: sourceId, at });
          },
        };
        return source;
      }
      createBuffer() {
        return {};
      }
      decodeAudioData(bytes: ArrayBuffer) {
        if (new Uint8Array(bytes)[0] === 1)
          return new Promise((resolve) => {
            scope.releaseDecode = () => resolve({ duration: 20 });
          });
        return Promise.resolve({ duration: 20 });
      }
      resume() {
        this.state = 'running';
        log({ type: 'resume' });
        return Promise.resolve();
      }
      suspend() {
        this.state = 'suspended';
        log({ type: 'suspend' });
        return Promise.resolve();
      }
      close() {
        this.state = 'closed';
        log({ type: 'close' });
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      value: Context,
      configurable: true,
    });
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = String(input);
      if (!url.endsWith('.wav')) return original(input, init);
      if (url.includes('decode-late.wav')) {
        const bytes = new Uint8Array(16);
        bytes[0] = 1;
        return Promise.resolve(new Response(bytes));
      }
      if (url.includes('late.wav'))
        return new Promise((resolve) => {
          scope.releaseLate = () => resolve(new Response(new ArrayBuffer(16)));
        });
      return Promise.resolve(new Response(new ArrayBuffer(16)));
    };
    HTMLMediaElement.prototype.play = function () {
      log({ type: 'effect' });
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      log({ type: 'effect-pause' });
    };
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.goto(`${workspace.url}soundtrack.html`);
  await expect(
    page.getByRole('button', { name: 'gesture', exact: true }),
  ).toBeVisible();
}

async function events(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          audioLog: {
            type: string;
            id?: number;
            value?: number;
            at?: number;
            loop?: boolean;
          }[];
        }
      ).audioLog,
  );
}

test('music unlocks on a trusted gesture, keeps the same loop and crossfades tracks under ducking', async ({
  page,
  workspace,
}) => {
  await harness(page, workspace);
  expect((await events(page)).filter((e) => e.type === 'start')).toHaveLength(
    0,
  );
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointerdown')),
  );
  expect((await events(page)).filter((e) => e.type === 'start')).toHaveLength(
    0,
  );
  await page.getByRole('button', { name: 'gesture', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === 'start' && e.loop).length,
    )
    .toBe(1);
  await page.getByRole('button', { name: 'same', exact: true }).click();
  expect(
    (await events(page)).filter((e) => e.type === 'start' && e.loop),
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'duck', exact: true }).click();
  await expect
    .poll(async () =>
      (await events(page)).some((e) => e.type === 'ramp' && e.value === 0.05),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'next', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === 'start' && e.loop).length,
    )
    .toBe(2);
  expect(
    (await events(page)).some((e) => e.type === 'stop' && e.at === 11),
  ).toBe(true);
  await page.getByRole('button', { name: 'pause', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page))
          .filter((e) => e.type === 'resume' || e.type === 'suspend')
          .at(-1)?.type,
    )
    .toBe('suspend');
  await page.getByRole('button', { name: 'pause', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page))
          .filter((e) => e.type === 'resume' || e.type === 'suspend')
          .at(-1)?.type,
    )
    .toBe('resume');
  expect(
    (await events(page)).filter((e) => e.type === 'start' && e.loop),
  ).toHaveLength(2);
  await page.getByRole('button', { name: 'mute', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page))
          .filter((e) => e.type === 'resume' || e.type === 'suspend')
          .at(-1)?.type,
    )
    .toBe('suspend');
  await page.evaluate(() =>
    (window as unknown as { disposeAudio: () => void }).disposeAudio(),
  );
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => !e.type.startsWith('effect')).at(-1)
          ?.type,
    )
    .toBe('close');
});

test('hidden pages suspend and late music loading cannot resurrect a disposed scene', async ({
  page,
  workspace,
}) => {
  await harness(page, workspace);
  await page.getByRole('button', { name: 'gesture', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === 'start' && e.loop).length,
    )
    .toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(
      async () =>
        (await events(page))
          .filter((e) => e.type === 'resume' || e.type === 'suspend')
          .at(-1)?.type,
    )
    .toBe('suspend');
  await page.getByRole('button', { name: 'late', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as { releaseLate?: () => void })
            .releaseLate,
      ),
    )
    .toBe('function');
  await page.evaluate(() =>
    (window as unknown as { disposeAudio: () => void }).disposeAudio(),
  );
  await page.evaluate(() =>
    (window as unknown as { releaseLate: () => void }).releaseLate(),
  );
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => !e.type.startsWith('effect')).at(-1)
          ?.type,
    )
    .toBe('close');
  expect(
    (await events(page)).filter((e) => e.type === 'start' && e.loop),
  ).toHaveLength(1);
});

test('effect bursts have a per-cue cooldown and at most two active sounds', async ({
  page,
  workspace,
}) => {
  await harness(page, workspace);
  await page.getByRole('button', { name: 'gesture', exact: true }).click();
  await page.getByRole('button', { name: 'effect', exact: true }).click();
  await page.getByRole('button', { name: 'effect', exact: true }).click();
  expect((await events(page)).filter((e) => e.type === 'effect')).toHaveLength(
    1,
  );
  await page.getByRole('button', { name: 'effect-two', exact: true }).click();
  await page.getByRole('button', { name: 'effect-three', exact: true }).click();
  expect((await events(page)).filter((e) => e.type === 'effect')).toHaveLength(
    3,
  );
  expect(
    (await events(page)).filter((e) => e.type === 'effect-pause'),
  ).toHaveLength(1);
  await page.evaluate(() =>
    (window as unknown as { disposeAudio: () => void }).disposeAudio(),
  );
  expect(
    (await events(page)).filter((e) => e.type === 'effect-pause'),
  ).toHaveLength(3);
});

test('game scene sharing preserves the loop, authored cues replace travel sounds and the ending changes music', async ({
  page,
  workspace,
}) => {
  await harness(page, workspace);
  const content = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const first = content.scenes[0]!;
  const second = content.scenes[1]!;
  await writeFile(
    workspace.source,
    JSON.stringify({
      ...content,
      startScene: first.id,
      startDialogue: undefined,
      dialogues: [],
      flags: [...content.flags, 'audio-ending'],
      endings: [
        {
          id: 'audio-ending',
          when: { flag: 'audio-ending' },
          title: 'Koniec skúšky',
          text: 'Hotovo.',
          music: 'ambience/ending.wav',
        },
      ],
      scenes: content.scenes.map((scene) => ({
        ...scene,
        music: 'ambience/village.wav',
        hotspots:
          scene.id === first.id
            ? [
                {
                  id: 'audio-door',
                  label: 'Zvukové dvere',
                  bounds: { x: 300, y: 200, width: 100, height: 150 },
                  onClick: [
                    {
                      sound: 'ambience/combine.wav',
                      effects: [{ type: 'scene', id: second.id }],
                    },
                  ],
                },
              ]
            : [
                {
                  id: 'audio-finish',
                  label: 'Zvukový koniec',
                  bounds: { x: 300, y: 200, width: 100, height: 150 },
                  onClick: [
                    {
                      effects: [
                        { type: 'flag', id: 'audio-ending', value: true },
                      ],
                    },
                  ],
                },
              ],
      })),
    }),
  );
  await page.goto(workspace.url);
  await ready(page);
  await page.getByRole('button', { name: 'Menu', exact: true }).press('Tab');
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === 'start' && e.loop).length,
    )
    .toBe(1);
  // An authored cue is passed to HTML Audio via assetUrl, never mixed with the
  // generic transition sound. The second scene intentionally shares its music.
  await page.evaluate(() => {
    const scope = window as unknown as { effectSources: string[] };
    scope.effectSources = [];
    HTMLMediaElement.prototype.play = function () {
      scope.effectSources.push(this.src);
      return Promise.resolve();
    };
  });
  await (await object(page, 'Zvukové dvere')).press('Enter');
  await expect(page.locator('.scene-frame')).toHaveAttribute(
    'aria-label',
    `Lokácia: ${second.title}`,
  );
  expect(
    (await events(page)).filter((e) => e.type === 'start' && e.loop),
  ).toHaveLength(1);
  const sounds = await page.evaluate(
    () => (window as unknown as { effectSources: string[] }).effectSources,
  );
  expect(sounds.some((url) => url.includes('combine.wav'))).toBe(true);
  expect(sounds.some((url) => url.includes('travel.wav'))).toBe(false);
  await (await object(page, 'Zvukový koniec')).press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Koniec skúšky' }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === 'start' && e.loop).length,
    )
    .toBe(2);
  await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => !e.type.startsWith('effect')).at(-1)
          ?.type,
    )
    .toBe('close');
});

test('a newer track wins over delayed decoding and rapid crossfades keep at most two music sources', async ({
  page,
  workspace,
}) => {
  await harness(page, workspace);
  await page.getByRole('button', { name: 'gesture', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === 'start' && e.loop).length,
    )
    .toBe(1);
  await page.getByRole('button', { name: 'decode-late', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as { releaseDecode?: () => void })
            .releaseDecode,
      ),
    )
    .toBe('function');
  await page.getByRole('button', { name: 'next', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === 'start' && e.loop).length,
    )
    .toBe(2);
  await page.evaluate(() =>
    (window as unknown as { releaseDecode: () => void }).releaseDecode(),
  );
  await page.getByRole('button', { name: 'third', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await events(page)).filter((e) => e.type === 'start' && e.loop).length,
    )
    .toBe(3);
  const log = await events(page);
  const first = log.find((e) => e.type === 'start' && e.loop)!;
  expect(log.some((e) => e.type === 'disconnect' && e.id === first.id)).toBe(
    true,
  );
  await page.evaluate(() =>
    (window as unknown as { disposeAudio: () => void }).disposeAudio(),
  );
});
