import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  GameAction,
  GameContent,
  GameState,
  Hotspot,
  Verb,
} from '../game/types';
import { matches } from '../game/state';
import { scenePoint } from '../game/coordinates';
import { containsPoint } from '../game/transforms';
import { saveGame, loadGame } from '../game/storage';
import { GameCanvas } from './GameCanvas';
import { Inventory } from './Inventory';
import { DialoguePanel } from './DialoguePanel';

const verbs: { id: Verb | 'auto'; label: string }[] = [
  { id: 'auto', label: 'Kontextová akcia' },
  { id: 'look', label: 'Preskúmať' },
  { id: 'take', label: 'Vziať' },
  { id: 'talk', label: 'Hovoriť' },
  { id: 'use', label: 'Použiť' },
];
type Target = { type: 'item'; id: string } | { type: 'hotspot'; id: string };
interface Drag {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  active: boolean;
  target: Target | null;
}

export function GameWindow({
  content,
  state,
  dispatch,
  restore,
  reset,
}: {
  content: GameContent;
  state: GameState;
  dispatch: (action: GameAction) => void;
  restore: (state: GameState) => void;
  reset: () => void;
}) {
  const [hovered, setHovered] = useState<Hotspot | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [verb, setVerb] = useState<Verb | 'auto'>('auto');
  const [showHotspots, setShowHotspots] = useState(false);
  const [menu, setMenu] = useState(false);
  const [objectsOpen, setObjectsOpen] = useState(false);
  const [storageMessage, setStorageMessage] = useState(
    'Pozícia sa uloží až tlačidlom Uložiť hru.',
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<
    | (Drag & { startX: number; startY: number; element: HTMLButtonElement })
    | null
  >(null);
  const suppressClick = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setAreaSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scene = content.scenes.find((entry) => entry.id === state.sceneId)!;
  const hotspots = scene.hotspots.filter((hotspot) =>
    matches(state, hotspot.visibleWhen),
  );
  const selected =
    selectedItem && state.inventory.includes(selectedItem)
      ? selectedItem
      : null;
  const item = content.items.find((entry) => entry.id === selected);
  const currentHover = hotspots.find(
    (entry) =>
      entry.id ===
      (drag?.target?.type === 'hotspot' ? drag.target.id : hovered?.id),
  );
  const act = useCallback(
    (hotspot: Hotspot) => {
      dispatch({
        type: 'interact',
        hotspotId: hotspot.id,
        verb: verb === 'auto' ? undefined : verb,
        itemId: selectedItem ?? undefined,
      });
      setSelectedItem(null);
      setHovered(null);
      setObjectsOpen(false);
    },
    [dispatch, verb, selectedItem],
  );
  const finishDrag = useCallback(() => {
    const current = dragRef.current;
    dragRef.current = null;
    if (current?.active) suppressClick.current = true;
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    setDrag(null);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (menu) {
          setMenu(false);
          menuButton.current?.focus();
          return;
        }
        finishDrag();
        setSelectedItem(null);
        setMenu(false);
        setObjectsOpen(false);
        dispatch({ type: 'closeDialogue' });
      }
    };
    const onBlur = () => finishDrag();
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [dispatch, finishDrag, menu]);
  // Pointer capture keeps both mouse and touch drags alive across the canvas.
  useEffect(() => {
    const targetAt = (event: PointerEvent): Target | null => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const inventory = element?.closest<HTMLElement>('[data-inventory-id]');
      if (inventory && !inventory.closest('fieldset:disabled'))
        return { type: 'item', id: inventory.dataset.inventoryId! };
      if (
        !element?.closest('.canvas-host') ||
        !viewport.current ||
        state.dialogue ||
        menu
      )
        return null;
      const point = scenePoint(
        viewport.current.getBoundingClientRect(),
        scene,
        event.clientX,
        event.clientY,
      );
      const hotspot =
        point &&
        [...hotspots]
          .reverse()
          .find((hotspot) => containsPoint(hotspot, point));
      return hotspot ? { type: 'hotspot', id: hotspot.id } : null;
    };
    const move = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.active ||=
        Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY,
        ) > 7;
      current.x = event.clientX;
      current.y = event.clientY;
      current.target = targetAt(event);
      if (current.active) {
        event.preventDefault();
        setDrag({ ...current });
      }
    };
    const up = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (current.active) {
        suppressClick.current = true;
        const target = targetAt(event);
        if (target?.type === 'item' && target.id !== current.id)
          dispatch({ type: 'combine', first: current.id, second: target.id });
        if (target?.type === 'hotspot')
          dispatch({
            type: 'interact',
            hotspotId: target.id,
            itemId: current.id,
          });
        setSelectedItem(null);
        setHovered(null);
      }
      finishDrag();
    };
    const cancel = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) finishDrag();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('lostpointercapture', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('lostpointercapture', cancel);
    };
  }, [scene, hotspots, state.dialogue, dispatch, menu, finishDrag]);
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || state.dialogue || menu || dragRef.current) return;
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
      element: event.currentTarget,
    };
  }
  const dragItem = content.items.find((entry) => entry.id === drag?.id);
  const verbLabel = currentHover
    ? verbs.find(
        (entry) =>
          entry.id === (verb === 'auto' ? currentHover.defaultVerb : verb),
      )!.label
    : '';
  function clearUI() {
    finishDrag();
    setSelectedItem(null);
    setHovered(null);
    setVerb('auto');
    setObjectsOpen(false);
  }

  const sceneScale = Math.min(
    areaSize.width / scene.width,
    areaSize.height / scene.height,
  );
  const sceneLeft = (areaSize.width - scene.width * sceneScale) / 2;
  const sceneTop = (areaSize.height - scene.height * sceneScale) / 2;
  const labelPadding = Math.min(150, areaSize.width / 2);

  return (
    <section className="game-window" aria-label="Herné okno">
      <header className="game-topbar">
        <div className="game-brand">
          <span aria-hidden="true">↯</span> TUKABEL
        </div>
        <span className="scene-title">{scene.title}</span>
        <div className="game-tools">
          <button
            aria-pressed={showHotspots}
            onClick={() => setShowHotspots((value) => !value)}
          >
            {showHotspots ? 'Skryť predmety' : 'Ukázať predmety'}
          </button>
          <button
            ref={menuButton}
            aria-expanded={menu}
            onClick={() => {
              finishDrag();
              setMenu((value) => !value);
            }}
          >
            Menu
          </button>
        </div>
      </header>
      <div className="play-area" ref={viewport}>
        <GameCanvas
          scene={scene}
          state={state}
          animations={content.animations}
          hoveredId={currentHover?.id ?? null}
          selectedId={null}
          showHotspots={showHotspots}
          onHover={setHovered}
          onInteract={act}
          blocked={menu || Boolean(drag?.active)}
        />
        {currentHover && !state.dialogue && !menu && (
          <div
            className="scene-label"
            style={{
              left: Math.max(
                labelPadding,
                Math.min(
                  areaSize.width - labelPadding,
                  sceneLeft +
                    (currentHover.bounds.x + currentHover.bounds.width / 2) *
                      sceneScale,
                ),
              ),
              top: Math.max(56, sceneTop + currentHover.bounds.y * sceneScale),
            }}
          >
            {(dragItem?.label ?? item?.label)
              ? `${dragItem?.label ?? item?.label} → `
              : `${verbLabel} · `}
            {currentHover.label}
          </div>
        )}
        {!state.dialogue && (
          <div
            className="reaction"
            role="status"
            aria-label="Reakcia"
            aria-live="polite"
            aria-atomic="true"
          >
            <p key={state.message}>{state.message}</p>
          </div>
        )}
        {state.dialogue && (
          <DialoguePanel content={content} state={state} dispatch={dispatch} />
        )}
        {objectsOpen && !state.dialogue && (
          <div className="objects-popover" aria-label="Predmety v miestnosti">
            {hotspots.map((hotspot) => (
              <button
                key={hotspot.id}
                className="object-button"
                onClick={() => act(hotspot)}
                onFocus={() => setHovered(hotspot)}
                onBlur={() => setHovered(null)}
                onMouseEnter={() => setHovered(hotspot)}
                onMouseLeave={() => setHovered(null)}
              >
                {hotspot.label} ↗
              </button>
            ))}
          </div>
        )}
        {menu && (
          <div className="menu-overlay">
            <section
              className="game-menu"
              role="dialog"
              aria-label="Herné menu"
              aria-modal="true"
              onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                const controls =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)',
                  );
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }}
            >
              <h2>Pauza na kávu</h2>
              <button
                autoFocus
                onClick={() => {
                  const result = saveGame(content, state);
                  setStorageMessage(
                    result.ok
                      ? 'Hra je uložená v tomto prehliadači.'
                      : result.message,
                  );
                }}
              >
                Uložiť hru
              </button>
              <button
                onClick={() => {
                  const result = loadGame(content);
                  if (result.ok) {
                    restore(result.value);
                    clearUI();
                  }
                  setStorageMessage(
                    result.ok ? 'Uložená hra je načítaná.' : result.message,
                  );
                }}
              >
                Načítať hru
              </button>
              <button
                onClick={() => {
                  reset();
                  clearUI();
                  setStorageMessage(
                    'Nová hra. Ručne uložená pozícia ostáva dostupná.',
                  );
                  setMenu(false);
                  menuButton.current?.focus();
                }}
              >
                Nová hra
              </button>
              <p role="status" aria-label="Ukladanie">
                {storageMessage}
              </p>
              <button
                onClick={() => {
                  setMenu(false);
                  menuButton.current?.focus();
                }}
              >
                Pokračovať v hre
              </button>
            </section>
          </div>
        )}
      </div>
      <div className="game-dock">
        <fieldset
          className="verb-controls"
          disabled={Boolean(state.dialogue) || menu}
        >
          <legend className="sr-only">Herné akcie</legend>
          {verbs.map((entry) => (
            <button
              key={entry.id}
              aria-pressed={!selected && verb === entry.id}
              onClick={() => {
                setVerb(entry.id);
                setSelectedItem(null);
              }}
            >
              {entry.label}
            </button>
          ))}
          <button
            aria-expanded={objectsOpen}
            onClick={() => setObjectsOpen((value) => !value)}
          >
            Objekty
          </button>
        </fieldset>
        <Inventory
          content={content}
          state={state}
          blocked={menu}
          selectedItem={selected}
          draggingItem={drag?.id ?? null}
          dropItem={drag?.target?.type === 'item' ? drag.target.id : null}
          onPointerDown={startDrag}
          onSelect={(id, pointer) => {
            if (pointer && suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (selected && selected !== id) {
              dispatch({ type: 'combine', first: selected, second: id });
              setSelectedItem(null);
            } else setSelectedItem(selected === id ? null : id);
          }}
          onInspect={(id) => dispatch({ type: 'inspectItem', itemId: id })}
        />
        <div className="game-help">
          {item ? (
            <>
              <span>
                Použiť: <strong>{item.label}</strong>
              </span>
              <button
                onClick={() =>
                  dispatch({ type: 'inspectItem', itemId: item.id })
                }
              >
                Preskúmať predmet
              </button>
              <button onClick={() => setSelectedItem(null)}>
                Zrušiť výber
              </button>
            </>
          ) : (
            <span>
              Klik / dotyk · Potiahni predmety · Tab a Enter · Escape zruší
              výber
            </span>
          )}
          <span>{scene.title}</span>
        </div>
      </div>
      {drag?.active && dragItem && (
        <div
          className={`drag-ghost ${drag.target && !(drag.target.type === 'item' && drag.target.id === drag.id) ? 'valid-drop' : ''}`}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          {dragItem.image ? <img src={dragItem.image} alt="" /> : dragItem.icon}
          <span>{dragItem.label}</span>
        </div>
      )}
    </section>
  );
}
