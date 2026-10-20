import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { readArtSource } from '../dev/artSource';
import { createArtwork } from '../dev/sceneArt';
import { maskPng, readObjectMask } from '../dev/objectMask';
import { segmentObject, segmentationStatus } from '../dev/segmentation';
import { paintMask } from '../src/editor/maskCanvas';

const python = path.resolve('.local-tools/segmentation/bin/python');
const rgba = (file: string | Buffer) =>
  sharp(file).ensureAlpha().raw().toBuffer();
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-masks-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('extraction preserves every source RGB/alpha sample and reassembles without changing even antialiased outlines or holes', async () => {
  await fixture(async (root) => {
    const width = 96,
      height = 64;
    const original = await sharp(
      Buffer.from(
        `<svg width="96" height="64"><rect width="96" height="64" fill="#ddc491"/><path d="M13.3 11.8H70.6V45.2H13.3Z" fill="#a34b35" stroke="#262e27" stroke-width="5"/><path d="M32 20h12v13H32Z" fill="#ddc491"/></svg>`,
      ),
    )
      .png()
      .toBuffer();
    await writeFile(path.join(root, 'source.png'), original);
    const source = await readArtSource(root, 'source.png');
    const pixels = Buffer.alloc(width * height);
    for (let y = 8; y < 49; y++)
      for (let x = 10; x < 75; x++)
        if (!(x >= 32 && x < 44 && y >= 20 && y < 33))
          pixels[y * width + x] = 255;
    const mask = {
      width,
      height,
      sourceSha256: source.sourceSha256,
      data: (await maskPng(pixels, width, height)).toString('base64'),
      method: 'manual',
    };
    let calls = 0,
      observedMaskAlpha = -1;
    const result = await createArtwork(
      root,
      {
        source: 'source.png',
        operation: 'extract',
        objectMask: mask,
        confirmed: true,
        prompt: 'Repair background.',
        repairPadding: 5,
      },
      {
        apiKey: 'secret',
        fetch: (async (_url, init) => {
          calls++;
          const body = JSON.parse(init!.body as string),
            [w, h] = body.size.split('x').map(Number);
          const providerMask = await rgba(
            Buffer.from(body.mask.image_url.split(',')[1], 'base64'),
          );
          // Selected area plus an independent expanded repair mask is sent to AI.
          observedMaskAlpha = providerMask[(512 * 1536 + 160) * 4 + 3]!;
          const generated = await sharp({
            create: { width: w, height: h, channels: 4, background: '#497564' },
          })
            .png()
            .toBuffer();
          return Response.json({
            data: [{ b64_json: generated.toString('base64') }],
          });
        }) as typeof fetch,
      },
    );
    const cutout = await rgba(path.join(root, result.cutout!));
    const expectedCutout = Buffer.from(source.raw);
    for (let p = 0; p < pixels.length; p++)
      expectedCutout[p * 4 + 3] = pixels[p] ? source.raw[p * 4 + 3]! : 0;
    expect(cutout).toEqual(expectedCutout);
    expect(await rgba(path.join(root, result.reassembled!))).toEqual(
      source.raw,
    );
    expect(result.reconstruction).toEqual({
      changedPixels: 0,
      selectedPixels: pixels.filter((v) => v === 255).length,
    });
    const background = await rgba(path.join(root, result.image));
    let outsideChanges = 0;
    for (let p = 0; p < pixels.length; p++)
      if (
        !pixels[p] &&
        !background
          .subarray(p * 4, p * 4 + 4)
          .equals(source.raw.subarray(p * 4, p * 4 + 4))
      )
        outsideChanges++;
    expect(outsideChanges).toBe(0);
    expect(calls).toBe(1);
    expect(observedMaskAlpha).toBe(0);
    expect(
      JSON.parse(await readFile(path.join(root, result.manifest), 'utf8')),
    ).toMatchObject({
      version: 2,
      objectMask: {
        file: 'object-mask.png',
        method: 'manual',
        pixelOwnership: 'binary',
      },
      repairPadding: 5,
      reconstruction: { changedPixels: 0 },
    });
  });
});

