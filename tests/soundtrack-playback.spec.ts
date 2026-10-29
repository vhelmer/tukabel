import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { authoredTest as test } from './editorFixture';
import { object, ready, hudClick } from './helpers';
import type { GameContent } from '../src/game/types';

test('real generated music decodes and plays in the game, shares a loop and yields to dialogue and mute', async ({
  page,
  workspace,
}) => {
  test.setTimeout(120000);
  const content = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  await page.addInitScript(() => {
    const scope = window as unknown as {
      scoreProbe: {
        contexts: AudioContext[];
        sources: AudioBufferSourceNode[];
        gains: GainNode[];
        ended: AudioBufferSourceNode[];
        media: {
          src: string;
          volume: number;
          played: boolean;
          failed: boolean;
        }[];
      };
    };
    const probe: typeof scope.scoreProbe = {
      contexts: [],
      sources: [],
      gains: [],
      ended: [],
      media: [],
    };
    scope.scoreProbe = probe;
    const NativeContext = window.AudioContext;
    class ObservedContext extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource();
        probe.sources.push(source);
        source.addEventListener('ended', () => probe.ended.push(source));
        return source;
      }
      createGain() {
        const gain = super.createGain();
        probe.gains.push(gain);
        return gain;
      }
    }
    window.AudioContext = ObservedContext;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const entry = {
        src: this.src,
        volume: this.volume,
        played: false,
        failed: false,
      };
      probe.media.push(entry);
      const promise = play.call(this);
      void promise.then(
        () => {
          entry.played = true;
        },
        () => {
          entry.failed = true;
        },
      );
      return promise;
    };
  });
  const loops = () =>
    page.evaluate(() => {
      const probe = (
        window as unknown as {
          scoreProbe: { sources: AudioBufferSourceNode[] };
        }
      ).scoreProbe;
      return probe.sources
        .filter((s) => s.loop)
        .map((s) => ({
          duration: s.buffer?.duration ?? 0,
          energy: s.buffer
            ? s.buffer
                .getChannelData(0)
                .slice(0, 44100)
                .reduce((sum, x) => sum + x * x, 0) / 44100
            : 0,
        }));
    });
  const gain = () =>
    page.evaluate(
      () =>
        (window as unknown as { scoreProbe: { gains: GainNode[] } }).scoreProbe
          .gains[0]?.gain.value ?? -1,
    );
  await page.goto(workspace.url);
  await page.getByRole('button', { name: 'Preskočiť ›', exact: true }).click();
  await ready(page);
  await expect(page.locator('.dialogue-panel')).toHaveClass(/is-speaking/);
  await expect.poll(async () => (await loops()).length).toBe(1);
  expect((await loops())[0]!.duration).toBeCloseTo(16, 3);
  expect((await loops())[0]!.energy).toBeGreaterThan(0.0001);
  await expect.poll(gain).toBeCloseTo(0.05, 2);
  const startVoice = page.getByRole('button', {
    name: 'Spustiť dabing',
    exact: true,
  });
  if (await startVoice.count()) await startVoice.click();
  await page
    .getByRole('button', { name: 'Dokončiť repliku', exact: true })
    .click();
  const accept = content.dialogues
    .find((d) => d.id === 'fero-intro')!
    .nodes[0]!.choices.find((c) => c.id === 'accept')!;
  await page.getByRole('button', { name: accept.text, exact: true }).click();
  await expect(page.locator('.dialogue-panel')).toHaveCount(0);
  await expect.poll(gain).toBeCloseTo(0.2, 2);
  await (await object(page, 'Prechod do uličky')).press('Enter');
  await expect(page.locator('.scene-frame')).toHaveAttribute(
    'aria-label',
    'Lokácia: Ulička',
  );
  expect((await loops()).length).toBe(1);
  await (await object(page, 'Späť na Ferov dvor')).press('Enter');
  async function travel(sceneId: string) {
    await (await object(page, 'Mapa osady')).press('Enter');
    const point = content.worldMap!.points.find((p) => p.sceneId === sceneId)!;
    await page
      .locator(`[data-hud-control="map-point:${point.id}"]`)
      .press('Enter');
    await ready(page);
  }
  await travel('scene1');
  expect((await loops()).length).toBe(1);
  await (await object(page, 'Prázdna fľaša')).press('Enter');
  await travel('scene3');
  await expect.poll(async () => (await loops()).length).toBe(2);
  expect(
    (await loops()).every((loop) => Math.abs(loop.duration - 16) < 0.001),
  ).toBe(true);
  const mark = await page.evaluate(
    () =>
      (window as unknown as { scoreProbe: { media: unknown[] } }).scoreProbe
        .media.length,
  );
  await page.locator('[data-inventory-id="empty-bottle"]').press('Enter');
  await (await object(page, 'Pumpa so svätenou vodou')).press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        (index) =>
          (
            window as unknown as {
              scoreProbe: {
                media: {
                  src: string;
                  played: boolean;
                  failed: boolean;
                  volume: number;
                }[];
              };
            }
          ).scoreProbe.media
            .slice(index)
            .filter((m) => m.src.includes('sfx-water') && m.played && !m.failed)
            .length,
        mark,
      ),
    )
    .toBe(1);
  const cues = await page.evaluate(
    (index) =>
      (
        window as unknown as {
          scoreProbe: { media: { src: string; volume: number }[] };
        }
      ).scoreProbe.media.slice(index),
    mark,
  );
  expect(cues.some((cue) => cue.src.includes('pickup.wav'))).toBe(false);
  expect(cues.find((cue) => cue.src.includes('sfx-water'))!.volume).toBeCloseTo(
    0.35,
  );
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  const menu = page.getByRole('dialog', { name: 'Herné menu' });
  await menu
    .getByRole('button', { name: 'Zvuk prostredia: zapnutý', exact: true })
    .click();
  await menu
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { scoreProbe: { contexts: AudioContext[] } })
            .scoreProbe.contexts[0]?.state,
      ),
    )
    .toBe('suspended');
  await hudClick(page, page.getByRole('button', { name: 'Menu', exact: true }));
  await menu
    .getByRole('button', { name: 'Zvuk prostredia: vypnutý', exact: true })
    .click();
  await menu
    .getByRole('button', { name: 'Pokračovať v hre', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { scoreProbe: { contexts: AudioContext[] } })
            .scoreProbe.contexts[0]?.state,
      ),
    )
    .toBe('running');
  expect((await loops()).length).toBe(2);
});
