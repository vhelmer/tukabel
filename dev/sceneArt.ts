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
import { prepareExtractedAsset } from './extractedAsset.ts';
import { readObjectMask, maskPng } from './objectMask.ts';
import { matteForeground, type SegmentationOptions } from './segmentation.ts';
import {
  prepareGeneratedAsset,
  placeGeneratedAsset,
  inspectAssetAlpha,
} from './generatedAsset.ts';
import { polygonBounds, polygonIssue } from '../src/game/polygon.ts';
import type { AnimationDefinition } from '../src/game/types.ts';
import type { Point } from '../src/game/transforms.ts';
import type { InpaintDebug } from '../src/editor/inpaintDebug.ts';
import {
  featherRepair,
  prepareInpaint,
  composeRepair,
  rgbMae,
} from './inpaint.ts';
import {
  defaultImageModel,
  defaultImageQuality,
  imageModels,
  imageQualities,
  type ImageQuality,
} from '../src/editor/artSettings.ts';

export interface ArtOptions {
  apiKey?: string;
  model?: string;
  quality?: string;
  fetch?: typeof fetch;
  onStage?: (stage: string) => void;
  segmentation?: SegmentationOptions;
}
export type ArtOperation =
  'cutout' | 'loop' | 'edit' | 'extract' | 'remove' | 'generate' | 'asset';
export interface ArtResult {
  operation: ArtOperation;
  source: string;
  image: string;
  cutout?: string;
  preview?: string;
  extractionMethod?: 'openai';
  assetScale?: 1 | 2;
  alignment?: import('../src/editor/artSettings.ts').AssetAlignment;
  alignmentMatches?: string;
  cutoutFull?: string;
  cutoutFrame?: import('../src/game/transforms.ts').CropFrame;
  backgrounds?: { restored: string; masked: string };
  animation?: AnimationDefinition;
  width: number;
  height: number;
  manifest: string;
  objectMask?: string;
  original?: string;
  reassembled?: string;
  difference?: string;
  repairMask?: string;
  debugOnly?: boolean;
  blockedReason?: string;
  assetDiagnostic?: import('../src/editor/artSettings.ts').AssetDiagnostic;
  debug?: InpaintDebug;
  model?: string;
  quality?: ImageQuality;
  reconstruction?: {
    changedPixels: number;
    selectedPixels: number;
    cleanupPixels: number;
    unexpectedPixels: number;
    edgePixels?: number;
  };
}
const MAX_PIXELS = ART_MAX_PIXELS;
const MAX_BYTES = 24 * 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const aiOperations = ['edit', 'extract', 'remove', 'generate', 'asset'];
function imageSettings(model: string, quality: unknown) {
  if (!imageQualities(model).includes(quality as ImageQuality))
    throw Error(
      `Neplatná kvalita obrázku pro ${model}. Vyber ${imageQualities(model).join(', ')}; zkontroluj i OPENAI_IMAGE_QUALITY.`,
    );
  return { model, quality: quality as ImageQuality };
}
export const artStatus = (options: ArtOptions) => ({
  configured: Boolean(options.apiKey),
  ...imageSettings(
    options.model || defaultImageModel,
    options.quality || defaultImageQuality,
  ),
});