test('transparent source edge alpha is retained and stale, soft, colored or mis-sized masks are rejected before paid calls', async () => {
  await fixture(async (root) => {
    const raw = Buffer.from([
      20, 40, 60, 255, 80, 100, 120, 128, 0, 0, 0, 0, 45, 67, 89, 255,
    ]);
    await writeFile(
      path.join(root, 'source.png'),
      await sharp(raw, { raw: { width: 2, height: 2, channels: 4 } })
        .png()
        .toBuffer(),
    );
    const source = await readArtSource(root, 'source.png');
    const mask = {
      width: 2,
      height: 2,
      sourceSha256: source.sourceSha256,
      data: (await maskPng(Buffer.from([255, 255, 255, 0]), 2, 2)).toString(
        'base64',
      ),
      method: 'manual',
    };
    const result = await createArtwork(
      root,
      {
        source: 'source.png',
        operation: 'extract',
        objectMask: mask,
        confirmed: true,
        prompt: 'Repair.',
      },
      {
        apiKey: 'secret',
        fetch: (async () =>
          Response.json({
            data: [
              {
                b64_json: (
                  await sharp({
                    create: {
                      width: 1024,
                      height: 1024,
                      channels: 4,
                      background: 'green',
                    },
                  })
                    .png()
                    .toBuffer()
                ).toString('base64'),
              },
            ],
          })) as typeof fetch,
      },
    );
    expect((await rgba(path.join(root, result.cutout!)))[7]).toBe(128);
    expect(await rgba(path.join(root, result.reassembled!))).toEqual(raw);
    for (const invalid of [
      { ...mask, sourceSha256: 'stale' },
      { ...mask, width: 3 },
      {
        ...mask,
        data: (await maskPng(Buffer.from([128, 255, 0, 0]), 2, 2)).toString(
          'base64',
        ),
      },
    ])
      await expect(readObjectMask(invalid, source)).rejects.toThrow();
    await expect(
      readObjectMask(
        {
          ...mask,
          data: (
            await sharp({
              create: {
                width: 2,
                height: 2,
                channels: 4,
                background: '#ff0000',
              },
            })
              .png()
              .toBuffer()
          ).toString('base64'),
        },
        source,
      ),
    ).rejects.toThrow('farebných');
    let calls = 0;
    await expect(
      createArtwork(
        root,
        {
          source: 'source.png',
          operation: 'extract',
          objectMask: { ...mask, sourceSha256: 'stale' },
          prompt: 'Repair',
          confirmed: true,
        },
        {
          apiKey: 'secret',
          fetch: (async () => {
            calls++;
            throw Error('Must not call');
          }) as typeof fetch,
        },
      ),
    ).rejects.toThrow('zmenenému');
    expect(calls).toBe(0);
  });
});

test('mask brush clips at canvas edges and supports foreground, background and source-pixel alignment', () => {
  const pixels = new Uint8Array(100),
    seeds = new Uint8Array(100);
  paintMask(pixels, seeds, 10, 10, 0, 0, 2, true);
  expect(pixels[0]).toBe(255);
  expect(seeds[0]).toBe(255);
  expect(pixels[99]).toBe(0);
  paintMask(pixels, seeds, 10, 10, 0.5, 0.5, 1, false);
  expect(pixels[0]).toBe(0);
  expect(seeds[0]).toBe(128);
});

for (const method of ['grabcut', 'sam2'] as const) {
  test(`real local ${method} finds a cartoon clock and yields original-pixel assets`, async () => {
    test.setTimeout(120000);
    const options = {
      python,
      checkpoint:
        process.env.SAM2_CHECKPOINT ||
        path.resolve('.local-tools/models/sam2.1_hiera_tiny.pt'),
    };
    const info = test.info();
    const status = await segmentationStatus(options);
    test.skip(
      !status[method],
      method === 'sam2'
        ? 'Install SAM 2 and its local checkpoint; see README'
        : 'Install local OpenCV with npm run setup:segmentation',
    );
    await fixture(async (root) => {
      await writeFile(
        path.join(root, 'source.png'),
        await sharp('src/assets/demo-room.svg').png().toBuffer(),
      );
      const source = await readArtSource(root, 'source.png'),
        pixels = Buffer.alloc(source.width * source.height),
        seeds = Buffer.alloc(pixels.length);
      for (let y = 55; y < 195; y++)
        for (let x = 830; x < 975; x++) pixels[y * source.width + x] = 255;
      // A few face/outline samples, no manually traced silhouette.
      paintMask(pixels, seeds, source.width, source.height, 905, 105, 8, true);
      paintMask(pixels, seeds, source.width, source.height, 849, 120, 2, true);
      paintMask(pixels, seeds, source.width, source.height, 965, 180, 4, false);
      const result = await segmentObject(
        root,
        {
          source: 'source.png',
          method,
          mask: {
            width: source.width,
            height: source.height,
            sourceSha256: source.sourceSha256,
            data: (await maskPng(pixels, source.width, source.height)).toString(
              'base64',
            ),
            method: 'manual',
          },
          seeds: (await maskPng(seeds, source.width, source.height)).toString(
            'base64',
          ),
        },
        options,
      );
      const mask = await readObjectMask(result, source);
      for (let p = 0; p < seeds.length; p++) {
        if (seeds[p] === 255) expect(mask.pixels[p]).toBe(255);
        if (seeds[p] === 128) expect(mask.pixels[p]).toBe(0);
      }
      expect(mask.pixels[105 * source.width + 905]).toBe(255);
      expect(mask.pixels[120 * source.width + 849]).toBe(255);
      expect(mask.pixels[60 * source.width + 835]).toBe(0);
      expect(mask.pixels[180 * source.width + 965]).toBe(0);
      const area = mask.pixels.filter((v) => v === 255).length;
      const cutout = await createArtwork(root, {
        source: 'source.png',
        operation: 'cutout',
        objectMask: result,
      });
      await writeFile(
        info.outputPath(`${method}-clock-cutout.png`),
        await readFile(path.join(root, cutout.image)),
      );
      const image = await rgba(path.join(root, cutout.image));
      let changed = 0;
      for (let p = 0; p < mask.pixels.length; p++)
        if (
          mask.pixels[p] &&
          !image
            .subarray(p * 4, p * 4 + 4)
            .equals(source.raw.subarray(p * 4, p * 4 + 4))
        )
          changed++;
      expect(changed).toBe(0);
      expect(area).toBeGreaterThan(7000);
      expect(area).toBeLessThan(16000);
    });
  });
}

