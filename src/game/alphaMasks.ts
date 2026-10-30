import type { AlphaMask } from './hitTest';

// One CPU alpha byte per source pixel, shared across scenes and editor/game.
// Resolved entries are LRU-bounded; mounted scenes keep their own references.
const cache = new Map<string, Promise<AlphaMask>>();
const sizes = new Map<string, number>();
const budget = 32 * 1024 * 1024;
let bytes = 0;

export function loadAlphaMask(url: string): Promise<AlphaMask> {
  const existing = cache.get(url);
  if (existing) {
    cache.delete(url);
    cache.set(url, existing);
    return existing;
  }
  const pending = new Promise<AlphaMask>((resolve, reject) => {
    const image = new Image();
    // Release HD assets may come from another origin; reading pixels needs CORS.
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      try {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Cannot read image alpha');
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        const alpha = new Uint8Array(canvas.width * canvas.height);
        for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
        resolve({ width: canvas.width, height: canvas.height, alpha });
      } catch (error) {
        reject(error);
      } finally {
        canvas.width = canvas.height = 0;
        image.onload = image.onerror = null;
      }
    };
    image.onerror = () => {
      image.onload = image.onerror = null;
      reject(new Error(`Cannot load alpha mask: ${url}`));
    };
    image.src = url;
  })
    .then((mask) => {
      sizes.set(url, mask.alpha.byteLength);
      bytes += mask.alpha.byteLength;
      for (const key of cache.keys()) {
        if (bytes <= budget) break;
        const size = sizes.get(key);
        if (size === undefined) continue;
        cache.delete(key);
        sizes.delete(key);
        bytes -= size;
      }
      return mask;
    })
    .catch((error: unknown) => {
      cache.delete(url);
      throw error;
    });
  cache.set(url, pending);
  return pending;
}
