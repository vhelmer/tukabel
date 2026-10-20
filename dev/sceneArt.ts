import { createHash, randomUUID } from 'node:crypto';
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
import { setImmediate as yieldToEditor } from 'node:timers/promises';
import sharp from 'sharp';
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
}
const MAX_PIXELS = 8 * 1024 * 1024;
const MAX_BYTES = 24 * 1024 * 1024;
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const aiOperations = ['edit', 'extract', 'remove', 'generate'];
export const artStatus = (options: ArtOptions) => ({
  configured: Boolean(options.apiKey),
  model: options.model || 'gpt-image-1.5',
});

async function sourceFile(root: string, id: string) {
  if (
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
  if (!stat.isFile() || stat.size > MAX_BYTES)
    throw Error('Obrázok môže mať najviac 24 MB.');
  return { filename, bytes: await readFile(filename) };
}
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
  const original = await sourceFile(root, input.source);
  const metadata = await sharp(original.bytes, {
    limitInputPixels: MAX_PIXELS,
  }).metadata();
  if ((metadata.pages ?? 1) !== 1)
    throw Error('Vyber statický obrázok, nie animovaný súbor.');
  const decoded = await sharp(original.bytes, { limitInputPixels: MAX_PIXELS })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const raw = decoded.data;
  const source = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
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
  if (['cutout', 'loop', 'extract', 'remove'].includes(operation) && !points)
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
  const cutoutRaw = Buffer.from(raw);
  const maskRaw = Buffer.alloc(raw.length, 255);
  for (let i = 0; i < raw.length; i += 4) {
    cutoutRaw[i + 3] = Math.round((raw[i + 3]! * coverage[i + 3]!) / 255);
    maskRaw[i + 3] = 255 - coverage[i + 3]!;
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
    const workingMask = points
      ? await sharp(mask)
          .resize(w, h)
          .extend({ ...extent, background: '#ffffff' })
          .png()
          .toBuffer()
      : undefined;
    const instruction =
      operation === 'remove' || operation === 'extract'
        ? 'Remove the selected object completely. Reconstruct the scenery behind it seamlessly. Do not leave a duplicate or a silhouette. '
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
    if (points) {
      const merged = Buffer.from(raw);
      for (let i = 0; i < raw.length; i += 4)
        for (let c = 0; c < 4; c++)
          merged[i + c] = Math.round(
            (raw[i + c]! * (255 - coverage[i + 3]!) +
              result[i + c]! * coverage[i + 3]!) /
              255,
          );
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
    if (operation === 'extract')
      await writeFile(path.join(staging, 'cutout.png'), cutout, { flag: 'wx' });
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
      version: 1,
      source: input.source,
      sourceSha256: hash(original.bytes),
      operation,
      selection: points,
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
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
