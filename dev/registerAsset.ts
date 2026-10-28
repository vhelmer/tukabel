import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { SegmentationOptions } from './segmentation.ts';
import { inspectAssetAlpha } from './generatedAsset.ts';
import { remoteSegmentation } from './remoteSegmentation.ts';
import type { CropFrame } from '../src/game/transforms.ts';
import type { AssetAlignment } from '../src/editor/artSettings.ts';

export function validateAlignmentRecord(
  value: unknown,
  width: number,
  height: number,
) {
  const a = value as AssetAlignment | undefined;
  if (
    !a ||
    a.method !== 'features' ||
    !Number.isInteger(a.matches) ||
    a.matches < 12 ||
    !Number.isInteger(a.inliers) ||
    a.inliers < 12 ||
    a.inliers > a.matches ||
    ![
      a.inlierRatio,
      a.medianError,
      a.p90Error,
      a.coverageX,
      a.coverageY,
      ...(Array.isArray(a.matrix) ? a.matrix : []),
    ].every(Number.isFinite) ||
    a.inlierRatio < 0.35 ||
    a.inlierRatio > 1 ||
    a.medianError < 0 ||
    a.medianError > 3 ||
    a.p90Error < a.medianError ||
    a.p90Error > 6 ||
    a.coverageX < 0.25 ||
    a.coverageY < 0.25 ||
    !Array.isArray(a.matrix) ||
    a.matrix.length !== 6
  )
    throw Error(
      'Zarovnání nemá dost spolehlivých shod. Původní umístění zůstalo zachované.',
    );
  const [m00, m01, , m10, m11] = a.matrix;
  const factor = Math.hypot(m00!, m10!);
  if (
    Math.abs(m00! - m11!) > 1e-5 ||
    Math.abs(m01! + m10!) > 1e-5 ||
    factor < 0.03 ||
    factor > 20 ||
    Math.abs((Math.atan2(m10!, m00!) * 180) / Math.PI) > 8 ||
    Math.abs(a.inlierRatio - a.inliers / a.matches) > 0.02
  )
    throw Error('Neplatná transformace zarovnání.');
  const frame = a.frame;
  if (
    !frame ||
    !['x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'].every((k) =>
      Number.isInteger(frame[k as keyof CropFrame]),
    ) ||
    frame.x < 0 ||
    frame.y < 0 ||
    frame.width < 1 ||
    frame.height < 1 ||
    frame.x + frame.width > width ||
    frame.y + frame.height > height ||
    frame.sourceWidth !== width ||
    frame.sourceHeight !== height
  )
    throw Error('Neplatné rozměry zarovnání.');
  return a;
}

export async function validateRegistration(
  result: Record<string, unknown>,
  width: number,
  height: number,
  scale: 1 | 2,
) {
  const a = validateAlignmentRecord(result.alignment, width, height);
  const frame = a.frame;
  if (
    typeof result['result.png'] !== 'string' ||
    typeof result['full.png'] !== 'string'
  )
    throw Error('Neplatné rozměry zarovnání.');
  const image = Buffer.from(result['result.png'], 'base64'),
    full = Buffer.from(result['full.png'], 'base64');
  const [im, fm] = await Promise.all([
    sharp(image, { limitInputPixels: 8 * 1024 * 1024 }).metadata(),
    sharp(full, { limitInputPixels: 8 * 1024 * 1024 }).metadata(),
  ]);
  if (
    im.format !== 'png' ||
    fm.format !== 'png' ||
    im.width !== frame.width * scale ||
    im.height !== frame.height * scale ||
    fm.width !== width ||
    fm.height !== height
  )
    throw Error('Neplatné rozměry zarovnání.');
  return {
    image,
    full,
    frame,
    alignment: a,
    matches:
      typeof result['alignment-matches.png'] === 'string'
        ? Buffer.from(result['alignment-matches.png'], 'base64')
        : undefined,
  };
}

export async function registerAsset(
  source: Buffer,
  generated: Buffer,
  mask: Buffer,
  width: number,
  height: number,
  scale: 1 | 2,
  options: SegmentationOptions = {},
) {
  const diagnostic = await inspectAssetAlpha(generated);
  if (!diagnostic.hasAlpha || diagnostic.maxBorderAlpha > 1)
    throw Error(
      'Výstup má neprůhledný obsah na okraji nebo nemá alfu. Zarovnání nesmí povolit useknutý objekt či pozadí; původní výsledek zůstává zachovaný.',
    );
  const files = {
    'source.png': source.toString('base64'),
    'generated.png': generated.toString('base64'),
    'prior.png': mask.toString('base64'),
  };
  try {
    if (options.remote)
      return await validateRegistration(
        await remoteSegmentation(options.remote, {
          operation: 'align',
          files,
          args: [String(scale)],
        }),
        width,
        height,
        scale,
      );
    const directory = await mkdtemp(path.join(tmpdir(), 'tukabel-align-'));
    try {
      for (const [name, bytes] of Object.entries(files))
        await writeFile(
          path.join(directory, name),
          Buffer.from(bytes, 'base64'),
        );
      let python = options.python;
      if (!python) {
        python = path.resolve('.local-tools/segmentation/bin/python');
        try {
          await access(python);
        } catch {
          python = 'python3';
        }
      }
      await promisify(execFile)(
        python,
        [
          fileURLToPath(
            new URL('../scripts/segmentation/align.py', import.meta.url),
          ),
          directory,
          String(scale),
        ],
        { timeout: 300000, maxBuffer: 32768 },
      );
      const result: Record<string, unknown> = {
        alignment: JSON.parse(
          await readFile(path.join(directory, 'alignment.json'), 'utf8'),
        ),
      };
      for (const name of ['result.png', 'full.png', 'alignment-matches.png'])
        result[name] = (await readFile(path.join(directory, name))).toString(
          'base64',
        );
      return await validateRegistration(result, width, height, scale);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } catch {
    throw Error(
      'Chytré zarovnání nenašlo dost spolehlivých shod nebo není dostupné OpenCV. Původní umístění zůstalo zachované; nic se negeneruje znovu. Zkontroluj segmentační Python / SSH nebo zvol rám výběru.',
    );
  }
}
