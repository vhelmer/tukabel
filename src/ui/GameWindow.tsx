import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  GameAction,
  AnimationTrigger,
  GameContent,
  GameState,
  Hotspot,
} from '../game/types';
import { useDialogueAudio } from './DialogueAudio';
import { useConversation } from './useConversation';
import { subtitleText } from '../game/subtitles';
import { getDialogueNode } from '../game/state';
import { reduceGame } from '../game/state';
import { SceneCursor, PickupFlight } from './SceneCursor';
import type { Pickup } from './SceneCursor';
import { matches } from '../game/state';
import { scenePoint } from '../game/coordinates';
import type { ScenePicker } from '../game/hitTest';
import { rotatedBounds } from '../game/transforms';
import { saveGame, loadGame } from '../game/storage';
import { GameCanvas } from './GameCanvas';
import { Inventory } from './Inventory';
import { DialoguePanel } from './DialoguePanel';
import { TaskJournal, NotebookIcon } from './TaskJournal';
import { useButtonActivation } from './useButtonActivation';

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
  dispatch: dispatchGame,
  restore,
  reset,
}: {
  content: GameContent;
  state: GameState;
  dispatch: (action: GameAction) => void;
  restore: (state: GameState) => void;
  reset: () => void;
}) {
  const [animationTrigger, setAnimationTrigger] =
    useState<AnimationTrigger | null>(null);
  const [hovered, setHovered] = useState<Hotspot | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [journal, setJournal] = useState(false);
  const modalOpen = menu || journal;
  const activeTaskCount = Object.values(state.tasks).filter(
    (status) => status === 'active',
  ).length;
  const journalButton = useRef<HTMLButtonElement>(null);
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
  const gameRef = useRef<HTMLElement>(null);
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    inScene: boolean;
  } | null>(null);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const pickupNonce = useRef(0);
  const finishPickup = useCallback(
    (id: number) =>
      setPickups((previous) => previous.filter((p) => p.id !== id)),
    [],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const picker = useRef<ScenePicker | null>(null);
  const registerPicker = useCallback((next: ScenePicker | null) => {
    picker.current = next;
  }, []);
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
  const dialogueNode = getDialogueNode(content, state);
  const voiceActor = dialogueNode?.actor
    ? content.scenes
        .find((s) => s.id === dialogueNode.actor!.sceneId)
        ?.hotspots.find((h) => h.id === dialogueNode.actor!.hotspotId)
    : scene.hotspots.find(
        (h) =>
          h.animation?.dialogueId === state.dialogue?.id ||
          h.onClick.some((r) =>
            r.effects?.some(
              (e) => e.type === 'dialogue' && e.id === state.dialogue?.id,
            ),
          ),
      );
  const hotspots = scene.hotspots.filter(
    (hotspot) =>
      !hotspot.hidden &&
      (hotspot.opacity ?? 1) > 0 &&
      !hotspot.decorative &&
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
  const dispatch = useCallback(
    (action: GameAction) => {
      if (action.type === 'interact' && !state.dialogue) {
        const scene = content.scenes.find(
          (entry) => entry.id === state.sceneId,
        )!;
        const actor = scene.hotspots.find(
          (h) =>
            h.id === action.hotspotId &&
            !h.hidden &&
            (h.opacity ?? 1) > 0 &&
            !h.decorative &&
            matches(state, h.visibleWhen),
        );
        if (actor)
          setAnimationTrigger((previous) => ({
            sceneId: scene.id,
            hotspotId: actor.id,
            interaction: action.itemId ? 'use' : 'click',
            nonce: (previous?.nonce ?? 0) + 1,
          }));
      }
      const next = reduceGame(content, state, action);
      const added = next.inventory.filter(
        (id) => !state.inventory.includes(id),
      );
      const rootBox = gameRef.current?.getBoundingClientRect();
      const viewBox = viewport.current?.getBoundingClientRect();
      if (
        added.length &&
        rootBox &&
        viewBox &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        const location = content.scenes.find((s) => s.id === state.sceneId)!;
        const actor =
          action.type === 'interact'
            ? location.hotspots.find((h) => h.id === action.hotspotId)
            : undefined;
        const scale = Math.min(
          viewBox.width / location.width,
          viewBox.height / location.height,
        );
        const origin = actor?.bounds;
        const width = origin ? origin.width * scale : 56;
        const height = origin ? origin.height * scale : 56;
        const x =
          viewBox.x -
          rootBox.x +
          (viewBox.width - location.width * scale) / 2 +
          (origin?.x ?? location.width / 2) * scale;
        const y =
          viewBox.y -
          rootBox.y +
          (viewBox.height - location.height * scale) / 2 +
          (origin?.y ?? location.height * 0.6) * scale;
        setPickups((previous) => [
          ...previous,
          ...added.map((id) => {
            const item = content.items.find((i) => i.id === id)!;
            return {
              id: ++pickupNonce.current,
              itemId: id,
              image: actor?.image ?? item.image,
              icon: item.icon,
              x,
              y,
              width,
              height,
              rotation: actor?.rotation ?? 0,
            };
          }),
        ]);
      }
      dispatchGame(action);
    },
    [dispatchGame, content, state],
  );
  const conversation = useConversation(content, state, dispatch, modalOpen);
  const { reset: resetConversation } = conversation;
  const dialogueAudio = useDialogueAudio(
    dialogueNode,
    voiceActor?.animation,
    modalOpen,
    conversation.phase === 'speech',
    true,
    conversation.utteranceKey,
    { compact: true, onComplete: conversation.finish },
  );
  const silentPlayback = useMemo(
    () => ({ read: () => ({ active: false, timeMs: 0 }) }),
    [],
  );
  const speechPlayback =
    conversation.phase === 'speech' ? dialogueAudio.clock : silentPlayback;
  const act = useCallback(
    (hotspot: Hotspot) => {
      dispatch({
        type: 'interact',
        hotspotId: hotspot.id,
        itemId: selectedItem ?? undefined,
      });
      setSelectedItem(null);
      setObjectsOpen(false);
    },
    [dispatch, selectedItem],
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
        if (journal) {
          setJournal(false);
          journalButton.current?.focus();
          return;
        }
        if (menu) {
          setMenu(false);
          menuButton.current?.focus();
          return;
        }
        finishDrag();
        setSelectedItem(null);
        setMenu(false);
        setObjectsOpen(false);
      }
    };
    const onBlur = () => finishDrag();
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [finishDrag, menu, journal]);
  // Pointer capture keeps both mouse and touch drags alive across the canvas.
  useEffect(() => {
    const targetAt = (event: PointerEvent): Target | null => {
      if (modalOpen) return null;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const inventory = element?.closest<HTMLElement>('[data-inventory-id]');
      if (inventory && !inventory.closest('fieldset:disabled'))
        return { type: 'item', id: inventory.dataset.inventoryId! };
      if (
        !element?.closest('.canvas-host') ||
        !viewport.current ||
        state.dialogue ||
        modalOpen
      )
        return null;
      const point = scenePoint(
        viewport.current.getBoundingClientRect(),
        scene,
        event.clientX,
        event.clientY,
      );
      const hotspot = point && picker.current?.(point);
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
        const box = gameRef.current?.getBoundingClientRect();
        setDrag({
          ...current,
          x: current.x - (box?.x ?? 0),
          y: current.y - (box?.y ?? 0),
        });
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
  }, [scene, hotspots, state.dialogue, dispatch, modalOpen, finishDrag]);
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || state.dialogue || modalOpen || dragRef.current)
      return;
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
  function clearUI() {
    resetConversation();
    finishDrag();
    setSelectedItem(null);
    setHovered(null);
    setObjectsOpen(false);
    setPickups([]);
    setJournal(false);
  }

  const journalControl = useButtonActivation(() => {
    finishDrag();
    setSelectedItem(null);
    setObjectsOpen(false);
    setHovered(null);
    setMenu(false);
    setJournal((value) => !value);
  });
  const objectsControl = useButtonActivation(() =>
    setObjectsOpen((value) => !value),
  );
  const menuControl = useButtonActivation(() => {
    finishDrag();
    setJournal(false);
    setMenu((value) => !value);
  });
  const sceneScale = Math.min(
    areaSize.width / scene.width,
    areaSize.height / scene.height,
  );
  const sceneLeft = (areaSize.width - scene.width * sceneScale) / 2;
  const sceneTop = (areaSize.height - scene.height * sceneScale) / 2;
  const labelPadding = Math.min(150, areaSize.width / 2);

  return (
    <section
      ref={gameRef}
      className={`game-window ${pointer?.inScene && (currentHover || selected) && !modalOpen && !state.dialogue ? 'has-scene-cursor' : ''} ${drag?.active ? 'is-dragging' : ''}`}
      aria-label="Herné okno"
      onPointerMove={(event) => {
        if (event.pointerType === 'touch') return;
        const box = event.currentTarget.getBoundingClientRect();
        setPointer({
          x: event.clientX - box.x,
          y: event.clientY - box.y,
          inScene:
            event.target instanceof Element &&
            Boolean(event.target.closest('.canvas-host')),
        });
      }}
      onPointerLeave={() => {
        setPointer(null);
        setHovered(null);
      }}
    >
      <header className="game-topbar game-hud">
        <div className="hud-heading">
          <div className="game-brand">
            <span aria-hidden="true">↯</span> TUKABEL
          </div>
          <span className="scene-title">{scene.title}</span>
          <div className="game-tools">
            <button
              ref={journalButton}
              className="journal-toggle"
              aria-expanded={journal}
              {...journalControl}
            >
              <NotebookIcon />
              <span>Denník</span>
              <span
                className="journal-badge"
                aria-label={'Aktívne úlohy: ' + activeTaskCount}
              >
                {activeTaskCount}
              </span>
            </button>
            <button
              aria-expanded={objectsOpen}
              disabled={Boolean(state.dialogue) || modalOpen}
              {...objectsControl}
            >
              Objekty
            </button>
            <button ref={menuButton} aria-expanded={menu} {...menuControl}>
              Menu
            </button>
          </div>
        </div>
        <div className="game-dock">
          <div className="inventory-tools">
            <span className="eyebrow">VRECKÁ PLNÉ MOŽNOSTÍ</span>
          </div>
          <Inventory
            content={content}
            state={state}
            blocked={modalOpen}
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
              } else {
                setSelectedItem(selected === id ? null : id);
                dispatch({ type: 'inspectItem', itemId: id });
              }
            }}
            onInspect={(id) => dispatch({ type: 'inspectItem', itemId: id })}
          />
        </div>
      </header>
      <div className="play-area" ref={viewport}>
        <GameCanvas
          scene={scene}
          state={state}
          animations={content.animations}
          animationTrigger={animationTrigger}
          speechPlayback={speechPlayback}
          onPickerReady={registerPicker}
          onHover={setHovered}
          onInteract={act}
          blocked={modalOpen || Boolean(drag?.active)}
        />
        {currentHover && !state.dialogue && !modalOpen && (
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
              top: Math.max(
                56,
                sceneTop +
                  rotatedBounds(currentHover.bounds, currentHover.rotation).y *
                    sceneScale,
              ),
            }}
          >
            {(dragItem?.label ?? item?.label)
              ? `${dragItem?.label ?? item?.label} → `
              : ''}
            {currentHover.label}
          </div>
        )}
        {!state.dialogue && Boolean(state.message) && (
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
          <DialoguePanel
            conversation={conversation}
            audio={dialogueAudio.controls}
            subtitle={
              dialogueAudio.unavailable && dialogueNode
                ? subtitleText(dialogueNode)
                : dialogueAudio.subtitle
            }
            onAdvance={() => conversation.advance(dialogueAudio.stop)}
          />
        )}
        {objectsOpen && !state.dialogue && !modalOpen && (
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
      <div className="game-help">
        {item ? (
          <>
            <span>
              Použiť: <strong>{item.label}</strong>
            </span>
            <button onClick={() => setSelectedItem(null)}>Zrušiť výber</button>
          </>
        ) : (
          <span>
            Klik / dotyk · Potiahni predmety · Tab a Enter · Escape zruší výber
          </span>
        )}
        <span>{scene.title}</span>
      </div>
      {journal && (
        <TaskJournal
          content={content}
          state={state}
          onClose={() => {
            setJournal(false);
            journalButton.current?.focus();
          }}
        />
      )}
      {pointer?.inScene &&
        currentHover &&
        !drag?.active &&
        !selected &&
        !state.dialogue &&
        !modalOpen && (
          <SceneCursor
            key={currentHover.id}
            hotspot={currentHover}
            clips={content.animations ?? []}
            x={pointer.x}
            y={pointer.y}
          />
        )}
      {pointer?.inScene &&
        selected &&
        item &&
        !drag?.active &&
        !state.dialogue &&
        !modalOpen && (
          <div
            className="drag-ghost held-item"
            aria-hidden="true"
            style={{ left: pointer.x, top: pointer.y }}
          >
            {item.image ? <img src={item.image} alt="" /> : item.icon}
            <span>{item.label}</span>
          </div>
        )}
      {pickups.map((pickup) => (
        <PickupFlight key={pickup.id} pickup={pickup} onDone={finishPickup} />
      ))}
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