test('SAM source-edge refinement recovers both router antennae and keeps cutout pixels opaque and source-identical', async () => {
  test.setTimeout(120000);
  const info = test.info();
  const options = {
    python,
    checkpoint:
      process.env.SAM2_CHECKPOINT ||
      path.resolve('.local-tools/models/sam2.1_hiera_tiny.pt'),
  };
  test.skip(
    !(await segmentationStatus(options)).sam2,
    'Install local SAM 2; see README',
  );
  await fixture(async (root) => {
    const svg = await readFile('src/assets/demo-room.svg', 'utf8');
    await writeFile(
      path.join(root, 'source.png'),
      await sharp(Buffer.from(svg)).png().toBuffer(),
    );
    const source = await readArtSource(root, 'source.png');
    // Independent ground truth from the actual drawing, including its outlines.
    const drawing = svg
      .split('<!-- Router:')[1]!
      .split('-->')[1]!
      .split('<!-- A mug')[0]!;
    const truthRgba = await rgba(
      await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><g stroke="#383b32" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">${drawing}</g></svg>`,
        ),
      )
        .png()
        .toBuffer(),
    );
    const truth = Buffer.alloc(source.width * source.height);
    for (let p = 0; p < truth.length; p++)
      truth[p] = truthRgba[p * 4 + 3]! >= 128 ? 255 : 0;
    const pixels = Buffer.alloc(truth.length);
    // Same loose rectangle used when the router's left antenna lost half its pixels.
    for (let y = 326; y < 543; y++)
      for (let x = 317; x < 598; x++) pixels[y * source.width + x] = 255;
    const input = {
      source: 'source.png',
      method: 'sam2',
      mask: {
        width: source.width,
        height: source.height,
        sourceSha256: source.sourceSha256,
        data: (await maskPng(pixels, source.width, source.height)).toString(
          'base64',
        ),
        method: 'manual',
      },
      seeds: (
        await maskPng(Buffer.alloc(truth.length), source.width, source.height)
      ).toString('base64'),
    };
    const overlaps: number[] = [];
    for (const refineEdges of [false, true]) {
      const result = await segmentObject(
        root,
        { ...input, refineEdges },
        options,
      );
      expect(result.refineEdges).toBe(refineEdges);
      const { pixels: mask } = await readObjectMask(result, source);
      let intersection = 0,
        union = 0;
      for (let p = 0; p < mask.length; p++) {
        if (mask[p] && truth[p]) intersection++;
        if (mask[p] || truth[p]) union++;
      }
      overlaps.push(intersection / union);
      if (refineEdges) {
        for (const [left, right] of [
          [325, 375],
          [510, 560],
        ]) {
          let expected = 0,
            retained = 0;
          for (let y = 345; y < 437; y++)
            for (let x = left!; x < right!; x++) {
              const p = y * source.width + x;
              if (truth[p]) {
                expected++;
                if (mask[p]) retained++;
              }
            }
          expect(retained / expected).toBeGreaterThan(0.985);
        }
      }
      const cutout = await createArtwork(root, {
        source: 'source.png',
        operation: 'cutout',
        objectMask: result,
      });
      const bytes = await readFile(path.join(root, cutout.image));
      await writeFile(
        info.outputPath(
          refineEdges ? 'router-refined.png' : 'router-raw-sam.png',
        ),
        bytes,
      );
      const raw = await rgba(bytes);
      let alteredPixels = 0;
      for (let p = 0; p < mask.length; p++) {
        const i = p * 4;
        if (
          mask[p]
            ? !raw.subarray(i, i + 4).equals(source.raw.subarray(i, i + 4))
            : raw[i + 3] !== 0
        )
          alteredPixels++;
      }
      expect(alteredPixels).toBe(0);
      expect(
        JSON.parse(await readFile(path.join(root, cutout.manifest), 'utf8'))
          .objectMask.refineEdges,
      ).toBe(refineEdges);
    }
    expect(overlaps[1]!).toBeGreaterThan(0.96);
    expect(overlaps[1]! - overlaps[0]!).toBeGreaterThan(0.06);
  });
});
