import type { PointerEvent } from 'react';
import type { Point } from '../game/transforms';
import { maxPolygonPoints } from '../game/polygon';

export function PolygonHandles({
  points,
  screenScale,
  selectedVertex,
  onStart,
  onSelect,
  onAdd,
  onRemove,
  onNudge,
}: {
  points: readonly Point[];
  screenScale: number;
  selectedVertex: number;
  onStart: (event: PointerEvent<SVGElement>, index: number) => void;
  onSelect: (index: number) => void;
  onAdd: (index: number) => void;
  onRemove: (index: number) => void;
  onNudge: (index: number, delta: Point) => void;
}) {
  const handle = 28 / screenScale;
  return (
    <>
      {points.map((p, i, points) => {
        const next = points[(i + 1) % points.length]!;
        return (
          <g key={i}>
            {points.length < maxPolygonPoints && (
              <g
                role="button"
                tabIndex={0}
                aria-label={`Pridať vrchol na hranu ${i + 1}`}
                data-edge-index={i}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={() => onAdd(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onAdd(i);
                  }
                }}
                style={{ cursor: 'copy' }}
              >
                <circle
                  cx={(p.x + next.x) / 2}
                  cy={(p.y + next.y) / 2}
                  r={handle * 0.29}
                  fill="#303a32"
                  stroke="#f1ce83"
                  strokeWidth={1 / screenScale}
                />
                <text
                  x={(p.x + next.x) / 2}
                  y={(p.y + next.y) / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#f1ce83"
                  fontSize={14 / screenScale}
                  pointerEvents="none"
                >
                  +
                </text>
              </g>
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={handle * 0.34}
              fill={selectedVertex === i ? '#f1ce83' : '#3e776c'}
              stroke="#fff0d4"
              strokeWidth={2 / screenScale}
              role="button"
              tabIndex={0}
              aria-label={`Vrchol ${i + 1}`}
              data-vertex-index={i}
              style={{ cursor: 'move' }}
              onFocus={() => onSelect(i)}
              onPointerDown={(e) => {
                onStart(e, i);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove(i);
                }
                const shifts: Record<string, Point> = {
                  ArrowLeft: { x: -1, y: 0 },
                  ArrowRight: { x: 1, y: 0 },
                  ArrowUp: { x: 0, y: -1 },
                  ArrowDown: { x: 0, y: 1 },
                };
                const shift = shifts[e.key];
                if (!shift) return;
                e.preventDefault();
                e.stopPropagation();
                const step = e.shiftKey ? 10 : 1;
                onNudge(i, { x: shift.x * step, y: shift.y * step });
              }}
            />
          </g>
        );
      })}
    </>
  );
}
