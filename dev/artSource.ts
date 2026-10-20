import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const ART_MAX_PIXELS = 8 * 1024 * 1024;
export const artHash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
export async function readArtSource(root: string, id: unknown) {
  if (
    typeof id !== 'string' ||
    !/^[a-zA-Z0-9_/-]+\.(png|webp|jpe?g|svg|avif)$/.test(id) ||
    id.split('/').includes('..')
  )
    throw Error('Vyber lokálny obrázok zo src/assets/.');
  const filename = path.resolve(root, id);
  if (
    !filename.startsWith(path.resolve(root) + path.sep) ||
    (await realpath(filename)) !== filename
  )
    throw Error('Obrázok nesmie používať symbolické odkazy.');
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size > 24 * 1024 * 1024)
    throw Error('Obrázok môže mať najviac 24 MB.');
  const bytes = await readFile(filename);
  const metadata = await sharp(bytes, {
    limitInputPixels: ART_MAX_PIXELS,
  }).metadata();
  if ((metadata.pages ?? 1) !== 1) throw Error('Vyber statický obrázok.');
  const decoded = await sharp(bytes, { limitInputPixels: ART_MAX_PIXELS })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const source = await sharp(decoded.data, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
  return {
    filename,
    bytes,
    raw: decoded.data,
    source,
    width,
    height,
    sourceSha256: artHash(bytes),
  };
}
