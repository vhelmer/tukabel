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
  validateGenerationRequest,
  validateProcessing,
} from '../dev/animationVideo';
import { createAnimationService } from '../dev/animationService';
import { falVideoGenerator } from '../dev/falVideo';
import { fixtureVideo } from './videoFixture';
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
  duration: 2,
  background: 'magenta',
});
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

test('video animation validation checks local MP4, metadata, refs and timing', async () => {
  const project = JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
  const source = project.scenes[0]!.hotspots.find((h) => h.image)!.image!;
  const animation = {
    ...clip('blink', 'blink', [source, source]),
    source,
    generation: {
      provider: 'fal',
      model: 'test-provider',
      prompt: 'Blink',
      sourceHash: 'a'.repeat(64),
      requestId: 'test-id',
      video: 'animations/video/original.mp4',
      duration: 2,
      background: 'magenta',
      trimStart: 0,
      trimEnd: 2,
    },
  };
  const valid = { ...project, animations: [animation] };
  expect(validateProject(valid)).toEqual([]);
  for (const patch of [
    { video: 'https://evil.example/a.mp4' },
    { video: '../private.mp4' },
    { trimEnd: 3 },
    { provider: 'openai' },
    { sourceHash: 'bad' },
  ])
    expect(
      validateProject({
        ...valid,
        animations: [
          { ...animation, generation: { ...animation.generation, ...patch } },
        ],
      }).length,
    ).toBeGreaterThan(0);
  expect(validateProject(valid, []).join('\n')).toContain(
    'missing video asset',
  );
  expect(
    validateProject({
      ...valid,
      animations: [{ ...animation, frames: Array(121).fill(source) }],
    }).join('\n'),
  ).toContain('1–120');
});

test('generation accepts full assets and explicitly rejects old edit payloads and unbounded processing', () => {
  const valid = request('a'.repeat(64));
  expect(validateGenerationRequest(valid)).toBe(true);
  for (const patch of [
    { region: { x: 0, y: 0, width: 10, height: 10 } },
    { mode: 'full' },
    { quality: 'high' },
    { frameIndex: 0 },
    { duration: 60 },
    { source: '../actor.png' },
    { apiKey: 'secret' },
    { background: 'none' },
  ])
    expect(validateGenerationRequest({ ...valid, ...patch })).toBe(false);
  expect(
    validateProcessing({
      trimStart: 0,
      trimEnd: 2,
      fps: 12,
      keySimilarity: 0.2,
    }),
  ).toBe(true);
  for (const patch of [
    { trimStart: -1 },
    { trimEnd: 0 },
    { fps: 120 },
    { keySimilarity: 2 },
    { trimEnd: NaN },
  ])
    expect(
      validateProcessing({
        trimStart: 0,
        trimEnd: 2,
        fps: 12,
        keySimilarity: 0.2,
        ...patch,
      }),
    ).toBe(false);
});

