import { useState } from 'react';
import { useImageSize } from './useImageSize';
import { imagePlacement } from '../game/transforms';
import { rectanglePoints } from '../game/polygon';
import { withHotspotBounds } from './polygonTools';
import { editDimension } from './transformTools';
import type { GameContent, Hotspot, SceneDefinition } from '../game/types';
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
  onOpenAnimations,
}: {
  scene: SceneDefinition;
  hotspot?: Hotspot;
  content: GameContent;
  assets: readonly string[];
  onAssets: (ids: string[]) => void;
  onScene: (scene: SceneDefinition) => void;
  onHotspot: (hotspot: Hotspot) => void;
  onDelete: () => void;
  onOpenAnimations: () => void;
}) {
  const [useItem, setUseItem] = useState(content.items[0]?.id ?? '');
  const imageSize = useImageSize(hotspot?.image);
  return (
    <div className="scene-inspector">
      <details open>
        <summary>Lokace · {scene.id}</summary>
        <Field label="Název lokace">
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
              label={key === 'width' ? 'Šířka lokace' : 'Výška lokace'}
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
          label="Pozadí lokace"
          value={scene.background}
          assets={assets}
          onAssets={onAssets}
          onChange={(background) => onScene({ ...scene, background })}
        />
      </details>
      {hotspot ? (
        <>
          <h2>Objekt · {hotspot.id}</h2>
          <Field label="Název objektu">
            <input
              value={hotspot.label}
              onChange={(event) =>
                onHotspot({ ...hotspot, label: event.target.value })
              }
            />
          </Field>
          <div className="bounds-fields">
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <Field key={key} label={`Oblast ${key}`}>
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
          <Field label="Otočení objektu (°)">
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
              <Field label="Způsob změny velikosti">
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
                  <option value="contain">Proporčně · bez deformace</option>
                  <option value="stretch">
                    Deformovat · volná šířka a výška
                  </option>
                </select>
              </Field>
              <p className="field-note">
                {hotspot.imageFit === 'stretch'
                  ? 'Deformace je zapnutá: šířka a výška se mění nezávisle.'
                  : 'Šířka a výška se mění společně. Obrázek vždy zachová původní proporce v svém rámu.'}
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
                Rám podle obrázku
              </button>
            </>
          )}
          <AssetField
            label="Obrázek objektu"
            value={hotspot.image ?? ''}
            optional
            assets={assets}
            onAssets={onAssets}
            onChange={(image) =>
              onHotspot({ ...hotspot, image: image || undefined })
            }
          />
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={hotspot.placeholder ?? false}
              onChange={(event) =>
                onHotspot({
                  ...hotspot,
                  placeholder: event.target.checked || undefined,
                })
              }
            />
            Zástupná grafika
          </label>
          <p className="muted">
            Bez obrázku zobrazí obdélník s názvem objektu. Přiřazený obrázek jej
            nahradí.
          </p>
          <label>
            Klikatelná oblast
            <select
              aria-label="Klikatelná oblast"
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
                Automaticky · viditelné pixely obrázku
              </option>
              <option value="polygon">
                Ruční polygon · úprava vrcholů ve scéně
              </option>
              <option value="bounds">Ruční obdélník · celý rám hotspotu</option>
            </select>
          </label>
          {hotspot.image &&
            !hotspot.polygon &&
            hotspot.hitTest !== 'bounds' && (
              <label>
                Práh neprůhlednosti (1–255)
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
            Ruční polygon má přednost před průhledností obrázku. Bez obrázku a
            polygonu je klikatelný celý rám. Automatický režim propouští
            průhledné pixely na objekty pod nimi; výchozí práh je 32/255. Ruční
            obdélník má přednost před průhledností.
          </p>
          {hotspot.image && (
            <button className="primary-button" onClick={onOpenAnimations}>
              Otevřít animační studio
            </button>
          )}
          <ConditionField
            label="Viditelnost objektu"
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
          <label className="editor-toggle">
            <input
              type="checkbox"
              checked={Boolean(hotspot.openMap)}
              onChange={(event) =>
                onHotspot({
                  ...hotspot,
                  openMap: event.target.checked || undefined,
                })
              }
            />{' '}
            Otevřít mapu lokací
          </label>
          <p className="field-note">
            Kliknutí na tento hotspot otevře mapu lokací. Vstup nakresli
            nástrojem Nakreslit polygon a podle potřeby nastav kurzor Odchod.
            Při zapnutí se místo pravidel kliknutí otevře mapa; pravidla se
            zachovají pro případ vypnutí. Mapu nejprve vytvoř v záložce Mapa
            lokací.
          </p>
          <h3>Kliknutí na objekt</h3>
          <p className="field-note">
            První splněná reakce se vykoná automaticky. Prázdný seznam znamená
            tichou kulisu; komentář není povinný.
          </p>
          <RulesField
            content={content}
            value={hotspot.onClick}
            onChange={(onClick) => onHotspot({ ...hotspot, onClick })}
          />
          <h3>Kurzor nad objektem</h3>
          <Field label="Typ kurzoru">
            <select
              value={hotspot.cursor ?? 'auto'}
              onChange={(event) =>
                onHotspot({
                  ...hotspot,
                  cursor: event.target.value as Hotspot['cursor'],
                })
              }
            >
              <option value="auto">Automaticky podle kliknutí</option>
              <option value="interact">Ruka · interakce</option>
              <option value="talk">Mluvící pusa</option>
              <option value="exit">Odchod</option>
            </select>
          </Field>
          <AssetField
            label="Vlastní obrázek kurzoru"
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
            label="Animace kurzoru"
            value={hotspot.cursorAnimation ?? ''}
            values={(content.animations ?? []).filter(
              (c) => !hotspot.cursorImage || c.source === hotspot.cursorImage,
            )}
            empty="Bez animace"
            onChange={(id) =>
              onHotspot({ ...hotspot, cursorAnimation: id || undefined })
            }
          />
          <Field label="Velikost kurzoru (px)">
            <TransformNumber
              min={16}
              max={96}
              value={hotspot.cursorSize ?? 40}
              onChange={(cursorSize) => onHotspot({ ...hotspot, cursorSize })}
            />
          </Field>
          <div className="field-row">
            {([0, 1] as const).map((i) => (
              <Field key={i} label={`Špička kurzoru ${i === 0 ? 'x' : 'y'}`}>
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
          <h3>Použití inventáře na objekt</h3>
          <SelectId
            label="Použitý předmět"
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
            Odstranit objekt
          </button>
        </>
      ) : (
        <p className="field-note">
          Vyber oblast ve scéně nebo nakresli nový hotspot.
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
