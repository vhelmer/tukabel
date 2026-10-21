import sharp from 'sharp';
import { ART_MAX_PIXELS } from './artSource.ts';
import type { ObjectMask, MattingSettings } from '../src/editor/masks.ts';
export const ALPHA_LEVELS = Array.from({ length: 256 }, (_, i) => i);
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
    throw Error('Neplatná PNG maska (nejvýše 4 MB).');
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
    throw Error('Maska musí mít přesné rozměry zdroje.');
  const rgba = await sharp(bytes)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer();
  const pixels = Buffer.alloc(width * height);
  const allowed = new Set(levels);
  for (let p = 0; p < pixels.length; p++) {
    const i = p * 4,
      v = rgba[i]!;
    if (
      !allowed.has(v) ||
      rgba[i + 1] !== v ||
      rgba[i + 2] !== v ||
      rgba[i + 3] !== 255
    )
      throw Error(
        'Maska musí být neprůhledná, bez barevných okrajov. Měkké hodnoty vyžadují režim alpha matting.',
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
    !['manual', 'grabcut', 'sam2', 'sam3'].includes(String(input.method)) ||
    (input.refineEdges !== undefined &&
      typeof input.refineEdges !== 'boolean') ||
    (input.detailPass !== undefined && typeof input.detailPass !== 'boolean')
  )
    throw Error(
      'Maska patří k jinému nebo změněnému zdroji. Připrav ji znovu.',
    );
  const matting = input.matting;
  if (
    matting !== undefined &&
    (!isObject(matting) ||
      !['vitmatte', 'closed-form', 'import'].includes(String(matting.method)) ||
      !Number.isInteger(matting.radius) ||
      Number(matting.radius) < (matting.method === 'import' ? 0 : 1) ||
      Number(matting.radius) > 32 ||
      typeof matting.decontaminate !== 'boolean')
  )
    throw Error('Neplatné nastavení alpha mattingu.');
  const pixels = await maskPixels(
    input.data,
    source.width,
    source.height,
    matting ? ALPHA_LEVELS : undefined,
  );
  if (!pixels.some((v) => v > 0)) throw Error('Maska neobsahuje žádný objekt.');
  return {
    pixels,
    method: input.method as ObjectMask['method'],
    refineEdges: input.refineEdges as boolean | undefined,
    detailPass: input.detailPass as boolean | undefined,
    matting: matting as MattingSettings | undefined,
  };
}
