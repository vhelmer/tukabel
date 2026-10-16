import type { Hotspot } from './types';
import { centre, imagePlacement, rotateAround } from './transforms';
import type { Point } from './transforms';

export interface AlphaMask {
  width: number;
  height: number;
  alpha: Uint8Array;
}

export type ScenePicker = (point: Point) => Hotspot | null;
export const defaultAlphaThreshold = 32;

// Coordinates inside the unrotated hotspot frame, before the visual's idle pose.
export function hitTestLocal(
  hotspot: Hotspot,
  point: Point,
  mask?: AlphaMask,
  pose?: { rotation: number; scaleX: number; scaleY: number },
): boolean {
  const { width, height } = hotspot.bounds;
  if (!hotspot.image || hotspot.hitTest === 'bounds')
    return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
  // A failed/pending image must never turn its transparent frame into a target.
  if (!mask) return false;
  let p = point;
  if (pose) {
    if (!pose.scaleX || !pose.scaleY) return false;
    const pivot = { x: width / 2, y: height };
    p = rotateAround(point, pivot, -pose.rotation);
    p = {
      x: pivot.x + (p.x - pivot.x) / pose.scaleX,
      y: pivot.y + (p.y - pivot.y) / pose.scaleY,
    };
  }
  const placement = imagePlacement(
    { x: 0, y: 0, width, height },
    mask,
    hotspot.imageFit,
  );
  const x = Math.floor(((p.x - placement.x) / placement.width) * mask.width);
  const y = Math.floor(((p.y - placement.y) / placement.height) * mask.height);
  return (
    x >= 0 &&
    x < mask.width &&
    y >= 0 &&
    y < mask.height &&
    mask.alpha[y * mask.width + x]! >=
      (hotspot.alphaThreshold ?? defaultAlphaThreshold)
  );
}

export function hotspotLocalPoint(hotspot: Hotspot, point: Point): Point {
  const p = rotateAround(
    point,
    centre(hotspot.bounds),
    -(hotspot.rotation ?? 0),
  );
  return { x: p.x - hotspot.bounds.x, y: p.y - hotspot.bounds.y };
}

export function hitTestHotspot(
  hotspot: Hotspot,
  point: Point,
  mask?: AlphaMask,
) {
  return hitTestLocal(hotspot, hotspotLocalPoint(hotspot, point), mask);
}
