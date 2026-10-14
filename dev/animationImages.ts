import sharp from 'sharp';
import type { AnimationKind, ImageRegion } from '../src/game/types.ts';
import type { GenerationRequest } from '../src/editor/animationTypes.ts';

export function framePlan(kind: AnimationKind, count: number): number[] {
  if (kind === 'blink')
    return Array.from(
      { length: count },
      (_, index) =>
        Math.min(index, count - 1 - index) / Math.floor((count - 1) / 2),
    );
  if (kind === 'expression')
    return Array.from({ length: count }, (_, index) => index / (count - 1));
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? 0 : index / (count - 1),
  );
}
export function validateGenerationRequest(
  value: unknown,
): value is GenerationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).some(
      (key) =>
        ![
          'source',
          'sourceRevision',
          'kind',
          'prompt',
          'frameCount',
          'quality',
          'mode',
          'region',
          'frameIndex',
          'targetAnimationId',
        ].includes(key),
    )
  )
    return false;
  if (
    typeof request.source !== 'string' ||
    !/^[a-zA-Z0-9_/-]+\.(png|webp|svg)$/.test(request.source) ||
    request.source.includes('..') ||
    typeof request.sourceRevision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.sourceRevision) ||
    !['blink', 'talk', 'expression', 'idle'].includes(String(request.kind)) ||
    typeof request.prompt !== 'string' ||
    request.prompt.trim().length < 3 ||
    request.prompt.length > 2000 ||
    !Number.isInteger(request.frameCount) ||
    Number(request.frameCount) < 3 ||
    Number(request.frameCount) > 12 ||
    !['low', 'medium', 'high'].includes(String(request.quality)) ||
    !['region', 'full'].includes(String(request.mode))
  )
    return false;
  if (
    request.frameIndex !== undefined &&
    (!Number.isInteger(request.frameIndex) ||
      Number(request.frameIndex) < 0 ||
      Number(request.frameIndex) >= Number(request.frameCount))
  )
    return false;
  if (
    request.targetAnimationId !== undefined &&
    (typeof request.targetAnimationId !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(request.targetAnimationId))
  )
    return false;
  if (request.mode === 'region') {
    if (
      !request.region ||
      typeof request.region !== 'object' ||
      Array.isArray(request.region)
    )
      return false;
    const region = request.region as Record<string, unknown>;
    if (
      Object.keys(region).sort().join() !== 'height,width,x,y' ||
      !Object.values(region).every(
        (entry) =>
          typeof entry === 'number' && Number.isInteger(entry) && entry >= 0,
      ) ||
      Number(region.width) < 4 ||
      Number(region.height) < 4
    )
      return false;
  } else if (request.region !== undefined) return false;
  return true;
}
export async function normalizeSource(bytes: Buffer) {
  const image = sharp(bytes, {
    limitInputPixels: 2048 * 2048,
    animated: false,
  });
  const metadata = await image.metadata();
  if (
    !['png', 'webp', 'svg'].includes(metadata.format ?? '') ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > 2048 ||
    metadata.height > 2048 ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error('Zdroj musí byť statický PNG/WebP/SVG do 2048 × 2048 px.');
  const { data, info } = await image
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const png = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return {
    data,
    width: info.width,
    height: info.height,
    png,
    hasAlpha: metadata.hasAlpha ?? false,
  };
}
export type NormalizedSource = Awaited<ReturnType<typeof normalizeSource>>;

export async function prepareEdit(
  source: NormalizedSource,
  region?: ImageRegion,
) {
  if (
    region &&
    (region.x + region.width > source.width ||
      region.y + region.height > source.height)
  )
    throw new Error('Oblasť úpravy presahuje zdrojový obrázok.');
  // A local edit sends a context crop around the mask, giving tiny eyes enough
  // resolution while the rest of the original character stays on this machine.
  const crop = region
    ? {
        x: Math.max(0, region.x - region.width),
        y: Math.max(0, region.y - region.height * 2),
        width: 0,
        height: 0,
      }
    : { x: 0, y: 0, width: source.width, height: source.height };
  if (region) {
    crop.width = Math.min(
      source.width - crop.x,
      region.x + region.width * 2 - crop.x,
    );
    crop.height = Math.min(
      source.height - crop.y,
      region.y + region.height * 3 - crop.y,
    );
  }
  const scale = Math.min(1024 / crop.width, 1024 / crop.height);
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const left = Math.floor((1024 - width) / 2);
  const top = Math.floor((1024 - height) / 2);
  const image = await sharp(source.png)
    .extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    })
    .resize(width, height)
    .extend({
      left,
      right: 1024 - width - left,
      top,
      bottom: 1024 - height - top,
      background: { r: 238, g: 238, b: 238, alpha: region ? 1 : 0 },
    })
    .png()
    .toBuffer();
  let mask: Buffer | undefined;
  if (region) {
    const pixels = Buffer.alloc(1024 * 1024 * 4, 255);
    const bounds = {
      x: left + Math.floor(((region.x - crop.x) * width) / crop.width),
      y: top + Math.floor(((region.y - crop.y) * height) / crop.height),
      width: Math.ceil((region.width * width) / crop.width),
      height: Math.ceil((region.height * height) / crop.height),
    };
    for (let y = bounds.y; y < Math.min(1024, bounds.y + bounds.height); y++)
      for (let x = bounds.x; x < Math.min(1024, bounds.x + bounds.width); x++)
        pixels[(y * 1024 + x) * 4 + 3] = 0;
    mask = await sharp(pixels, {
      raw: { width: 1024, height: 1024, channels: 4 },
    })
      .png()
      .toBuffer();
  }
  return { image, mask, crop, left, top, width, height };
}
export type PreparedEdit = Awaited<ReturnType<typeof prepareEdit>>;

