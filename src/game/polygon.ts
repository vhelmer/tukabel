import type { Point, Bounds } from './transforms.ts';

export const maxPolygonPoints = 128;
const epsilon = 0.000001;
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (p: Point, a: Point, b: Point) =>
  Math.abs(cross(a, b, p)) <= epsilon &&
  p.x >= Math.min(a.x, b.x) - epsilon &&
  p.x <= Math.max(a.x, b.x) + epsilon &&
  p.y >= Math.min(a.y, b.y) - epsilon &&
  p.y <= Math.max(a.y, b.y) + epsilon;

// Even/odd ray crossing handles concave outlines in either winding direction.
// Shared edges count as hits; content order decides which overlapping object wins.
export function containsPolygon(points: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!,
      b = points[i]!;
    if (onSegment(p, a, b)) return true;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)
    )
      inside = !inside;
  }
  return inside;
}

export type PolygonIssue = 'count' | 'duplicate' | 'crossing' | 'area';
export function polygonIssue(points: readonly Point[]): PolygonIssue | null {
  if (points.length < 3 || points.length > maxPolygonPoints) return 'count';
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      if (
        Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y) <
        epsilon
      )
        return 'duplicate';
    }
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j]!,
        d = points[(j + 1) % points.length]!;
      const abC = cross(a, b, c),
        abD = cross(a, b, d),
        cdA = cross(c, d, a),
        cdB = cross(c, d, b);
      if (
        (abC * abD < 0 && cdA * cdB < 0) ||
        onSegment(c, a, b) ||
        onSegment(d, a, b) ||
        onSegment(a, c, d) ||
        onSegment(b, c, d)
      )
        return 'crossing';
    }
    // Adjacent collinear edges may continue straight, but cannot double back.
    const c = points[(i + 2) % points.length]!;
    if (
      Math.abs(cross(a, b, c)) <= epsilon &&
      (onSegment(c, a, b) || onSegment(a, b, c))
    )
      return 'crossing';
  }
  const area = points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length]!;
    return sum + p.x * next.y - p.y * next.x;
  }, 0);
  return Math.abs(area) < epsilon ? 'area' : null;
}

export function polygonBounds(points: readonly Point[]): Bounds {
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function rectanglePoints(b: Bounds): Point[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
}
