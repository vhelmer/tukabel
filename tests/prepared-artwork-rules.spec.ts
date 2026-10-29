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
    expect(blocked.blockedReason).toBeUndefined();
    expect(blocked.cutout).toBeDefined();
    const { inspectAssetAlpha } = await import('../dev/generatedAsset');
    const legacyRecipe = JSON.parse(
      await readFile(path.join(root, blocked.manifest), 'utf8'),
    );
    await writeFile(
      path.join(root, blocked.manifest),
      JSON.stringify({
        ...legacyRecipe,
        blockedReason: 'Starší výřez odmítnutý kvůli alfě na okraji.',
        assetDiagnostic: {
          image: 'extraction-returned.png',
          ...(await inspectAssetAlpha(generated)),
        },
      }),
    );
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
      (
        await readFile(
          path.join(
            root,
            path.dirname(blocked.manifest),
            'extraction-returned.png',
          ),
        )
      ).equals(generated),
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

async function assetArchive() {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { artHash } = await import('../dev/artSource');
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-asset-archive-'));
  const manifest = 'scene-art/11111111-1111-4111-8111-111111111111/recipe.json';
  const directory = path.join(root, path.dirname(manifest));
  await mkdir(directory, { recursive: true });
  const source = await sharp({
    create: { width: 100, height: 100, channels: 4, background: '#776655' },
  })
    .png()
    .toBuffer();
  const raw = Buffer.alloc(40 * 60 * 4);
  for (let y = 10; y < 50; y++)
    for (let x = 10; x < 30; x++) {
      raw[(y * 40 + x) * 4] = 180;
      raw[(y * 40 + x) * 4 + 3] = 254;
    }
  raw[3] = 1;
  raw[(40 * 60 - 1) * 4 + 3] = 1;
  const generated = await sharp(raw, {
    raw: { width: 40, height: 60, channels: 4 },
  })
    .png()
    .toBuffer();
  const recipe = {
    version: 3,
    operation: 'asset',
    source: 'source.png',
    sourceSha256: artHash(source),
    assetScale: 1,
    assetPlacement: {
      target: { x: 20, y: 10, width: 30, height: 40 },
      fit: 'contain',
      anchor: 'bottom-center',
      provider: 'provider-returned.png',
      guide: 'placement-guide.png',
      background: 'unchanged',
    },
    blockedReason: 'Starší výstup s alfou na okraji.',
    assetDiagnostic: { image: '../untrusted.png', borderPixels: 999 },
  };
  await Promise.all([
    writeFile(path.join(root, 'source.png'), source),
    writeFile(path.join(directory, 'source.png'), source),
    writeFile(path.join(directory, 'provider-input.png'), source),
    writeFile(path.join(directory, 'placement-guide.png'), source),
    writeFile(path.join(directory, 'provider-returned.png'), generated),
    writeFile(path.join(directory, 'image.png'), source),
    writeFile(path.join(root, manifest), JSON.stringify(recipe)),
  ]);
  return {
    root,
    manifest,
    directory,
    recipe,
    source,
    generated,
    raw,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('legacy generated asset recovery publishes independent cropped 1x/2x objects and keeps paid archives intact', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { prepareArchivedExtraction } = await import('../dev/prepareArtwork');
  const { artworkHistory } = await import('../dev/artHistory');
  const fixture = await assetArchive();
  const { root, manifest, directory } = fixture;
  try {
    const oldRecipe = await readFile(path.join(root, manifest));
    const blocked = (await artworkHistory(root, { source: 'source.png' }))[0];
    expect(blocked?.operation).toBe('asset');
    expect(blocked?.assetDiagnostic).toMatchObject({
      borderPixels: 2,
      maxBorderAlpha: 1,
      image: `${path.dirname(manifest)}/provider-returned.png`,
    });
    expect(blocked?.backgrounds).toBeUndefined();
    for (const scale of [1, 2] as const) {
      const result = await prepareArchivedExtraction(root, {
        manifest,
        source: 'source.png',
        scale,
        alignment: 'frame',
      });
      expect(result.operation).toBe('asset');
      expect(result.manifest).not.toBe(manifest);
      expect(result.cutoutFrame).toEqual({
        x: 25,
        y: 10,
        width: 20,
        height: 40,
        sourceWidth: 100,
        sourceHeight: 100,
      });
      expect(result.blockedReason).toBeUndefined();
      expect(result.backgrounds).toBeUndefined();
      expect(result.extractionMethod).toBeUndefined();
      expect(
        await sharp(path.join(root, result.image)).metadata(),
      ).toMatchObject({ width: 20 * scale, height: 40 * scale });
      expect(
        await sharp(path.join(root, result.cutoutFull!)).metadata(),
      ).toMatchObject({ width: 100, height: 100 });
      expect(
        await sharp(path.join(root, result.preview!)).metadata(),
      ).toMatchObject({ width: 100, height: 100 });
      const nextRecipe = JSON.parse(
        await readFile(path.join(root, result.manifest), 'utf8'),
      );
      expect(nextRecipe).toMatchObject({
        operation: 'asset',
        assetPlacement: fixture.recipe.assetPlacement,
        derivedFrom: manifest,
        alphaCutoff: 1,
        assetScale: scale,
      });
      expect(nextRecipe.blockedReason).toBeUndefined();
      expect(nextRecipe.assetDiagnostic).toBeUndefined();
      expect(
        (
          await readFile(
            path.join(
              root,
              path.dirname(result.manifest),
              'provider-returned.png',
            ),
          )
        ).equals(fixture.generated),
      ).toBe(true);
      expect(
        (
          await readFile(
            path.join(
              root,
              path.dirname(result.manifest),
              'placement-guide.png',
            ),
          )
        ).equals(fixture.source),
      ).toBe(true);
      const reopened = (
        await artworkHistory(root, { source: 'source.png' })
      ).find((r) => r.manifest === result.manifest);
      expect(reopened).toMatchObject({
        operation: 'asset',
        image: result.image,
        preview: result.preview,
        original: result.original,
        cutoutFrame: result.cutoutFrame,
        assetScale: scale,
      });
      expect(reopened?.backgrounds).toBeUndefined();
      expect(await artworkHistory(root, { source: result.image })).toEqual([]);
    }
    expect((await readFile(path.join(root, manifest))).equals(oldRecipe)).toBe(
      true,
    );
    expect(
      (await readFile(path.join(directory, 'provider-returned.png'))).equals(
        fixture.generated,
      ),
    ).toBe(true);
    expect(
      (await readFile(path.join(directory, 'image.png'))).equals(
        fixture.source,
      ),
    ).toBe(true);
  } finally {
    await fixture.cleanup();
  }
});

test('generated asset archive rejects genuine clipped or opaque pixels, stale sources and unsafe archive files', async () => {
  const { writeFile, rm, symlink, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { prepareArchivedExtraction } = await import('../dev/prepareArtwork');
  const { artworkHistory } = await import('../dev/artHistory');
  const fixture = await assetArchive();
  const { root, manifest, directory } = fixture;
  const request = { manifest, source: 'source.png', scale: 1 };
  try {
    await expect(
      prepareArchivedExtraction(root, { ...request, alignment: 'features' }),
    ).rejects.toThrow();
    for (const alpha of [2, 255]) {
      const raw = Buffer.from(fixture.raw);
      raw[3] = alpha;
      await writeFile(
        path.join(directory, 'provider-returned.png'),
        await sharp(raw, { raw: { width: 40, height: 60, channels: 4 } })
          .png()
          .toBuffer(),
      );
      await expect(prepareArchivedExtraction(root, request)).rejects.toThrow(
        'průhledným',
      );
    }
    await writeFile(
      path.join(directory, 'provider-returned.png'),
      fixture.generated,
    );
    await expect(
      prepareArchivedExtraction(root, {
        ...request,
        manifest: '../recipe.json',
      }),
    ).rejects.toThrow('Neplatný');
    await expect(
      prepareArchivedExtraction(root, { ...request, source: '../source.png' }),
    ).rejects.toThrow();
    await writeFile(
      path.join(root, manifest),
      JSON.stringify({
        ...fixture.recipe,
        assetPlacement: { target: { x: 90, y: 10, width: 30, height: 40 } },
      }),
    );
    await expect(prepareArchivedExtraction(root, request)).rejects.toThrow(
      'rám',
    );
    await writeFile(path.join(root, manifest), JSON.stringify(fixture.recipe));
    const provider = path.join(directory, 'provider-returned.png');
    await rm(provider);
    await symlink(path.join(root, 'source.png'), provider);
    await expect(prepareArchivedExtraction(root, request)).rejects.toThrow();
    expect(await artworkHistory(root, { source: 'source.png' })).toEqual([]);
    await rm(provider);
    await writeFile(provider, fixture.generated);
    const savedRecipe = await readFile(path.join(root, manifest));
    await rm(path.join(root, manifest));
    await writeFile(path.join(root, 'outside-recipe.json'), savedRecipe);
    await symlink(
      path.join(root, 'outside-recipe.json'),
      path.join(root, manifest),
    );
    await expect(prepareArchivedExtraction(root, request)).rejects.toThrow();
    expect(await artworkHistory(root, { source: 'source.png' })).toEqual([]);
    await rm(path.join(root, manifest));
    await writeFile(path.join(root, manifest), savedRecipe);
    await writeFile(
      path.join(root, 'source.png'),
      await sharp(fixture.source).negate().png().toBuffer(),
    );
    await expect(prepareArchivedExtraction(root, request)).rejects.toThrow(
      'zdroji',
    );
    expect(await artworkHistory(root, { source: 'source.png' })).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});

test('history omits generated assets with inconsistent crop dimensions or unsupported scales', async () => {
  const { readFile, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { prepareArchivedExtraction } = await import('../dev/prepareArtwork');
  const { artworkHistory } = await import('../dev/artHistory');
  const fixture = await assetArchive();
  try {
    const ready = await prepareArchivedExtraction(fixture.root, {
      manifest: fixture.manifest,
      source: 'source.png',
      scale: 2,
    });
    const filename = path.join(fixture.root, ready.manifest);
    const recipe = JSON.parse(await readFile(filename, 'utf8'));
    for (const invalid of [
      { ...recipe, cutoutFrame: { ...recipe.cutoutFrame, width: 21 } },
      {
        ...recipe,
        assetScale: 3,
        cutoutFrame: { ...recipe.cutoutFrame, width: 40, height: 80 },
      },
    ]) {
      await writeFile(filename, JSON.stringify(invalid));
      expect(
        (await artworkHistory(fixture.root, { source: 'source.png' })).some(
          (r) => r.manifest === ready.manifest,
        ),
      ).toBe(false);
    }
    await writeFile(filename, JSON.stringify(recipe));
    const atOne = await prepareArchivedExtraction(fixture.root, {
      manifest: ready.manifest,
      source: 'source.png',
      scale: 1,
    });
    expect(atOne.cutoutFrame).toEqual(ready.cutoutFrame);
    expect(
      await sharp(path.join(fixture.root, atOne.image)).metadata(),
    ).toMatchObject({ width: 20, height: 40 });
  } finally {
    await fixture.cleanup();
  }
});