// Single provider boundary. It returns pixels, never project paths or credentials.
async function editImage(
  image: Buffer,
  mask: Buffer | undefined,
  prompt: string,
  size: string,
  options: ArtOptions,
  output?: { transparent: true; guide: Buffer },
) {
  const { model, quality } = artStatus(options);
  if (!options.apiKey)
    throw Error('Nastav OPENAI_API_KEY v .env.local a restartuj Vite.');
  const body = {
    model,
    images: [
      { image_url: `data:image/png;base64,${image.toString('base64')}` },
      ...(output
        ? [
            {
              image_url: `data:image/png;base64,${output.guide.toString('base64')}`,
            },
          ]
        : []),
    ],
    ...(output ? { background: 'transparent' } : {}),
    mask: mask
      ? { image_url: `data:image/png;base64,${mask.toString('base64')}` }
      : undefined,
    prompt,
    n: 1,
    quality,
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
    throw Error('AI služba neodpověděla. Požadavek se automaticky neopakuje.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      `AI úprava selhala (HTTP ${response.status}, ${model}, ${quality}). Zkontroluj přístup k modelu, nastavení a kredit; požadavek se neopakuje.`,
    );
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > 40 * 1024 * 1024) throw Error('Odpověď AI je příliš velká.');
    chunks.push(chunk);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw Error('AI vrátila nečitelnou odpověď. Požadavek se neopakuje.');
  }
  const item =
    object(data) && Array.isArray(data.data)
      ? (data.data[0] as unknown)
      : undefined;
  if (!object(item) || typeof item.b64_json !== 'string')
    throw Error('AI nevrátila PNG obrázek.');
  const bytes = Buffer.from(item.b64_json, 'base64');
  const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
  if (
    meta.format !== 'png' ||
    (meta.pages ?? 1) !== 1 ||
    bytes.length > MAX_BYTES
  )
    throw Error('AI vrátila neplatný nebo příliš velký obrázek.');
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
    throw Error('Neplatná grafická operace.');
  const operation = input.operation as ArtOperation;
  const debugOnly = input.debugOnly === true;
  const assetScale = input.assetScale ?? 1;
  if (
    ![1, 2].includes(Number(assetScale)) ||
    typeof assetScale !== 'number' ||
    (input.assetScale !== undefined &&
      !(
        operation === 'asset' ||
        (operation === 'extract' && input.extractionMethod === 'openai')
      ))
  )
    throw Error('Neplatné rozlišení assetu.');
  if (
    input.extractionMethod !== undefined &&
    (operation !== 'extract' ||
      typeof input.extractionMethod !== 'string' ||
      !['mask', 'openai'].includes(input.extractionMethod))
  )
    throw Error('Neplatná metoda výřezu objektu.');
  const openaiExtraction =
    operation === 'extract' &&
    input.extractionMethod === 'openai' &&
    !debugOnly;
  if (
    (input.debugOnly !== undefined && typeof input.debugOnly !== 'boolean') ||
    (debugOnly && !['extract', 'remove'].includes(operation))
  )
    throw Error(
      'Diagnostika přípravy je dostupná pro oddělení a odstranění objektu.',
    );
  const ai = aiOperations.includes(operation) && !debugOnly;
  if (ai && input.confirmed !== true)
    throw Error('AI generování musíš výslovně spustit.');
  if (
    ai &&
    (typeof input.prompt !== 'string' ||
      !input.prompt.trim() ||
      input.prompt.length > 4000)
  )
    throw Error('Zadej pokyny pro AI (nejvýše 4000 znaků).');
  let settings: ReturnType<typeof imageSettings> | undefined;
  if (ai || debugOnly) {
    const configuredModel = options.model || defaultImageModel;
    const model = input.model ?? configuredModel;
    if (
      typeof model !== 'string' ||
      !imageModels(configuredModel).includes(model)
    )
      throw Error(
        'Vyber podporovaný model obrázků nebo nastav OPENAI_IMAGE_MODEL na serveru.',
      );
    settings = imageSettings(
      model,
      input.quality ?? options.quality ?? defaultImageQuality,
    );
  }
  options.onStage?.('Načítám zdroj a připravuji výběr');
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
    throw Error('Maska není podporovaná pro tuto operaci.');
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
      throw Error('Výběr musí být polygon uvnitř zdrojového obrázku.');
    points = input.selection as Point[];
    if (polygonIssue(points))
      throw Error('Výběr se nesmí křížit a musí mít plochu.');
  }
  if (
    ['cutout', 'loop', 'extract', 'remove', 'asset'].includes(operation) &&
    !points &&
    !suppliedMask
  )
    throw Error('Nejprve vyber oblast obrázku.');
  if (operation === 'generate') points = undefined;
  const assetRequest =
    operation === 'asset'
      ? await prepareGeneratedAsset(source, points!, width, height)
      : undefined;
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
    ['extract', 'remove', 'cutout'].includes(operation) || !!suppliedMask;
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
    objectPixels[p] = suppliedMask?.matting
      ? coverage[p * 4 + 3]! > 0
        ? 255
        : 0
      : coverage[p * 4 + 3]!;
  const repairPadding = ['extract', 'remove'].includes(operation)
    ? (input.repairPadding ?? 12)
    : 0;
  if (
    !Number.isInteger(repairPadding) ||
    Number(repairPadding) < 0 ||
    Number(repairPadding) > 64
  )
    throw Error('Přesah opravy musí být 0–64 px.');
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
  const requestedFeather = input.repairFeather ?? 2;
  if (
    !Number.isInteger(requestedFeather) ||
    Number(requestedFeather) < 0 ||
    Number(requestedFeather) > 32
  )
    throw Error('Přechod švu musí být 0–32 px.');
  const feather = Math.min(Number(requestedFeather), Number(repairPadding));
  const repairCoverage = await featherRepair(
    objectPixels,
    providerMask,
    width,
    height,
    feather,
  );
  if (!debugOnly && !openaiExtraction && suppliedMask?.matting?.decontaminate)
    options.onStage?.('Odděluji barvu pozadí pouze v jemných hranách');
  const cutoutRaw =
    !debugOnly && !openaiExtraction && suppliedMask?.matting?.decontaminate
      ? await matteForeground(
          original,
          suppliedMask.pixels,
          options.segmentation,
        )
      : Buffer.from(raw);
  const maskRaw = Buffer.alloc(raw.length, 255);
  for (let i = 0; i < raw.length; i += 4) {
    cutoutRaw[i + 3] = suppliedMask?.matting
      ? Math.min(raw[i + 3]!, coverage[i + 3]!)
      : Math.round((raw[i + 3]! * coverage[i + 3]!) / 255);
    maskRaw[i + 3] = 255 - providerMask[i / 4]!;
  }
  const png = (data: Buffer) =>
    sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
  let cutout = await png(cutoutRaw);
  // Crop only still cutouts. Animation frames retain their shared source canvas.
  let cutoutFrame: ArtResult['cutoutFrame'];
  let croppedCutout = cutout;
  if (['cutout', 'extract'].includes(operation) && !debugOnly) {
    let left = width,
      top = height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (cutoutRaw[(y * width + x) * 4 + 3]) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
    if (right < left) throw Error('Výřez neobsahuje žádné viditelné pixely.');
    cutoutFrame = {
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
      sourceWidth: width,
      sourceHeight: height,
    };
    croppedCutout = await sharp(cutout)
      .extract({
        left,
        top,
        width: cutoutFrame.width,
        height: cutoutFrame.height,
      })
      .png()
      .toBuffer();
  }
  const mask = await png(maskRaw);
  let image = debugOnly
    ? source
    : operation === 'cutout'
      ? croppedCutout
      : cutout;
  let pipeline: Awaited<ReturnType<typeof prepareInpaint>> | undefined;
  let returned: Buffer | undefined, restored: Buffer | undefined;
  let blockedReason: string | undefined;
  let returnedSize: { width: number; height: number } | undefined;
  if ((ai || debugOnly) && !assetRequest) {
    if ((points || suppliedMask) && !providerMask.some((v) => v > 0))
      throw Error('Maska je prázdná v původním rozlišení. Zvětši výběr.');
    pipeline = await prepareInpaint(source, providerMask, width, height);
  }
  let assetDiagnostic: ArtResult['assetDiagnostic'];
  async function checkedPlacement(
    generated: Buffer,
    target: Parameters<typeof placeGeneratedAsset>[1],
  ) {
    try {
      return await placeGeneratedAsset(generated, target, width, height, {
        scale: assetScale as 1 | 2,
        alphaCutoff: assetRequest || openaiExtraction ? 1 : 0,
      });
    } catch (error) {
      blockedReason =
        error instanceof Error ? error.message : 'Výstup nelze umístit.';
      assetDiagnostic = {
        image:
          operation === 'extract'
            ? 'extraction-returned.png'
            : 'provider-returned.png',
        ...(await inspectAssetAlpha(generated)),
      };
      return undefined;
    }
  }
  let assetPreview: Buffer | undefined;
  let extractionRequest:
    Awaited<ReturnType<typeof prepareExtractedAsset>> | undefined;
  let extractionReturned: Buffer | undefined;
  let extractionComposite: Buffer | undefined;
  let backgroundPrompt: string | undefined;
  let extractionPrompt: string | undefined;
  if (assetRequest) {
    options.onStage?.(
      'AI vytváří transparentní objekt podle pozadí a označeného místa',
    );
    const generated = await editImage(
      assetRequest.reference,
      undefined,
      `Create ONLY one new isolated 2D adventure game object. Image 1 is the original scenery reference. Image 2 marks the intended placement area in pink; use that area and its surroundings to infer the object's scale, viewpoint, support surface, lighting, palette and ink outlines. Do not redraw or include the scenery, the pink guide, existing objects, a floor patch, annotations, watermarks, UI overlays or a checkerboard. Render only the requested new object, centered and completely visible, with at least 8% transparent margin on every side. Use genuine transparent alpha around it, including holes and translucent material. Preserve the reference cartoon drawing style and perspective. The sprite will be fitted proportionally into the selected ${assetRequest.target.width} by ${assetRequest.target.height} source-pixel area. User instructions: ${input.prompt as string}`,
      assetRequest.size,
      { ...options, ...settings },
      { transparent: true, guide: assetRequest.guide },
    );
    returned = generated;
    const placed = await checkedPlacement(generated, assetRequest.target);
    if (placed) {
      image = placed.image;
      croppedCutout = placed.image;
      cutout = placed.full;
      cutoutFrame = placed.frame;
      assetPreview = await sharp(source)
        .composite([{ input: placed.full }])
        .png()
        .toBuffer();
    } else image = source;
  } else if (ai) {
    const { input: workingImage, apiMask, geometry, restore } = pipeline!;
    const workingMask = points || suppliedMask ? apiMask : undefined;
    const work = geometry.canvas;
    const instruction =
      operation === 'remove' || operation === 'extract'
        ? 'Remove the selected object completely, including thin protrusions, outline strokes, contact shadows and detached remnants within the repair mask. Change only the missing background inside the repair mask and reconstruct continuous scenery and line work using adjacent untouched pixels as the color and lighting reference. Preserve the original palette, brightness, contrast, saturation, color temperature, shadows, texture, dirt and wear. Do not relight, brighten, darken, recolor, apply color grading or exposure/white-balance correction to the scene. Do not add highlights or haze. Preserve every existing detail outside the repair mask. Do not leave a duplicate or a silhouette. '
        : operation === 'generate'
          ? 'Create a new 2D adventure location using the reference ONLY for its drawing style, palette and line work. '
          : 'Edit only the selected area. ';
    options.onStage?.('AI upravuje obrázek · požadavek se neopakuje');
    backgroundPrompt = `${instruction}Preserve the reference cartoon drawing style, perspective, lighting and composition outside the edit. Preserve the image framing. No UI, text labels or watermarks. User instructions: ${input.prompt as string}`;
    const generated = await editImage(
      workingImage,
      workingMask,
      backgroundPrompt,
      `${work.width}x${work.height}`,
      { ...options, ...settings },
    );
    returned = generated;
    const meta = await sharp(generated).metadata();
    returnedSize = { width: meta.width!, height: meta.height! };
    // A differently sized response cannot be aligned reliably. Archive it for
    // inspection instead of silently stretching it and publishing a shifted edit.
    if (meta.width !== work.width || meta.height !== work.height) {
      blockedReason = `AI vrátila ${meta.width} × ${meta.height}, očakávané ${work.width} × ${work.height}. Výsledek se neškáluje ani nepoužije; zkontroluj diagnostiku.`;
      image = source;
    } else {
      restored = await restore(generated);
      if (points || suppliedMask) {
        const selectedCoverage = ['extract', 'remove'].includes(operation)
          ? repairCoverage
          : Buffer.from(coverage.filter((_v, i) => i % 4 === 3));
        const merged = composeRepair(raw, restored, selectedCoverage);
        if (operation === 'extract') {
          for (let i = 0; i < raw.length; i += 4)
            if (coverage[i + 3] && raw[i + 3]! < 255) merged.fill(0, i, i + 4);
        }
        image = await png(merged);
      } else image = await png(restored);
    }
  }
  if (openaiExtraction && !blockedReason) {
    extractionRequest = await prepareExtractedAsset(
      source,
      objectPixels,
      width,
      height,
    );
    options.onStage?.('OpenAI odděluje objekt · druhý požadavek bez opakování');
    extractionPrompt =
      'Extract ONLY the existing object highlighted in pink in image 2 from the unmodified image 1. This is background removal, not a redraw or enhancement. Remove all surrounding scenery and background. Return one complete isolated object on genuine transparent alpha, including holes and fine edges. Preserve the original RGB colors, brightness, luminance, contrast, saturation, exposure, white balance, color temperature, shadows and highlights of image 1. Preserve its exact identity, pose, proportions, outline, texture, dirt, stains and wear. Do not brighten or darken the subject, relight it, whiten clothing, clean stains, repaint, beautify, sharpen or normalize its colors. Do not replace shaded or dirty colors with cleaner or lighter versions. Keep subject interior colors unchanged; only change background alpha and decontaminate mixed edge pixels when necessary. Do not include the pink guide, floor, contact shadow, extra objects, text, UI, or a checkerboard. Center the complete object with at least 8% transparent margin on every side. Do not crop any part. Image 2 is a selection guide only: use image 1 as the sole color reference and never copy the pink tint.';
    extractionReturned = await editImage(
      extractionRequest.reference,
      undefined,
      extractionPrompt,
      extractionRequest.size,
      { ...options, ...settings },
      { transparent: true, guide: extractionRequest.guide },
    );
    const placed = await checkedPlacement(
      extractionReturned,
      extractionRequest.target,
    );
    if (placed) {
      cutout = placed.full;
      croppedCutout = placed.image;
      cutoutFrame = placed.frame;
      assetPreview = await sharp(source)
        .composite([{ input: placed.full }])
        .png()
        .toBuffer();
      extractionComposite = await sharp(image)
        .composite([{ input: placed.full }])
        .png()
        .toBuffer();
    }
  }
  const folder = path.join(root, 'scene-art');
  await mkdir(folder, { recursive: true });
  if ((await realpath(folder)) !== path.resolve(folder))
    throw Error('Adresář grafiky nesmí být symbolický odkaz.');
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
    if (assetRequest && returned) {
      for (const [name, bytes] of [
        ['provider-input.png', assetRequest.reference],
        ['placement-guide.png', assetRequest.guide],
        ['provider-returned.png', returned],
      ] as const)
        await writeFile(path.join(staging, name), bytes, { flag: 'wx' });
    }
    if (extractionRequest && extractionReturned) {
      for (const [name, bytes] of [
        ['extraction-input.png', extractionRequest.reference],
        ['extraction-guide.png', extractionRequest.guide],
        ['extraction-returned.png', extractionReturned],
      ] as const)
        await writeFile(path.join(staging, name), bytes, { flag: 'wx' });
    }
    if (assetPreview)
      await writeFile(path.join(staging, 'preview.png'), assetPreview, {
        flag: 'wx',
      });
    if (extractionComposite)
      await writeFile(
        path.join(staging, 'reassembled.png'),
        extractionComposite,
        { flag: 'wx' },
      );
    let reconstruction: ArtResult['reconstruction'];
    if (exact)
      await writeFile(
        path.join(staging, 'object-mask.png'),
        await maskPng(
          suppliedMask?.matting ? suppliedMask.pixels : objectPixels,
          width,
          height,
        ),
        { flag: 'wx' },
      );
    if (suppliedMask?.matting)
      await writeFile(
        path.join(staging, 'ownership-mask.png'),
        await maskPng(objectPixels, width, height),
        { flag: 'wx' },
      );
    if (cutoutFrame && !blockedReason) {
      await writeFile(path.join(staging, 'cutout-full.png'), cutout, {
        flag: 'wx',
      });
      if (operation === 'extract')
        await writeFile(path.join(staging, 'cutout.png'), croppedCutout, {
          flag: 'wx',
        });
    }
    if (
      operation === 'extract' &&
      !debugOnly &&
      !blockedReason &&
      !openaiExtraction
    ) {
      const background = await sharp(image).ensureAlpha().raw().toBuffer();
      const combined = Buffer.from(background),
        difference = Buffer.alloc(raw.length, 0);
      let changedPixels = 0,
        selectedPixels = 0,
        cleanupPixels = 0,
        unexpectedPixels = 0,
        edgePixels = 0;
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
        const matteEdge =
          changed &&
          !!suppliedMask?.matting &&
          cutoutRaw[i + 3]! > 0 &&
          cutoutRaw[i + 3]! < raw[i + 3]!;
        if (matteEdge) edgePixels++;
        if (changed && !cleanup && !matteEdge) unexpectedPixels++;
        difference[i] = changed ? 255 : 0;
        difference[i + 1] = cleanup ? 170 : 0;
        if (matteEdge) {
          difference[i] = 0;
          difference[i + 1] = 170;
          difference[i + 2] = 255;
        }
        difference[i + 3] = 255;
      }
      reconstruction = {
        changedPixels,
        selectedPixels,
        cleanupPixels,
        unexpectedPixels,
        ...(suppliedMask?.matting ? { edgePixels } : {}),
      };
      if (unexpectedPixels)
        throw Error(
          'Kontrola složení zjistila změněné pixely. Výsledek se nepublikoval.',
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
          'Neplatné nastavení smyčky (4–24 snímků, 1–30 fps, síla 1–32 px).',
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
        options.onStage?.(`Vykresluji snímek ${frame + 1}/${count}`);
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
          throw Error('Smyčka je příliš velká. Zmenši zdrojový obrázek.');
        await writeFile(path.join(staging, name), bytes, { flag: 'wx' });
        frames.push(`${prefix}/${name}`);
      }
      animation = {
        id: `ambient-${id}`,
        label: `Smyčka · ${motion}`,
        source: `${prefix}/image.png`,
        frames,
        kind: 'idle',
        fps,
        loop: true,
      };
    }
    let debug: InpaintDebug | undefined;
    if (pipeline && ['extract', 'remove'].includes(operation)) {
      const files: InpaintDebug['files'] = {
        original: `${prefix}/source.png`,
        objectMask: `${prefix}/object-mask.png`,
        expandedMask: `${prefix}/expanded-mask.png`,
        blendMask: `${prefix}/repair-mask.png`,
        input: `${prefix}/provider-input.png`,
        apiMask: `${prefix}/provider-mask.png`,
        roundTrip: `${prefix}/round-trip.png`,
        returned: returned ? `${prefix}/provider-returned.png` : undefined,
        restored: restored ? `${prefix}/provider-restored.png` : undefined,
        final: restored && !blockedReason ? `${prefix}/image.png` : undefined,
        difference: restored ? `${prefix}/provider-difference.png` : undefined,
      };
      const finalRaw = await sharp(image).ensureAlpha().raw().toBuffer();
      let objectCount = 0,
        expandedCount = 0,
        featherPixels = 0,
        lostObjectPixels = 0,
        outsideChanges = 0,
        boundaryMaxWeight = 0;
      for (let p = 0; p < objectPixels.length; p++) {
        if (objectPixels[p]) objectCount++;
        if (providerMask[p]) expandedCount++;
        if (repairCoverage[p]! > 0 && repairCoverage[p]! < 255) featherPixels++;
        if (objectPixels[p] && !pipeline.mappedMask[p]) lostObjectPixels++;
        const i = p * 4;
        if (
          !providerMask[p] &&
          (raw[i] !== finalRaw[i] ||
            raw[i + 1] !== finalRaw[i + 1] ||
            raw[i + 2] !== finalRaw[i + 2] ||
            raw[i + 3] !== finalRaw[i + 3])
        )
          outsideChanges++;
        const x = p % width,
          y = Math.floor(p / width);
        if (
          providerMask[p] &&
          ((x > 0 && !providerMask[p - 1]) ||
            (x + 1 < width && !providerMask[p + 1]) ||
            (y > 0 && !providerMask[p - width]) ||
            (y + 1 < height && !providerMask[p + width]))
        )
          boundaryMaxWeight = Math.max(boundaryMaxWeight, repairCoverage[p]!);
      }
      if (outsideChanges)
        throw Error(
          'Kompozice zmenila pixely mimo opravy. Výsledek se nepublikoval.',
        );
      const roundTripMae = rgbMae(raw, pipeline.roundTrip, () => true);
      const contextMae = restored
        ? rgbMae(pipeline.roundTrip, restored, (p) => !providerMask[p])
        : undefined;
      const ring = restored
        ? await sharp(providerMask, { raw: { width, height, channels: 1 } })
            .erode(9)
            .greyscale()
            .raw()
            .toBuffer()
        : undefined;
      const seamMae =
        restored && ring
          ? rgbMae(
              pipeline.roundTrip,
              restored,
              (p) => !providerMask[p] && !!ring[p],
            )
          : undefined;
      const warnings: string[] = [];
      if (!repairPadding)
        warnings.push(
          'Přesah je nulový: tiene a obrysy mimo masky se neopravujú, šev je tvrdý.',
        );
      else if (feather >= Number(repairPadding))
        warnings.push(
          'Přechod švu zaberá celý přesah. Pokud ostávajú stopy objektu, zvětši přesah oproti šířce přechodu.',
        );
      if (
        providerMask.subarray(0, width).some((v) => v > 0) ||
        providerMask.subarray((height - 1) * width).some((v) => v > 0) ||
        providerMask.some(
          (v, p) => !!v && (p % width === 0 || p % width === width - 1),
        )
      )
        warnings.push(
          'Opravná maska dosahuje okraj zdroje; přesah je na něm orezaný.',
        );
      if (expandedCount > width * height * 0.5)
        warnings.push(
          'Opravná maska zaberá viac než polovicu obrázku; zkontroluj výběr a přesah.',
        );
      if (lostObjectPixels)
        warnings.push(
          `Maska po škálování stráca ${lostObjectPixels} pixelů objektu.`,
        );
      if (boundaryMaxWeight)
        warnings.push(
          'Na vnější hranici opravy ostáva nenulový zásah. Zkontroluj přechod švu a přesah.',
        );
      if (roundTripMae > 1)
        warnings.push(
          'Samotné škálování mění detaily. Porovnej kontrolní návrat bez AI s originálem.',
        );
      if (
        (contextMae !== undefined && contextMae > 1) ||
        (seamMae !== undefined && seamMae > 1)
      )
        warnings.push(
          'Model změnil i chráněný kontext. Rozdíl oproti kontrolnímu návratu může vysvětlit barevný šev; color matching se nepoužívá.',
        );
      if (blockedReason) warnings.push(blockedReason);
      debug = {
        files,
        geometry: { ...pipeline.geometry, returned: returnedSize },
        metrics: {
          objectPixels: objectCount,
          expandedPixels: expandedCount,
          featherPixels,
          feather,
          padding: Number(repairPadding),
          lostObjectPixels,
          roundTripMae,
          contextMae,
          seamMae,
          outsideChanges: restored ? outsideChanges : undefined,
          boundaryMaxWeight,
        },
        warnings,
      };
      const artifacts: [string, Buffer][] = [
        ['expanded-mask.png', await maskPng(providerMask, width, height)],
        ['provider-input.png', pipeline.input],
        ['provider-mask.png', pipeline.apiMask],
        ['round-trip.png', await png(pipeline.roundTrip)],
      ];
      if (returned) artifacts.push(['provider-returned.png', returned]);
      if (restored) {
        artifacts.push(['provider-restored.png', await png(restored)]);
        const difference = Buffer.alloc(raw.length, 255);
        for (let i = 0; i < raw.length; i += 4)
          for (let c = 0; c < 3; c++)
            difference[i + c] = Math.min(
              255,
              Math.abs(restored[i + c]! - pipeline.roundTrip[i + c]!) * 4,
            );
        artifacts.push(['provider-difference.png', await png(difference)]);
      }
      await Promise.all(
        artifacts.map(([name, bytes]) =>
          writeFile(path.join(staging, name), bytes, { flag: 'wx' }),
        ),
      );
    }
    const manifest = {
      version: 3,
      assetScale,
      alphaCutoff: assetRequest || openaiExtraction ? 1 : undefined,
      extraction: extractionRequest
        ? {
            method: 'openai',
            target: extractionRequest.target,
            inputCrop: extractionRequest.crop,
            guideMethod: suppliedMask?.method ?? 'polygon',
            fit: 'contain',
            anchor: 'bottom-center',
            provider: 'extraction-returned.png',
            input: 'extraction-input.png',
            guide: 'extraction-guide.png',
            pixelExact: false,
          }
        : undefined,
      assetPlacement: assetRequest
        ? {
            target: assetRequest.target,
            fit: 'contain',
            anchor: 'bottom-center',
            background: 'unchanged',
            guide: 'placement-guide.png',
            provider: 'provider-returned.png',
          }
        : undefined,
      preview: assetPreview ? 'preview.png' : undefined,
      cutoutFrame,
      cutoutFull: cutoutFrame && !blockedReason ? 'cutout-full.png' : undefined,
      backgrounds:
        restored && ['extract', 'remove'].includes(operation)
          ? { restored: 'provider-restored.png', masked: 'image.png' }
          : undefined,
      defaultBackground:
        restored && ['extract', 'remove'].includes(operation)
          ? 'restored'
          : undefined,
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
            pixelOwnership: suppliedMask?.matting ? 'alpha' : 'binary',
            matting: suppliedMask?.matting,
            ownershipMask: suppliedMask?.matting
              ? 'ownership-mask.png'
              : undefined,
          }
        : undefined,
      repairPadding,
      repairFeather: feather,
      debugOnly: debugOnly || undefined,
      blockedReason,
      assetDiagnostic,
      debug,
      pipeline: debug
        ? {
            context: 'full-source-letterbox',
            expansion: 'square-radius-native-pixels',
            imageResampling: 'lanczos3',
            maskDownsampling: 'conservative-pixel-footprints',
            feather: 'inward-smoothstep-chamfer',
            composition: 'premultiplied-interpolation-to-straight-rgba',
          }
        : undefined,
      repairMask: ['extract', 'remove'].includes(operation)
        ? 'repair-mask.png'
        : undefined,
      reconstruction,
      prompt: ai ? input.prompt : undefined,
      providerPrompts:
        backgroundPrompt || extractionPrompt
          ? { background: backgroundPrompt, extraction: extractionPrompt }
          : undefined,
      model: settings?.model,
      quality: settings?.quality,
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
      throw Error('Zdroj se mezitím změnil. Výsledek se neuložil.');
    options.onStage?.('Overujem zdroj a publikujem assety');
    await rename(staging, path.join(folder, id));
    return {
      operation,
      extractionMethod: openaiExtraction ? 'openai' : undefined,
      assetScale: assetScale as 1 | 2,
      source: input.source,
      ...settings,
      debugOnly: debugOnly || undefined,
      blockedReason,
      assetDiagnostic: assetDiagnostic
        ? { ...assetDiagnostic, image: `${prefix}/${assetDiagnostic.image}` }
        : undefined,
      debug,
      image: `${prefix}/image.png`,
      preview: assetPreview ? `${prefix}/preview.png` : undefined,
      cutoutFrame: blockedReason ? undefined : cutoutFrame,
      cutoutFull:
        cutoutFrame && !blockedReason ? `${prefix}/cutout-full.png` : undefined,
      backgrounds:
        restored && ['extract', 'remove'].includes(operation)
          ? {
              restored: `${prefix}/provider-restored.png`,
              masked: `${prefix}/image.png`,
            }
          : undefined,
      cutout:
        operation === 'extract' && !debugOnly && !blockedReason
          ? `${prefix}/cutout.png`
          : undefined,
      animation,
      width,
      height,
      manifest: `${prefix}/recipe.json`,
      objectMask: exact ? `${prefix}/object-mask.png` : undefined,
      original: `${prefix}/source.png`,
      reassembled:
        reconstruction || extractionComposite
          ? `${prefix}/reassembled.png`
          : undefined,
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
