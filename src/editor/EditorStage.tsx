import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { assetUrl } from '../game/assets';
import { hitTestHotspot } from '../game/hitTest';
import { useAlphaMasks } from './useAlphaMasks';
import { SceneImage } from './SceneImage';
import { centre, isInsideScene } from '../game/transforms';
import type { Bounds, Point } from '../game/transforms';
import type { Hotspot, SceneDefinition } from '../game/types';
import { moveBounds, resizeBounds, rotationFromDrag } from './transformTools';

interface Gesture {
  pointerId: number;
  mode: 'move' | 'resize' | 'draw' | 'rotate';
  id: string;
  start: Point;
  original: Bounds;
  bounds: Bounds;
  originalRotation: number;
  rotation: number;
  proportional: boolean;
}
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function EditorStage({
  scene,
  selectedId,
  onSelect,
  onHotspot,
  onCreate,
}: {
  scene: SceneDefinition;
  selectedId: string;
  onSelect: (id: string) => void;
  onHotspot: (hotspot: Hotspot) => void;
  onCreate: (bounds: Bounds) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Gesture | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [panning, setPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [helpers, setHelpers] = useState(true);
  const [screenScale, setScreenScale] = useState(1);
  const { masks, error: maskError } = useAlphaMasks(scene);
  const [hoveredId, setHoveredId] = useState('');
  const pick = (p: Point) =>
    [...scene.hotspots]
      .reverse()
      .find((hotspot) =>
        hitTestHotspot(
          hotspot,
          p,
          hotspot.image ? masks?.get(assetUrl(hotspot.image)) : undefined,
        ),
      );
  const selected = scene.hotspots.find((h) => h.id === selectedId);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      const scale = Math.min(
        box.width / scene.width,
        box.height / scene.height,
      );
      if (scale > 0) setScreenScale(scale);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scene.width, scene.height]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const current = gesture.current;
      gesture.current = null;
      setPreview(null);
      setDrawing(false);
      if (current && svg.current?.hasPointerCapture(current.pointerId))
        svg.current.releasePointerCapture(current.pointerId);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const point = (event: PointerEvent<SVGElement>): Point | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: p.x, y: p.y };
  };
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
      originalRotation: hotspot?.rotation ?? 0,
      rotation: hotspot?.rotation ?? 0,
      proportional: Boolean(hotspot?.image) && hotspot?.imageFit !== 'stretch',
    };
    setPreview({ ...gesture.current });
  }
  function move(event: PointerEvent<SVGElement>) {
    const current = gesture.current,
      end = point(event);
    if (!current) {
      setHoveredId(end && !drawing && !panning ? (pick(end)?.id ?? '') : '');
      return;
    }
    if (current.pointerId !== event.pointerId || !end) return;
    const delta = { x: end.x - current.start.x, y: end.y - current.start.y };
    if (current.mode === 'move')
      current.bounds = moveBounds(
        current.original,
        current.originalRotation,
        delta,
        scene,
      );
    else if (current.mode === 'resize')
      current.bounds = resizeBounds(
        current.original,
        current.originalRotation,
        delta,
        scene,
        current.proportional,
      );
    else if (current.mode === 'rotate') {
      const next = rotationFromDrag(
        current.original,
        current.originalRotation,
        current.start,
        end,
        event.shiftKey,
      );
      if (isInsideScene(current.original, scene, next)) current.rotation = next;
    } else {
      const x = clamp(end.x, 0, scene.width),
        y = clamp(end.y, 0, scene.height);
      current.bounds = {
        x: Math.round(Math.min(current.start.x, x)),
        y: Math.round(Math.min(current.start.y, y)),
        width: Math.round(Math.abs(x - current.start.x)),
        height: Math.round(Math.abs(y - current.start.y)),
      };
    }
    setPreview({ ...current });
  }
  function finish(event: PointerEvent<SVGElement>, cancel = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPreview(null);
    if (!cancel) {
      if (
        current.mode === 'draw' &&
        current.bounds.width >= 8 &&
        current.bounds.height >= 8
      ) {
        onCreate(current.bounds);
        setDrawing(false);
      } else if (current.mode !== 'draw') {
        const hotspot = scene.hotspots.find((h) => h.id === current.id);
        if (hotspot)
          onHotspot({
            ...hotspot,
            bounds: current.bounds,
            rotation: current.rotation || undefined,
          });
      }
    }
    if (svg.current?.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
  }
  const active = selected
    ? {
        ...selected,
        bounds: preview?.id === selected.id ? preview.bounds : selected.bounds,
        rotation:
          preview?.id === selected.id
            ? preview.rotation
            : (selected.rotation ?? 0),
      }
    : undefined;
  const activePivot = active ? centre(active.bounds) : { x: 0, y: 0 };
  const handle = 28 / screenScale;
  return (
    <section className="editor-stage-panel">
      <div className="stage-toolbar">
        <div>
          <strong>{scene.title}</strong>
          <span>
            {scene.width} × {scene.height}
          </span>
        </div>
        <label>
          Priblíženie scény{' '}
          <select
            aria-label="Priblíženie scény"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[0.5, 0.75, 1, 1.5, 2].map((n) => (
              <option key={n} value={n}>
                {n * 100}%
              </option>
            ))}
          </select>
        </label>
        <label className="editor-toggle">
          <input
            type="checkbox"
            checked={helpers}
            onChange={(e) => setHelpers(e.target.checked)}
          />{' '}
          Pomôcky scény
        </label>
        <label className="editor-toggle">
          <input
            type="checkbox"
            checked={panning}
            onChange={(event) => {
              setPanning(event.target.checked);
              setDrawing(false);
            }}
          />
          Posun pohľadu
        </label>
        <button
          aria-pressed={drawing}
          onClick={() => {
            setDrawing(!drawing);
            setPanning(false);
            setHelpers(true);
          }}
        >
          {drawing ? 'Zrušiť kreslenie' : 'Nakresliť hotspot'}
        </button>
      </div>
      <div className="stage-transform-tool">
        <label>
          Transformačný nástroj{' '}
          <select
            aria-label="Transformačný nástroj"
            disabled={!selected?.image}
            value={selected?.imageFit ?? 'contain'}
            onChange={(e) =>
              selected &&
              onHotspot({
                ...selected,
                imageFit: e.target.value === 'stretch' ? 'stretch' : undefined,
              })
            }
          >
            <option value="contain">Proporčne · bez deformácie</option>
            <option value="stretch">Deformovať · voľná šírka a výška</option>
          </select>
        </label>
        {selected?.imageFit === 'stretch' && (
          <strong>Deformácia je zapnutá</strong>
        )}
      </div>
      <p className="field-note">
        {drawing
          ? 'Potiahni v scéne a vytvor novú oblasť.'
          : panning
            ? 'Na dotyku potiahni scénu pre posun zväčšeného výrezu. Myšou použi posuvníky alebo koliesko. Vypni Posun pohľadu pre úpravy objektov.'
            : 'Ťahaj viditeľnú časť objektu. Ľavý horný úchyt presúva celý rám, pravý dolný mení veľkosť. Objekt môžeš vybrať aj zo zoznamu. Kruh nad rámom otáča; Shift zarovnáva po 15°. Escape zruší ťah. Pomôcky možno skryť pre čistý náhľad. Zobrazené sú aj podmienene skryté objekty.'}
      </p>
      {maskError ? (
        <p role="alert">Klikateľné pixely sa nepodarilo načítať: {maskError}</p>
      ) : (
        !masks && <p role="status">Načítavam klikateľné oblasti…</p>
      )}
      <div className="editor-stage-viewport">
        <div
          className="editor-stage-surface"
          style={{ width: `${zoom * 100}%` }}
        >
          <svg
            ref={svg}
            className={`editor-stage ${drawing ? 'drawing' : ''} ${panning ? 'panning' : ''}`}
            viewBox={`0 0 ${scene.width} ${scene.height}`}
            style={{
              aspectRatio: `${scene.width} / ${scene.height}`,
              cursor: !drawing && !panning && hoveredId ? 'move' : undefined,
            }}
            data-hovered-id={hoveredId}
            aria-label="Vizuálny editor lokácie"
            onPointerDown={(e) => {
              if (drawing) begin(e, 'draw');
              else if (!panning) {
                const p = point(e);
                const hotspot = p && pick(p);
                if (hotspot) begin(e, 'move', hotspot);
              }
            }}
            onPointerMove={move}
            onPointerLeave={() => setHoveredId('')}
            onPointerUp={(e) => finish(e)}
            onPointerCancel={(e) => finish(e, true)}
            onLostPointerCapture={(e) => finish(e, true)}
          >
            <SceneImage
              asset={scene.background}
              bounds={{ x: 0, y: 0, width: scene.width, height: scene.height }}
              fit="stretch"
            />
            {scene.hotspots.map((hotspot) => {
              const b =
                preview?.id === hotspot.id ? preview.bounds : hotspot.bounds;
              const angle =
                preview?.id === hotspot.id
                  ? preview.rotation
                  : (hotspot.rotation ?? 0);
              const pivot = centre(b);
              return (
                <g
                  key={hotspot.id}
                  data-hotspot-id={hotspot.id}
                  transform={`rotate(${angle} ${pivot.x} ${pivot.y})`}
                >
                  {hotspot.image && (
                    <SceneImage
                      asset={hotspot.image}
                      bounds={b}
                      fit={hotspot.imageFit}
                    />
                  )}
                  <rect
                    {...b}
                    className={
                      selectedId === hotspot.id
                        ? 'editor-region selected'
                        : 'editor-region'
                    }
                    style={
                      helpers
                        ? undefined
                        : { fill: 'transparent', stroke: 'none' }
                    }
                    pointerEvents="none"
                  />
                  {helpers && (
                    <text
                      x={b.x + 8}
                      y={b.y + 24}
                      style={{
                        fontSize: 12 / screenScale,
                        strokeWidth: 3 / screenScale,
                      }}
                      pointerEvents="none"
                    >
                      {hotspot.label}
                    </text>
                  )}
                </g>
              );
            })}
            {helpers && active && !panning && (
              <g
                transform={`rotate(${active.rotation} ${activePivot.x} ${activePivot.y})`}
              >
                <rect
                  x={active.bounds.x - handle / 2}
                  y={active.bounds.y - handle / 2}
                  width={handle}
                  height={handle}
                  className="resize-handle"
                  style={{ cursor: 'move' }}
                  data-move-id={active.id}
                  aria-label="Presunúť vybraný objekt"
                  onPointerDown={(e) => {
                    if (!drawing) begin(e, 'move', active);
                  }}
                />
                <rect
                  x={active.bounds.x + active.bounds.width - handle / 2}
                  y={active.bounds.y + active.bounds.height - handle / 2}
                  width={handle}
                  height={handle}
                  className="resize-handle"
                  data-resize-id={active.id}
                  onPointerDown={(e) => {
                    if (!drawing) begin(e, 'resize', active);
                  }}
                />
                <line
                  x1={activePivot.x}
                  y1={active.bounds.y}
                  x2={activePivot.x}
                  y2={active.bounds.y - 36 / screenScale}
                  className="rotation-stem"
                  pointerEvents="none"
                />
                <circle
                  cx={activePivot.x}
                  cy={active.bounds.y - 36 / screenScale}
                  r={handle / 2}
                  className="rotation-handle"
                  data-rotate-id={active.id}
                  onPointerDown={(e) => {
                    if (!drawing) begin(e, 'rotate', active);
                  }}
                />
              </g>
            )}
            {preview?.mode === 'draw' && (
              <rect
                {...preview.bounds}
                className="editor-region selected"
                pointerEvents="none"
              />
            )}
          </svg>
        </div>
      </div>
    </section>
  );
}
