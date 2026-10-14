import { useState } from 'react';
import type {
  GameContent,
  Hotspot,
  SceneDefinition,
  Verb,
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
}: {
  scene: SceneDefinition;
  hotspot?: Hotspot;
  content: GameContent;
  assets: readonly string[];
  onAssets: (ids: string[]) => void;
  onScene: (scene: SceneDefinition) => void;
  onHotspot: (hotspot: Hotspot) => void;
  onDelete: () => void;
}) {
  const [verb, setVerb] = useState<Verb>(hotspot?.defaultVerb ?? 'look');
  const [useItem, setUseItem] = useState(content.items[0]?.id ?? '');
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
                <input
                  type="number"
                  min={key === 'x' || key === 'y' ? 0 : 1}
                  value={hotspot.bounds[key]}
                  onChange={(event) =>
                    onHotspot({
                      ...hotspot,
                      bounds: {
                        ...hotspot.bounds,
                        [key]: Number(event.target.value),
                      },
                    })
                  }
                />
              </Field>
            ))}
          </div>
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
          <Field label="Kontextová akcia">
            <select
              value={hotspot.defaultVerb}
              onChange={(event) =>
                onHotspot({
                  ...hotspot,
                  defaultVerb: event.target.value as Verb,
                })
              }
            >
              <option value="look">Preskúmať</option>
              <option value="take">Vziať</option>
              <option value="talk">Hovoriť</option>
              <option value="use">Použiť</option>
            </select>
          </Field>
          <h3>Interakcie</h3>
          <div className="editor-tabs">
            {(['look', 'take', 'talk', 'use'] as const).map((id) => (
              <button
                key={id}
                aria-pressed={verb === id}
                onClick={() => setVerb(id)}
              >
                {id}
              </button>
            ))}
          </div>
          <RulesField
            content={content}
            value={hotspot.actions[verb]}
            onChange={(rules) => {
              const actions = { ...hotspot.actions };
              if (rules.length) actions[verb] = rules;
              else delete actions[verb];
              onHotspot({ ...hotspot, actions });
            }}
          />
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
