import { expect, test } from '@playwright/test';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createArtwork, artStatus } from '../dev/sceneArt';
import { validateAnimationAssets } from '../dev/animationImport';
import { validateProject } from '../src/game/validateProject';
import { initialState, reduceGame } from '../src/game/state';
import type { GameContent } from '../src/game/types';
const rectangle = [
  { x: 8, y: 8 },
  { x: 56, y: 8 },
  { x: 56, y: 40 },
  { x: 8, y: 40 },
];
async function fixture(run: (root: string, original: Buffer) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-art-rules-'));
  try {
    const raw = Buffer.alloc(64 * 48 * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = ((i / 4) % 64) * 3;
      raw[i + 1] = Math.floor(i / 256) * 4;
      raw[i + 2] = 70;
      raw[i + 3] = 255;
    }
    const original = await sharp(raw, {
      raw: { width: 64, height: 48, channels: 4 },
    })
      .png()
      .toBuffer();
    await writeFile(path.join(root, 'source.png'), original);
    await run(root, original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const rgba = (file: string | Buffer) =>
  sharp(file).ensureAlpha().raw().toBuffer();

test('scene cutouts and ambient loops preserve canvas, archive selections and publish complete local clips', async () => {
  await fixture(async (root, original) => {
    const result = await createArtwork(root, {
      source: 'source.png',
      operation: 'cutout',
      selection: rectangle,
    });
    const bytes = await rgba(path.join(root, result.image)),
      source = await rgba(original);
    expect((await sharp(path.join(root, result.image)).metadata()).width).toBe(
      64,
    );
    expect(bytes[3]).toBe(0);
    const inside = (20 * 64 + 20) * 4;
    expect(bytes.subarray(inside, inside + 4)).toEqual(
      source.subarray(inside, inside + 4),
    );
    expect(await readFile(path.join(root, 'source.png'))).toEqual(original);
    const recipe = JSON.parse(
      await readFile(path.join(root, result.manifest), 'utf8'),
    );
    expect(recipe.selection).toEqual(rectangle);
    const loop = await createArtwork(root, {
      source: 'source.png',
      operation: 'loop',
      selection: rectangle,
      motion: 'water',
      frameCount: 16,
      fps: 8,
      amplitude: 4,
    });
    expect(loop.animation!.frames).toHaveLength(16);
    await validateAnimationAssets(root, { animations: [loop.animation!] });
    const frames = await Promise.all(
      loop.animation!.frames.map((id) => rgba(path.join(root, id))),
    );
    expect(
      new Set(frames.map((b) => b.toString('base64'))).size,
    ).toBeGreaterThan(8);
    // First and last poses straddle the loop boundary without a hard end reset.
    const distance = (a: Buffer, b: Buffer) =>
      a.reduce((sum, value, i) => sum + Math.abs(value - b[i]!), 0);
    expect(distance(frames[0]!, frames.at(-1)!)).toBeLessThan(
      distance(frames[0]!, frames[8]!),
    );
    expect(
      (await readdir(path.join(root, 'scene-art'))).some((id) =>
        id.startsWith('.tmp'),
      ),
    ).toBe(false);
  });
});

test('masked AI extraction uses a server-only key, repairs only selected pixels and preserves a transparent original cutout', async () => {
  await fixture(async (root, original) => {
    const requests: Record<string, unknown>[] = [];
    const generated = await sharp({
      create: { width: 1536, height: 1024, channels: 4, background: '#00ff00' },
    })
      .png()
      .toBuffer();
    const result = await createArtwork(
      root,
      {
        source: 'source.png',
        operation: 'extract',
        selection: rectangle,
        prompt: 'Remove the table.',
        repairPadding: 0,
        confirmed: true,
      },
      {
        apiKey: 'test-art-secret',
        fetch: (async (url, init) => {
          expect(url).toBe('https://api.openai.com/v1/images/edits');
          expect((init!.headers as Record<string, string>).Authorization).toBe(
            'Bearer test-art-secret',
          );
          const body = JSON.parse(init!.body as string);
          expect(body.n).toBe(1);
          expect(body.model).toBe('gpt-image-2.5-sunburst');
          expect(body.quality).toBe('high');
          expect(body).not.toHaveProperty('input_fidelity');
          expect(body.output_format).toBe('png');
          expect(body).not.toHaveProperty('response_format');
          expect(body.prompt).toContain('Remove the selected object');
          const mask = await rgba(
            Buffer.from(body.mask.image_url.split(',')[1], 'base64'),
          );
          expect(mask[3]).toBe(255); // letterbox is protected
          expect(mask[(512 * 1536 + 768) * 4 + 3]).toBe(0);
          requests.push(body);
          return Response.json({
            data: [{ b64_json: generated.toString('base64') }],
          });
        }) as typeof fetch,
      },
    );
    expect(requests).toHaveLength(1);
    const edited = await rgba(path.join(root, result.image)),
      source = await rgba(original);
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        if (x < 8 || x >= 56 || y < 8 || y >= 40)
          expect(edited.subarray(i, i + 4)).toEqual(source.subarray(i, i + 4));
      }
    expect(edited.subarray((20 * 64 + 20) * 4, (20 * 64 + 20) * 4 + 4)).toEqual(
      Buffer.from([0, 255, 0, 255]),
    );
    expect((await rgba(path.join(root, result.cutout!)))[3]).toBe(0);
    expect(
      await readFile(path.join(root, result.manifest), 'utf8'),
    ).not.toContain('test-art-secret');
    expect(artStatus({ apiKey: 'test-art-secret' })).toEqual({
      configured: true,
      model: 'gpt-image-2.5-sunburst',
      quality: 'high',
    });
    expect(result).toMatchObject({
      model: 'gpt-image-2.5-sunburst',
      quality: 'high',
    });
    expect(
      JSON.parse(await readFile(path.join(root, result.manifest), 'utf8')),
    ).toMatchObject({ model: 'gpt-image-2.5-sunburst', quality: 'high' });
  });
});

test('Image API settings preserve server defaults, allow explicit comparison and reject incompatible quality before spending credits', async () => {
  await fixture(async (root) => {
    const valid = {
      source: 'source.png',
      operation: 'remove',
      selection: rectangle,
      prompt: 'Remove the table.',
      confirmed: true,
    };
    const output = await sharp({
      create: { width: 1536, height: 1024, channels: 4, background: '#fff' },
    })
      .png()
      .toBuffer();
    let calls = 0;
    const provider: typeof fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(init!.body as string);
      expect(body.size).toBe('1536x1024');
      expect(body.mask.image_url).toMatch(/^data:image\/png;base64,/);
      expect(body.images[0].image_url).toMatch(/^data:image\/png;base64,/);
      expect(body.n).toBe(1);
      expect(body.output_format).toBe('png');
      if (['gpt-image-1', 'gpt-image-1.5'].includes(body.model))
        expect(body.input_fidelity).toBe('high');
      else expect(body).not.toHaveProperty('input_fidelity');
      const result = Response.json({
        data: [{ b64_json: output.toString('base64') }],
      });
      requests.push(body);
      return result;
    };
    const requests: Record<string, unknown>[] = [];
    for (const config of [
      {
        server: { model: 'gpt-image-1.5', quality: 'medium' },
        input: {},
        model: 'gpt-image-1.5',
        quality: 'medium',
      },
      {
        server: { model: 'gpt-image-1.5', quality: 'medium' },
        input: { model: 'gpt-image-2.5-sunburst', quality: 'high' },
        model: 'gpt-image-2.5-sunburst',
        quality: 'high',
      },
      {
        server: {},
        input: { model: 'gpt-image-1.5', quality: 'low' },
        model: 'gpt-image-1.5',
        quality: 'low',
      },
      {
        server: {},
        input: { quality: 'xhigh' },
        model: 'gpt-image-2.5-sunburst',
        quality: 'xhigh',
      },
      {
        server: { model: 'gpt-image-2.5-sunburst-2026-09-08', quality: 'max' },
        input: {},
        model: 'gpt-image-2.5-sunburst-2026-09-08',
        quality: 'max',
      },
      {
        server: { model: 'gpt-image-1' },
        input: {},
        model: 'gpt-image-1',
        quality: 'high',
      },
    ]) {
      const result = await createArtwork(
        root,
        { ...valid, ...config.input },
        { apiKey: 'secret', fetch: provider, ...config.server },
      );
      expect(requests.at(-1)).toMatchObject({
        model: config.model,
        quality: config.quality,
      });
      expect(result).toMatchObject({
        model: config.model,
        quality: config.quality,
      });
      expect(
        JSON.parse(await readFile(path.join(root, result.manifest), 'utf8')),
      ).toMatchObject({ model: config.model, quality: config.quality });
    }
    const successfulCalls = calls;
    for (const input of [
      { model: 'gpt-image-1.5', quality: 'max' },
      { quality: 'unknown' },
      { quality: 3 },
      { model: 'unconfigured-model' },
      { model: {} },
    ])
      await expect(
        createArtwork(
          root,
          { ...valid, ...input },
          { apiKey: 'secret', fetch: provider },
        ),
      ).rejects.toThrow(/kvalita|model/);
    expect(calls).toBe(successfulCalls);
    await expect(
      createArtwork(root, valid, {
        apiKey: 'secret',
        quality: 'wrong',
        fetch: provider,
      }),
    ).rejects.toThrow('OPENAI_IMAGE_QUALITY');
    expect(calls).toBe(successfulCalls);
  });
});

test('scene graphics reject unsafe paths and invalid selections; failed provider calls never retry or publish partial assets', async () => {
  await fixture(async (root) => {
    const valid = {
      source: 'source.png',
      operation: 'remove',
      selection: rectangle,
      prompt: 'Remove table.',
      confirmed: true,
    };
    let paid = 0;
    const options = {
      apiKey: 'hidden-key',
      fetch: (async () => {
        paid++;
        return new Response('secret-provider-body', { status: 402 });
      }) as typeof fetch,
    };
    await expect(
      createArtwork(root, { ...valid, confirmed: false }, options),
    ).rejects.toThrow('výslovne');
    await expect(
      createArtwork(root, { ...valid, source: '../source.png' }, options),
    ).rejects.toThrow('lokálny');
    await symlink(path.join(root, 'source.png'), path.join(root, 'link.png'));
    await expect(
      createArtwork(root, { ...valid, source: 'link.png' }, options),
    ).rejects.toThrow('symbolické');
    await expect(
      createArtwork(
        root,
        {
          ...valid,
          selection: [
            { x: -1, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
        options,
      ),
    ).rejects.toThrow('Výber');
    expect(paid).toBe(0);
    await expect(createArtwork(root, valid, options)).rejects.toThrow(
      'HTTP 402',
    );
    expect(paid).toBe(1);
    await expect(
      createArtwork(root, valid, {
        ...options,
        fetch: (async () =>
          new Response('hidden-key and provider internals', {
            status: 200,
          })) as typeof fetch,
      }),
    ).rejects.toThrow('nečitateľnú');
    expect(await readdir(root)).not.toContain('scene-art');
    await expect(
      createArtwork(root, {
        source: 'source.png',
        operation: 'loop',
        selection: rectangle,
        frameCount: 300,
      }),
    ).rejects.toThrow('slučky');
    expect(await readdir(path.join(root, 'scene-art'))).toEqual([]);
  });
});

test('layer properties validate and hidden or decorative objects cannot dispatch game effects', () => {
  const layer = {
    id: 'layer',
    label: 'Cloud',
    decorative: true,
    hidden: false,
    locked: true,
    opacity: 0.4,
    image: 'cloud.png',
    bounds: { x: 0, y: 0, width: 64, height: 48 },
    onClick: [
      { effects: [{ type: 'flag' as const, id: 'clicked', value: true }] },
    ],
  };
  const content: GameContent = {
    id: 'art-test',
    startScene: 'scene',
    initialMessage: '',
    flags: ['clicked'],
    items: [],
    dialogues: [],
    combinations: [],
    scenes: [
      {
        id: 'scene',
        title: 'Scene',
        width: 64,
        height: 48,
        background: 'bg.png',
        backgroundHidden: true,
        hotspots: [layer],
      },
    ],
  };
  expect(validateProject(content, ['cloud.png', 'bg.png'])).toEqual([]);
  const state = initialState(content);
  expect(
    reduceGame(content, state, { type: 'interact', hotspotId: 'layer' }),
  ).toBe(state);
  const hidden = {
    ...content,
    scenes: [
      {
        ...content.scenes[0]!,
        hotspots: [{ ...layer, decorative: false, hidden: true }],
      },
    ],
  };
  expect(
    reduceGame(hidden, state, { type: 'interact', hotspotId: 'layer' }),
  ).toBe(state);
  expect(
    validateProject({
      ...content,
      scenes: [{ ...content.scenes[0], hotspots: [{ ...layer, opacity: 2 }] }],
    }),
  ).toContain('scenes[0].hotspots[0]: opacity must be within 0–1');
});
