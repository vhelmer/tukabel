import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Hotspot, SceneDefinition, GameContent } from '../src/game/types';
import { authoredTest as test } from './editorFixture';
import { ready } from './helpers';

async function sampleActor(
  page: Page,
  scene: SceneDefinition,
  actor: Hotspot,
  source: { width: number; height: number },
) {
  const canvas = page.locator('.canvas-host canvas');
  const box = (await canvas.boundingBox())!;
  const png = await canvas.screenshot();
  const metadata = await sharp(png).metadata();
  const resolution = metadata.width! / box.width;
  const sceneScale = Math.min(
    box.width / scene.width,
    box.height / scene.height,
  );
  const actorScale = Math.min(
    actor.bounds.width / source.width,
    actor.bounds.height / source.height,
  );
  const origin = {
    x:
      (box.width - scene.width * sceneScale) / 2 +
      (actor.bounds.x + (actor.bounds.width - source.width * actorScale) / 2) *
        sceneScale,
    y:
      (box.height - scene.height * sceneScale) / 2 +
      (actor.bounds.y +
        (actor.bounds.height - source.height * actorScale) / 2) *
        sceneScale,
  };
  const crop = (x: number, y: number, width: number, height: number) =>
    sharp(png)
      .extract({
        left: Math.round((origin.x + x * actorScale * sceneScale) * resolution),
        top: Math.round((origin.y + y * actorScale * sceneScale) * resolution),
        width: Math.max(
          1,
          Math.floor(width * actorScale * sceneScale * resolution),
        ),
        height: Math.max(
          1,
          Math.floor(height * actorScale * sceneScale * resolution),
        ),
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
  return {
    hand: await crop(240, 6, 90, 34),
    torso: await crop(80, 240, 150, 260),
  };
}

test('Fero keeps scratching his head in a continuous idle loop without moving his torso and respects reduced motion', async ({
  page,
  workspace,
}, testInfo) => {
  test.setTimeout(60000);
  const content = JSON.parse(
    await readFile(workspace.source, 'utf8'),
  ) as GameContent;
  const scene = content.scenes.find((s) => s.id === 'scene4')!;
  const fero = scene.hotspots.find((h) => h.id === 'layer1')!;
  expect(fero.animation?.idle).toBe('fero-head-scratch-loop');
  expect(fero.animation?.idleLoop).toBe(true);
  const clip = content.animations!.find((a) => a.id === fero.animation!.idle)!;
  expect(clip.loop).toBe(true);
  expect(clip.frames.map((frame) => path.basename(frame))).toEqual(
    [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map(
      (index) => `frame-${String(index).padStart(2, '0')}.png`,
    ),
  );
  expect(clip.fps).toBe(10);
  expect(clip.region).toBeUndefined();
  expect(clip.source).toBe(fero.image);
  expect(fero.animation?.blink).toBeTruthy();
  expect(fero.animation?.talk).toBeTruthy();
  const source = await sharp(
    path.join(workspace.root, 'src/assets', fero.image!),
  ).metadata();
  expect([source.width, source.height]).toEqual([355, 580]);
  const sourceSize = { width: source.width!, height: source.height! };
  await writeFile(
    workspace.source,
    JSON.stringify({ ...content, startScene: scene.id }),
  );
  await page.goto(workspace.url);
  await ready(page);
  await page.mouse.move(0, 0);
  const first = await sampleActor(page, scene, fero, sourceSize);
  await expect
    .poll(
      async () => {
        const current = await sampleActor(page, scene, fero, sourceSize);
        expect(
          current.torso.equals(first.torso),
          'Idle motion must preserve torso placement and pixels',
        ).toBe(true);
        return current.hand.equals(first.hand);
      },
      { timeout: 4000, intervals: [80, 120, 160] },
    )
    .toBe(false);
  // An 11-position clip at 10 fps has already ended if it was accidentally a one-shot.
  await page.waitForTimeout(1300);
  const later = await sampleActor(page, scene, fero, sourceSize);
  await expect
    .poll(
      async () => {
        const current = await sampleActor(page, scene, fero, sourceSize);
        expect(
          current.torso.equals(first.torso),
          'Repeating motion must not shift the torso',
        ).toBe(true);
        return current.hand.equals(later.hand);
      },
      { timeout: 4000, intervals: [80, 120, 160] },
    )
    .toBe(false);
  await page
    .locator('.canvas-host canvas')
    .screenshot({ path: testInfo.outputPath('fero-head-scratch.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const still = await sampleActor(page, scene, fero, sourceSize);
  await page.waitForTimeout(300);
  const unchanged = await sampleActor(page, scene, fero, sourceSize);
  expect(
    unchanged.hand.equals(still.hand),
    'Reduced motion must stop the scratching hand',
  ).toBe(true);
  expect(unchanged.torso.equals(still.torso)).toBe(true);
});
