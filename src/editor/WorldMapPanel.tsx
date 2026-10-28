import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { assetUrl } from '../game/assets';
import type { GameContent, WorldMapPoint } from '../game/types';
import { AssetField, ConditionField, Field, SelectId } from './fields';
import { nextId } from './model';

type WorldMap = NonNullable<GameContent['worldMap']>;
type Position = { x: number; y: number };
type Gesture = {
  pointerId: number;
  map: WorldMap;
  pointId: string;
  sceneId: string;
  offset: Position;
  fromMarker: boolean;
  start: Position;
  moved: boolean;
};

function resizeMap(map: WorldMap, width: number, height: number): WorldMap {
  return {
    ...map,
    width,
    height,
    points: map.points.map((point) => ({
      ...point,
      x: (point.x / map.width) * width,
      y: (point.y / map.height) * height,
    })),
  };
}

export function WorldMapPanel({
  content,
  assets,
  onAssets,
  onChange,
}: {
  content: GameContent;
  assets: readonly string[];
  onAssets: (ids: string[]) => void;
  onChange: (content: GameContent) => void;
}) {
  const map = content.worldMap;
  const [selectedId, setSelectedId] = useState('');
  const [newSceneId, setNewSceneId] = useState('');
  const [preview, setPreview] = useState<
    Position & { map: WorldMap; pointId: string }
  >();
  const [imageStatus, setImageStatus] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const imageRequest = useRef(0);
  const mounted = useRef(false);
  const latest = useRef({ content, onChange });
  useEffect(() => {
    latest.current = { content, onChange };
  }, [content, onChange]);
  useEffect(() => {
    mounted.current = true;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !gesture.current) return;
      event.preventDefault();
      const pointerId = gesture.current.pointerId;
      gesture.current = null;
      setPreview(undefined);
      if (svg.current?.hasPointerCapture(pointerId))
        svg.current.releasePointerCapture(pointerId);
    };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      mounted.current = false;
    };
  }, []);

  const selected = map?.points.find((point) => point.id === selectedId);
  const availableScenes = content.scenes.filter(
    (scene) => !map?.points.some((point) => point.sceneId === scene.id),
  );
  const newScene =
    availableScenes.find((scene) => scene.id === newSceneId) ??
    availableScenes[0];
  const updateMap = (worldMap: WorldMap | undefined) =>
    onChange({ ...content, worldMap });
  const updatePoint = (next: WorldMapPoint) => {
    if (map)
      updateMap({
        ...map,
        points: map.points.map((point) =>
          point.id === next.id ? next : point,
        ),
      });
  };
  const addPoint = (position: Position, destination = newScene?.id) => {
    const scene = content.scenes.find((entry) => entry.id === destination);
    if (
      !map ||
      !scene ||
      map.points.some((point) => point.sceneId === scene.id)
    )
      return;
    const id = nextId(
      'place',
      map.points.map((point) => point.id),
    );
    updateMap({
      ...map,
      points: [
        ...map.points,
        { id, label: scene.title, sceneId: scene.id, ...position },
      ],
    });
    setSelectedId(id);
  };
  function selectImage(id: string) {
    const request = ++imageRequest.current;
    const previous = map;
    const image = new Image();
    setImageStatus('Načítám rozměry obrázku…');
    image.onload = () => {
      if (!mounted.current || request !== imageRequest.current) return;
      const current = latest.current;
      if (current.content.worldMap !== previous) {
        setImageStatus('Mapa se mezitím změnila. Vyber obrázek znovu.');
        return;
      }
      current.onChange({
        ...current.content,
        worldMap: previous
          ? {
              ...resizeMap(previous, image.naturalWidth, image.naturalHeight),
              image: id,
            }
          : {
              image: id,
              width: image.naturalWidth,
              height: image.naturalHeight,
              points: [],
            },
      });
      setImageStatus('Obrázek načtený; body zachovaly poměrnou polohu.');
    };
    image.onerror = () => {
      if (mounted.current && request === imageRequest.current)
        setImageStatus(
          'Obrázek se nepodařilo načíst. Mapa zůstala beze změny.',
        );
    };
    image.src = assetUrl(id);
  }
  const position = (event: { clientX: number; clientY: number }) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix || !map) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: point.x, y: point.y };
  };
  const clamp = (point: Position): Position => ({
    x: Math.max(0, Math.min(map?.width ?? 0, point.x)),
    y: Math.max(0, Math.min(map?.height ?? 0, point.y)),
  });
  function begin(event: PointerEvent<SVGSVGElement>) {
    if (!map || event.button !== 0 || gesture.current) return;
    const point = position(event);
    if (
      !point ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > map.width ||
      point.y > map.height
    )
      return;
    const targetId = (event.target as Element)
      .closest('[data-point-id]')
      ?.getAttribute('data-point-id');
    const pointId = targetId ?? selected?.id ?? '';
    const marker = map.points.find((entry) => entry.id === targetId);
    const offset = marker
      ? { x: point.x - marker.x, y: point.y - marker.y }
      : { x: 0, y: 0 };
    if (!pointId && !newScene) return;
    event.preventDefault();
    setSelectedId(pointId);
    gesture.current = {
      pointerId: event.pointerId,
      map,
      pointId,
      sceneId: newScene?.id ?? '',
      offset,
      fromMarker: Boolean(marker),
      start: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    setPreview({ x: point.x - offset.x, y: point.y - offset.y, map, pointId });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  }
  function finish(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPreview(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const point = position(event);
    if (
      cancelled ||
      !point ||
      map !== current.map ||
      (current.fromMarker && !current.moved)
    )
      return;
    const placed = clamp({
      x: point.x - current.offset.x,
      y: point.y - current.offset.y,
    });
    const target = map.points.find((entry) => entry.id === current.pointId);
    if (target) updatePoint({ ...target, ...placed });
    else addPoint(placed, current.sceneId);
  }

  return (
    <section className="content-panel" aria-label="Editor mapy lokací">
      <h2>Mapa lokací</h2>
      <p className="field-note">
        Obrázek a body sdílejí souřadnice mapy. Popisky pro hráče piš slovensky.
        Odemčená lokace zůstane na mapě i po zániku podmínky.
      </p>
      {!map ? (
        <button
          disabled={!content.scenes[0]?.background}
          onClick={() => selectImage(content.scenes[0]!.background)}
        >
          Vytvořit mapu lokací
        </button>
      ) : (
        <>
          <div className="world-map-settings">
            <AssetField
              label="Obrázek mapy"
              value={map.image}
              assets={assets}
              onAssets={onAssets}
              onChange={selectImage}
            />
            <div>
              <div className="field-row">
                {(['width', 'height'] as const).map((dimension) => (
                  <Field
                    key={dimension}
                    label={dimension === 'width' ? 'Šířka mapy' : 'Výška mapy'}
                  >
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={map[dimension]}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value >= 1)
                          updateMap(
                            resizeMap(
                              map,
                              dimension === 'width' ? value : map.width,
                              dimension === 'height' ? value : map.height,
                            ),
                          );
                      }}
                    />
                  </Field>
                ))}
              </div>
              <p className="field-note">
                Změna rozměrů přepočítá všechny body. Jiný obrázek použije
                vlastní nativní rozměry.
              </p>
              <button
                className="danger-button"
                onClick={() => updateMap(undefined)}
              >
                Odstranit mapu
              </button>
            </div>
          </div>
          <div className="world-map-layout">
            <div>
              <svg
                ref={svg}
                className="world-map-stage"
                aria-label="Náhled mapy lokací"
                role="group"
                tabIndex={0}
                viewBox={`0 0 ${map.width} ${map.height}`}
                style={{ aspectRatio: `${map.width} / ${map.height}` }}
                onPointerDown={begin}
                onPointerMove={(event) => {
                  if (gesture.current?.pointerId !== event.pointerId) return;
                  const point = position(event);
                  const current = gesture.current;
                  if (point && current) {
                    if (
                      Math.hypot(
                        event.clientX - current.start.x,
                        event.clientY - current.start.y,
                      ) >= 3
                    )
                      current.moved = true;
                    setPreview({
                      ...clamp({
                        x: point.x - current.offset.x,
                        y: point.y - current.offset.y,
                      }),
                      map: current.map,
                      pointId: current.pointId,
                    });
                  }
                }}
                onPointerUp={(event) => finish(event)}
                onPointerCancel={(event) => finish(event, true)}
                onLostPointerCapture={() => {
                  gesture.current = null;
                  setPreview(undefined);
                }}
              >
                <image
                  href={assetUrl(map.image)}
                  width={map.width}
                  height={map.height}
                  preserveAspectRatio="none"
                />
                {map.points.map((point) => {
                  const shown =
                    preview &&
                    preview.map === map &&
                    preview.pointId === point.id
                      ? { ...point, ...preview }
                      : point;
                  return (
                    <g
                      key={point.id}
                      data-point-id={point.id}
                      className={
                        selected?.id === point.id
                          ? 'world-map-point selected'
                          : 'world-map-point'
                      }
                      transform={`translate(${shown.x} ${shown.y})`}
                    >
                      <circle r={Math.max(map.width / 55, 8)} />
                      <text
                        x={0}
                        y={-Math.max(map.width / 40, 14)}
                        textAnchor="middle"
                        fontSize={Math.max(map.width / 50, 10)}
                      >
                        {point.label}
                      </text>
                    </g>
                  );
                })}
                {preview && preview.map === map && !preview.pointId && (
                  <circle
                    cx={preview.x}
                    cy={preview.y}
                    r={Math.max(map.width / 55, 8)}
                    className="world-map-new-point"
                  />
                )}
              </svg>
              <p className="field-note">
                Bod vyber kliknutím a přetáhni jej. Kliknutí do mapy přesune
                vybraný bod; bez výběru přidá nový. Escape nebo zrušený dotyk
                tah zahodí.
              </p>
            </div>
            <aside className="editor-card" aria-label="Vlastnosti bodu mapy">
              <SelectId
                label="Bod na úpravu"
                value={selected?.id ?? ''}
                empty="Nový bod"
                values={map.points}
                onChange={setSelectedId}
              />
              {!selected ? (
                <>
                  <SelectId
                    label="Lokace nového bodu"
                    value={newScene?.id ?? ''}
                    values={availableScenes.map((scene) => ({
                      id: scene.id,
                      label: scene.title,
                    }))}
                    empty={
                      availableScenes.length
                        ? undefined
                        : 'Všechny lokace už mají bod'
                    }
                    onChange={setNewSceneId}
                  />
                  <button
                    disabled={!newScene}
                    onClick={() =>
                      addPoint({ x: map.width / 2, y: map.height / 2 })
                    }
                  >
                    + Bod doprostřed mapy
                  </button>
                </>
              ) : (
                <>
                  <p className="field-note">Stálé ID: {selected.id}</p>
                  <Field label="Popisek lokace">
                    <input
                      value={selected.label}
                      onChange={(event) =>
                        updatePoint({ ...selected, label: event.target.value })
                      }
                    />
                  </Field>
                  <SelectId
                    label="Cílová lokace"
                    value={selected.sceneId}
                    values={content.scenes
                      .filter(
                        (scene) =>
                          scene.id === selected.sceneId ||
                          !map.points.some(
                            (point) => point.sceneId === scene.id,
                          ),
                      )
                      .map((scene) => ({ id: scene.id, label: scene.title }))}
                    onChange={(sceneId) =>
                      updatePoint({ ...selected, sceneId })
                    }
                  />
                  <div className="field-row">
                    {(['x', 'y'] as const).map((axis) => (
                      <Field key={axis} label={`Pozice ${axis.toUpperCase()}`}>
                        <input
                          type="number"
                          min={0}
                          max={axis === 'x' ? map.width : map.height}
                          step={1}
                          value={selected[axis]}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value))
                              updatePoint({
                                ...selected,
                                ...clamp({
                                  x: selected.x,
                                  y: selected.y,
                                  [axis]: value,
                                }),
                              });
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                  <Field label="Kdy odemknout lokaci">
                    <select
                      value={
                        !selected.unlockWhen
                          ? 'visit'
                          : 'all' in selected.unlockWhen &&
                              !selected.unlockWhen.all.length
                            ? 'initial'
                            : 'condition'
                      }
                      onChange={(event) =>
                        updatePoint({
                          ...selected,
                          unlockWhen:
                            event.target.value === 'visit'
                              ? undefined
                              : event.target.value === 'initial'
                                ? { all: [] }
                                : content.flags.length
                                  ? { flag: content.flags[0]! }
                                  : { not: { all: [] } },
                        })
                      }
                    >
                      <option value="visit">
                        Po první návštěvě nebo efektem
                      </option>
                      <option value="initial">Na začátku hry</option>
                      <option value="condition">Podle podmínky</option>
                    </select>
                  </Field>
                  {selected.unlockWhen &&
                    !(
                      'all' in selected.unlockWhen &&
                      !selected.unlockWhen.all.length
                    ) && (
                      <ConditionField
                        label="Podmínka odemčení lokace"
                        content={content}
                        value={selected.unlockWhen}
                        onChange={(unlockWhen) =>
                          updatePoint({
                            ...selected,
                            unlockWhen: unlockWhen ?? { all: [] },
                          })
                        }
                      />
                    )}
                  <Field label="Cestování z mapy">
                    <select
                      value={
                        selected.fastTravel === false ? 'transition' : 'travel'
                      }
                      onChange={(event) =>
                        updatePoint({
                          ...selected,
                          fastTravel: event.target.value === 'travel',
                        })
                      }
                    >
                      <option value="travel">Povolit rychlý přesun</option>
                      <option value="transition">
                        Jen přechodem z jiné lokace
                      </option>
                    </select>
                  </Field>
                  <p className="field-note">
                    Efekt „Odemknout lokaci na mapě“ může bod zpřístupnit z akce
                    i dialogu.
                  </p>
                  <button
                    onClick={() => setSelectedId('')}
                    disabled={!availableScenes.length}
                  >
                    Umístit další bod
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      updateMap({
                        ...map,
                        points: map.points.filter(
                          (point) => point.id !== selected.id,
                        ),
                      });
                      setSelectedId('');
                    }}
                  >
                    Odstranit bod
                  </button>
                </>
              )}
            </aside>
          </div>
        </>
      )}
      {imageStatus && (
        <p className="field-note" role="status">
          {imageStatus}
        </p>
      )}
    </section>
  );
}