export async function assembleFrame(
  source: NormalizedSource,
  edited: Buffer,
  layout: PreparedEdit,
  region?: ImageRegion,
) {
  const metadata = await sharp(edited, {
    limitInputPixels: 2048 * 2048,
  }).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== 1024 ||
    metadata.height !== 1024
  )
    throw new Error(
      'Model vrátil iný rozmer alebo formát než 1024 × 1024 PNG. Výsledok sa nepriradil.',
    );
  const frame = await sharp(edited)
    .extract({
      left: layout.left,
      top: layout.top,
      width: layout.width,
      height: layout.height,
    })
    .resize(layout.crop.width, layout.crop.height)
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer();
  if (!region)
    return sharp(frame, {
      raw: { width: source.width, height: source.height, channels: 4 },
    })
      .png()
      .toBuffer();
  const result = Buffer.from(source.data);
  // Exact copy outside the ROI and exact original alpha everywhere; no model
  // output can change clothing, silhouette or transparency outside this box.
  for (let y = region.y; y < region.y + region.height; y++)
    for (let x = region.x; x < region.x + region.width; x++) {
      const original = (y * source.width + x) * 4;
      const generated =
        ((y - layout.crop.y) * layout.crop.width + x - layout.crop.x) * 4;
      const feather = Math.min(
        1,
        Math.min(
          x - region.x,
          y - region.y,
          region.x + region.width - 1 - x,
          region.y + region.height - 1 - y,
        ) / 2,
      );
      for (let channel = 0; channel < 3; channel++)
        result[original + channel] = Math.round(
          source.data[original + channel]! * (1 - feather) +
            frame[generated + channel]! * feather,
        );
    }
  return sharp(result, {
    raw: { width: source.width, height: source.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
export function framePrompt(
  request: GenerationRequest,
  fraction: number,
): string {
  const phase =
    request.kind === 'blink'
      ? `Eyelids are ${Math.round(fraction * 100)}% closed; 100% means fully closed, 0% fully open. Change only the eyes.`
      : request.kind === 'talk'
        ? `Speaking pose ${Math.round(fraction * 100)}% through a short mouth movement. Change only mouth/lips inside the selected region.`
        : `Pose ${Math.round(fraction * 100)}% through the requested ${request.kind} change.`;
  return `Edit this game-character reference into ONE animation keyframe, not a sprite sheet.\nAuthor request: ${request.prompt}\n${phase}\nKeep identical identity, proportions, pose, framing, outline, palette, clothing and lighting. No text, no extra objects. ${request.mode === 'region' ? 'Edit only the transparent area of the mask; preserve the surrounding reference exactly. This is a context crop, do not zoom, translate or reframe it.' : 'Keep the subject at exactly the same position and scale. Preserve the original transparent background if present.'}`;
}
