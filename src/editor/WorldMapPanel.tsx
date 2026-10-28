import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../game/assets';
import { polygonBounds, rectanglePoints } from '../game/polygon';
import { centre, isInsideScene, rotateAround } from '../game/transforms';
import type { Bounds } from '../game/transforms';
import type {
  GameContent,
  Hotspot,
  SceneDefinition,
  WorldMapPoint,
} from '../game/types';
import { worldMapPolygon } from '../game/worldMap';
import { EditorStage } from './EditorStage';
import { AssetField, ConditionField, Field, SelectId } from './fields';
import { nextId } from './model';
import { withHotspotBounds } from './polygonTools';

type WorldMap = NonNullable<GameContent['worldMap']>;

function resizeMap(map: WorldMap, width: number, height: number): WorldMap {
  return {
    ...map,
    width,
    height,
    points: map.points.map((point) => ({
      ...point,
      x: (point.x / map.width) * width,
      y: (point.y / map.height) * height,
      polygon: point.polygon?.map((p) => ({
        x: (p.x / map.width) * width,
        y: (p.y / map.height) * height,
      })),
    })),
  };
}

function mapHotspot(point: WorldMapPoint, map: WorldMap): Hotspot {
  const polygon = worldMapPolygon(point, map);
  return {
    id: point.id,
    label: point.label,
    polygon,
    bounds: polygonBounds(polygon),
    onClick: [],
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
  const [imageStatus, setImageStatus] = useState('');
  const imageRequest = useRef(0);
  const mounted = useRef(false);
  const latest = useRef({ content, onChange });
  useEffect(() => {
    latest.current = { content, onChange };
  }, [content, onChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const selected = map?.points.find((point) => point.id === selectedId);
  const mapScene: SceneDefinition | undefined = map && {
    id: 'world-map',
    title: 'Mapa lokací',
    background: map.image,
    width: map.width,
    height: map.height,
    hotspots: map.points.map((point) => mapHotspot(point, map)),
  };
  const selectedRegion = mapScene?.hotspots.find(
    (hotspot) => hotspot.id === selectedId,
  );
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
  const updateRegion = (hotspot: Hotspot) => {
    const point = map?.points.find((entry) => entry.id === hotspot.id);
    if (!point) return;
    // A map region stores world vertices; bake the shared stage's rotation in.
    const polygon = (hotspot.polygon ?? rectanglePoints(hotspot.bounds)).map(
      (p) => rotateAround(p, centre(hotspot.bounds), hotspot.rotation ?? 0),
    );
    updatePoint({ ...point, polygon, ...centre(polygonBounds(polygon)) });
  };
  const addRegion = (bounds: Bounds, outline?: Hotspot['polygon']) => {
    if (!map || !newScene) return;
    const id = nextId(
      'place',
      map.points.map((point) => point.id),
    );
    const polygon = outline ?? rectanglePoints(bounds);
    updateMap({
      ...map,
      points: [
        ...map.points,
        {
          id,
          label: newScene.title,
          sceneId: newScene.id,
          polygon,
          ...centre(polygonBounds(polygon)),
        },
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
      setImageStatus('Obrázek načtený; oblasti zachovaly poměrné souřadnice.');
    };
    image.onerror = () => {
      if (mounted.current && request === imageRequest.current)
        setImageStatus(
          'Obrázek se nepodařilo načíst. Mapa zůstala beze změny.',
        );
    };
    image.src = assetUrl(id);
  }
  return (
    <section className="content-panel" aria-label="Editor mapy lokací">
      <h2>Mapa lokací</h2>
      <p className="field-note">
        Obrázek a polygonové oblasti sdílejí souřadnice mapy. Popisky pro hráče
        piš slovensky. Odemčená lokace zůstane na mapě i po zániku podmínky.
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
                Změna rozměrů přepočítá všechny vrcholy oblastí. Jiný obrázek
                použije vlastní nativní rozměry.
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
              <EditorStage
                scene={mapScene!}
                selectedId={selected?.id ?? ''}
                onSelect={setSelectedId}
                onHotspot={updateRegion}
                onCreate={addRegion}
              />
              <p className="field-note">
                Oblasti kresli stejným polygonovým nástrojem jako hotspoty v
                lokaci. Vrcholy, přesun, velikost i natočení se ukládají jedním
                krokem; Escape nebo zrušený dotyk zahodí celý tah.
              </p>
            </div>
            <aside className="editor-card" aria-label="Vlastnosti oblasti mapy">
              <SelectId
                label="Oblast na úpravu"
                value={selected?.id ?? ''}
                empty="Nová oblast"
                values={map.points}
                onChange={setSelectedId}
              />
              {!selected ? (
                <>
                  <SelectId
                    label="Lokace nové oblasti"
                    value={newScene?.id ?? ''}
                    values={availableScenes.map((scene) => ({
                      id: scene.id,
                      label: scene.title,
                    }))}
                    empty={
                      availableScenes.length
                        ? undefined
                        : 'Všechny lokace už mají oblast'
                    }
                    onChange={setNewSceneId}
                  />
                  <button
                    disabled={!newScene}
                    onClick={() =>
                      addRegion({
                        x: map.width * 0.4,
                        y: map.height * 0.4,
                        width: map.width * 0.2,
                        height: map.height * 0.2,
                      })
                    }
                  >
                    + Oblast doprostřed mapy
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
                  <div className="bounds-fields">
                    {(['x', 'y', 'width', 'height'] as const).map((key) => (
                      <Field key={key} label={`Oblast ${key}`}>
                        <input
                          type="number"
                          min={key === 'x' || key === 'y' ? 0 : 1}
                          step={1}
                          value={selectedRegion!.bounds[key]}
                          onChange={(event) => {
                            const value = event.target.valueAsNumber;
                            if (!Number.isFinite(value)) return;
                            const next = withHotspotBounds(selectedRegion!, {
                              ...selectedRegion!.bounds,
                              [key]: value,
                            });
                            if (
                              value >= (key === 'x' || key === 'y' ? 0 : 1) &&
                              isInsideScene(next.bounds, map)
                            )
                              updateRegion(next);
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
                    Efekt „Odemknout lokaci na mapě“ může oblast zpřístupnit z
                    akce i dialogu.
                  </p>
                  <button
                    onClick={() => setSelectedId('')}
                    disabled={!availableScenes.length}
                  >
                    Přidat další oblast
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
                    Odstranit oblast
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
