import { randomUUID, createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { format } from 'prettier';
import type {
  AnimationDefinition,
  AnimationRegion,
  GameContent,
} from '../src/game/types.ts';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 64 * 1024 * 1024;
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value);

async function localAsset(root: string, id: string) {
  if (
    !/^[a-zA-Z0-9_/-]+\.(svg|png|webp|jpe?g|avif)$/.test(id) ||
    id.split('/').includes('..')
  )
    throw new Error('Vyber lokálny obrázok zo src/assets/.');
  const filename = path.resolve(root, id);
  if (
    !filename.startsWith(path.resolve(root) + path.sep) ||
    (await realpath(filename)) !== filename
  )
    throw new Error('Asset nesmie používať symbolické odkazy.');
  return readFile(filename);
}
async function dimensions(bytes: Buffer) {
  const data = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!data.width || !data.height || (data.pages ?? 1) !== 1)
    throw new Error('Očakávam jeden statický obrázok.');
  return { width: data.width, height: data.height, format: data.format };
}

// Also check existing, manually edited content on save. Equal full-canvas sizes
// keep the source placement/anchor stable when Pixi swaps a texture.
export async function validateAnimationAssets(
  root: string,
  project: Pick<GameContent, 'animations'>,
) {
  const cache = new Map<string, ReturnType<typeof dimensions>>();
  const size = (id: string) => {
    if (!cache.has(id)) cache.set(id, localAsset(root, id).then(dimensions));
    return cache.get(id)!;
  };
  for (const clip of project.animations ?? []) {
    const source = await size(clip.source);
    if (
      clip.region &&
      (clip.region.x + clip.region.width > source.width ||
        clip.region.y + clip.region.height > source.height)
    )
      throw new Error(
        `${clip.label}: oblasť animácie je mimo pôvodného obrázka.`,
      );
    for (const frame of clip.frames) {
      const current = await size(frame);
      if (current.width !== source.width || current.height !== source.height)
        throw new Error(
          `${clip.label}: snímka ${frame} musí mať plátno ${source.width} × ${source.height} ako zdroj. Bez automatického škálovania.`,
        );
    }
  }
}

async function rgba(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: MAX_PIXELS })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer();
}
function extendDifference(
  base: Buffer,
  frame: Buffer,
  width: number,
  box: { left: number; top: number; right: number; bottom: number },
) {
  for (let i = 0; i < base.length; i += 4) {
    if (!base[i + 3] && !frame[i + 3]) continue;
    if (
      base[i] === frame[i] &&
      base[i + 1] === frame[i + 1] &&
      base[i + 2] === frame[i + 2] &&
      base[i + 3] === frame[i + 3]
    )
      continue;
    const pixel = i / 4,
      x = pixel % width,
      y = Math.floor(pixel / width);
    box.left = Math.min(box.left, x);
    box.right = Math.max(box.right, x);
    box.top = Math.min(box.top, y);
    box.bottom = Math.max(box.bottom, y);
  }
}
function asRegion(box: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): AnimationRegion | undefined {
  return box.right < box.left
    ? undefined
    : {
        x: box.left,
        y: box.top,
        width: box.right - box.left + 1,
        height: box.bottom - box.top + 1,
      };
}
export async function detectAnimationRegion(
  root: string,
  input: unknown,
): Promise<AnimationRegion | undefined> {
  if (
    !object(input) ||
    typeof input.source !== 'string' ||
    !Array.isArray(input.frames) ||
    !input.frames.length ||
    input.frames.length > 120 ||
    !input.frames.every((id) => typeof id === 'string')
  )
    throw new Error('Vyber zdroj a 1–120 lokálnych snímkov.');
  const original = await localAsset(root, input.source),
    source = await dimensions(original);
  if (source.width * source.height * input.frames.length > MAX_PIXELS)
    throw new Error('Animácia má priveľa pixelov.');
  const base = await rgba(original),
    box = { left: source.width, top: source.height, right: -1, bottom: -1 };
  for (const id of input.frames) {
    const bytes = await localAsset(root, id),
      size = await dimensions(bytes);
    if (size.width !== source.width || size.height !== source.height)
      throw new Error('Snímky musia mať rovnaké plátno ako zdroj.');
    extendDifference(base, await rgba(bytes), source.width, box);
  }
  return asRegion(box);
}

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated?: boolean;
  trimmed?: boolean;
  spriteSourceSize?: { x: number; y: number; w: number; h: number };
  sourceSize?: { w: number; h: number };
  duration?: number;
}

