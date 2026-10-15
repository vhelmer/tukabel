import { execFile } from 'node:child_process';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import type {
  GenerationRequest,
  VideoProcessing,
  AnimationBackground,
} from '../src/editor/animationTypes.ts';

export const ffmpegPath = () => process.env.FFMPEG_PATH || ffmpegStatic;
export async function processorAvailable() {
  const binary = ffmpegPath();
  if (!binary) return false;
  try {
    await access(binary, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
export async function runFFmpeg(args: string[], signal?: AbortSignal) {
  const binary = ffmpegPath();
  if (!binary)
    throw new Error('FFmpeg chýba. Spusti npm ci alebo nastav FFMPEG_PATH.');
  await new Promise<void>((resolve, reject) => {
    execFile(
      binary,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-threads',
        '1',
        ...args,
      ],
      {
        signal,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
      (error) =>
        error
          ? reject(
              new Error(
                signal?.aborted
                  ? 'Spracovanie zrušené.'
                  : 'FFmpeg video nedokázal spracovať. Skontroluj MP4 a časový výber.',
              ),
            )
          : resolve(),
    );
  });
}
export function validateGenerationRequest(
  value: unknown,
): value is GenerationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).every((key) =>
      [
        'source',
        'sourceRevision',
        'kind',
        'prompt',
        'duration',
        'background',
      ].includes(key),
    ) &&
    typeof r.source === 'string' &&
    /^[a-zA-Z0-9_/-]+\.(png|webp|svg)$/.test(r.source) &&
    !r.source.includes('..') &&
    typeof r.sourceRevision === 'string' &&
    /^[a-f0-9]{64}$/.test(r.sourceRevision) &&
    ['blink', 'talk', 'idle', 'expression'].includes(String(r.kind)) &&
    typeof r.prompt === 'string' &&
    r.prompt.trim().length >= 3 &&
    r.prompt.length <= 2000 &&
    [2, 3, 5].includes(Number(r.duration)) &&
    typeof r.duration === 'number' &&
    ['magenta', 'green', 'keep'].includes(String(r.background))
  );
}
export function validateProcessing(value: unknown): value is VideoProcessing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).sort().join() === 'fps,keySimilarity,trimEnd,trimStart' &&
    Object.values(r).every(
      (v) => typeof v === 'number' && Number.isFinite(v),
    ) &&
    Number(r.trimStart) >= 0 &&
    Number(r.trimEnd) > Number(r.trimStart) &&
    Number(r.trimEnd) <= 6 &&
    Number(r.trimEnd) - Number(r.trimStart) >= 0.08 &&
    Number.isInteger(r.fps) &&
    Number(r.fps) >= 1 &&
    Number(r.fps) <= 24 &&
    Math.ceil((Number(r.trimEnd) - Number(r.trimStart)) * Number(r.fps)) <=
      120 &&
    Number(r.keySimilarity) >= 0.05 &&
    Number(r.keySimilarity) <= 0.5
  );
}
export async function normalizeSource(
  bytes: Buffer,
  background: AnimationBackground,
) {
  const image = sharp(bytes, {
    limitInputPixels: 2048 * 2048,
    animated: false,
  });
  const meta = await image.metadata();
  if (
    !['png', 'webp', 'svg'].includes(meta.format ?? '') ||
    !meta.width ||
    !meta.height ||
    meta.width > 2048 ||
    meta.height > 2048 ||
    (meta.pages ?? 1) > 1
  )
    throw new Error('Vyber statický PNG/WebP/SVG do 2048 × 2048 px.');
  const colour =
    background === 'green'
      ? '#00ff00'
      : background === 'magenta'
        ? '#ff00ff'
        : '#eeeeee';
  // Preserve the entire framing: no crop, local edits, source alpha mask or ROI.
  const png = await image
    .toColourspace('srgb')
    .flatten({ background: colour })
    .png()
    .toBuffer();
  const scale = Math.min(1, 512 / Math.max(meta.width, meta.height));
  return {
    png,
    width: meta.width,
    height: meta.height,
    outputWidth: Math.max(1, Math.round(meta.width * scale)),
    outputHeight: Math.max(1, Math.round(meta.height * scale)),
  };
}
export function videoPrompt(request: GenerationRequest) {
  const action =
    request.kind === 'blink'
      ? 'One natural blink: eyes start open, close briefly around the middle, then open again. End in the initial resting pose.'
      : request.kind === 'talk'
        ? 'Small natural speaking mouth movements, ending in a resting pose.'
        : request.kind === 'idle'
          ? 'Subtle idle breathing, staying in the initial resting pose and framing.'
          : 'Subtle expression change, keeping the same character.';
  return `${request.prompt}\n${action}\nAnimate the entire reference image as one continuous shot. Fixed camera, no zoom, no cuts. Preserve the full character, identity, clothes, proportions, position and drawing style. Do not crop any part of the character. ${request.background === 'keep' ? 'Keep the background stationary.' : `Keep the background perfectly flat ${request.background === 'green' ? 'chroma green #00ff00' : 'chroma magenta #ff00ff'}, with no shadows, gradients or new objects.`}`;
}
export async function extractFrames(
  video: string,
  folder: string,
  settings: VideoProcessing,
  dimensions: { width: number; height: number },
  background: AnimationBackground,
  signal?: AbortSignal,
) {
  await runFFmpeg(
    [
      '-ss',
      String(settings.trimStart),
      '-i',
      video,
      '-t',
      String(settings.trimEnd - settings.trimStart),
      '-an',
      '-vf',
      `fps=${settings.fps},scale=${dimensions.width}:${dimensions.height}:flags=lanczos`,
      '-frames:v',
      '120',
      '-threads',
      '1',
      path.join(folder, 'frame-%03d.png'),
    ],
    signal,
  );
  const names = (await readdir(folder))
    .filter((name) => /^frame-\d{3}\.png$/.test(name))
    .sort();
  if (!names.length) throw new Error('Vo vybranom čase nie sú žiadne snímky.');
  if (background !== 'keep') {
    const key = background === 'green' ? [0, 255, 0] : [255, 0, 255];
    for (const name of names) {
      signal?.throwIfAborted();
      const file = path.join(folder, name);
      const { data, info } = await sharp(await readFile(file))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4) {
        const distance =
          Math.sqrt(
            (data[i]! - key[0]!) ** 2 +
              (data[i + 1]! - key[1]!) ** 2 +
              (data[i + 2]! - key[2]!) ** 2,
          ) / Math.sqrt(3 * 255 ** 2);
        data[i + 3] = Math.round(
          data[i + 3]! *
            Math.max(
              0,
              Math.min(1, (distance - settings.keySimilarity) / 0.08),
            ),
        );
      }
      await writeFile(
        file,
        await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .png()
          .toBuffer(),
      );
    }
  }
  return names;
}
