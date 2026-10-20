import sharp from 'sharp';
import { ART_MAX_PIXELS } from './artSource.ts';
import type { ObjectMask } from '../src/editor/masks.ts';
export const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export async function maskPixels(
  data: unknown,
  width: number,
  height: number,
  levels: readonly number[] = [0, 255],
) {
  if (
    typeof data !== 'string' ||
    data.length > 6 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw Error('Neplatná PNG maska (najviac 4 MB).');
  const bytes = Buffer.from(data, 'base64');
  const meta = await sharp(bytes, {
    limitInputPixels: ART_MAX_PIXELS,
  }).metadata();
  if (
    meta.format !== 'png' ||
    (meta.pages ?? 1) !== 1 ||
    meta.width !== width ||
    meta.height !== height ||
    bytes.length > 4 * 1024 * 1024
  )
    throw Error('Maska musí mať presné rozmery zdroja.');
  const rgba = await sharp(bytes)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer();
  const pixels = Buffer.alloc(width * height);
  for (let p = 0; p < pixels.length; p++) {
    const i = p * 4,
      v = rgba[i]!;
    if (
      !levels.includes(v) ||
      rgba[i + 1] !== v ||
      rgba[i + 2] !== v ||
      rgba[i + 3] !== 255
    )
      throw Error(
        'Maska musí byť nepriehľadná, bez mäkkých alebo farebných okrajov.',
      );
    pixels[p] = v;
  }
  return pixels;
}
export const maskPng = (pixels: Buffer, width: number, height: number) =>
  sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
export async function readObjectMask(
  input: unknown,
  source: { width: number; height: number; sourceSha256: string },
) {
  if (
    !isObject(input) ||
    input.width !== source.width ||
    input.height !== source.height ||
    input.sourceSha256 !== source.sourceSha256 ||
    !['manual', 'grabcut', 'sam2'].includes(String(input.method))
  )
    throw Error(
      'Maska patrí k inému alebo zmenenému zdroju. Priprav ju znovu.',
    );
  const pixels = await maskPixels(input.data, source.width, source.height);
  if (!pixels.includes(255)) throw Error('Maska neobsahuje žiadny objekt.');
  return { pixels, method: input.method as ObjectMask['method'] };
}
