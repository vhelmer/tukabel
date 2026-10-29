// Builds a sky clip mask for a location background: a 4-connected flood fill
// from the top edge through sky-blue and pale cloud pixels, small enclosed
// specks filled and a sub-pixel feather. Usage:
//   node scripts/sky-mask.mjs <background.png> <mask.png> [preview.png]
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const [source, out, preview] = process.argv.slice(2);
const { data, info } = await sharp(source)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const rgb = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
const sky = (i) => {
  const [r, g, b] = rgb(i);
  return b >= 150 && b - r >= 60 && b - g >= 30;
};
const cloud = (i) => {
  const [r, g, b] = rgb(i);
  const lo = Math.min(r, g, b),
    hi = Math.max(r, g, b);
  return lo >= 165 && hi - lo <= 50;
};
const mask = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++)
  if (sky(x)) {
    mask[x] = 1;
    stack.push(x);
  }
while (stack.length) {
  const i = stack.pop(),
    x = i % W,
    y = (i / W) | 0;
  for (const n of [
    x > 0 ? i - 1 : -1,
    x < W - 1 ? i + 1 : -1,
    y > 0 ? i - W : -1,
    y < H - 1 ? i + W : -1,
  ])
    if (n >= 0 && !mask[n] && (sky(n) || cloud(n))) {
      mask[n] = 1;
      stack.push(n);
    }
}
// Fill small enclosed specks (stars of antialiasing, cloud highlights) inside the sky.
const seen = new Uint8Array(W * H);
let filled = 0;
for (let s = 0; s < W * H; s++) {
  if (mask[s] || seen[s]) continue;
  const comp = [s];
  seen[s] = 1;
  let border = false;
  for (let k = 0; k < comp.length; k++) {
    const i = comp[k],
      x = i % W,
      y = (i / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
    for (const n of [
      x > 0 ? i - 1 : -1,
      x < W - 1 ? i + 1 : -1,
      y > 0 ? i - W : -1,
      y < H - 1 ? i + W : -1,
    ])
      if (n >= 0 && !mask[n] && !seen[n]) {
        seen[n] = 1;
        comp.push(n);
      }
    if (comp.length > 200 && border) break;
  }
  if (!border && comp.length <= 200) {
    for (const i of comp) mask[i] = 1;
    filled += comp.length;
  }
}
const alpha = Buffer.from(mask.map((v) => v * 255));
// A sub-pixel feather keeps the clipped cloud edge as soft as the painted outlines.
const soft = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } })
  .blur(0.6)
  .extractChannel(0)
  .raw()
  .toBuffer();
const rgba = Buffer.alloc(W * H * 4, 255);
for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = soft[i];
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(out);
const sky_px = mask.reduce((a, v) => a + v, 0);
console.log(
  JSON.stringify({
    width: W,
    height: H,
    skyPixels: sky_px,
    filledSpecks: filled,
    sourceSha256: createHash('sha256')
      .update(readFileSync(source))
      .digest('hex'),
  }),
);
if (!preview) process.exit(0);
// Preview: non-sky darkened and tinted red.
const prev = Buffer.from(data);
for (let i = 0; i < W * H; i++)
  if (!mask[i]) {
    prev[i * 3] = Math.min(255, prev[i * 3] * 0.5 + 90);
    prev[i * 3 + 1] *= 0.4;
    prev[i * 3 + 2] *= 0.4;
  }
await sharp(prev, { raw: { width: W, height: H, channels: 3 } })
  .resize(1254)
  .png()
  .toFile(preview);