test('fal adapter submits the entire PNG once, polls, downloads without credentials and cancels remotely', async () => {
  const png = await sharp('src/assets/caretaker.svg').png().toBuffer();
  const video = await fixtureVideo();
  const calls: { url: string; options?: RequestInit }[] = [];
  const base = 'https://queue.fal.run/fal-ai/wan/requests/test-id';
  let polls = 0;
  const provider = falVideoGenerator(
    'server-only-key',
    async (url, options) => {
      calls.push({ url: String(url), options });
      if (options?.method === 'POST') {
        const input = JSON.parse(options.body as string);
        expect(input.image_url).toBe(
          `data:image/png;base64,${png.toString('base64')}`,
        );
        expect(input.num_frames).toBe(49);
        expect(input.aspect_ratio).toBe('auto');
        expect(input.mask).toBeUndefined();
        expect(options.headers).toMatchObject({
          Authorization: 'Key server-only-key',
        });
        return Response.json({
          request_id: 'test-id',
          status_url: base + '/status',
          response_url: base,
          cancel_url: base + '/cancel',
        });
      }
      if (String(url).endsWith('/status'))
        return Response.json({
          status: ++polls === 1 ? 'IN_PROGRESS' : 'COMPLETED',
        });
      if (String(url) === base)
        return Response.json({
          video: { url: 'https://v3.fal.media/files/output.mp4' },
        });
      expect(options?.headers).toBeUndefined();
      return new Response(new Uint8Array(video));
    },
    1,
  );
  const progress: string[] = [];
  const generated = await provider.generate({
    image: png,
    prompt: 'Blink',
    duration: 2,
    signal: new AbortController().signal,
    onProgress: (phase) => progress.push(phase),
  });
  expect(generated.video.equals(video)).toBe(true);
  expect(calls.filter((c) => c.options?.method === 'POST')).toHaveLength(1);
  expect(progress.some((p) => p.includes('generuje'))).toBe(true);
  const controller = new AbortController();
  let cancelled = false;
  const cancellable = falVideoGenerator(
    'secret',
    async (_url, options) => {
      if (options?.method === 'POST')
        return Response.json({
          request_id: 'test-id',
          status_url: base + '/status',
          response_url: base,
          cancel_url: base + '/cancel',
        });
      if (options?.method === 'PUT') {
        cancelled = true;
        return new Response(null, { status: 202 });
      }
      controller.abort();
      return Response.json({ status: 'IN_QUEUE' });
    },
    1,
  );
  await expect(
    cancellable.generate({
      image: png,
      prompt: 'Blink',
      duration: 2,
      signal: controller.signal,
      onProgress: () => {},
    }),
  ).rejects.toThrow();
  expect(cancelled).toBe(true);
  let deniedCalls = 0;
  const denied = falVideoGenerator('never-expose', async () => {
    deniedCalls++;
    return new Response('private provider body', { status: 401 });
  });
  await expect(
    denied.generate({
      image: png,
      prompt: 'Blink',
      duration: 2,
      signal: new AbortController().signal,
      onProgress: () => {},
    }),
  ).rejects.toThrow('FAL_KEY');
  expect(deniedCalls).toBe(1);
});

