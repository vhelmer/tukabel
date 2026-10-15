import type { Hotspot } from './types.ts';

export type Bounds = Hotspot['bounds'];
export interface Point {
  x: number;
  y: number;
}
export const radians = (degrees: number) => (degrees * Math.PI) / 180;
export const centre = (bounds: Bounds): Point => ({
  x: bounds.x + bounds.width / 2,
  y: bounds.y + bounds.height / 2,
});
export function rotate(point: Point, degrees: number): Point {
  const angle = radians(degrees);
  return {
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
  };
}
export function rotateAround(
  point: Point,
  pivot: Point,
  degrees: number,
): Point {
  const local = rotate({ x: point.x - pivot.x, y: point.y - pivot.y }, degrees);
  return { x: pivot.x + local.x, y: pivot.y + local.y };
}
// Shared SVG/Pixi placement, in the coordinate system of the owning rectangle.
export function imagePlacement(
  bounds: Bounds,
  source: { width: number; height: number },
  fit: Hotspot['imageFit'] = 'contain',
): Bounds {
  if (fit === 'stretch') return { ...bounds };
  const scale = Math.min(
    bounds.width / source.width,
    bounds.height / source.height,
  );
  const width = source.width * scale,
    height = source.height * scale;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}
export function rotatedBounds(bounds: Bounds, rotation = 0): Bounds {
  const angle = radians(rotation);
  const width =
    Math.abs(bounds.width * Math.cos(angle)) +
    Math.abs(bounds.height * Math.sin(angle));
  const height =
    Math.abs(bounds.width * Math.sin(angle)) +
    Math.abs(bounds.height * Math.cos(angle));
  const pivot = centre(bounds);
  return { x: pivot.x - width / 2, y: pivot.y - height / 2, width, height };
}
export function containsPoint(
  hotspot: Pick<Hotspot, 'bounds' | 'rotation'>,
  point: Point,
): boolean {
  const p = rotateAround(
    point,
    centre(hotspot.bounds),
    -(hotspot.rotation ?? 0),
  );
  const b = hotspot.bounds;
  return (
    p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height
  );
}
export function isInsideScene(
  bounds: Bounds,
  scene: { width: number; height: number },
  rotation = 0,
): boolean {
  const b = rotatedBounds(bounds, rotation),
    epsilon = 0.001;
  return (
    b.x >= -epsilon &&
    b.y >= -epsilon &&
    b.x + b.width <= scene.width + epsilon &&
    b.y + b.height <= scene.height + epsilon
  );
}
