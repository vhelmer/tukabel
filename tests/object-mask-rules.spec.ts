import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { readArtSource } from '../dev/artSource';
import { createArtwork } from '../dev/sceneArt';
import { maskPng, readObjectMask } from '../dev/objectMask';
import {
  segmentObject,
  segmentationStatus,
  matteObject,
} from '../dev/segmentation';
import { paintMask } from '../src/editor/maskCanvas';

test('alpha PNGs retain all 256 levels and intrinsic alpha is never multiplied twice', async () => {
  await fixture(async (root) => {
    const width = 256,
      height = 2;
    const raw = Buffer.alloc(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      raw.set([224, 80, 24, p < width ? 255 : 128], p * 4);
    }
    await writeFile(
      path.join(root, 'source.png'),
      await sharp(raw, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer(),
    );
    const source = await readArtSource(root, 'source.png');
    const alpha = Buffer.from(
      Array.from({ length: width * height }, (_, i) => i % 256),
    );
    const mask = {
      width,
      height,
      sourceSha256: source.sourceSha256,
      method: 'manual',
      data: (await maskPng(alpha, width, height)).toString('base64'),
      matting: { method: 'import', radius: 0, decontaminate: false },
    };
    expect((await readObjectMask(mask, source)).pixels).toEqual(alpha);
    await expect(
      readObjectMask({ ...mask, matting: undefined }, source),
    ).rejects.toThrow('Mäkké');
    await expect(
      readObjectMask(
        { ...mask, matting: { ...mask.matting, decontaminate: 'true' } },
        source,
      ),
    ).rejects.toThrow('mattingu');
    const result = await createArtwork(root, {
      source: 'source.png',
      operation: 'cutout',
      objectMask: mask,
    });
    const decoded = await rgba(path.join(root, result.image));
    for (let p = 0; p < alpha.length; p++) {
      expect(decoded[p * 4 + 3]).toBe(Math.min(raw[p * 4 + 3]!, alpha[p]!));
      expect(decoded.subarray(p * 4, p * 4 + 3)).toEqual(
        raw.subarray(p * 4, p * 4 + 3),
      );
    }
    expect(
      JSON.parse(await readFile(path.join(root, result.manifest), 'utf8'))
        .objectMask,
    ).toMatchObject({
      pixelOwnership: 'alpha',
      matting: mask.matting,
      ownershipMask: 'ownership-mask.png',
    });
  });
});

for (const method of ['closed-form', 'vitmatte'] as const) {
  test(`real ${method} preserves hard brush pixels, improves an antialiased black outline and exports exact cores`, async () => {
    test.setTimeout(120000);
    const status = await segmentationStatus({ python });
    test.skip(
      !(method === 'vitmatte' ? status.vitmatte : status.closedForm),
      'npm run setup:matting',
    );
    await fixture(async (root) => {
      const width = 128,
        height = 128;
      const foreground = await sharp(
        Buffer.from(
          '<svg width="128" height="128"><path d="M27.2 31.7Q65 5.3 98.1 35L101.6 96.2Q55 119.8 23.3 88Z" fill="#b7a05c" stroke="#202830" stroke-width="5"/></svg>',
        ),
      )
        .png()
        .toBuffer();
      const sourceBytes = await sharp({
        create: { width, height, channels: 4, background: '#c4d9e2' },
      })
        .composite([{ input: foreground }])
        .png()
        .toBuffer();
      await writeFile(path.join(root, 'source.png'), sourceBytes);
      const original = await readArtSource(root, 'source.png');
      const trueAlpha = await sharp(foreground)
        .extractChannel('alpha')
        .raw()
        .toBuffer();
      const prior = Buffer.from(trueAlpha.map((v) => (v >= 128 ? 255 : 0)));
      const seeds = Buffer.alloc(prior.length);
      seeds[64 * width + 64] = 255;
      seeds[3 * width + 3] = 128;
      const result = await matteObject(
        root,
        {
          source: 'source.png',
          mask: {
            width,
            height,
            sourceSha256: original.sourceSha256,
            method: 'manual',
            data: (await maskPng(prior, width, height)).toString('base64'),
          },
          seeds: (await maskPng(seeds, width, height)).toString('base64'),
          method,
          radius: 4,
          decontaminate: true,
        },
        { python },
      );
      const { pixels: alpha } = await readObjectMask(result, original);
      expect(new Set(alpha).size).toBeGreaterThan(32);
      expect(alpha[64 * width + 64]).toBe(255);
      expect(alpha[3 * width + 3]).toBe(0);
      let baseline = 0,
        error = 0;
      for (let p = 0; p < prior.length; p++) {
        baseline += Math.abs(prior[p]! - trueAlpha[p]!);
        error += Math.abs(alpha[p]! - trueAlpha[p]!);
      }
      expect(error).toBeLessThan(baseline * 0.65);
      const exported = await createArtwork(root, {
        source: 'source.png',
        operation: 'cutout',
        objectMask: result,
      });
      const raw = await rgba(path.join(root, exported.image));
      let coreChanges = 0,
        correctedEdges = 0,
        alphaChanges = 0;
      for (let p = 0; p < alpha.length; p++) {
        if (
          alpha[p] === 255 &&
          !raw
            .subarray(p * 4, p * 4 + 4)
            .equals(original.raw.subarray(p * 4, p * 4 + 4))
        )
          coreChanges++;
        if (
          alpha[p]! > 0 &&
          alpha[p]! < 255 &&
          !raw
            .subarray(p * 4, p * 4 + 3)
            .equals(original.raw.subarray(p * 4, p * 4 + 3))
        )
          correctedEdges++;
        if (raw[p * 4 + 3] !== alpha[p]) alphaChanges++;
      }
      expect(coreChanges).toBe(0);
      expect(alphaChanges).toBe(0);
      expect(correctedEdges).toBeGreaterThan(0);
      const repaired = await createArtwork(
        root,
        {
          source: 'source.png',
          operation: 'extract',
          objectMask: result,
          confirmed: true,
          prompt: 'Repair background.',
        },
        {
          apiKey: 'mock',
          fetch: (async (_url, init) => {
            const [w, h] = JSON.parse(init!.body as string)
              .size.split('x')
              .map(Number);
            return Response.json({
              data: [
                {
                  b64_json: (
                    await sharp({
                      create: {
                        width: w,
                        height: h,
                        channels: 4,
                        background: '#37404a',
                      },
                    })
                      .png()
                      .toBuffer()
                  ).toString('base64'),
                },
              ],
            });
          }) as typeof fetch,
        },
      );
      expect(repaired.reconstruction?.unexpectedPixels).toBe(0);
      expect(repaired.reconstruction?.edgePixels).toBeGreaterThan(0);
      await expect(
        matteObject(
          root,
          { source: 'source.png', method, radius: 0, decontaminate: true },
          { python },
        ),
      ).rejects.toThrow('nastavenie');
    });
  });
}

test('native-resolution matting stitches overlapping tiles without shifting or degrading the outline', async () => {
  test.setTimeout(120000);
  test.skip(
    !(await segmentationStatus({ python })).closedForm,
    'npm run setup:matting',
  );
  await fixture(async (root) => {
    const width = 1600,
      height = 900;
    const foreground = await sharp(
      Buffer.from(
        '<svg width="1600" height="900"><path d="M70.3 60.7L1520.1 85.2L1490.8 820.4L95.6 838.3Z" stroke="#202830" stroke-width="7" fill="#bd9d64"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    await sharp({
      create: { width, height, channels: 4, background: '#bdcfd8' },
    })
      .composite([{ input: foreground }])
      .png()
      .toFile(path.join(root, 'source.png'));
    const original = await readArtSource(root, 'source.png');
    const truth = await sharp(foreground)
      .extractChannel('alpha')
      .raw()
      .toBuffer();
    const prior = Buffer.from(truth.map((v) => (v >= 128 ? 255 : 0)));
    const result = await matteObject(
      root,
      {
        source: 'source.png',
        mask: {
          width,
          height,
          sourceSha256: original.sourceSha256,
          method: 'manual',
          data: (await maskPng(prior, width, height)).toString('base64'),
        },
        seeds: (
          await maskPng(Buffer.alloc(prior.length), width, height)
        ).toString('base64'),
        method: 'closed-form',
        radius: 4,
        decontaminate: false,
      },
      { python },
    );
    const { pixels } = await readObjectMask(result, original);
    expect([result.width, result.height]).toEqual([width, height]);
    let baseline = 0,
      error = 0,
      seamError = 0,
      seamBaseline = 0;
    for (let p = 0; p < pixels.length; p++) {
      const delta = Math.abs(pixels[p]! - truth[p]!);
      const base = Math.abs(prior[p]! - truth[p]!);
      error += delta;
      baseline += base;
      // Tile stride is 576; inspect its crossings with the actual outline.
      if (Math.abs((p % width) - 576) < 6 || Math.abs((p % width) - 1152) < 6) {
        seamError += delta;
        seamBaseline += base;
      }
    }
    expect(error).toBeLessThan(baseline * 0.1);
    expect(seamError).toBeLessThan(seamBaseline * 0.1);
  });
});

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

test('extraction keeps source pixels exact and publishes the repair margin instead of restoring missed outlines', async () => {
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
    expect(result.reconstruction?.cleanupPixels).toBeGreaterThan(0);
    expect(result.reconstruction).toMatchObject({
      unexpectedPixels: 0,
      selectedPixels: pixels.filter((v) => v === 255).length,
    });
    const background = await rgba(path.join(root, result.image));
    const repair = await sharp(path.join(root, result.repairMask!))
      .greyscale()
      .raw()
      .toBuffer();
    const combined = await rgba(path.join(root, result.reassembled!));
    let outsideChanges = 0;
    for (let p = 0; p < pixels.length; p++)
      if (
        !repair[p] &&
        !background
          .subarray(p * 4, p * 4 + 4)
          .equals(source.raw.subarray(p * 4, p * 4 + 4))
      )
        outsideChanges++;
    expect(outsideChanges).toBe(0);
    // The missed antialiased outline at x=9 used to be copied back from the source.
    expect(
      background.subarray((25 * width + 9) * 4, (25 * width + 9) * 4 + 4),
    ).toEqual(Buffer.from([73, 117, 100, 255]));
    let incorrect = 0;
    for (let p = 0; p < pixels.length; p++)
      if (
        (pixels[p] || !repair[p]) &&
        !combined
          .subarray(p * 4, p * 4 + 4)
          .equals(source.raw.subarray(p * 4, p * 4 + 4))
      )
        incorrect++;
    expect(incorrect).toBe(0);
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
      reconstruction: { unexpectedPixels: 0 },
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
        repairPadding: 0,
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
  pixels[55] = 73;
  paintMask(pixels, seeds, 10, 10, 5.5, 5.5, 1, 'unknown');
  expect(pixels[55]).toBe(73);
  expect(seeds[55]).toBe(64);
});

for (const method of ['grabcut', 'sam2'] as const) {
  test(`real local ${method} finds a cartoon clock and yields original-pixel assets`, async () => {
    test.setTimeout(120000);
    const options = {
      python,
      modelConfig:
        process.env.SAM2_CONFIG || 'configs/sam2.1/sam2.1_hiera_t.yaml',
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
    checkpoint: path.resolve('.local-tools/models/sam2.1_hiera_tiny.pt'),
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
    for (const mode of ['raw', 'edges', 'detail'] as const) {
      const refineEdges = mode !== 'raw';
      const detailPass = mode === 'detail';
      const result = await segmentObject(
        root,
        { ...input, refineEdges, detailPass },
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
      if (detailPass) {
        // A provider oracle removes only the router from the actual SVG. This
        // reproduces the publication bug without spending external API credits.
        const cleanSvg = svg.replace(drawing, '');
        const clean = await rgba(
          await sharp(Buffer.from(cleanSvg)).png().toBuffer(),
        );
        const repaired = await createArtwork(
          root,
          {
            source: 'source.png',
            operation: 'extract',
            objectMask: result,
            repairPadding: 12,
            confirmed: true,
            prompt: 'Remove the router and its outlines.',
          },
          {
            apiKey: 'mock',
            fetch: (async (_url, init) => {
              const [width, height] = JSON.parse(init!.body as string)
                .size.split('x')
                .map(Number);
              return Response.json({
                data: [
                  {
                    b64_json: (
                      await sharp(Buffer.from(cleanSvg))
                        .resize(width, height, {
                          fit: 'contain',
                          background: '#281e2b',
                        })
                        .png()
                        .toBuffer()
                    ).toString('base64'),
                  },
                ],
              });
            }) as typeof fetch,
          },
        );
        const backgroundBytes = await readFile(path.join(root, repaired.image));
        await writeFile(
          info.outputPath('router-clean-background.png'),
          backgroundBytes,
        );
        const background = await rgba(backgroundBytes);
        let previousGhosts = 0,
          remainingGhosts = 0;
        for (let p = 0; p < mask.length; p++) {
          if (mask[p]) continue;
          const i = p * 4;
          const delta = (a: Buffer, b: Buffer) =>
            Math.max(...[0, 1, 2].map((c) => Math.abs(a[i + c]! - b[i + c]!)));
          if (delta(source.raw, clean) > 60) {
            previousGhosts++;
            if (delta(background, source.raw) < delta(background, clean))
              remainingGhosts++;
          }
        }
        expect(previousGhosts).toBeGreaterThan(0);
        expect(remainingGhosts).toBeLessThan(previousGhosts * 0.1);
        expect(repaired.reconstruction?.unexpectedPixels).toBe(0);
      }
      const cutout = await createArtwork(root, {
        source: 'source.png',
        operation: 'cutout',
        objectMask: result,
      });
      const bytes = await readFile(path.join(root, cutout.image));
      await writeFile(info.outputPath(`router-${mode}.png`), bytes);
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
    expect(overlaps[2]!).toBeGreaterThan(0.97);
  });
});
