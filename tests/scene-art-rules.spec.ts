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
import { readArtSource } from '../dev/artSource';
import { maskPng } from '../dev/objectMask';
import { composeRepair, featherRepair, prepareInpaint } from '../dev/inpaint';
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

test('repair feather reaches zero at the outer boundary, preserves the object and blends straight alpha correctly', async () => {
  const width = 40,
    height = 30;
  const object = Buffer.alloc(width * height),
    expanded = Buffer.alloc(width * height);
  for (let y = 4; y < 26; y++)
    for (let x = 4; x < 36; x++) expanded[y * width + x] = 255;
  for (let y = 10; y < 20; y++)
    for (let x = 10; x < 30; x++) object[y * width + x] = 255;
  const blend = await featherRepair(object, expanded, width, height, 4);
  expect(blend[15 * width + 4]).toBe(0);
  expect(blend[15 * width + 5]).toBeGreaterThan(0);
  expect(blend[15 * width + 5]).toBeLessThan(blend[15 * width + 6]!);
  expect(blend[15 * width + 7]).toBeLessThan(blend[15 * width + 8]!);
  expect(blend[15 * width + 10]).toBe(255);
  expect(await featherRepair(object, expanded, width, height, 0)).toEqual(
    expanded,
  );
  for (let p = 0; p < object.length; p++) {
    if (object[p]) expect(blend[p]).toBe(255);
    if (!expanded[p]) expect(blend[p]).toBe(0);
  }
  expect(
    composeRepair(
      Buffer.from([0, 0, 255, 128]),
      Buffer.from([255, 0, 0, 64]),
      Buffer.from([128]),
    ),
  ).toEqual(Buffer.from([85, 0, 170, 96]));
  // Hidden RGB under transparent pixels must not contaminate the seam.
  expect(
    composeRepair(
      Buffer.from([255, 0, 255, 0]),
      Buffer.from([0, 240, 0, 255]),
      Buffer.from([128]),
    ),
  ).toEqual(Buffer.from([0, 240, 0, 128]));
});

test('downsampling keeps thin mask components and padding stays protected in the exact API payload', async () => {
  const width = 3200,
    height = 1000;
  const source = await sharp({
    create: { width, height, channels: 4, background: '#809070' },
  })
    .png()
    .toBuffer();
  const mask = Buffer.alloc(width * height);
  for (let y = 10; y < 990; y++)
    for (const x of [2, 5, 10, 777, 1599]) mask[y * width + x] = 255;
  const prepared = await prepareInpaint(source, mask, width, height);
  const downsampled = await sharp(mask, { raw: { width, height, channels: 1 } })
    .resize(1536, 480, { kernel: 'nearest' })
    .png()
    .toBuffer();
  const old = await sharp(downsampled)
    .resize(width, height, { kernel: 'nearest' })
    .greyscale()
    .raw()
    .toBuffer();
  let lost = 0,
    oldLost = 0;
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      if (!prepared.mappedMask[p]) lost++;
      if (!old[p]) oldLost++;
    }
  expect(oldLost).toBeGreaterThan(0);
  expect(lost).toBe(0);
  const api = await rgba(prepared.apiMask);
  expect(api[3]).toBe(255);
  expect(prepared.geometry).toMatchObject({
    context: { x: 0, y: 0, width, height },
    canvas: { width: 1536, height: 1024 },
    content: { width: 1536, height: 480, left: 0, top: 272 },
  });
  expect(new Set(api.filter((_v, i) => i % 4 === 3))).toEqual(
    new Set([0, 255]),
  );
});

test('debug preparation never calls a provider and records native masks, exact model context and transform before generation', async () => {
  await fixture(async (root) => {
    const source = await readFile(path.join(root, 'source.png'));
    let calls = 0;
    const result = await createArtwork(
      root,
      {
        source: 'source.png',
        operation: 'remove',
        selection: rectangle,
        repairPadding: 4,
        debugOnly: true,
      },
      {
        fetch: (async () => {
          calls++;
          throw Error('must not call');
        }) as typeof fetch,
      },
    );
    expect(calls).toBe(0);
    expect(result.debugOnly).toBe(true);
    expect(result.debug!.files.returned).toBeUndefined();
    expect(result.debug!.files.final).toBeUndefined();
    expect(result.debug!.metrics).toMatchObject({
      lostObjectPixels: 0,
      boundaryMaxWeight: 0,
      feather: 2,
    });
    expect(await readFile(path.join(root, result.image))).toEqual(source);
    for (const id of Object.values(result.debug!.files).filter(Boolean))
      expect((await sharp(path.join(root, id!)).metadata()).format).toBe('png');
    const recipe = JSON.parse(
      await readFile(path.join(root, result.manifest), 'utf8'),
    );
    expect(recipe).toMatchObject({
      debugOnly: true,
      repairPadding: 4,
      repairFeather: 2,
    });
  });
});

