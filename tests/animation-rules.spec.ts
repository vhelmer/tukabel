import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
  createAnimationPlayer,
  frameAt,
  isCharacterSpeaking,
} from '../src/game/animation';
import { validateProject } from '../src/game/validateProject';
import type { AnimationDefinition, GameContent } from '../src/game/types';
import {
  assembleFrame,
  framePlan,
  normalizeSource,
  prepareEdit,
  validateGenerationRequest,
} from '../dev/animationImages';
import { createAnimationService } from '../dev/animationService';
import { openAIImageEditor } from '../dev/imageEdit';
import type { GenerationRequest } from '../src/editor/animationTypes';

const clip = (
  id: string,
  kind: AnimationDefinition['kind'],
  frames: string[],
): AnimationDefinition => ({
  id,
  label: id,
  source: 'actor.png',
  kind,
  frames,
  fps: 10,
});
const request = (revision: string): GenerationRequest => ({
  source: 'actor.png',
  sourceRevision: revision,
  kind: 'blink',
  prompt: 'Vytvor mrknutie na 5 snímkov.',
  frameCount: 5,
  quality: 'medium',
  mode: 'region',
  region: { x: 8, y: 12, width: 12, height: 8 },
});
async function fixtureImage() {
  const pixels = Buffer.alloc(32 * 48 * 4);
  for (let index = 0; index < 32 * 48; index++) {
    pixels[index * 4] = index % 255;
    pixels[index * 4 + 1] = 70;
    pixels[index * 4 + 2] = 120;
    pixels[index * 4 + 3] = index % 4 === 0 ? 100 : 255;
  }
  return sharp(pixels, { raw: { width: 32, height: 48, channels: 4 } })
    .png()
    .toBuffer();
}
const responseImage = () =>
  sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 240, g: 20, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

test('visual clocks prioritize speech, schedule finite blinks and hold once-only expressions', () => {
  const blink = clip('blink', 'blink', [
    'base',
    'half',
    'closed',
    'half',
    'base',
  ]);
  const talk = clip('talk', 'talk', ['mouth1', 'mouth2']);
  const player = createAnimationPlayer(
    { blink: 'blink', talk: 'talk', blinkIntervalMs: [100, 100] },
    [blink, talk],
    () => 0,
  );
  expect(player.tick(99, false).priority).toBe('base');
  expect(player.tick(1, false).priority).toBe('blink');
  expect(player.tick(100, false).frame).toBe('half');
  expect(player.tick(100, false).frame).toBe('closed');
  expect(player.tick(0, true)).toMatchObject({
    priority: 'talk',
    frame: 'mouth1',
  });
  expect(player.tick(100, true).frame).toBe('mouth2');
  expect(player.tick(0, false).priority).toBe('base');
  expect(player.tick(100, false).priority).toBe('blink');
  expect(player.tick(500, false).priority).toBe('base');
  const idle = clip('idle', 'expression', ['neutral', 'smile']);
  expect(frameAt(idle, 10000, false)).toBe('smile');
  expect(frameAt(idle, 10000, true)).toBe('neutral');
  const state = {
    sceneId: 'room',
    inventory: [],
    flags: {},
    message: '',
    dialogue: { id: 'conversation', nodeId: 'start' },
  };
  expect(
    isCharacterSpeaking(
      {
        id: 'npc',
        label: '',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        defaultVerb: 'talk',
        actions: {
          talk: [
            {
              message: '',
              effects: [{ type: 'dialogue', id: 'conversation' }],
            },
          ],
        },
      },
      state,
    ),
  ).toBe(true);
});

