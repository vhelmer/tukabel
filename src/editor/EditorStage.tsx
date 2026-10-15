import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { SceneImage } from './SceneImage';
import { scenePoint } from '../game/coordinates';
import type { Hotspot, SceneDefinition } from '../game/types';

type Bounds = Hotspot['bounds'];
interface Gesture {
  pointerId: number;
  mode: 'move' | 'resize' | 'draw';
  id: string;
  start: { x: number; y: number };
  original: Bounds;
  bounds: Bounds;
}
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function EditorStage({
  scene,
  selectedId,
  onSelect,
  onBounds,
  onCreate,
}: {
  scene: SceneDefinition;
  selectedId: string;
  onSelect: (id: string) => void;
  onBounds: (id: string, bounds: Bounds) => void;
  onCreate: (bounds: Bounds) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Gesture | null>(null);
  const [drawing, setDrawing] = useState(false);
  const point = (event: PointerEvent<SVGElement>) =>
    svg.current &&
    scenePoint(
      svg.current.getBoundingClientRect(),
      scene,
      event.clientX,
      event.clientY,
    );
  function begin(
    event: PointerEvent<SVGElement>,
    mode: Gesture['mode'],
    hotspot?: Hotspot,
  ) {
    if (event.button !== 0 || gesture.current) return;
    const start = point(event);
    if (!start) return;
    event.stopPropagation();
    event.preventDefault();
    svg.current?.setPointerCapture(event.pointerId);
    if (hotspot) onSelect(hotspot.id);
    const bounds = hotspot?.bounds ?? {
      x: start.x,
      y: start.y,
      width: 1,
      height: 1,
    };
    gesture.current = {
      pointerId: event.pointerId,
      mode,
      id: hotspot?.id ?? '',
      start,
      original: bounds,
      bounds,
    };
    setPreview({ ...gesture.current });
  }
  function move(event: PointerEvent<SVGElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || !svg.current)
      return;
    const rect = svg.current.getBoundingClientRect();
    const end = {
      x: clamp(
        ((event.clientX - rect.left) / rect.width) * scene.width,
        0,
        scene.width,
      ),
      y: clamp(
        ((event.clientY - rect.top) / rect.height) * scene.height,
        0,
        scene.height,
      ),
    };
    const dx = end.x - current.start.x;
    const dy = end.y - current.start.y;
    const old = current.original;
    current.bounds =
      current.mode === 'move'
        ? {
            ...old,
            x: clamp(Math.round(old.x + dx), 0, scene.width - old.width),
            y: clamp(Math.round(old.y + dy), 0, scene.height - old.height),
          }
        : current.mode === 'resize'
          ? {
              ...old,
              width: clamp(Math.round(old.width + dx), 8, scene.width - old.x),
              height: clamp(
                Math.round(old.height + dy),
                8,
                scene.height - old.y,
              ),
            }
          : {
              x: Math.round(Math.min(current.start.x, end.x)),
              y: Math.round(Math.min(current.start.y, end.y)),
              width: Math.round(Math.abs(dx)),
              height: Math.round(Math.abs(dy)),
            };
    setPreview({ ...current });
  }
  function finish(event: PointerEvent<SVGElement>, cancel = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!cancel) {
      if (
        current.mode === 'draw' &&
        current.bounds.width >= 8 &&
        current.bounds.height >= 8
      ) {
        onCreate(current.bounds);
        setDrawing(false);
      } else if (current.mode !== 'draw') onBounds(current.id, current.bounds);
    }
    gesture.current = null;
    setPreview(null);
    if (svg.current?.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
  }
  return (
    <section className="editor-stage-panel">
      <div className="stage-toolbar">
        <div>
          <strong>{scene.title}</strong>
          <span>
            {scene.width} × {scene.height}
          </span>
        </div>
        <button
          aria-pressed={drawing}
          onClick={() => setDrawing((value) => !value)}
        >
          {drawing ? 'Zrušiť kreslenie' : 'Nakresliť hotspot'}
        </button>
      </div>
      <p className="field-note">
        {drawing
          ? 'Potiahni v scéne a vytvor novú oblasť.'
          : 'Klik vyberie objekt. Potiahni oblasť alebo jej dolný pravý roh. Zobrazené sú aj podmienene skryté objekty.'}
      </p>
      <svg
        ref={svg}
        className={`editor-stage ${drawing ? 'drawing' : ''}`}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        style={{ aspectRatio: `${scene.width} / ${scene.height}` }}
        aria-label="Vizuálny editor lokácie"
        onPointerDown={(event) => {
          if (drawing) begin(event, 'draw');
        }}
        onPointerMove={move}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
      >
        <SceneImage
          asset={scene.background}
          bounds={{ x: 0, y: 0, width: scene.width, height: scene.height }}
          fit="stretch"
        />
        {scene.hotspots.map((hotspot) => {
          const bounds =
            preview?.id === hotspot.id ? preview.bounds : hotspot.bounds;
          return (
            <g
              key={hotspot.id}
              data-hotspot-id={hotspot.id}
              transform={`rotate(${hotspot.rotation ?? 0} ${bounds.x + bounds.width / 2} ${bounds.y + bounds.height / 2})`}
              onPointerDown={(event) => {
                if (!drawing) begin(event, 'move', hotspot);
              }}
            >
              {hotspot.image && (
                <SceneImage
                  asset={hotspot.image}
                  bounds={bounds}
                  fit={hotspot.imageFit}
                />
              )}
              <rect
                {...bounds}
                className={
                  selectedId === hotspot.id
                    ? 'editor-region selected'
                    : 'editor-region'
                }
                pointerEvents={drawing ? 'none' : 'all'}
              />
              <text x={bounds.x + 8} y={bounds.y + 24} pointerEvents="none">
                {hotspot.label}
              </text>
              {selectedId === hotspot.id && (
                <rect
                  x={bounds.x + bounds.width - 14}
                  y={bounds.y + bounds.height - 14}
                  width={26}
                  height={26}
                  className="resize-handle"
                  data-resize-id={hotspot.id}
                  onPointerDown={(event) => {
                    if (!drawing) begin(event, 'resize', hotspot);
                  }}
                />
              )}
            </g>
          );
        })}
        {preview?.mode === 'draw' && (
          <rect
            {...preview.bounds}
            className="editor-region selected"
            pointerEvents="none"
          />
        )}
      </svg>
    </section>
  );
}
