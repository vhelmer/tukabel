import sharp from 'sharp';

// SAM/hand selection determines placement, never clips the provider's new alpha.
export async function prepareExtractedAsset(
  source: Buffer,
  pixels: Buffer,
  width: number,
  height: number,
) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (pixels[y * width + x]) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
  if (right < left) throw Error('Výběr pro OpenAI výřez je prázdný.');
  const target = {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  const padding = Math.max(
    8,
    Math.ceil(Math.max(target.width, target.height) * 0.12),
  );
  const crop = {
    left: Math.max(0, left - padding),
    top: Math.max(0, top - padding),
    width: Math.min(width, right + padding + 1) - Math.max(0, left - padding),
    height: Math.min(height, bottom + padding + 1) - Math.max(0, top - padding),
  };
  const overlay = Buffer.alloc(width * height * 4);
  for (let p = 0; p < pixels.length; p++) {
    overlay[p * 4] = 255;
    overlay[p * 4 + 1] = 61;
    overlay[p * 4 + 2] = 147;
    overlay[p * 4 + 3] = pixels[p] ? 80 : 0;
  }
  const size =
    target.width > target.height * 1.3
      ? '1536x1024'
      : target.height > target.width * 1.3
        ? '1024x1536'
        : '1024x1024';
  const resize = {
    width: 1536,
    height: 1536,
    fit: 'inside' as const,
    withoutEnlargement: true,
  };
  const reference = await sharp(source)
    .extract(crop)
    .resize(resize)
    .png()
    .toBuffer();
  const guide = await sharp(
    await sharp(source)
      .composite([{ input: overlay, raw: { width, height, channels: 4 } }])
      .png()
      .toBuffer(),
  )
    .extract(crop)
    .resize(resize)
    .png()
    .toBuffer();
  return { reference, guide, target, crop, size };
}
