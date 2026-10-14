import type { PointerEvent } from 'react';
import type { GameContent, GameState } from '../game/types';

export function Inventory({
  content,
  state,
  blocked,
  selectedItem,
  draggingItem,
  dropItem,
  onSelect,
  onPointerDown,
  onInspect,
}: {
  content: GameContent;
  state: GameState;
  blocked: boolean;
  selectedItem: string | null;
  draggingItem: string | null;
  dropItem: string | null;
  onSelect: (id: string, pointer: boolean) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, id: string) => void;
  onInspect: (id: string) => void;
}) {
  return (
    <fieldset
      className="inventory"
      disabled={Boolean(state.dialogue) || blocked}
    >
      <legend className="sr-only">Inventár</legend>
      <div className="inventory-heading">
        <span className="eyebrow">INVENTÁR</span>
        <small>Potiahni predmet na predmet alebo do scény</small>
      </div>
      <div className="inventory-items">
        {!state.inventory.length && (
          <p className="empty-inventory">Prázdne vrecká. Zatiaľ.</p>
        )}
        {state.inventory.map((id) => {
          const item = content.items.find((entry) => entry.id === id)!;
          return (
            <button
              key={id}
              data-inventory-id={id}
              className={`inventory-item ${draggingItem === id ? 'drag-source' : ''} ${dropItem === id ? 'drop-target' : ''}`}
              aria-pressed={selectedItem === id}
              onPointerDown={(event) => onPointerDown(event, id)}
              onClick={(event) => onSelect(id, event.detail > 0)}
              onDoubleClick={() => onInspect(id)}
            >
              {item.image ? (
                <img src={item.image} alt="" draggable={false} />
              ) : (
                <span className="item-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