test('animation validation checks source compatibility, refs, timing, assets and metadata', async () => {
  const project = JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
  const source = project.scenes[0]!.hotspots.find(
    (hotspot) => hotspot.image,
  )!.image!;
  const animation = { ...clip('blink', 'blink', [source, source]), source };
  const valid = {
    ...project,
    animations: [animation],
    scenes: project.scenes.map((scene, index) =>
      index
        ? scene
        : {
            ...scene,
            hotspots: scene.hotspots.map((hotspot) =>
              hotspot.image === source
                ? {
                    ...hotspot,
                    animation: { blink: 'blink', blinkIntervalMs: [100, 200] },
                  }
                : hotspot,
            ),
          },
    ),
  };
  expect(validateProject(valid)).toEqual([]);
  expect(
    validateProject({
      ...valid,
      animations: [{ ...animation, source: 'other.png', fps: 0 }],
    }).join('\n'),
  ).toContain('source must match');
  expect(
    validateProject({
      ...valid,
      animations: [
        {
          ...animation,
          generation: {
            prompt: '',
            model: 'model',
            quality: 'bad',
            mode: 'region',
            sourceHash: 'bad',
          },
        },
      ],
    }).length,
  ).toBeGreaterThan(0);
  expect(
    validateProject({
      ...valid,
      animations: [
        { ...animation, frames: ['https://remote.example/image.png'] },
      ],
    }).length,
  ).toBeGreaterThan(0);
  expect(
    validateProject({
      ...valid,
      scenes: valid.scenes.map((scene) => ({
        ...scene,
        hotspots: scene.hotspots.map((hotspot) => ({
          ...hotspot,
          animation: { blink: 'missing', blinkIntervalMs: [500, 100] },
        })),
      })),
    }).join('\n'),
  ).toContain('blink interval');
});

test('blink plans reuse keyframes and generation rejects malformed or out-of-range requests', () => {
  expect(framePlan('blink', 5)).toEqual([0, 0.5, 1, 0.5, 0]);
  expect(framePlan('blink', 6)).toEqual([0, 0.5, 1, 1, 0.5, 0]);
  const valid = request('a'.repeat(64));
  expect(validateGenerationRequest(valid)).toBe(true);
  for (const invalid of [
    { ...valid, frameCount: 2 },
    { ...valid, frameCount: 25 },
    { ...valid, source: '../actor.png' },
    { ...valid, quality: 'auto' },
    { ...valid, apiKey: 'client-secret' },
    { ...valid, region: null },
    { ...valid, frameIndex: 5 },
    { ...valid, region: { ...valid.region, x: -1 } },
  ])
    expect(validateGenerationRequest(invalid)).toBe(false);
});

test('local compositing preserves every outside pixel and every alpha byte despite a drifting model output', async () => {
  const source = await normalizeSource(await fixtureImage());
  const region = request('a'.repeat(64)).region!;
  const layout = await prepareEdit(source, region);
  const mask = await sharp(layout.mask!).ensureAlpha().raw().toBuffer();
  expect(mask.some((value, index) => index % 4 === 3 && value === 0)).toBe(
    true,
  );
  expect(mask[3]).toBe(255);
  const png = await assembleFrame(
    source,
    await responseImage(),
    layout,
    region,
  );
  const result = await sharp(png).ensureAlpha().raw().toBuffer();
  let changed = 0;
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const index = (y * source.width + x) * 4;
      expect(result[index + 3]).toBe(source.data[index + 3]);
      if (
        x < region.x ||
        x >= region.x + region.width ||
        y < region.y ||
        y >= region.y + region.height
      )
        expect(result.subarray(index, index + 4)).toEqual(
          source.data.subarray(index, index + 4),
        );
      else if (
        !result
          .subarray(index, index + 3)
          .equals(source.data.subarray(index, index + 3))
      )
        changed++;
    }
  expect(changed).toBeGreaterThan(0);
  await expect(
    assembleFrame(source, await fixtureImage(), layout, region),
  ).rejects.toThrow('1024');
  await expect(
    prepareEdit(source, { x: 30, y: 40, width: 12, height: 12 }),
  ).rejects.toThrow('presahuje');
  const wholeFrame = await assembleFrame(
    source,
    await responseImage(),
    await prepareEdit(source),
  );
  const wholePixels = await sharp(wholeFrame).ensureAlpha().raw().toBuffer();
  expect(wholePixels.length).toBe(source.data.length);
  expect(wholePixels[0]).not.toBe(source.data[0]);
});

