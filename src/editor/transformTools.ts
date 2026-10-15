import {
  centre,
  rotate,
  rotateAround,
  rotatedBounds,
  isInsideScene,
} from '../game/transforms';
import type { Bounds, Point } from '../game/transforms';

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const roundBounds = (b: Bounds): Bounds => ({
  x: Math.round(b.x * 1000) / 1000,
  y: Math.round(b.y * 1000) / 1000,
  width: Math.round(b.width * 1000) / 1000,
  height: Math.round(b.height * 1000) / 1000,
});
export function moveBounds(
  bounds: Bounds,
  rotation: number,
  delta: Point,
  scene: { width: number; height: number },
): Bounds {
  const envelope = rotatedBounds(bounds, rotation);
  return roundBounds({
    ...bounds,
    x:
      bounds.x +
      clamp(delta.x, -envelope.x, scene.width - envelope.x - envelope.width),
    y:
      bounds.y +
      clamp(delta.y, -envelope.y, scene.height - envelope.y - envelope.height),
  });
}
export function resizeBounds(
  bounds: Bounds,
  rotation: number,
  delta: Point,
  scene: { width: number; height: number },
  proportional: boolean,
): Bounds {
  const local = rotate(delta, -rotation);
  const factor = Math.max(
    8 / Math.min(bounds.width, bounds.height),
    1 +
      (local.x * bounds.width + local.y * bounds.height) /
        (bounds.width ** 2 + bounds.height ** 2),
  );
  const width = proportional
    ? bounds.width * factor
    : Math.max(8, bounds.width + local.x);
  const height = proportional
    ? bounds.height * factor
    : Math.max(8, bounds.height + local.y);
  const anchor = rotateAround(
    { x: bounds.x, y: bounds.y },
    centre(bounds),
    rotation,
  );
  const at = (fraction: number): Bounds => {
    const w = bounds.width + (width - bounds.width) * fraction;
    const h = bounds.height + (height - bounds.height) * fraction;
    const half = rotate({ x: w / 2, y: h / 2 }, rotation);
    return {
      x: anchor.x + half.x - w / 2,
      y: anchor.y + half.y - h / 2,
      width: w,
      height: h,
    };
  };
  if (isInsideScene(at(1), scene, rotation)) return roundBounds(at(1));
  // Stop at the scene boundary while keeping the opposite rotated corner fixed.
  let low = 0,
    high = 1;
  for (let step = 0; step < 20; step++) {
    const mid = (low + high) / 2;
    if (isInsideScene(at(mid), scene, rotation)) low = mid;
    else high = mid;
  }
  return roundBounds(at(low));
}
export function rotationFromDrag(
  bounds: Bounds,
  original: number,
  start: Point,
  end: Point,
  snap: boolean,
) {
  const pivot = centre(bounds);
  const difference =
    Math.atan2(end.y - pivot.y, end.x - pivot.x) -
    Math.atan2(start.y - pivot.y, start.x - pivot.x);
  const degrees =
    original +
    (Math.atan2(Math.sin(difference), Math.cos(difference)) * 180) / Math.PI;
  const rounded = Math.round(degrees / (snap ? 15 : 1)) * (snap ? 15 : 1);
  return ((((rounded + 180) % 360) + 360) % 360) - 180;
}
export function editDimension(
  bounds: Bounds,
  key: keyof Bounds,
  value: number,
  proportional: boolean,
): Bounds {
  if (
    !proportional ||
    key === 'x' ||
    key === 'y' ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return { ...bounds, [key]: value };
  const factor = value / bounds[key];
  return roundBounds({
    ...bounds,
    width: bounds.width * factor,
    height: bounds.height * factor,
  });
}
