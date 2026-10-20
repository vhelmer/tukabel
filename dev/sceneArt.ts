import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldToEditor } from 'node:timers/promises';
import sharp from 'sharp';
import { readArtSource, ART_MAX_PIXELS, artHash as hash } from './artSource.ts';
import { readObjectMask, maskPng } from './objectMask.ts';
import { polygonBounds, polygonIssue } from '../src/game/polygon.ts';
import type { AnimationDefinition } from '../src/game/types.ts';
import type { Point } from '../src/game/transforms.ts';

export interface ArtOptions {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  onStage?: (stage: string) => void;
}
export type ArtOperation =
  'cutout' | 'loop' | 'edit' | 'extract' | 'remove' | 'generate';
export interface ArtResult {
  operation: ArtOperation;
  source: string;
  image: string;
  cutout?: string;
  animation?: AnimationDefinition;
  width: number;
  height: number;
  manifest: string;
  objectMask?: string;
  original?: string;
  reassembled?: string;
  difference?: string;
  repairMask?: string;
  reconstruction?: {
    changedPixels: number;
    selectedPixels: number;
    cleanupPixels: number;
    unexpectedPixels: number;
  };
}
const MAX_PIXELS = ART_MAX_PIXELS;
const MAX_BYTES = 24 * 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const aiOperations = ['edit', 'extract', 'remove', 'generate'];
export const artStatus = (options: ArtOptions) => ({
  configured: Boolean(options.apiKey),
  model: options.model || 'gpt-image-1.5',
});

// Single provider boundary. It returns pixels, never project paths or credentials.
async function editImage(
  image: Buffer,
  mask: Buffer | undefined,
  prompt: string,
  size: string,
  options: ArtOptions,
) {
  const model = options.model || 'gpt-image-1.5';
  if (!options.apiKey)
    throw Error('Nastav OPENAI_API_KEY v .env.local a reštartuj Vite.');
  const body = {
    model,
    images: [
      { image_url: `data:image/png;base64,${image.toString('base64')}` },
    ],
    mask: mask
      ? { image_url: `data:image/png;base64,${mask.toString('base64')}` }
      : undefined,
    prompt,
    n: 1,
    quality: 'medium',
    output_format: 'png',
    size,
    ...(['gpt-image-1', 'gpt-image-1.5'].includes(model)
      ? { input_fidelity: 'high' }
      : {}),
  };
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      'https://api.openai.com/v1/images/edits',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      },
    );
  } catch {
    throw Error('AI služba neodpovedala. Požiadavka sa automaticky neopakuje.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      `AI úprava zlyhala (HTTP ${response.status}). Skontroluj prístup k modelu a kredit; požiadavka sa neopakuje.`,
    );
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > 40 * 1024 * 1024) throw Error('Odpoveď AI je príliš veľká.');
    chunks.push(chunk);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw Error('AI vrátila nečitateľnú odpoveď. Požiadavka sa neopakuje.');
  }
  const item =
    object(data) && Array.isArray(data.data)
      ? (data.data[0] as unknown)
      : undefined;
  if (!object(item) || typeof item.b64_json !== 'string')
    throw Error('AI nevrátila PNG obrázok.');
  const bytes = Buffer.from(item.b64_json, 'base64');
  const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
  if (
    meta.format !== 'png' ||
    (meta.pages ?? 1) !== 1 ||
    bytes.length > MAX_BYTES
  )
    throw Error('AI vrátila neplatný alebo príliš veľký obrázok.');
  return bytes;
}

