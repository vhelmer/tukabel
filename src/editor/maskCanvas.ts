export async function pngPixels(data: string, width: number, height: number) {
  const image = new Image();
  image.src = `data:image/png;base64,${data}`;
  await image.decode();
  if (image.naturalWidth !== width || image.naturalHeight !== height)
    throw Error('Maska má iné rozmery než zdroj.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const result = new Uint8Array(width * height);
  for (let p = 0; p < result.length; p++) {
    const i = p * 4,
      value = rgba[i]!;
    if (rgba[i + 1] !== value || rgba[i + 2] !== value || rgba[i + 3] !== 255)
      throw Error('PNG maska musí byť nepriehľadná v odtieňoch sivej (0–255).');
    result[p] = value;
  }
  return result;
}
export function maskBase64(pixels: Uint8Array, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!,
    rgba = ctx.createImageData(width, height);
  for (let p = 0; p < pixels.length; p++) {
    const i = p * 4;
    rgba.data[i] = rgba.data[i + 1] = rgba.data[i + 2] = pixels[p]!;
    rgba.data[i + 3] = 255;
  }
  ctx.putImageData(rgba, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1]!;
}
// Brush coordinates always refer to original source pixels, independent of zoom.
export function paintMask(
  mask: Uint8Array,
  seeds: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  add: boolean | 'unknown',
) {
  for (
    let row = Math.max(0, Math.floor(y - radius));
    row < Math.min(height, Math.ceil(y + radius));
    row++
  )
    for (
      let col = Math.max(0, Math.floor(x - radius));
      col < Math.min(width, Math.ceil(x + radius));
      col++
    ) {
      if ((col + 0.5 - x) ** 2 + (row + 0.5 - y) ** 2 > radius ** 2) continue;
      const p = row * width + col;
      if (add !== 'unknown') mask[p] = add ? 255 : 0;
      seeds[p] = add === 'unknown' ? 64 : add ? 255 : 128;
    }
}
