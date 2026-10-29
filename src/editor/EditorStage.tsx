import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { assetUrl } from '../game/assets';
import { hitTestHotspot } from '../game/hitTest';
import { useAlphaMasks } from './useAlphaMasks';
import { PolygonHandles } from './PolygonHandles';
import { SceneImage } from './SceneImage';
import {
  polygonBounds,
  polygonIssue,
  rectanglePoints,
  maxPolygonPoints,
} from '../game/polygon';
import {
  withHotspotBounds,
  withPolygon,
  movePolygonVertex,
} from './polygonTools';
import { centre, isInsideScene, rotateAround } from '../game/transforms';
import type { Bounds, Point } from '../game/transforms';
import type { Hotspot, SceneDefinition } from '../game/types';
import { moveBounds, resizeBounds, rotationFromDrag } from './transformTools';

interface Gesture {
  pointerId: number;
  mode: 'move' | 'resize' | 'draw' | 'rotate' | 'vertex';
  polygon?: Hotspot['polygon'];
  vertexIndex?: number;
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
  selection,
  onSelection,
}: {
  scene: SceneDefinition;
  selectedId: string;
  onSelect: (id: string) => void;
  onHotspot: (hotspot: Hotspot) => void;
  onCreate: (bounds: Bounds, polygon?: Hotspot['polygon']) => void;
  selection?: readonly Point[];
  onSelection?: (points: readonly Point[]) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const draftPointer = useRef<number | null>(null);
  const [preview, setPreview] = useState<Gesture | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [polygonDraft, setPolygonDraft] = useState<Point[] | null>(null);
  const [draftCursor, setDraftCursor] = useState<Point | null>(null);
  const [polygonError, setPolygonError] = useState('');
  const [vertex, setVertex] = useState<{ id: string; index: number } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [helpers, setHelpers] = useState(true);
  const [screenScale, setScreenScale] = useState(1);
  const { masks, error: maskError } = useAlphaMasks(scene);
  const [hoveredId, setHoveredId] = useState('');
  const pick = (p: Point) =>
    [...scene.hotspots]
      .reverse()
      .find(
        (hotspot) =>
          !hotspot.hidden &&
          (hotspot.opacity ?? 1) > 0 &&
          !hotspot.locked &&
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
      setSelecting(false);
      setPolygonDraft(null);
      setPolygonError('');
      const pointerId = current?.pointerId ?? draftPointer.current;
      draftPointer.current = null;
      if (pointerId !== null && svg.current?.hasPointerCapture(pointerId))
        svg.current.releasePointerCapture(pointerId);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const point = (event: { clientX: number; clientY: number }): Point | null => {
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
    vertexIndex?: number,
  ) {
    if (event.button !== 0 || gesture.current || hotspot?.locked) return;
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
      polygon: hotspot?.polygon,
      vertexIndex,
      proportional: Boolean(hotspot?.image) && hotspot?.imageFit !== 'stretch',
    };
    setPreview({ ...gesture.current });
  }
  function move(event: PointerEvent<SVGElement>) {
    const current = gesture.current,
      end = point(event);
    if (!current) {
      if (polygonDraft) {
        setDraftCursor(end);
        return;
      }
      setHoveredId(end && !drawing && !panning ? (pick(end)?.id ?? '') : '');
      return;
    }
    if (current.pointerId !== event.pointerId || !end) return;
    const delta = { x: end.x - current.start.x, y: end.y - current.start.y };
    if (current.mode === 'vertex') {
      const original = scene.hotspots.find((h) => h.id === current.id)!;
      const next = movePolygonVertex(original, current.vertexIndex!, {
        x: clamp(end.x, 0, scene.width),
        y: clamp(end.y, 0, scene.height),
      });
      current.bounds = next.bounds;
      current.polygon = next.polygon;
    } else if (current.mode === 'move')
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
        if (selecting && onSelection)
          onSelection(rectanglePoints(current.bounds));
        else onCreate(current.bounds);
        setSelecting(false);
        setDrawing(false);
      } else if (current.mode !== 'draw') {
        const hotspot = scene.hotspots.find((h) => h.id === current.id);
        if (hotspot) {
          const next = {
            ...withHotspotBounds(hotspot, current.bounds),
            ...(current.mode === 'vertex' ? { polygon: current.polygon } : {}),
            rotation: current.rotation || undefined,
          };
          if (
            next.polygon &&
            (polygonIssue(next.polygon) ||
              !isInsideScene(next.bounds, scene, next.rotation))
          )
            setPolygonError(
              'Neplatná úprava se neuložila. Vrcholy musí tvořit jednoduchý polygon bez křížení, s rámem v lokaci.',
            );
          else {
            setPolygonError('');
            onHotspot(next);
          }
        }
      }
    }
    if (svg.current?.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
  }
  const active = selected
    ? {
        ...withHotspotBounds(
          selected,
          preview?.id === selected.id ? preview.bounds : selected.bounds,
        ),
        ...(preview?.id === selected.id && preview.mode === 'vertex'
          ? { polygon: preview.polygon }
          : {}),
        rotation:
          preview?.id === selected.id
            ? preview.rotation
            : (selected.rotation ?? 0),
      }
    : undefined;
  const activePivot = active ? centre(active.bounds) : { x: 0, y: 0 };
  const handle = 28 / screenScale;
  const selectedVertex =
    vertex?.id === selectedId && vertex.index < (selected?.polygon?.length ?? 0)
      ? vertex.index
      : -1;
  function completePolygon() {
    if (!polygonDraft || polygonIssue(polygonDraft)) {
      setPolygonError(
        'Polygon potřebuje 3–128 různých bodů, plochu a hrany bez křížení.',
      );
      return;
    }
    if (selecting && onSelection) onSelection(polygonDraft);
    else onCreate(polygonBounds(polygonDraft), polygonDraft);
    setSelecting(false);
    setPolygonDraft(null);
    setPolygonError('');
  }
  function commitPolygon(next: Hotspot) {
    if (
      !next.polygon ||
      polygonIssue(next.polygon) ||
      !isInsideScene(next.bounds, scene, next.rotation)
    ) {
      setPolygonError(
        'Neplatná úprava se neuložila. Hrany se nesmějí křížit a rám musí zůstat v lokaci.',
      );
      return;
    }
    setPolygonError('');
    onHotspot(next);
  }
  function removeVertex(index: number) {
    if (!selected?.polygon || selected.polygon.length <= 3) return;
    commitPolygon(
      withPolygon(
        selected,
        selected.polygon.filter((_, i) => i !== index),
      ),
    );
    setVertex(null);
  }
  function addVertex(index: number) {
    if (!selected?.polygon || selected.polygon.length >= maxPolygonPoints)
      return;
    const points = [...selected.polygon],
      a = points[index]!,
      b = points[(index + 1) % points.length]!;
    points.splice(index + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    commitPolygon(withPolygon(selected, points));
    setVertex({ id: selected.id, index: index + 1 });
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
        <label>
          Přiblížení scény{' '}
          <select
            aria-label="Přiblížení scény"
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
          Pomůcky scény
        </label>
        <label className="editor-toggle">
          <input
            type="checkbox"
            checked={panning}
            onChange={(event) => {
              setPanning(event.target.checked);
              setDrawing(false);
              setPolygonDraft(null);
            }}
          />
          Posun pohledu
        </label>
        <button
          aria-pressed={drawing && !selecting}
          onClick={() => {
            setSelecting(false);
            setDrawing(!drawing);
            setPolygonDraft(null);
            setPolygonError('');
            setPanning(false);
            setHelpers(true);
          }}
        >
          {drawing && !selecting ? 'Zrušit kreslení' : 'Nakreslit hotspot'}
        </button>
        <button
          aria-pressed={polygonDraft !== null && !selecting}
          onClick={() => {
            setSelecting(false);
            setPolygonDraft(polygonDraft === null ? [] : null);
            setPolygonError('');
            setDrawing(false);
            setPanning(false);
            setHelpers(true);
            svg.current?.focus();
          }}
        >
          {polygonDraft !== null && !selecting
            ? 'Zrušit polygon'
            : 'Nakreslit polygon'}
        </button>
        {onSelection &&
          (['rectangle', 'polygon'] as const).map((tool) => (
            <button
              key={tool}
              aria-pressed={
                selecting &&
                (tool === 'rectangle' ? drawing : polygonDraft !== null)
              }
              onClick={() => {
                const cancel =
                  selecting &&
                  (tool === 'rectangle' ? drawing : polygonDraft !== null);
                setSelecting(!cancel);
                setDrawing(!cancel && tool === 'rectangle');
                setPolygonDraft(!cancel && tool === 'polygon' ? [] : null);
                setPanning(false);
                setPolygonError('');
                svg.current?.focus();
              }}
            >
              {tool === 'rectangle' ? 'Vybrat obdélník' : 'Vybrat polygon'}
            </button>
          ))}
      </div>
      <div className="stage-transform-tool">
        <label>
          Transformační nástroj{' '}
          <select
            aria-label="Transformační nástroj"
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
            <option value="contain">Proporčně · bez deformace</option>
            <option value="stretch">Deformovat · volná šířka a výška</option>
          </select>
        </label>
        {selected?.imageFit === 'stretch' && (
          <strong>Deformace je zapnutá</strong>
        )}
      </div>
      <p className="field-note">
        {polygonDraft !== null
          ? 'Klikej nebo klepej pro přidání bodů. Uzavři kliknutím na první bod, Enterem nebo tlačítkem Dokončit polygon pod scénou. Backspace odebere poslední bod, Escape zruší návrh.'
          : drawing
            ? 'Přetáhni ve scéně a vytvoř novou oblast.'
            : panning
              ? 'Na dotyku přetáhni scénu pro posun zvětšeného výřezu. Myší použij posuvníky nebo kolečko. Vypni Posun pohledu pro úpravy objektů.'
              : 'Táhni viditelnou část objektu. Levý horní úchyt přesouvá celý rám, pravý dolní mění velikost. Objekt můžeš vybrat i ze seznamu. Kruh nad rámem otáčí; Shift zarovnává po 15°. Escape zruší tah. Pomůcky lze skrýt pro čistý náhled. Zobrazené jsou i podmíněně skryté objekty.'}
      </p>
      {maskError ? (
        <p role="alert">Klikatelné pixely se nepodařilo načíst: {maskError}</p>
      ) : (
        !masks && <p role="status">Načítám klikatelné oblasti…</p>
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
            aria-label="Vizuální editor lokace"
            tabIndex={0}
            onKeyDown={(e) => {
              if (polygonDraft === null || e.target !== svg.current) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                completePolygon();
              }
              if (e.key === 'Backspace') {
                e.preventDefault();
                setPolygonDraft(polygonDraft.slice(0, -1));
              }
            }}
            onPointerUp={(e) => {
              if (
                polygonDraft === null ||
                draftPointer.current !== e.pointerId
              ) {
                finish(e);
                return;
              }
              draftPointer.current = null;
              if (svg.current?.hasPointerCapture(e.pointerId))
                svg.current.releasePointerCapture(e.pointerId);
              const p = point(e);
              if (!p) return;
              const next = {
                x: Math.round(clamp(p.x, 0, scene.width) * 1000) / 1000,
                y: Math.round(clamp(p.y, 0, scene.height) * 1000) / 1000,
              };
              if (
                polygonDraft.length >= 3 &&
                Math.hypot(
                  next.x - polygonDraft[0]!.x,
                  next.y - polygonDraft[0]!.y,
                ) <=
                  12 / screenScale
              )
                completePolygon();
              else if (polygonDraft.length < maxPolygonPoints)
                setPolygonDraft([...polygonDraft, next]);
            }}
            onPointerDown={(e) => {
              if (polygonDraft !== null) {
                if (e.button === 0) {
                  e.preventDefault();
                  svg.current?.focus();
                  draftPointer.current = e.pointerId;
                  svg.current?.setPointerCapture(e.pointerId);
                }
                return;
              }
              if (drawing) begin(e, 'draw');
              else if (!panning) {
                const p = point(e);
                const hotspot = p && pick(p);
                if (hotspot) begin(e, 'move', hotspot);
              }
            }}
            onPointerMove={move}
            onPointerLeave={() => setHoveredId('')}
            onPointerCancel={(e) => {
              draftPointer.current = null;
              finish(e, true);
            }}
            onLostPointerCapture={(e) => {
              draftPointer.current = null;
              finish(e, true);
            }}
          >
            {!scene.backgroundHidden && (
              <SceneImage
                asset={scene.background}
                bounds={{
                  x: 0,
                  y: 0,
                  width: scene.width,
                  height: scene.height,
                }}
                fit="stretch"
              />
            )}
            {scene.hotspots.map((hotspot) => {
              const shown = withHotspotBounds(
                hotspot,
                preview?.id === hotspot.id ? preview.bounds : hotspot.bounds,
              );
              const polygon =
                preview?.id === hotspot.id && preview.mode === 'vertex'
                  ? preview.polygon
                  : shown.polygon;
              const b = shown.bounds;
              const angle =
                preview?.id === hotspot.id
                  ? preview.rotation
                  : (hotspot.rotation ?? 0);
              const pivot = centre(b);
              return (
                <g
                  key={hotspot.id}
                  data-hotspot-id={hotspot.id}
                  opacity={
                    hotspot.hidden
                      ? helpers
                        ? 0.18
                        : 0
                      : (hotspot.opacity ?? 1)
                  }
                  transform={`rotate(${angle} ${pivot.x} ${pivot.y})`}
                >
                  {hotspot.image && (
                    <SceneImage
                      asset={hotspot.image}
                      bounds={b}
                      fit={hotspot.imageFit}
                    />
                  )}
                  {hotspot.placeholder === true && !hotspot.image && (
                    <g pointerEvents="none">
                      <rect {...b} fill="#283b43" />
                      <rect
                        x={b.x + 1}
                        y={b.y + 1}
                        width={Math.max(0, b.width - 2)}
                        height={Math.max(0, b.height - 2)}
                        fill="none"
                        stroke="#dfb671"
                        strokeWidth={2}
                      />
                      <text
                        x={b.x + b.width / 2}
                        y={b.y + b.height / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{
                          fontFamily: 'Arial, sans-serif',
                          fontWeight: 'bold',
                          fontSize: Math.max(
                            1,
                            Math.min(
                              24,
                              (b.width - 16) /
                                Math.max(1, hotspot.label.length * 0.65),
                              b.height - 16,
                            ),
                          ),
                          fill: '#f6edda',
                          stroke: 'none',
                        }}
                      >
                        {hotspot.label}
                      </text>
                    </g>
                  )}
                  {polygon ? (
                    <polygon
                      points={polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                      className={
                        selectedId === hotspot.id
                          ? 'editor-region selected'
                          : 'editor-region'
                      }
                      style={
                        helpers
                          ? preview?.id === hotspot.id &&
                            (polygonIssue(polygon) ||
                              !isInsideScene(b, scene, angle))
                            ? { fill: '#f05a6220', stroke: '#f05a62' }
                            : undefined
                          : { fill: 'transparent', stroke: 'none' }
                      }
                      pointerEvents="none"
                    />
                  ) : (
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
                  )}
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
            {helpers &&
              active &&
              !active.locked &&
              !panning &&
              !drawing &&
              polygonDraft === null && (
                <g
                  transform={`rotate(${active.rotation} ${activePivot.x} ${activePivot.y})`}
                >
                  <rect
                    x={
                      active.bounds.x -
                      handle / 2 -
                      (active.polygon ? handle : 0)
                    }
                    y={active.bounds.y - handle / 2}
                    width={handle}
                    height={handle}
                    className="resize-handle"
                    style={{ cursor: 'move' }}
                    data-move-id={active.id}
                    aria-label="Přesunout vybraný objekt"
                    onPointerDown={(e) => {
                      if (!drawing) begin(e, 'move', active);
                    }}
                  />
                  <rect
                    x={
                      active.bounds.x +
                      active.bounds.width -
                      handle / 2 +
                      (active.polygon ? handle : 0)
                    }
                    y={
                      active.bounds.y +
                      active.bounds.height -
                      handle / 2 +
                      (active.polygon ? handle : 0)
                    }
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
                  {active.polygon && (
                    <PolygonHandles
                      points={active.polygon}
                      screenScale={screenScale}
                      rotation={active.rotation}
                      selectedVertex={selectedVertex}
                      onStart={(e, index) => {
                        setVertex({ id: active.id, index });
                        begin(e, 'vertex', active, index);
                      }}
                      onSelect={(index) => setVertex({ id: active.id, index })}
                      onAdd={addVertex}
                      onRemove={removeVertex}
                      onNudge={(index, delta) => {
                        const world = rotateAround(
                          active.polygon![index]!,
                          activePivot,
                          active.rotation,
                        );
                        commitPolygon(
                          movePolygonVertex(active, index, {
                            x: world.x + delta.x,
                            y: world.y + delta.y,
                          }),
                        );
                      }}
                    />
                  )}
                </g>
              )}
            {polygonDraft !== null && (
              <g pointerEvents="none">
                <polyline
                  points={[
                    ...polygonDraft,
                    ...(draftCursor ? [draftCursor] : []),
                  ]
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke="#f1ce83"
                  strokeWidth={2 / screenScale}
                />
                {polygonDraft.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={(i === 0 ? 10 : 5) / screenScale}
                    fill={i === 0 ? '#f1ce83' : '#3e776c'}
                    stroke="#fff0d4"
                    strokeWidth={1 / screenScale}
                  />
                ))}
              </g>
            )}
            {selection && selection.length >= 3 && (
              <polygon
                data-art-selection="true"
                points={selection.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="#58c8c52a"
                stroke="#84ffed"
                strokeWidth={2 / screenScale}
                strokeDasharray={`${6 / screenScale} ${4 / screenScale}`}
                pointerEvents="none"
              />
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
      <div className="stage-toolbar" aria-label="Nástroje polygonu">
        {polygonDraft !== null ? (
          <>
            <span>
              {polygonDraft.length} / {maxPolygonPoints} bodů
            </span>
            <button
              disabled={polygonDraft.length < 3}
              onClick={completePolygon}
            >
              Dokončit polygon
            </button>
            <button
              disabled={!polygonDraft.length}
              onClick={() => setPolygonDraft(polygonDraft.slice(0, -1))}
            >
              Odebrat poslední bod
            </button>
          </>
        ) : (
          <>
            <button
              disabled={!selected}
              onClick={() =>
                selected &&
                onHotspot({
                  ...selected,
                  polygon: selected.polygon
                    ? undefined
                    : rectanglePoints(selected.bounds),
                  hitTest: selected.polygon ? 'bounds' : selected.hitTest,
                })
              }
            >
              {selected?.polygon ? 'Použít obdélník' : 'Převést na polygon'}
            </button>
            <button
              disabled={
                selectedVertex < 0 ||
                !selected?.polygon ||
                selected.polygon.length <= 3
              }
              onClick={() => removeVertex(selectedVertex)}
            >
              Odstranit vybraný vrchol
            </button>
            <span>
              Táhni vrcholy; + přidá bod na hraně. Delete smaže zaměřený vrchol,
              šípky ho posunou (Shift ×10).
            </span>
          </>
        )}
      </div>
      {polygonError && <p role="alert">{polygonError}</p>}
    </section>
  );
}