test('the real Images API adapter sends multipart source/mask with a server key and never retries errors', async () => {
  const png = await responseImage();
  let calls = 0;
  const provider = openAIImageEditor(
    'test-server-secret',
    async (url, options) => {
      calls++;
      expect(url).toBe('https://api.openai.com/v1/images/edits');
      expect(options!.headers).toEqual({
        Authorization: 'Bearer test-server-secret',
      });
      const form = options!.body as FormData;
      expect(form.get('model')).toBe('gpt-image-2');
      expect(form.get('n')).toBe('1');
      expect(form.get('size')).toBe('1024x1024');
      expect(form.has('input_fidelity')).toBe(false);
      expect(form.get('mask')).toBeInstanceOf(Blob);
      return new Response(
        JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }),
        { status: 200 },
      );
    },
  );
  expect(
    await provider.edit({
      image: png,
      mask: png,
      prompt: 'blink',
      quality: 'medium',
      signal: new AbortController().signal,
      transparent: false,
    }),
  ).toEqual(png);
  expect(calls).toBe(1);
  const denied = openAIImageEditor('never-expose-this-key', async () => {
    calls++;
    return new Response('upstream-private-details', { status: 429 });
  });
  await expect(
    denied.edit({
      image: png,
      prompt: '',
      quality: 'medium',
      signal: new AbortController().signal,
      transparent: false,
    }),
  ).rejects.toThrow('429');
  expect(calls).toBe(2);
});

test('jobs persist PNGs and provenance, reject stale sources and missing keys, and clean up after cancellation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-animation-unit-'));
  try {
    await writeFile(path.join(root, 'actor.png'), await fixtureImage());
    let calls = 0;
    const service = createAnimationService(root, {
      model: 'controlled-test-provider',
      edit: async () => {
        calls++;
        return responseImage();
      },
    });
    const info = await service.sourceInfo('actor.png');
    const input = request(info.revision);
    const job = await service.start(input);
    await expect.poll(() => service.get(job.id).status).toBe('completed');
    expect(calls).toBe(2);
    expect(job.result!.frames).toHaveLength(5);
    expect(job.result!.frames[1]).toBe(job.result!.frames[3]);
    const manifest = JSON.parse(
      await readFile(
        path.join(root, 'animations', job.id, 'generation.json'),
        'utf8',
      ),
    );
    expect(manifest.model).toBe('controlled-test-provider');
    expect(manifest.sourceHash).toBe(info.revision);
    expect(
      (
        await sharp(
          await readFile(path.join(root, job.result!.frames[2]!)),
        ).metadata()
      ).width,
    ).toBe(32);
    await expect(
      service.start({ ...input, sourceRevision: 'f'.repeat(64) }),
    ).rejects.toThrow('zmenil');
    await expect(createAnimationService(root).start(input)).rejects.toThrow(
      'OPENAI_API_KEY',
    );
    const cancellable = createAnimationService(root, {
      model: 'blocked-test-provider',
      edit: async ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          ),
        ),
    });
    const cancelled = await cancellable.start(input);
    cancellable.cancel(cancelled.id);
    await expect
      .poll(() => cancellable.get(cancelled.id).status)
      .toBe('cancelled');
    expect(
      (await readdir(path.join(root, 'animations'))).filter(
        (folder) => folder !== job.id,
      ),
    ).toEqual([]);
    const sourceChanged = createAnimationService(root, {
      model: 'controlled-test-provider',
      edit: async () => {
        await writeFile(path.join(root, 'actor.png'), await responseImage());
        return responseImage();
      },
    });
    const stale = await sourceChanged.start(input);
    await expect.poll(() => sourceChanged.get(stale.id).status).toBe('failed');
    expect(stale.error).toContain('zmenil počas');
    expect(await readdir(path.join(root, 'animations'))).toEqual([job.id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