function atlasFrames(value: unknown, name: unknown): AtlasFrame[] {
  if (!object(value) || !object(value.frames))
    throw new Error(
      'Spritesheet JSON musí obsahovať objekt frames (PixiJS/TexturePacker).',
    );
  let names = Object.keys(value.frames);
  if (object(value.animations) && Object.keys(value.animations).length) {
    const selected =
      typeof name === 'string' && name
        ? name
        : Object.keys(value.animations)[0]!;
    const sequence = value.animations[selected];
    if (
      !Array.isArray(sequence) ||
      !sequence.every((n) => typeof n === 'string')
    )
      throw new Error('Neplatná sekvencia animácie v spritesheete.');
    names = sequence;
  }
  return names.map((key) => {
    const entry = (value.frames as Record<string, unknown>)[key];
    if (!object(entry) || !object(entry.frame))
      throw new Error(`Chýbajúca snímka ${key}.`);
    return entry as unknown as AtlasFrame;
  });
}

// Normalize imports once in development. Runtime only needs ordinary local PNGs.
// Stage the entire validated clip, then atomically publish a new UUID directory.
export async function importAnimation(
  root: string,
  input: unknown,
): Promise<AnimationDefinition> {
  if (
    !object(input) ||
    typeof input.source !== 'string' ||
    typeof input.label !== 'string' ||
    !input.label.trim() ||
    input.label.length > 160 ||
    !['blink', 'talk', 'idle', 'expression'].includes(String(input.kind)) ||
    typeof input.fps !== 'number' ||
    !Number.isFinite(input.fps) ||
    input.fps < 1 ||
    input.fps > 30 ||
    !Array.isArray(input.files) ||
    !input.files.length ||
    input.files.length > 120
  )
    throw new Error(
      'Neplatný import animácie: zdroj, názov, typ, fps 1–30 a 1–120 PNG súborov.',
    );
  let total = 0;
  const uploads = input.files.map((file: unknown) => {
    if (
      !object(file) ||
      typeof file.name !== 'string' ||
      !/\.png$/i.test(file.name) ||
      typeof file.data !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) ||
      file.data.length > 44 * 1024 * 1024
    )
      throw new Error('Import podporuje iba PNG súbory.');
    const bytes = Buffer.from(file.data, 'base64');
    total += bytes.length;
    if (!bytes.length || total > MAX_BYTES)
      throw new Error('Import môže mať spolu najviac 32 MB.');
    return { name: file.name, bytes };
  });
  const original = await localAsset(root, input.source);
  const source = await dimensions(original);
  if (source.width > 4096 || source.height > 4096)
    throw new Error('Zdroj môže mať najviac 4096 × 4096 px.');
  const atlas =
    input.atlas === undefined
      ? undefined
      : atlasFrames(input.atlas, input.animationName);
  if (atlas && uploads.length !== 1)
    throw new Error('K spritesheet JSON vyber práve jeden PNG atlas.');
  const count = atlas?.length ?? uploads.length;
  if (
    !count ||
    count > 120 ||
    count * source.width * source.height > MAX_PIXELS
  )
    throw new Error(
      'Očakávam 1–120 snímkov, spolu najviac 64 miliónov pixelov.',
    );
  const parent = path.join(root, 'animations');
  await mkdir(parent, { recursive: true });
  if (
    (await lstat(parent)).isSymbolicLink() ||
    (await realpath(parent)) !== path.resolve(parent)
  )
    throw new Error('Adresár animácií nesmie byť symbolický odkaz.');
  const id = randomUUID();
  const staging = path.join(parent, `.${id}.tmp`);
  await mkdir(staging);
  try {
    const base = ['blink', 'talk'].includes(String(input.kind))
      ? await rgba(original)
      : undefined;
    const changed = {
      left: source.width,
      top: source.height,
      right: -1,
      bottom: -1,
    };
    const names: string[] = [];
    const durations: number[] = [];
    const sheet = atlas ? await dimensions(uploads[0]!.bytes) : undefined;
    if (sheet && sheet.format !== 'png')
      throw new Error('Atlas musí byť skutočný PNG.');
    for (let i = 0; i < count; i++) {
      let bytes: Buffer;
      if (atlas) {
        const entry = atlas[i]!;
        const rect = entry.frame;
        const full = entry.sourceSize ?? { w: rect.w, h: rect.h };
        const offset = entry.spriteSourceSize ?? {
          x: 0,
          y: 0,
          w: rect.w,
          h: rect.h,
        };
        if (
          !object(rect) ||
          !object(full) ||
          !object(offset) ||
          entry.rotated ||
          ![
            rect.x,
            rect.y,
            rect.w,
            rect.h,
            full.w,
            full.h,
            offset.x,
            offset.y,
            offset.w,
            offset.h,
          ].every(integer) ||
          rect.x < 0 ||
          rect.y < 0 ||
          rect.w <= 0 ||
          rect.h <= 0 ||
          rect.x + rect.w > sheet!.width ||
          rect.y + rect.h > sheet!.height ||
          full.w !== source.width ||
          full.h !== source.height ||
          offset.x < 0 ||
          offset.y < 0 ||
          offset.w !== rect.w ||
          offset.h !== rect.h ||
          offset.x + rect.w > full.w ||
          offset.y + rect.h > full.h
        )
          throw new Error(
            `Snímka ${i + 1}: neplatná oblasť / veľkosť plátna; otočené atlasové políčka nie sú podporované.`,
          );
        bytes = await sharp(uploads[0]!.bytes, { limitInputPixels: MAX_PIXELS })
          .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
          .extend({
            left: offset.x,
            top: offset.y,
            right: full.w - offset.x - rect.w,
            bottom: full.h - offset.y - rect.h,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();
        if (
          entry.duration !== undefined &&
          (typeof entry.duration !== 'number' ||
            !Number.isFinite(entry.duration) ||
            entry.duration < 10 ||
            entry.duration > 60000)
        )
          throw new Error('Trvanie snímky musí byť 10–60000 ms.');
        durations.push(entry.duration ?? 1000 / input.fps);
      } else {
        bytes = uploads[i]!.bytes;
        // Metadata alone does not detect a truncated PNG pixel stream.
        await sharp(bytes, { limitInputPixels: MAX_PIXELS }).stats();
        const frame = await dimensions(bytes);
        if (
          frame.format !== 'png' ||
          frame.width !== source.width ||
          frame.height !== source.height
        )
          throw new Error(
            `Snímka ${i + 1} musí byť PNG ${source.width} × ${source.height} ako zdroj. Zarovnaj plátno, nie veľkosť postavy.`,
          );
      }
      if (base)
        extendDifference(base, await rgba(bytes), source.width, changed);
      const name = `frame-${String(i + 1).padStart(3, '0')}.png`;
      await writeFile(path.join(staging, name), bytes, { flag: 'wx' });
      names.push(`animations/${id}/${name}`);
    }
    const clip: AnimationDefinition = {
      id: `animation-${id}`,
      label: input.label.trim(),
      source: input.source,
      kind: input.kind as AnimationDefinition['kind'],
      fps: input.fps,
      frames: names,
      ...(atlas ? { durationsMs: durations } : {}),
      loop: true,
      ...(base && asRegion(changed) ? { region: asRegion(changed) } : {}),
    };
    if (
      clip.region?.width === source.width &&
      clip.region.height === source.height
    )
      delete (clip as { region?: AnimationRegion }).region;
    // Archive the original atlas for future editing; never needed at runtime.
    if (atlas) {
      await writeFile(path.join(staging, 'atlas.png'), uploads[0]!.bytes);
      await writeFile(
        path.join(staging, 'atlas.json'),
        await format(JSON.stringify(input.atlas), { parser: 'json' }),
      );
    }
    await writeFile(
      path.join(staging, 'clip.json'),
      await format(JSON.stringify({ ...clip, sourceHash: hash(original) }), {
        parser: 'json',
      }),
    );
    if (hash(await localAsset(root, input.source)) !== hash(original))
      throw new Error('Zdroj sa počas importu zmenil. Zopakuj import.');
    await rename(staging, path.join(parent, id));
    return clip;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
