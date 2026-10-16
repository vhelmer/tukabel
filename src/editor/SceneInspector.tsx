import { useState } from 'react';
import { AnimationPanel } from './AnimationPanel';
import { useImageSize } from './useImageSize';
import { imagePlacement } from '../game/transforms';
import { rectanglePoints } from '../game/polygon';
import { withHotspotBounds } from './polygonTools';
import { editDimension } from './transformTools';
import type {
  AnimationDefinition,
  GameContent,
  Hotspot,
  SceneDefinition,
} from '../game/types';
import {
  AssetField,
  ConditionField,
  Field,
  RulesField,
  SelectId,
} from './fields';

export function SceneInspector({
  scene,
  hotspot,
  content,
  assets,
  onAssets,
  onScene,
  onHotspot,
  onDelete,
  onAnimationCommit,
}: {
  scene: SceneDefinition;
  hotspot?: Hotspot;
  content: GameContent;
  assets: readonly string[];
  onAssets: (ids: string[]) => void;
  onScene: (scene: SceneDefinition) => void;
  onHotspot: (hotspot: Hotspot) => void;
  onDelete: () => void;
  onAnimationCommit: (
    animations: readonly AnimationDefinition[],
    hotspot: Hotspot,
  ) => void;
}) {
  const [useItem, setUseItem] = useState(content.items[0]?.id ?? '');
  const imageSize = useImageSize(hotspot?.image);
  return (
    <div className="scene-inspector">
      <details open>
        <summary>Lokácia · {scene.id}</summary>
        <Field label="Názov lokácie">
          <input
            value={scene.title}
            onChange={(event) =>
              onScene({ ...scene, title: event.target.value })
            }
          />
        </Field>
        <div className="field-row">
          {(['width', 'height'] as const).map((key) => (
            <Field
              key={key}
              label={key === 'width' ? 'Šírka lokácie' : 'Výška lokácie'}
            >
              <input
                type="number"
                min={1}
                value={scene[key]}
                onChange={(event) =>
                  onScene({ ...scene, [key]: Number(event.target.value) })
                }
              />
            </Field>
          ))}
        </div>
        <AssetField
          label="Pozadie lokácie"
          value={scene.background}
          assets={assets}
          onAssets={onAssets}
          onChange={(background) => onScene({ ...scene, background })}
        />
      </details>
      {hotspot ? (
        <>
          <h2>Objekt · {hotspot.id}</h2>
          <Field label="Názov objektu">
            <input
              value={hotspot.label}
              onChange={(event) =>
                onHotspot({ ...hotspot, label: event.target.value })
              }
            />
          </Field>
          <div className="bounds-fields">
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <Field key={key} label={`Oblasť ${key}`}>
                <TransformNumber
                  min={key === 'x' || key === 'y' ? 0 : 1}
                  value={hotspot.bounds[key]}
                  onChange={(value) =>
                    onHotspot(
                      withHotspotBounds(
                        hotspot,
                        editDimension(
                          hotspot.bounds,
                          key,
                          value,
                          Boolean(hotspot.image) &&
                            hotspot.imageFit !== 'stretch',
                        ),
                      ),
                    )
                  }
                />
              </Field>
            ))}
          </div>
          <Field label="Otočenie objektu (°)">
            <TransformNumber
              min={-360}
              max={360}
              step={1}
              value={hotspot.rotation ?? 0}
              onChange={(value) =>
                onHotspot({
                  ...hotspot,
                  rotation: value || undefined,
                })
              }
            />
          </Field>
          {hotspot.image && (
            <>
              <Field label="Spôsob zmeny veľkosti">
                <select
                  value={hotspot.imageFit ?? 'contain'}
                  onChange={(event) =>
                    onHotspot({
                      ...hotspot,
                      imageFit:
                        event.target.value === 'stretch'
                          ? 'stretch'
                          : undefined,
                    })
                  }
                >
                  <option value="contain">Proporčne · bez deformácie</option>
                  <option value="stretch">
                    Deformovať · voľná šírka a výška
                  </option>
                </select>
              </Field>
              <p className="field-note">
                {hotspot.imageFit === 'stretch'
                  ? 'Deformácia je zapnutá: šírka a výška sa menia nezávisle.'
                  : 'Šírka a výška sa menia spolu. Obrázok vždy zachová pôvodné proporcie vo svojom ráme.'}
              </p>
              <button
                disabled={!imageSize}
                onClick={() =>
                  imageSize &&
                  onHotspot({
                    ...withHotspotBounds(
                      hotspot,
                      imagePlacement(hotspot.bounds, imageSize),
                    ),
                    imageFit: undefined,
                  })
                }
              >
                Rám podľa obrázka
              </button>
            </>
          )}
          <AssetField
            label="Obrázok objektu"
            value={hotspot.image ?? ''}
            optional
            assets={assets}
            onAssets={onAssets}
            onChange={(image) =>
              onHotspot({ ...hotspot, image: image || undefined })
            }
          />
          <label>
            Klikateľná oblasť
            <select
              aria-label="Klikateľná oblasť"
              value={hotspot.polygon ? 'polygon' : (hotspot.hitTest ?? 'alpha')}
              onChange={(event) =>
                onHotspot({
                  ...hotspot,
                  hitTest:
                    event.target.value === 'bounds' ? 'bounds' : undefined,
                  polygon:
                    event.target.value === 'polygon'
                      ? rectanglePoints(hotspot.bounds)
                      : undefined,
                })
              }
            >
              <option value="alpha">
                Automaticky · viditeľné pixely obrázka
              </option>
              <option value="polygon">
                Ručný polygón · úprava vrcholov v scéne
              </option>
              <option value="bounds">Ručný obdĺžnik · celý rám hotspotu</option>
            </select>
          </label>
          {hotspot.image &&
            !hotspot.polygon &&
            hotspot.hitTest !== 'bounds' && (
              <label>
                Prah nepriehľadnosti (1–255)
                <input
                  type="number"
                  min={1}
                  max={255}
                  step={1}
                  value={hotspot.alphaThreshold ?? 32}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value) && value >= 1 && value <= 255)
                      onHotspot({ ...hotspot, alphaThreshold: value });
                  }}
                />
              </label>
            )}
          <p className="field-note">
            Ručný polygón má prednosť pred priehľadnosťou obrázka. Bez obrázka a
            polygónu je klikateľný celý rám. Automatický režim prepúšťa
            priehľadné pixely na objekty pod nimi; predvolený prah je 32/255.
            Ručný obdĺžnik má prednosť pred priehľadnosťou.
          </p>
          {hotspot.image && (
            <AnimationPanel
              key={hotspot.image}
              hotspot={hotspot}
              content={content}
              assets={assets}
              onAssets={onAssets}
              onHotspot={onHotspot}
              onCommit={onAnimationCommit}
            />
          )}
          <ConditionField
            label="Viditeľnosť objektu"
            content={content}
            value={hotspot.visibleWhen}
            onChange={(visibleWhen) => onHotspot({ ...hotspot, visibleWhen })}
          />
          <label className="editor-toggle">
            <input
              type="checkbox"
              checked={Boolean(hotspot.tintWhen)}
              onChange={(event) =>
                onHotspot({
                  ...hotspot,
                  tintWhen: event.target.checked ? { all: [] } : undefined,
                })
              }
            />{' '}
            Zelený stavový indikátor
          </label>
          {hotspot.tintWhen && (
            <ConditionField
              label="Zelený indikátor"
              content={content}
              value={hotspot.tintWhen}
              onChange={(tintWhen) =>
                onHotspot({ ...hotspot, tintWhen: tintWhen ?? { all: [] } })
              }
            />
          )}
          <h3>Kliknutie na objekt</h3>
          <p className="field-note">
            Prvá splnená reakcia sa vykoná automaticky. Prázdny zoznam znamená
            tichú kulisu; komentár nie je povinný.
          </p>
          <RulesField
            content={content}
            value={hotspot.onClick}
            onChange={(onClick) => onHotspot({ ...hotspot, onClick })}
          />
          <h3>Kurzor nad objektom</h3>
          <Field label="Typ kurzora">
            <select
              value={hotspot.cursor ?? 'auto'}
              onChange={(event) =>
                onHotspot({
                  ...hotspot,
                  cursor: event.target.value as Hotspot['cursor'],
                })
              }
            >
              <option value="auto">Automaticky podľa kliknutia</option>
              <option value="interact">Ruka · interakcia</option>
              <option value="talk">Rozprávajúca pusa</option>
              <option value="exit">Odchod</option>
            </select>
          </Field>
          <AssetField
            label="Vlastný obrázok kurzora"
            value={hotspot.cursorImage ?? ''}
            optional
            assets={assets}
            onAssets={onAssets}
            onChange={(cursorImage) =>
              onHotspot({
                ...hotspot,
                cursorImage: cursorImage || undefined,
                cursorAnimation: undefined,
              })
            }
          />
          <SelectId
            label="Animácia kurzora"
            value={hotspot.cursorAnimation ?? ''}
            values={(content.animations ?? []).filter(
              (c) => !hotspot.cursorImage || c.source === hotspot.cursorImage,
            )}
            empty="Bez animácie"
            onChange={(id) =>
              onHotspot({ ...hotspot, cursorAnimation: id || undefined })
            }
          />
          <Field label="Veľkosť kurzora (px)">
            <TransformNumber
              min={16}
              max={96}
              value={hotspot.cursorSize ?? 40}
              onChange={(cursorSize) => onHotspot({ ...hotspot, cursorSize })}
            />
          </Field>
          <div className="field-row">
            {([0, 1] as const).map((i) => (
              <Field key={i} label={`Špička kurzora ${i === 0 ? 'x' : 'y'}`}>
                <TransformNumber
                  min={0}
                  max={96}
                  value={hotspot.cursorOffset?.[i] ?? 0}
                  onChange={(value) => {
                    const offset: [number, number] = [
                      ...(hotspot.cursorOffset ?? [0, 0]),
                    ];
                    offset[i] = value;
                    onHotspot({ ...hotspot, cursorOffset: offset });
                  }}
                />
              </Field>
            ))}
          </div>
          <h3>Použitie inventára na objekt</h3>
          <SelectId
            label="Použitý predmet"
            value={useItem}
            values={content.items}
            onChange={setUseItem}
          />
          {useItem && (
            <RulesField
              content={content}
              value={hotspot.uses?.[useItem]}
              onChange={(rules) => {
                const uses = { ...hotspot.uses };
                if (rules.length) uses[useItem] = rules;
                else delete uses[useItem];
                onHotspot({ ...hotspot, uses });
              }}
            />
          )}
          <button className="danger-button" onClick={onDelete}>
            Odstrániť objekt
          </button>
        </>
      ) : (
        <p className="field-note">
          Vyber oblasť v scéne alebo nakresli nový hotspot.
        </p>
      )}
    </div>
  );
}

function TransformNumber({
  value,
  onChange,
  min,
  max,
  step = 1,
  id,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max?: number;
  step?: number;
  id?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? value}
      onFocus={() => setDraft(String(value))}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = event.target.valueAsNumber;
        if (
          Number.isFinite(next) &&
          next >= min &&
          (max === undefined || next <= max)
        )
          onChange(next);
      }}
    />
  );
}
