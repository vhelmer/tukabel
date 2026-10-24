import sharp from 'sharp';
import { polygonBounds } from '../src/game/polygon.ts';
import type { CropFrame, Point } from '../src/game/transforms.ts';

// The source is reference material only. No background repair or segmentation
// is needed: the provider must return an isolated object with real transparency.
export async function prepareGeneratedAsset(
  source: Buffer,
  points: readonly Point[],
  width: number,
  height: number,
) {
  const b = polygonBounds(points);
  const target = {
    x: Math.max(0, Math.floor(b.x)),
    y: Math.max(0, Math.floor(b.y)),
    width:
      Math.min(width, Math.ceil(b.x + b.width)) - Math.max(0, Math.floor(b.x)),
    height:
      Math.min(height, Math.ceil(b.y + b.height)) -
      Math.max(0, Math.floor(b.y)),
  };
  if (target.width < 2 || target.height < 2)
    throw Error('Oblast pro nový asset musí mít alespoň 2 × 2 pixely zdroje.');
  const outline = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon points="${points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="#ff3d9320" stroke="#ff3d93" stroke-width="${Math.max(2, Math.min(width, height) / 200)}"/></svg>`,
  );
  const resize = {
    width: 1536,
    height: 1536,
    fit: 'inside' as const,
    withoutEnlargement: true,
  };
  const reference = await sharp(source).resize(resize).png().toBuffer();
  const guide = await sharp(
    await sharp(source)
      .composite([{ input: outline }])
      .png()
      .toBuffer(),
  )
    .resize(resize)
    .png()
    .toBuffer();
  const size =
    target.width > target.height * 1.3
      ? '1536x1024'
      : target.height > target.width * 1.3
        ? '1024x1536'
        : '1024x1024';
  return { reference, guide, target, size };
}

export async function placeGeneratedAsset(
  generated: Buffer,
  target: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
) {
  const { data, info } = await sharp(generated)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width,
    top = info.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (!data[(y * info.width + x) * 4 + 3]) continue;
      if (!x || !y || x === info.width - 1 || y === info.height - 1)
        throw Error(
          'AI nevrátila celý samostatný objekt s průhledným okrajem. Výsledek nepoužívej jako asset; uprav zadání a spusť novou úlohu. Pozadí zůstalo beze změny.',
        );
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  if (right < left) throw Error('AI vrátila prázdný průhledný asset.');
  const { data: image, info: fit } = await sharp(generated)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize(target.width, target.height, { fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
  const frame: CropFrame = {
    x: target.x + Math.floor((target.width - fit.width) / 2),
    y: target.y + target.height - fit.height,
    width: fit.width,
    height: fit.height,
    sourceWidth,
    sourceHeight,
  };
  const full = await sharp({
    create: {
      width: sourceWidth,
      height: sourceHeight,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite([{ input: image, left: frame.x, top: frame.y }])
    .png()
    .toBuffer();
  return { image, full, frame };
}
