import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { validateRegistration, registerAsset } from '../dev/registerAsset';

test('registration rejects weak matches and invalid geometry, accepting only verified full-canvas placements', async () => {
  const full = await sharp({
    create: { width: 100, height: 80, channels: 4, background: '#00000000' },
  })
    .png()
    .toBuffer();
  const image = await sharp({
    create: { width: 20, height: 30, channels: 4, background: '#445566' },
  })
    .png()
    .toBuffer();
  const match = {
    method: 'features',
    matches: 40,
    inliers: 30,
    inlierRatio: 0.75,
    medianError: 1,
    p90Error: 2,
    coverageX: 0.5,
    coverageY: 0.6,
    matrix: [0.5, 0, 12, 0, 0.5, 20],
    frame: {
      x: 12,
      y: 20,
      width: 20,
      height: 30,
      sourceWidth: 100,
      sourceHeight: 80,
    },
  };
  const valid = await validateRegistration(
    {
      alignment: match,
      'result.png': image.toString('base64'),
      'full.png': full.toString('base64'),
    },
    100,
    80,
    1,
  );
  expect(valid.frame).toEqual(match.frame);
  await expect(
    validateRegistration(
      {
        alignment: { ...match, inliers: 3 },
        'result.png': image.toString('base64'),
        'full.png': full.toString('base64'),
      },
      100,
      80,
      1,
    ),
  ).rejects.toThrow('shod');
  await expect(
    validateRegistration(
      {
        alignment: match,
        'result.png': image.toString('base64'),
        'full.png': image.toString('base64'),
      },
      100,
      80,
      1,
    ),
  ).rejects.toThrow('rozměry');
});

test('registration accepts only a similarity transform, never shear or unreliable scale', async () => {
  const full = await sharp({
    create: { width: 100, height: 80, channels: 4, background: '#00000000' },
  })
    .png()
    .toBuffer();
  const image = await sharp({
    create: { width: 20, height: 30, channels: 4, background: '#445566' },
  })
    .png()
    .toBuffer();
  const a = {
    method: 'features',
    matches: 40,
    inliers: 30,
    inlierRatio: 0.75,
    medianError: 1,
    p90Error: 2,
    coverageX: 0.5,
    coverageY: 0.6,
    matrix: [0.5, 0.2, 12, 0, 0.5, 20],
    frame: {
      x: 12,
      y: 20,
      width: 20,
      height: 30,
      sourceWidth: 100,
      sourceHeight: 80,
    },
  };
  await expect(
    validateRegistration(
      {
        alignment: a,
        'result.png': image.toString('base64'),
        'full.png': full.toString('base64'),
      },
      100,
      80,
      1,
    ),
  ).rejects.toThrow('transformace');
});

test('registration cannot bypass rejection of opaque or clipped provider outputs', async () => {
  const source = await sharp({
    create: { width: 100, height: 80, channels: 4, background: '#556677' },
  })
    .png()
    .toBuffer();
  const opaque = await sharp({
    create: { width: 30, height: 30, channels: 4, background: '#776655' },
  })
    .png()
    .toBuffer();
  const clipped = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect x="0" y="5" width="20" height="20" fill="red"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  for (const generated of [opaque, clipped])
    await expect(
      registerAsset(source, generated, source, 100, 80, 1, {
        python: '/must-not-run',
      }),
    ).rejects.toThrow('neprůhledný obsah na okraji');
});
