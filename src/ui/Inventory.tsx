import type { GameAction, GameContent, GameState } from '../game/types';

export function Inventory({
  content,
  state,
  selectedItem,
  onSelect,
  dispatch,
}: {
  content: GameContent;
  state: GameState;
  selectedItem: string | null;
  onSelect: (id: string | null) => void;
  dispatch: (action: GameAction) => void;
}) {
  const item = content.items.find((entry) => entry.id === selectedItem);
  return (
    <fieldset className="inventory" disabled={Boolean(state.dialogue)}>
      <legend>
        Inventár <span>· {state.inventory.length}</span>
      </legend>
      <div className="inventory-items">
        {state.inventory.length === 0 && (
          <p className="muted">Zatiaľ iba vrecká plné nádeje.</p>
        )}
        {state.inventory.map((id) => {
          const entry = content.items.find((value) => value.id === id)!;
          return (
            <button
              key={id}
              className="inventory-item"
              aria-pressed={id === selectedItem}
              onClick={() => {
                if (selectedItem && selectedItem !== id) {
                  dispatch({
                    type: 'combine',
                    first: selectedItem,
                    second: id,
                  });
                  onSelect(null);
                } else onSelect(id === selectedItem ? null : id);
              }}
            >
              <span aria-hidden="true">{entry.icon}</span>
              {entry.label}
            </button>
          );
        })}
      </div>
      {item && (
        <div className="item-actions">
          <span>
            Použiť: <strong>{item.label}</strong> → predmet v scéne alebo v
            inventári
          </span>
          <button
            onClick={() => dispatch({ type: 'inspectItem', itemId: item.id })}
          >
            Preskúmať predmet
          </button>
          <button onClick={() => onSelect(null)}>Zrušiť výber</button>
        </div>
      )}
    </fieldset>
  );
}
