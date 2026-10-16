import type { Hotspot } from '../game/types';
import type { Bounds, Point } from '../game/transforms';
import { centre, rotateAround, rotate } from '../game/transforms';
import { roundBounds } from './transformTools';
import { polygonBounds } from '../game/polygon';

const roundPoint = (p: Point): Point => ({
  x: Math.round(p.x * 1000) / 1000,
  y: Math.round(p.y * 1000) / 1000,
});

export function withHotspotBounds(hotspot: Hotspot, bounds: Bounds): Hotspot {
  const old = hotspot.bounds;
  if (
    old.x === bounds.x &&
    old.y === bounds.y &&
    old.width === bounds.width &&
    old.height === bounds.height
  )
    return hotspot;
  return {
    ...hotspot,
    bounds,
    polygon: hotspot.polygon?.map((p) =>
      roundPoint({
        x: bounds.x + ((p.x - old.x) * bounds.width) / old.width,
        y: bounds.y + ((p.y - old.y) * bounds.height) / old.height,
      }),
    ),
  };
}

// Refit an outline without shifting its surviving vertices when its rotation
// pivot changes. Image-backed manual polygons retain the image's original frame.
export function withPolygon(
  hotspot: Hotspot,
  polygon: readonly Point[],
): Hotspot {
  if (hotspot.image) return { ...hotspot, polygon: polygon.map(roundPoint) };
  const bounds = polygonBounds(polygon),
    oldPivot = centre(hotspot.bounds),
    pivot = centre(bounds);
  const rotated = rotate(
    { x: pivot.x - oldPivot.x, y: pivot.y - oldPivot.y },
    hotspot.rotation ?? 0,
  );
  const dx = oldPivot.x + rotated.x - pivot.x,
    dy = oldPivot.y + rotated.y - pivot.y;
  const points = polygon.map((p) => roundPoint({ x: p.x + dx, y: p.y + dy }));
  return {
    ...hotspot,
    bounds: roundBounds(polygonBounds(points)),
    polygon: points,
  };
}
export function movePolygonVertex(
  hotspot: Hotspot,
  index: number,
  world: Point,
): Hotspot {
  const p = rotateAround(
    world,
    centre(hotspot.bounds),
    -(hotspot.rotation ?? 0),
  );
  if (hotspot.image) {
    const b = hotspot.bounds;
    p.x = Math.max(b.x, Math.min(b.x + b.width, p.x));
    p.y = Math.max(b.y, Math.min(b.y + b.height, p.y));
  }
  return withPolygon(
    hotspot,
    hotspot.polygon!.map((old, i) => (i === index ? p : old)),
  );
}