test('identity and color-shifted provider responses distinguish scaling error, model drift and final composition without changing protected pixels', async () => {
  const info = test.info();
  await fixture(async (root) => {
    const width = 1280,
      height = 720;
    await writeFile(
      path.join(root, 'source.png'),
      await sharp('src/assets/demo-room.svg').png().toBuffer(),
    );
    const source = await readArtSource(root, 'source.png');
    const pixels = Buffer.alloc(width * height);
    for (let y = 350; y < 530; y++)
      for (let x = 350; x < 540; x++) pixels[y * width + x] = 255;
    const objectMask = {
      width,
      height,
      method: 'manual',
      sourceSha256: source.sourceSha256,
      data: (await maskPng(pixels, width, height)).toString('base64'),
    };
    for (const bias of [0, 16]) {
      let input: Buffer | undefined,
        mask: Buffer | undefined,
        returned: Buffer | undefined;
      const result = await createArtwork(
        root,
        {
          source: 'source.png',
          operation: 'remove',
          objectMask,
          repairPadding: 12,
          repairFeather: 4,
          prompt: 'Remove router.',
          confirmed: true,
        },
        {
          apiKey: 'never-archive-this',
          fetch: (async (_url, init) => {
            const body = JSON.parse(init!.body as string);
            input = Buffer.from(
              body.images[0].image_url.split(',')[1],
              'base64',
            );
            mask = Buffer.from(body.mask.image_url.split(',')[1], 'base64');
            if (!bias) returned = input;
            else {
              const { data, info } = await sharp(input)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
              for (let i = 0; i < data.length; i++)
                if (i % 4 !== 3) data[i] = Math.min(255, data[i]! + bias);
              returned = await sharp(data, {
                raw: { width: info.width, height: info.height, channels: 4 },
              })
                .png()
                .toBuffer();
            }
            return Response.json({
              data: [{ b64_json: returned.toString('base64') }],
            });
          }) as typeof fetch,
        },
      );
      const debug = result.debug!,
        files = debug.files;
      expect(await readFile(path.join(root, files.input))).toEqual(input);
      expect(await readFile(path.join(root, files.apiMask))).toEqual(mask);
      expect(await readFile(path.join(root, files.returned!))).toEqual(
        returned,
      );
      expect(debug.metrics.roundTripMae).toBeGreaterThan(0);
      // The positive shift clips bright input channels at 255.
      if (bias) {
        expect(debug.metrics.contextMae!).toBeGreaterThan(bias - 0.5);
        expect(debug.metrics.contextMae!).toBeLessThanOrEqual(bias);
        expect(debug.metrics.seamMae!).toBeGreaterThan(bias - 0.5);
        expect(debug.metrics.seamMae!).toBeLessThanOrEqual(bias);
      } else {
        expect(debug.metrics.contextMae).toBe(0);
        expect(debug.metrics.seamMae).toBe(0);
      }
      expect(debug.metrics).toMatchObject({
        outsideChanges: 0,
        boundaryMaxWeight: 0,
        lostObjectPixels: 0,
      });
      const blend = await sharp(path.join(root, files.blendMask))
        .greyscale()
        .raw()
        .toBuffer();
      const expanded = await sharp(path.join(root, files.expandedMask))
        .greyscale()
        .raw()
        .toBuffer();
      const restored = await rgba(path.join(root, files.restored!)),
        final = await rgba(path.join(root, files.final!));
      let mismatch = 0,
        outsideChanges = 0,
        boundaryChanges = 0;
      for (let p = 0; p < pixels.length; p++) {
        if (
          !expanded[p] &&
          !final
            .subarray(p * 4, p * 4 + 4)
            .equals(source.raw.subarray(p * 4, p * 4 + 4))
        )
          outsideChanges++;
        if (
          expanded[p] &&
          !blend[p] &&
          !final
            .subarray(p * 4, p * 4 + 4)
            .equals(source.raw.subarray(p * 4, p * 4 + 4))
        )
          boundaryChanges++;
        for (let c = 0; c < 3; c++)
          if (
            final[p * 4 + c] !==
            Math.round(
              (source.raw[p * 4 + c]! * (255 - blend[p]!) +
                restored[p * 4 + c]! * blend[p]!) /
                255,
            )
          )
            mismatch++;
      }
      expect(mismatch).toBe(0);
      expect(outsideChanges).toBe(0);
      expect(boundaryChanges).toBe(0);
      expect(
        await readFile(path.join(root, result.manifest), 'utf8'),
      ).not.toContain('never-archive-this');
      await writeFile(
        info.outputPath(`inpaint-${bias ? 'shifted' : 'identity'}-final.png`),
        await readFile(path.join(root, result.image)),
      );
      await writeFile(
        info.outputPath(`inpaint-${bias ? 'shifted' : 'identity'}-debug.json`),
        JSON.stringify(debug, null, 2),
      );
    }
  });
});

test('a wrong-sized provider image is archived for diagnosis and never stretched into a usable composition', async () => {
  await fixture(async (root) => {
    const wrong = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: '#37aa66' },
    })
      .png()
      .toBuffer();
    const result = await createArtwork(
      root,
      {
        source: 'source.png',
        operation: 'extract',
        selection: rectangle,
        prompt: 'Remove.',
        confirmed: true,
      },
      {
        apiKey: 'secret',
        fetch: (async () =>
          Response.json({
            data: [{ b64_json: wrong.toString('base64') }],
          })) as typeof fetch,
      },
    );
    expect(result.blockedReason).toContain('očakávané 1536 × 1024');
    expect(result.debug!.files.final).toBeUndefined();
    expect(result.debug!.files.restored).toBeUndefined();
    expect(result.cutout).toBeUndefined();
    expect(
      await readFile(path.join(root, result.debug!.files.returned!)),
    ).toEqual(wrong);
    expect(await readFile(path.join(root, result.image))).toEqual(
      await readFile(path.join(root, 'source.png')),
    );
  });
});

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
