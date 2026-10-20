import type { Hotspot, SceneDefinition } from '../game/types';
import { AssetField } from './fields';
import { nextId } from './model';

export function LayerPanel({
  scene,
  selectedId,
  assets,
  onAssets,
  onSelect,
  onChange,
}: {
  scene: SceneDefinition;
  selectedId: string;
  assets: readonly string[];
  onAssets: (ids: string[]) => void;
  onSelect: (id: string) => void;
  onChange: (scene: SceneDefinition) => void;
}) {
  const selected = scene.hotspots.find((h) => h.id === selectedId);
  const update = (next: Hotspot) =>
    onChange({
      ...scene,
      hotspots: scene.hotspots.map((h) => (h.id === next.id ? next : h)),
    });
  function reorder(id: string, direction: number) {
    const index = scene.hotspots.findIndex((h) => h.id === id),
      next = index + direction;
    if (next < 0 || next >= scene.hotspots.length) return;
    const hotspots = [...scene.hotspots];
    [hotspots[index], hotspots[next]] = [hotspots[next]!, hotspots[index]!];
    onChange({ ...scene, hotspots });
  }
  return (
    <section className="layer-panel" aria-label="Vrstvy scény">
      <h2>Vrstvy</h2>
      <p className="field-note">
        Vrchná položka je vpredu. Zámok chráni iba úpravy, oko platí aj v hre.
      </p>
      <button
        onClick={() => {
          const id = nextId(
            'layer',
            scene.hotspots.map((h) => h.id),
          );
          onChange({
            ...scene,
            hotspots: [
              ...scene.hotspots,
              {
                id,
                label: 'Nová vrstva',
                image: selected?.image ?? scene.background,
                decorative: true,
                onClick: [],
                bounds: {
                  x: 0,
                  y: 0,
                  width: scene.width,
                  height: scene.height,
                },
              },
            ],
          });
          onSelect(id);
        }}
      >
        + Obrázková vrstva
      </button>
      <div className="layer-stack">
        {[...scene.hotspots].reverse().map((h) => (
          <div
            className={`layer-row ${selectedId === h.id ? 'selected' : ''}`}
            key={h.id}
            data-layer-id={h.id}
          >
            <button
              className="layer-name"
              aria-pressed={selectedId === h.id}
              onClick={() => onSelect(h.id)}
            >
              {h.decorative ? '▧' : h.animation ? '◉' : '◇'} {h.label}
            </button>
            <label title="Viditeľnosť">
              <input
                aria-label={`Viditeľnosť · ${h.label}`}
                type="checkbox"
                checked={!h.hidden}
                onChange={(e) =>
                  update({ ...h, hidden: !e.target.checked || undefined })
                }
              />
              oko
            </label>
            <label title="Zamknutie">
              <input
                aria-label={`Zamknutie · ${h.label}`}
                type="checkbox"
                checked={h.locked ?? false}
                onChange={(e) =>
                  update({ ...h, locked: e.target.checked || undefined })
                }
              />
              zámok
            </label>
            <button
              aria-label={`Dopredu · ${h.label}`}
              disabled={scene.hotspots.at(-1)?.id === h.id}
              onClick={() => reorder(h.id, 1)}
            >
              ↑
            </button>
            <button
              aria-label={`Dozadu · ${h.label}`}
              disabled={scene.hotspots[0]?.id === h.id}
              onClick={() => reorder(h.id, -1)}
            >
              ↓
            </button>
          </div>
        ))}
        <div className={`layer-row ${!selected ? 'selected' : ''}`}>
          <button
            className="layer-name"
            aria-pressed={!selected}
            onClick={() => onSelect('')}
          >
            ▣ Pozadie
          </button>
          <label>
            <input
              type="checkbox"
              aria-label="Viditeľnosť · Pozadie"
              checked={!scene.backgroundHidden}
              onChange={(e) =>
                onChange({
                  ...scene,
                  backgroundHidden: !e.target.checked || undefined,
                })
              }
            />
            oko
          </label>
        </div>
      </div>
      {selected && (
        <fieldset disabled={selected.locked}>
          <legend>{selected.label}</legend>
          <label className="editor-field">
            Krytie vrstvy (%)
            <input
              aria-label="Krytie vrstvy (%)"
              type="range"
              min="0"
              max="100"
              value={Math.round((selected.opacity ?? 1) * 100)}
              onChange={(e) =>
                update({ ...selected, opacity: Number(e.target.value) / 100 })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={!selected.decorative}
              disabled={!selected.image}
              onChange={(e) =>
                update({
                  ...selected,
                  decorative: e.target.checked ? undefined : true,
                })
              }
            />{' '}
            Interaktívny objekt
          </label>
          <AssetField
            label="Obrázok vrstvy"
            value={selected.image ?? ''}
            assets={assets}
            onAssets={onAssets}
            onChange={(image) =>
              update({
                ...selected,
                image: image || undefined,
                animation: undefined,
                decorative: image ? selected.decorative : undefined,
              })
            }
          />
          <button
            className="danger-button"
            onClick={() => {
              onChange({
                ...scene,
                hotspots: scene.hotspots.filter((h) => h.id !== selected.id),
              });
              onSelect('');
            }}
          >
            Odstrániť vybranú vrstvu
          </button>
        </fieldset>
      )}
    </section>
  );
}