export async function createArtwork(
  root: string,
  input: unknown,
  options: ArtOptions = {},
): Promise<ArtResult> {
  if (
    !object(input) ||
    typeof input.source !== 'string' ||
    typeof input.operation !== 'string' ||
    !['cutout', 'loop', ...aiOperations].includes(input.operation)
  )
    throw Error('Neplatná grafická operácia.');
  const operation = input.operation as ArtOperation;
  const ai = aiOperations.includes(operation);
  if (ai && input.confirmed !== true)
    throw Error('AI generovanie musíš výslovne spustiť.');
  if (
    ai &&
    (typeof input.prompt !== 'string' ||
      !input.prompt.trim() ||
      input.prompt.length > 4000)
  )
    throw Error('Zadaj pokyny pre AI (najviac 4000 znakov).');
  options.onStage?.('Načítavam zdroj a pripravujem výber');
  const original = await readArtSource(root, input.source);
  const { width, height, raw, source } = original;
  const suppliedMask =
    input.objectMask === undefined
      ? undefined
      : await readObjectMask(input.objectMask, original);
  if (
    suppliedMask &&
    !['cutout', 'extract', 'remove', 'edit'].includes(operation)
  )
    throw Error('Maska nie je podporovaná pre túto operáciu.');
  let points: Point[] | undefined;
  if (input.selection !== undefined) {
    if (
      !Array.isArray(input.selection) ||
      input.selection.length < 3 ||
      input.selection.length > 128 ||
      input.selection.some(
        (p) =>
          !object(p) ||
          typeof p.x !== 'number' ||
          typeof p.y !== 'number' ||
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < 0 ||
          p.y < 0 ||
          p.x > width ||
          p.y > height,
      )
    )
      throw Error('Výber musí byť polygón vo vnútri zdrojového obrázka.');
    points = input.selection as Point[];
    if (polygonIssue(points))
      throw Error('Výber sa nesmie krížiť a musí mať plochu.');
  }
  if (
    ['cutout', 'loop', 'extract', 'remove'].includes(operation) &&
    !points &&
    !suppliedMask
  )
    throw Error('Najprv vyber oblasť obrázka.');
  if (operation === 'generate') points = undefined;
  const coverage = points
    ? await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon fill="white" points="${points.map((p) => `${p.x},${p.y}`).join(' ')}"/></svg>`,
        ),
      )
        .ensureAlpha()
        .raw()
        .toBuffer()
    : Buffer.alloc(width * height * 4, 255);
  // Extraction uses a binary pixel ownership mask. Soft polygon coverage used
  // twice (repair + source-over) changes the original outlines on reassembly.
  const exact =
    operation === 'extract' || operation === 'cutout' || !!suppliedMask;
  if (exact) {
    for (let p = 0; p < width * height; p++)
      coverage[p * 4 + 3] = suppliedMask
        ? suppliedMask.pixels[p]!
        : coverage[p * 4 + 3]! >= 128
          ? 255
          : 0;
  }
  const objectPixels = Buffer.alloc(width * height);
  for (let p = 0; p < objectPixels.length; p++)
    objectPixels[p] = coverage[p * 4 + 3]!;
  const repairPadding = ['extract', 'remove'].includes(operation)
    ? (input.repairPadding ?? 12)
    : 0;
  if (
    !Number.isInteger(repairPadding) ||
    Number(repairPadding) < 0 ||
    Number(repairPadding) > 64
  )
    throw Error('Presah opravy musí byť 0–64 px.');
  // The repair owns its own margin. Clipping it back to the cutout restores
  // missed outlines from the original image and leaves a ghost of the object.
  const providerMask = Number(repairPadding)
    ? await sharp(objectPixels, { raw: { width, height, channels: 1 } })
        // libvips morphology treats black as foreground: erode expands our
        // white selected pixels (verified by the repair-margin test).
        .erode(Number(repairPadding) * 2 + 1)
        .greyscale()
        .raw()
        .toBuffer()
    : objectPixels;
  const repairCoverage = Buffer.from(providerMask);
  if (Number(repairPadding) > 0) {
    const soft = await sharp(providerMask, {
      raw: { width, height, channels: 1 },
    })
      .blur(1)
      .greyscale()
      .raw()
      .toBuffer();
    for (let p = 0; p < repairCoverage.length; p++)
      // Feather only inside the permitted repair; never soften the cutout.
      repairCoverage[p] = Math.max(
        objectPixels[p]!,
        Math.min(providerMask[p]!, soft[p]!),
      );
  }
  const cutoutRaw = Buffer.from(raw);
  const maskRaw = Buffer.alloc(raw.length, 255);
  for (let i = 0; i < raw.length; i += 4) {
    cutoutRaw[i + 3] = Math.round((raw[i + 3]! * coverage[i + 3]!) / 255);
    maskRaw[i + 3] = 255 - providerMask[i / 4]!;
  }
  const png = (data: Buffer) =>
    sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
  const cutout = await png(cutoutRaw);
  const mask = await png(maskRaw);
  let image = cutout;
  if (ai) {
    // Letterbox rather than distort input/mask into the provider's standard canvas.
    const work =
      width > height
        ? { width: 1536, height: 1024 }
        : width < height
          ? { width: 1024, height: 1536 }
          : { width: 1024, height: 1024 };
    const scale = Math.min(work.width / width, work.height / height);
    const w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    const left = Math.floor((work.width - w) / 2),
      top = Math.floor((work.height - h) / 2);
    const extent = {
      left,
      top,
      right: work.width - w - left,
      bottom: work.height - h - top,
    };
    const workingImage = await sharp(source)
      .resize(w, h)
      .extend({ ...extent, background: '#281e2b' })
      .png()
      .toBuffer();
    const workingMask =
      points || suppliedMask
        ? await sharp(mask)
            .resize(w, h, { kernel: 'nearest' })
            .extend({ ...extent, background: '#ffffff' })
            .png()
            .toBuffer()
        : undefined;
    const instruction =
      operation === 'remove' || operation === 'extract'
        ? 'Remove the selected object completely, including thin protrusions, outline strokes, contact shadows and detached remnants within the repair mask. Reconstruct continuous scenery and line work behind it seamlessly. Do not leave a duplicate or a silhouette. '
        : operation === 'generate'
          ? 'Create a new 2D adventure location using the reference ONLY for its drawing style, palette and line work. '
          : 'Edit only the selected area. ';
    options.onStage?.('AI upravuje obrázok · požiadavka sa neopakuje');
    const generated = await editImage(
      workingImage,
      workingMask,
      `${instruction}Preserve the reference cartoon drawing style, perspective, lighting and composition outside the edit. Preserve the image framing. No UI, text labels or watermarks. User instructions: ${input.prompt as string}`,
      `${work.width}x${work.height}`,
      options,
    );
    const normalized = await sharp(generated)
      .resize(work.width, work.height, { fit: 'fill' })
      .png()
      .toBuffer();
    const crop = await sharp(normalized)
      .extract({ left, top, width: w, height: h })
      .png()
      .toBuffer();
    const result = await sharp(crop)
      .resize(width, height)
      .ensureAlpha()
      .raw()
      .toBuffer();
    if (points || suppliedMask) {
      const merged = Buffer.from(raw);
      for (let i = 0; i < raw.length; i += 4) {
        const weight = ['extract', 'remove'].includes(operation)
          ? repairCoverage[i / 4]!
          : coverage[i + 3]!;
        for (let c = 0; c < 4; c++)
          merged[i + c] = Math.round(
            (raw[i + c]! * (255 - weight) + result[i + c]! * weight) / 255,
          );
      }
      if (operation === 'extract') {
        for (let i = 0; i < raw.length; i += 4) {
          if (coverage[i + 3] && raw[i + 3]! < 255) merged.fill(0, i, i + 4);
        }
      }
      image = await png(merged);
    } else image = await png(result);
  }
  const folder = path.join(root, 'scene-art');
  await mkdir(folder, { recursive: true });
  if ((await realpath(folder)) !== path.resolve(folder))
    throw Error('Adresár grafiky nesmie byť symbolický odkaz.');
  const id = randomUUID(),
    prefix = `scene-art/${id}`;
  const staging = path.join(folder, `.tmp-${id}`);
  await mkdir(staging);
  try {
    await writeFile(path.join(staging, 'source.png'), source, { flag: 'wx' });
    await writeFile(path.join(staging, 'mask.png'), mask, { flag: 'wx' });
    await writeFile(path.join(staging, 'image.png'), image, { flag: 'wx' });
    if (['extract', 'remove'].includes(operation))
      await writeFile(
        path.join(staging, 'repair-mask.png'),
        await maskPng(repairCoverage, width, height),
        { flag: 'wx' },
      );
    let reconstruction: ArtResult['reconstruction'];
    if (exact)
      await writeFile(
        path.join(staging, 'object-mask.png'),
        await maskPng(objectPixels, width, height),
        { flag: 'wx' },
      );
    if (operation === 'extract') {
      await writeFile(path.join(staging, 'cutout.png'), cutout, { flag: 'wx' });
      const background = await sharp(image).ensureAlpha().raw().toBuffer();
      const combined = Buffer.from(background),
        difference = Buffer.alloc(raw.length, 0);
      let changedPixels = 0,
        selectedPixels = 0,
        cleanupPixels = 0,
        unexpectedPixels = 0;
      for (let i = 0; i < raw.length; i += 4) {
        if (objectPixels[i / 4]) selectedPixels++;
        const a = cutoutRaw[i + 3]! / 255,
          b = background[i + 3]! / 255;
        const alpha = a + b * (1 - a);
        for (let c = 0; c < 3; c++)
          combined[i + c] = alpha
            ? Math.round(
                (cutoutRaw[i + c]! * a + background[i + c]! * b * (1 - a)) /
                  alpha,
              )
            : 0;
        combined[i + 3] = Math.round(alpha * 255);
        const changed =
          raw[i + 3] !== combined[i + 3] ||
          ((raw[i + 3] || combined[i + 3]) &&
            [0, 1, 2].some((c) => raw[i + c] !== combined[i + c]));
        if (changed) changedPixels++;
        const cleanup =
          changed && !objectPixels[i / 4] && repairCoverage[i / 4]! > 0;
        if (cleanup) cleanupPixels++;
        if (changed && !cleanup) unexpectedPixels++;
        difference[i] = changed ? 255 : 0;
        difference[i + 1] = cleanup ? 170 : 0;
        difference[i + 3] = 255;
      }
      reconstruction = {
        changedPixels,
        selectedPixels,
        cleanupPixels,
        unexpectedPixels,
      };
      if (unexpectedPixels)
        throw Error(
          'Kontrola zloženia zistila zmenené pixely. Výsledok sa nepublikoval.',
        );
      await writeFile(
        path.join(staging, 'reassembled.png'),
        await png(combined),
        { flag: 'wx' },
      );
      await writeFile(
        path.join(staging, 'difference.png'),
        await png(difference),
        { flag: 'wx' },
      );
    }
    let animation: AnimationDefinition | undefined;
    if (operation === 'loop') {
      const count = input.frameCount ?? 16,
        fps = input.fps ?? 8,
        amount = input.amplitude ?? 4;
      const motion = input.motion ?? 'water';
      if (
        !Number.isInteger(count) ||
        Number(count) < 4 ||
        Number(count) > 24 ||
        typeof fps !== 'number' ||
        !Number.isFinite(fps) ||
        fps < 1 ||
        fps > 30 ||
        typeof amount !== 'number' ||
        !Number.isFinite(amount) ||
        amount < 1 ||
        amount > 32 ||
        !['water', 'clouds', 'smoke'].includes(String(motion))
      )
        throw Error(
          'Neplatné nastavenie slučky (4–24 snímok, 1–30 fps, sila 1–32 px).',
        );
      const bBox = polygonBounds(points!);
      const x0 = Math.floor(bBox.x),
        y0 = Math.floor(bBox.y),
        bw = Math.max(1, Math.ceil(bBox.x + bBox.width) - x0),
        bh = Math.max(1, Math.ceil(bBox.y + bBox.height) - y0);
      const wrap = (n: number, start: number, length: number) =>
        start + ((((n - start) % length) + length) % length);
      const frames: string[] = [];
      let total = 0;
      for (let frame = 0; frame < Number(count); frame++) {
        options.onStage?.(`Vykresľujem snímku ${frame + 1}/${count}`);
        const result = Buffer.from(cutoutRaw),
          phase = (frame * Math.PI * 2) / Number(count);
        for (let y = y0; y < Math.min(height, y0 + bh); y++) {
          // Keep project reads, saves and progress polling responsive even for
          // large local loops; no worker framework is needed for these batches.
          if ((y - y0) % 32 === 0) await yieldToEditor();
          for (let x = x0; x < Math.min(width, x0 + bw); x++) {
            const i = (y * width + x) * 4;
            if (!coverage[i + 3]) continue;
            const dx =
              amount *
              Math.sin(
                phase +
                  (motion === 'water'
                    ? ((y - y0) / bh) * Math.PI * 4
                    : motion === 'smoke'
                      ? ((y - y0) / bh) * 5
                      : 0),
              );
            const dy = motion === 'smoke' ? amount * Math.cos(phase) : 0;
            const sx = wrap(x + dx, x0, bw),
              sy = wrap(y + dy, y0, bh);
            const ix = Math.floor(sx),
              iy = Math.floor(sy),
              fx = sx - ix,
              fy = sy - iy;
            const nextX = Math.min(width - 1, wrap(ix + 1, x0, bw)),
              nextY = Math.min(height - 1, wrap(iy + 1, y0, bh));
            const a = (iy * width + ix) * 4,
              b = (iy * width + nextX) * 4,
              c = (nextY * width + ix) * 4,
              d = (nextY * width + nextX) * 4;
            const wa = ((1 - fx) * (1 - fy) * raw[a + 3]!) / 255,
              wb = (fx * (1 - fy) * raw[b + 3]!) / 255,
              wc = ((1 - fx) * fy * raw[c + 3]!) / 255,
              wd = (fx * fy * raw[d + 3]!) / 255;
            const edge = Math.max(
              0,
              Math.min(
                1,
                Math.min(
                  x - bBox.x,
                  y - bBox.y,
                  bBox.x + bBox.width - x,
                  bBox.y + bBox.height - y,
                ) / 6,
              ),
            );
            const weight = edge * (wa + wb + wc + wd);
            for (let channel = 0; channel < 3; channel++) {
              const sampled =
                raw[a + channel]! * wa +
                raw[b + channel]! * wb +
                raw[c + channel]! * wc +
                raw[d + channel]! * wd;
              result[i + channel] = Math.round(
                raw[i + channel]! * (1 - weight) + sampled * edge,
              );
            }
          }
        }
        const name = `frame-${String(frame + 1).padStart(3, '0')}.png`;
        const bytes = await png(result);
        total += bytes.length;
        if (total > 64 * 1024 * 1024)
          throw Error('Slučka je príliš veľká. Zmenši zdrojový obrázok.');
        await writeFile(path.join(staging, name), bytes, { flag: 'wx' });
        frames.push(`${prefix}/${name}`);
      }
      animation = {
        id: `ambient-${id}`,
        label: `Slučka · ${motion}`,
        source: `${prefix}/image.png`,
        frames,
        kind: 'idle',
        fps,
        loop: true,
      };
    }
    const manifest = {
      version: 2,
      source: input.source,
      sourceSha256: hash(original.bytes),
      operation,
      selection: points,
      objectMask: exact
        ? {
            file: 'object-mask.png',
            method: suppliedMask?.method ?? 'polygon',
            refineEdges: suppliedMask?.refineEdges,
            detailPass: suppliedMask?.detailPass,
            pixelOwnership: 'binary',
          }
        : undefined,
      repairPadding,
      repairMask: ['extract', 'remove'].includes(operation)
        ? 'repair-mask.png'
        : undefined,
      reconstruction,
      prompt: ai ? input.prompt : undefined,
      model: ai ? artStatus(options).model : undefined,
      motion:
        operation === 'loop'
          ? {
              kind: input.motion ?? 'water',
              frameCount: input.frameCount ?? 16,
              fps: input.fps ?? 8,
              amplitude: input.amplitude ?? 4,
            }
          : undefined,
      animation,
    };
    await writeFile(
      path.join(staging, 'recipe.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { flag: 'wx' },
    );
    if (hash(await readFile(original.filename)) !== hash(original.bytes))
      throw Error('Zdroj sa medzitým zmenil. Výsledok sa neuložil.');
    options.onStage?.('Overujem zdroj a publikujem assety');
    await rename(staging, path.join(folder, id));
    return {
      operation,
      source: input.source,
      image: `${prefix}/image.png`,
      cutout: operation === 'extract' ? `${prefix}/cutout.png` : undefined,
      animation,
      width,
      height,
      manifest: `${prefix}/recipe.json`,
      objectMask: exact ? `${prefix}/object-mask.png` : undefined,
      original: `${prefix}/source.png`,
      reassembled: reconstruction ? `${prefix}/reassembled.png` : undefined,
      difference: reconstruction ? `${prefix}/difference.png` : undefined,
      repairMask: ['extract', 'remove'].includes(operation)
        ? `${prefix}/repair-mask.png`
        : undefined,
      reconstruction,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
