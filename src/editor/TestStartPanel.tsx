import { useMemo, useState } from 'react';
import type { GameContent, GameState } from '../game/types';
import { Field, SelectId } from './fields';
import { endingFlags, setupFromState } from './testStart';
import type { TestSetup } from './testStart';

function CheckList({
  label,
  entries,
  selected,
  onChange,
}: {
  label: string;
  entries: readonly { id: string; label?: string; note?: string }[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="test-start-grid" role="group" aria-label={label}>
      {entries.map((entry) => (
        <label key={entry.id}>
          <input
            type="checkbox"
            checked={selected.includes(entry.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, entry.id]
                  : selected.filter((id) => id !== entry.id),
              )
            }
          />
          <span>
            {entry.label ?? entry.id}
            {entry.label && <code>{entry.id}</code>}
            {entry.note && <em>{entry.note}</em>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function TestStartPanel({
  content,
  setup,
  onChange,
  testState,
  onStart,
  disabled,
}: {
  content: GameContent;
  setup: TestSetup;
  onChange: (setup: TestSetup) => void;
  testState?: GameState;
  onStart: () => void;
  disabled: boolean;
}) {
  const [filter, setFilter] = useState('');
  const endings = useMemo(() => endingFlags(content), [content]);
  const query = filter.trim().toLowerCase();
  const shownFlags = content.flags.filter((flag) =>
    flag.toLowerCase().includes(query),
  );
  const set = (patch: Partial<TestSetup>) => onChange({ ...setup, ...patch });
  return (
    <section className="content-panel" aria-label="Testovací start">
      <h2>Testovací start</h2>
      <p className="field-note">
        Spustí Game Mode rovnou ve vybrané lokaci s vybranými předměty, příznaky
        a odemčenými lokacemi, bez procházení hry od začátku. Výběr se neukládá
        do projektu ani do herní pozice.
      </p>
      <div className="field-row">
        <SelectId
          label="Lokace"
          value={setup.sceneId}
          values={content.scenes.map((scene) => ({
            id: scene.id,
            label: scene.title,
          }))}
          onChange={(sceneId) => set({ sceneId })}
        />
        <button
          disabled={!testState}
          onClick={() => testState && onChange(setupFromState(testState))}
        >
          Převzít stav z hry
        </button>
        <button
          className="primary-button"
          disabled={disabled}
          onClick={onStart}
        >
          Spustit test ↗
        </button>
      </div>

      <h3>
        Předměty v inventáři ({setup.inventory.length}/{content.items.length})
      </h3>
      <div className="row-actions">
        <button
          onClick={() =>
            set({ inventory: content.items.map((item) => item.id) })
          }
        >
          Všechny
        </button>
        <button onClick={() => set({ inventory: [] })}>Žádné</button>
      </div>
      <CheckList
        label="Předměty"
        entries={content.items}
        selected={setup.inventory}
        onChange={(inventory) => set({ inventory })}
      />

      <h3>
        Stav příběhu – příznaky ({setup.flags.length}/{content.flags.length})
      </h3>
      <p className="field-note">
        Příznaky zapni podle toho, co už má být v příběhu hotové (např. otevřená
        krypta). Hromadný výběr vynechává příznaky, které spouští konec hry.
      </p>
      <div className="field-row">
        <Field label="Filtrovat příznaky">
          <input
            value={filter}
            placeholder="např. crypt, known, taken"
            onChange={(event) => setFilter(event.target.value)}
          />
        </Field>
        <button
          onClick={() =>
            set({
              flags: [
                ...new Set([
                  ...setup.flags,
                  ...shownFlags.filter((flag) => !endings.has(flag)),
                ]),
              ],
            })
          }
        >
          Zapnout zobrazené
        </button>
        <button
          onClick={() =>
            set({
              flags: setup.flags.filter((flag) => !shownFlags.includes(flag)),
            })
          }
        >
          Vypnout zobrazené
        </button>
      </div>
      <CheckList
        label="Příznaky"
        entries={shownFlags.map((flag) => ({
          id: flag,
          note: endings.has(flag) ? 'konec hry' : undefined,
        }))}
        selected={setup.flags}
        onChange={(flags) => set({ flags })}
      />

      <h3>
        Odemčené lokace na mapě ({setup.unlockedScenes.length}/
        {content.scenes.length})
      </h3>
      <div className="row-actions">
        <button
          onClick={() =>
            set({ unlockedScenes: content.scenes.map((scene) => scene.id) })
          }
        >
          Všechny
        </button>
        <button onClick={() => set({ unlockedScenes: [] })}>
          Jen podle příznaků
        </button>
      </div>
      <CheckList
        label="Odemčené lokace"
        entries={content.scenes.map((scene) => ({
          id: scene.id,
          label: scene.title,
        }))}
        selected={setup.unlockedScenes}
        onChange={(unlockedScenes) => set({ unlockedScenes })}
      />
    </section>
  );
}
