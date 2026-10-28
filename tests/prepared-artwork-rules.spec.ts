import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { placeGeneratedAsset } from '../dev/generatedAsset';

test('negligible alpha is removed explicitly, 2x changes pixels but not scene geometry', async () => {
  const raw = Buffer.alloc(40 * 60 * 4);
  for (let y = 10; y < 50; y++)
    for (let x = 10; x < 30; x++) {
      raw[(y * 40 + x) * 4] = 180;
      raw[(y * 40 + x) * 4 + 3] = 254;
    }
  raw[3] = 1;
  const png = await sharp(raw, { raw: { width: 40, height: 60, channels: 4 } })
    .png()
    .toBuffer();
  const target = { x: 20, y: 10, width: 20, height: 40 };
  await expect(placeGeneratedAsset(png, target, 100, 100)).rejects.toThrow(
    'průhledným',
  );
  const a = await placeGeneratedAsset(png, target, 100, 100, {
    alphaCutoff: 1,
    scale: 1,
  });
  const b = await placeGeneratedAsset(png, target, 100, 100, {
    alphaCutoff: 1,
    scale: 2,
  });
  expect(a.frame).toEqual(b.frame);
  expect((await sharp(a.image).metadata()).width).toBe(20);
  expect((await sharp(b.image).metadata()).width).toBe(40);
  expect((await sharp(b.full).metadata()).width).toBe(100);
  const bad = Buffer.from(raw);
  bad[3] = 255;
  await expect(
    placeGeneratedAsset(
      await sharp(bad, { raw: { width: 40, height: 60, channels: 4 } })
        .png()
        .toBuffer(),
      target,
      100,
      100,
      { alphaCutoff: 1, scale: 1 },
    ),
  ).rejects.toThrow('průhledným');
});

test('archived extraction is locally recoverable at 1x/2x, preserves originals and rejects stale or unsafe requests', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { createArtwork } = await import('../dev/sceneArt');
  const { prepareArchivedExtraction } = await import('../dev/prepareArtwork');
  const { artworkHistory } = await import('../dev/artHistory');
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-prepare-test-'));
  try {
    const source = await sharp({
      create: { width: 100, height: 100, channels: 4, background: '#776655' },
    })
      .png()
      .toBuffer();
    await writeFile(path.join(root, 'source.png'), source);
    const raw = Buffer.alloc(40 * 60 * 4);
    for (let y = 10; y < 50; y++)
      for (let x = 10; x < 30; x++) {
        raw[(y * 40 + x) * 4] = 180;
        raw[(y * 40 + x) * 4 + 3] = 254;
      }
    raw[3] = 1;
    const generated = await sharp(raw, {
      raw: { width: 40, height: 60, channels: 4 },
    })
      .png()
      .toBuffer();
    let calls = 0;
    const blocked = await createArtwork(
      root,
      {
        operation: 'extract',
        extractionMethod: 'openai',
        source: 'source.png',
        selection: [
          { x: 20, y: 10 },
          { x: 40, y: 10 },
          { x: 40, y: 50 },
          { x: 20, y: 50 },
        ],
        confirmed: true,
        prompt: 'Oprav.',
      },
      {
        apiKey: 'test-secret',
        fetch: (async (_url, init) => {
          calls++;
          const body = JSON.parse(init!.body as string);
          return Response.json({
            data: [
              {
                b64_json:
                  body.background === 'transparent'
                    ? generated.toString('base64')
                    : body.images[0].image_url.split(',')[1],
              },
            ],
          });
        }) as typeof fetch,
      },
    );
    expect(blocked.blockedReason).toBeDefined();
    const oldRecipe = await readFile(path.join(root, blocked.manifest));
    const one = await prepareArchivedExtraction(root, {
      manifest: blocked.manifest,
      source: 'source.png',
      scale: 1,
    });
    const two = await prepareArchivedExtraction(root, {
      manifest: blocked.manifest,
      source: 'source.png',
      scale: 2,
    });
    expect(one.blockedReason).toBeUndefined();
    expect(two.cutoutFrame).toEqual(one.cutoutFrame);
    expect((await sharp(path.join(root, one.cutout!)).metadata()).width).toBe(
      one.cutoutFrame!.width,
    );
    expect((await sharp(path.join(root, two.cutout!)).metadata()).width).toBe(
      one.cutoutFrame!.width * 2,
    );
    expect(
      (await readFile(path.join(root, blocked.manifest))).equals(oldRecipe),
    ).toBe(true);
    expect(
      (await readFile(path.join(root, blocked.assetDiagnostic!.image))).equals(
        generated,
      ),
    ).toBe(true);
    expect(calls).toBe(2);
    const history = await artworkHistory(root, { source: 'source.png' });
    expect(history.find((r) => r.manifest === two.manifest)?.assetScale).toBe(
      2,
    );
    await expect(
      prepareArchivedExtraction(root, {
        manifest: '../recipe.json',
        source: 'source.png',
        scale: 1,
      }),
    ).rejects.toThrow('Neplatný');
    await expect(
      prepareArchivedExtraction(root, {
        manifest: blocked.manifest,
        source: 'source.png',
        scale: 3,
      }),
    ).rejects.toThrow('Neplatný');
    await writeFile(
      path.join(root, 'source.png'),
      await sharp(source).negate().png().toBuffer(),
    );
    await expect(
      prepareArchivedExtraction(root, {
        manifest: blocked.manifest,
        source: 'source.png',
        scale: 1,
      }),
    ).rejects.toThrow('zdroji');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