test('real MP4 pipeline archives video, extracts full frames, keys backgrounds and resamples without AI', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-animation-unit-'));
  try {
    await writeFile(
      path.join(root, 'actor.png'),
      await sharp('src/assets/caretaker.svg').png().toBuffer(),
    );
    let calls = 0;
    const service = createAnimationService(root, {
      model: 'controlled-video-provider',
      generate: async ({ image }) => {
        calls++;
        const meta = await sharp(image).metadata();
        expect(meta.width).toBe(180);
        expect(meta.height).toBe(290);
        return { video: await fixtureVideo(), requestId: 'test-id' };
      },
    });
    const info = await service.sourceInfo('actor.png');
    const input = request(info.revision);
    await expect(createAnimationService(root).start(input)).rejects.toThrow(
      'FAL_KEY',
    );
    await expect(
      service.start({ ...input, sourceRevision: 'b'.repeat(64) }),
    ).rejects.toThrow('zmenil');
    const job = await service.start(input);
    await expect.poll(() => service.get(job.id).status).toBe('completed');
    expect(job.result).toBeUndefined();
    expect(
      (await readFile(path.join(root, job.video!))).toString('ascii', 4, 8),
    ).toBe('ftyp');
    const result = await service.save(job.id, {
      trimStart: 0,
      trimEnd: 2,
      fps: 12,
      keySimilarity: 0.2,
    });
    expect(result.frames).toHaveLength(24);
    const a = await sharp(await readFile(path.join(root, result.frames[0]!)))
      .raw()
      .ensureAlpha()
      .toBuffer();
    const b = await sharp(await readFile(path.join(root, result.frames[12]!)))
      .raw()
      .ensureAlpha()
      .toBuffer();
    expect(a.equals(b)).toBe(false);
    expect(a[3]).toBe(0); // video background removed, not a copied source alpha mask
    expect(a[(150 * 180 + 90) * 4 + 3]).toBe(255); // body retained
    const again = await service.save(job.id, {
      trimStart: 0.5,
      trimEnd: 1.5,
      fps: 6,
      keySimilarity: 0.18,
    });
    expect(again.frames).toHaveLength(6);
    expect(calls).toBe(1);
    const manifest = JSON.parse(
      await readFile(
        path.join(root, path.dirname(again.frames[0]!), 'generation.json'),
        'utf8',
      ),
    );
    expect(manifest.processing.trimStart).toBe(0.5);
    expect(manifest.generation.video).toBe(job.video);
    await writeFile(
      path.join(root, 'actor.png'),
      await sharp({
        create: { width: 32, height: 32, channels: 4, background: '#000' },
      })
        .png()
        .toBuffer(),
    );
    await expect(
      service.save(job.id, {
        trimStart: 0,
        trimEnd: 1,
        fps: 12,
        keySimilarity: 0.2,
      }),
    ).rejects.toThrow('zmenil');
    service.dispose();
    expect(
      (await readdir(path.join(root, 'animations'))).filter((n) =>
        n.startsWith('.'),
      ),
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fal rejects untrusted queue/media destinations without forwarding credentials or retrying submissions', async () => {
  const base = 'https://queue.fal.run/fal-ai/wan/requests/test-id';
  for (const attack of ['queue', 'media']) {
    const calls: string[] = [];
    const provider = falVideoGenerator(
      'server-secret',
      async (url, options) => {
        calls.push(String(url));
        if (options?.method === 'PUT')
          return new Response(null, { status: 202 });
        if (options?.method === 'POST')
          return Response.json({
            request_id: 'test-id',
            cancel_url: base + '/cancel',
            response_url: base,
            status_url:
              attack === 'queue'
                ? 'https://attacker.example/status'
                : base + '/status',
          });
        if (String(url).endsWith('/status'))
          return Response.json({ status: 'COMPLETED' });
        return Response.json({
          video: { url: 'http://127.0.0.1/private.mp4' },
        });
      },
      1,
    );
    await expect(
      provider.generate({
        image: Buffer.from('reference'),
        prompt: 'Blink',
        duration: 2,
        signal: new AbortController().signal,
        onProgress: () => {},
      }),
    ).rejects.toThrow(/URL|adresu/);
    expect(calls.every((url) => url.startsWith('https://queue.fal.run/'))).toBe(
      true,
    );
    expect(
      calls.filter(
        (url) =>
          url === 'https://queue.fal.run/fal-ai/wan/v2.2-5b/image-to-video',
      ),
    ).toHaveLength(1);
  }
});

test('failed decoding keeps the original archive; stale generation and cancellation publish no assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-video-failures-'));
  try {
    const sourceFile = path.join(root, 'actor.png');
    await writeFile(
      sourceFile,
      await sharp('src/assets/caretaker.svg').png().toBuffer(),
    );
    const broken = createAnimationService(root, {
      model: 'broken-test-provider',
      generate: async () => ({
        video: Buffer.from('0000ftypnot-a-valid-mp4'),
        requestId: 'broken-test-id',
      }),
    });
    const input = request((await broken.sourceInfo('actor.png')).revision);
    const job = await broken.start(input);
    await expect.poll(() => job.status).toBe('completed');
    await expect(
      broken.save(job.id, {
        trimStart: 0,
        trimEnd: 2,
        fps: 12,
        keySimilarity: 0.2,
      }),
    ).rejects.toThrow('FFmpeg');
    expect(job.result).toBeUndefined();
    expect(await readdir(path.join(root, 'animations'))).toEqual([job.id]);
    expect(await readFile(path.join(root, job.video!))).toEqual(
      Buffer.from('0000ftypnot-a-valid-mp4'),
    );
    const changed = createAnimationService(root, {
      model: 'changing-source-test-provider',
      generate: async () => {
        await writeFile(
          sourceFile,
          await sharp({
            create: {
              width: 30,
              height: 30,
              channels: 4,
              background: '#123456',
            },
          })
            .png()
            .toBuffer(),
        );
        return { video: await fixtureVideo(), requestId: 'changed-test-id' };
      },
    });
    const stale = await changed.start(input);
    await expect.poll(() => stale.status).toBe('failed');
    expect(stale.error).toContain('zmenil');
    expect(await readdir(path.join(root, 'animations'))).toEqual([job.id]);
    const cancel = createAnimationService(root, {
      model: 'cancel-test-provider',
      generate: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.throwIfAborted();
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Abort', 'AbortError')),
            { once: true },
          );
        }),
    });
    const cancelled = await cancel.start(
      request((await cancel.sourceInfo('actor.png')).revision),
    );
    await expect(
      cancel.start(request((await cancel.sourceInfo('actor.png')).revision)),
    ).rejects.toThrow('Už beží');
    cancel.cancel(cancelled.id);
    await expect.poll(() => cancelled.status).toBe('cancelled');
    expect(await readdir(path.join(root, 'animations'))).toEqual([job.id]);
    broken.dispose();
    changed.dispose();
    cancel.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
