import sharp from 'sharp';
import { setImmediate as yieldToEditor } from 'node:timers/promises';

// Distance to unselected pixels in original coordinates. Only the repair margin
// fades; the selected object always receives the complete generated background.
export async function featherRepair(
  object: Buffer,
  expanded: Buffer,
  width: number,
  height: number,
  feather: number,
) {
  const blend = Buffer.from(expanded);
  if (!feather) return blend;
  const distance = new Float32Array(expanded.length);
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) await yieldToEditor();
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!expanded[p]) continue;
      let d = feather + 1;
      if (x) d = Math.min(d, distance[p - 1]! + 1);
      if (y) d = Math.min(d, distance[p - width]! + 1);
      if (x && y) d = Math.min(d, distance[p - width - 1]! + diagonal);
      if (x + 1 < width && y)
        d = Math.min(d, distance[p - width + 1]! + diagonal);
      distance[p] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (y % 64 === 0) await yieldToEditor();
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      if (!expanded[p]) continue;
      let d = distance[p]!;
      if (x + 1 < width) d = Math.min(d, distance[p + 1]! + 1);
      if (y + 1 < height) d = Math.min(d, distance[p + width]! + 1);
      if (x && y + 1 < height)
        d = Math.min(d, distance[p + width - 1]! + diagonal);
      if (x + 1 < width && y + 1 < height)
        d = Math.min(d, distance[p + width + 1]! + diagonal);
      distance[p] = d;
      const t = Math.max(0, Math.min(1, (d - 1) / feather));
      blend[p] = object[p] ? 255 : Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  return blend;
}

export async function prepareInpaint(
  source: Buffer,
  expanded: Buffer,
  width: number,
  height: number,
) {
  const canvas =
    width > height
      ? { width: 1536, height: 1024 }
      : width < height
        ? { width: 1024, height: 1536 }
        : { width: 1024, height: 1024 };
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const content = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    left: 0,
    top: 0,
  };
  content.left = Math.floor((canvas.width - content.width) / 2);
  content.top = Math.floor((canvas.height - content.height) / 2);
  const extent = {
    ...content,
    right: canvas.width - content.width - content.left,
    bottom: canvas.height - content.height - content.top,
  };
  const input = await sharp(source)
    .resize(content.width, content.height, { kernel: 'lanczos3' })
    .extend({
      left: extent.left,
      top: extent.top,
      right: extent.right,
      bottom: extent.bottom,
      background: '#281e2b',
    })
    .png()
    .toBuffer();
  // Conservative pixel footprints keep one-pixel antennae/wires editable when
  // downsampling. Nearest-neighbour alone can silently discard them entirely.
  const selected = Buffer.alloc(content.width * content.height);
  if (scale < 1) {
    for (let y = 0; y < height; y++) {
      if (y % 64 === 0) await yieldToEditor();
      const top = Math.floor((y * content.height) / height),
        bottom = Math.ceil(((y + 1) * content.height) / height);
      for (let x = 0; x < width; x++)
        if (expanded[y * width + x]) {
          const left = Math.floor((x * content.width) / width),
            right = Math.ceil(((x + 1) * content.width) / width);
          for (let row = top; row < bottom; row++)
            selected.fill(
              255,
              row * content.width + left,
              row * content.width + right,
            );
        }
    }
  } else {
    const resized = await sharp(expanded, {
      raw: { width, height, channels: 1 },
    })
      .resize(content.width, content.height, { kernel: 'nearest' })
      .greyscale()
      .raw()
      .toBuffer();
    resized.copy(selected);
  }
  const rgba = Buffer.alloc(canvas.width * canvas.height * 4, 255);
  for (let y = 0; y < content.height; y++)
    for (let x = 0; x < content.width; x++)
      rgba[((y + content.top) * canvas.width + x + content.left) * 4 + 3] =
        255 - selected[y * content.width + x]!;
  const apiMask = await sharp(rgba, { raw: { ...canvas, channels: 4 } })
    .png()
    .toBuffer();
  const geometry = { context: { x: 0, y: 0, width, height }, canvas, content };
  const restore = (bytes: Buffer) =>
    sharp(bytes)
      .extract(content)
      .resize(width, height, { kernel: 'lanczos3' })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer();
  const roundTrip = await restore(input);
  const mappedMask = await sharp(selected, { raw: { ...content, channels: 1 } })
    .resize(width, height, { kernel: 'nearest' })
    .greyscale()
    .raw()
    .toBuffer();
  return { input, apiMask, geometry, restore, roundTrip, mappedMask };
}

// Interpolate premultiplied contributions, then store straight RGBA. Blending
// straight RGB and alpha independently creates dark/colored transparent seams.
export function composeRepair(
  original: Buffer,
  generated: Buffer,
  coverage: Buffer,
) {
  const merged = Buffer.from(original);
  for (let p = 0; p < coverage.length; p++) {
    const i = p * 4,
      t = coverage[p]! / 255;
    if (!t) continue;
    if (t === 1) {
      generated.copy(merged, i, i, i + 4);
      continue;
    }
    const a = (original[i + 3]! / 255) * (1 - t),
      b = (generated[i + 3]! / 255) * t,
      alpha = a + b;
    for (let c = 0; c < 3; c++)
      merged[i + c] = alpha
        ? Math.round((original[i + c]! * a + generated[i + c]! * b) / alpha)
        : 0;
    merged[i + 3] = Math.round(alpha * 255);
  }
  return merged;
}

export function rgbMae(a: Buffer, b: Buffer, selected: (p: number) => boolean) {
  let sum = 0,
    n = 0;
  for (let p = 0; p < a.length / 4; p++)
    if (selected(p) && a[p * 4 + 3] && b[p * 4 + 3]) {
      for (let c = 0; c < 3; c++)
        sum += Math.abs(a[p * 4 + c]! - b[p * 4 + c]!);
      n += 3;
    }
  return n ? Math.round((sum / n) * 1000) / 1000 : 0;
}
