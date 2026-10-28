import { rectanglePoints } from './polygon.ts';
import type { Point } from './transforms.ts';
import type { WorldMapDefinition, WorldMapPoint } from './types.ts';

// Legacy point maps keep a usable area; all consumers share the same geometry.
export function worldMapPolygon(
  point: WorldMapPoint,
  map: WorldMapDefinition,
): readonly Point[] {
  if (point.polygon) return point.polygon;
  const width = Math.min(120, map.width);
  const height = Math.min(80, map.height);
  return rectanglePoints({
    x: Math.max(0, Math.min(map.width - width, point.x - width / 2)),
    y: Math.max(0, Math.min(map.height - height, point.y - height / 2)),
    width,
    height,
  });
}
