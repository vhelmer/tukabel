import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { canTravel, getDialogueNode, getEnding } from '../game/state';
import { reduceGame } from '../game/state';
import { SceneCursor } from './SceneCursor';
import type { HudController, InventoryPointer } from '../game/createHud';
import { gameViewport, sceneViewportRect } from '../game/hudLayout';
import { matches } from '../game/state';
import { scenePoint } from '../game/coordinates';
import type { ScenePicker } from '../game/hitTest';
import { rotatedBounds } from '../game/transforms';
import { saveGame, loadGame } from '../game/storage';
import { GameCanvas } from './GameCanvas';
import { DialoguePanel } from './DialoguePanel';
import { EndingPanel } from './EndingPanel';
import { useSceneAudio } from './useSceneAudio';

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
  const [mapOpen, setMapOpen] = useState(false);
  const mapTravelLock = useRef(false);
  const ending = getEnding(content, state);
  const modalOpen = menu || journal || mapOpen || Boolean(ending);
  const hudController = useRef<HudController | null>(null);
  const registerHud = useCallback((controller: HudController | null) => {
    hudController.current = controller;
  }, []);
  function focusHud(id: string) {
    gameRef.current
      ?.querySelector<HTMLButtonElement>('[data-hud-control="' + id + '"]')
      ?.focus();
  }
  const [objectsOpen, setObjectsOpen] = useState(false);
  const [storageMessage, setStorageMessage] = useState(
    'Pozícia sa uloží až tlačidlom Uložiť hru.',
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<
    | (Drag & { startX: number; startY: number; element: HTMLCanvasElement })
    | null
  >(null);
  const suppressClick = useRef(false);
  const gameRef = useRef<HTMLElement>(null);
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    inScene: boolean;
  } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const picker = useRef<ScenePicker | null>(null);
  const registerPicker = useCallback((next: ScenePicker | null) => {
    picker.current = next;
  }, []);
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
  const {
    enabled: soundEnabled,
    toggle: toggleSound,
    playEffect,
  } = useSceneAudio(
    ending ? ending.ambient : scene.ambient,
    menu || journal || mapOpen,
  );
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
      if (ending) return;
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
      if (next.sceneId !== state.sceneId) playEffect('travel');
      else if (added.length)
        playEffect(action.type === 'combine' ? 'combine' : 'pickup');
      const rootBox = viewport.current?.getBoundingClientRect();
      const viewBox = viewport.current
        ? sceneViewportRect(viewport.current)
        : undefined;
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
        const collected = Boolean(
          actor?.image && !matches(next, actor.visibleWhen),
        );
        const width = collected ? origin!.width * scale : 56;
        const height = collected ? origin!.height * scale : 56;
        const originX = origin
          ? origin.x + (collected ? 0 : origin.width / 2)
          : location.width / 2;
        const originY = origin
          ? origin.y + (collected ? 0 : origin.height / 2)
          : location.height * 0.6;
        const x =
          viewBox.x -
          rootBox.x +
          (viewBox.width - location.width * scale) / 2 +
          originX * scale -
          (origin && !collected ? width / 2 : 0);
        const y =
          viewBox.y -
          rootBox.y +
          (viewBox.height - location.height * scale) / 2 +
          originY * scale -
          (origin && !collected ? height / 2 : 0);
        for (const id of added) {
          const item = content.items.find((i) => i.id === id)!;
          const sx = viewport.current!.clientWidth / rootBox.width;
          const sy = viewport.current!.clientHeight / rootBox.height;
          hudController.current?.pickup({
            itemId: id,
            image: collected ? actor!.image : item.image,
            icon: item.icon,
            x: x * sx,
            y: y * sy,
            width: width * sx,
            height: height * sy,
            rotation: collected ? (actor?.rotation ?? 0) : 0,
          });
        }
      }
      dispatchGame(action);
    },
    [dispatchGame, content, state, ending, playEffect],
  );
  const conversation = useConversation(content, state, dispatch, modalOpen);
  const { reset: resetConversation } = conversation;
  const dialogueAudio = useDialogueAudio(
    dialogueNode,
    voiceActor?.animation,
    modalOpen,
    !ending && conversation.phase === 'speech',
    true,
    conversation.utteranceKey,
    { compact: true, onComplete: conversation.finish },
  );
  const silentPlayback = useMemo(
    () => ({ read: () => ({ active: false, timeMs: 0 }) }),
    [],
  );
  const speechPlayback =
    !ending && conversation.phase === 'speech'
      ? dialogueAudio.clock
      : silentPlayback;
  const act = useCallback(
    (hotspot: Hotspot) => {
      if (
        hotspot.openMap &&
        content.worldMap &&
        !state.dialogue &&
        !modalOpen
      ) {
        setSelectedItem(null);
        setObjectsOpen(false);
        setHovered(null);
        setMenu(false);
        setJournal(false);
        mapTravelLock.current = false;
        setMapOpen(true);
        return;
      }
      dispatch({
        type: 'interact',
        hotspotId: hotspot.id,
        itemId: selectedItem ?? undefined,
      });
      setSelectedItem(null);
      setObjectsOpen(false);
    },
    [dispatch, selectedItem, content.worldMap, state.dialogue, modalOpen],
  );
  const finishDrag = useCallback(() => {
    const current = dragRef.current;
    dragRef.current = null;
    if (current) suppressClick.current = true;
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    setDrag(null);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (mapOpen) {
          event.preventDefault();
          setMapOpen(false);
          return;
        }
        if (journal) {
          setJournal(false);
          focusHud('journal');
          return;
        }
        if (menu) {
          setMenu(false);
          focusHud('menu');
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
  }, [finishDrag, menu, journal, mapOpen]);
  // Pointer capture keeps both mouse and touch drags alive across the canvas.
  useEffect(() => {
    const targetAt = (event: PointerEvent): Target | null => {
      if (modalOpen) return null;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const inventory = element?.closest('.canvas-host')
        ? hudController.current?.itemAt(event.clientX, event.clientY)
        : null;
      if (inventory) return { type: 'item', id: inventory };
      if (
        !element?.closest('.canvas-host') ||
        !viewport.current ||
        state.dialogue ||
        modalOpen ||
        hudController.current?.blocksPointer(event.clientX, event.clientY)
      )
        return null;
      const point = scenePoint(
        sceneViewportRect(viewport.current),
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
        suppressClick.current = true;
        event.preventDefault();
        const box = viewport.current?.getBoundingClientRect();
        setDrag({
          ...current,
          x:
            (current.x - (box?.x ?? 0)) *
            (viewport.current ? viewport.current.clientWidth / box!.width : 1),
          y:
            (current.y - (box?.y ?? 0)) *
            (viewport.current
              ? viewport.current.clientHeight / box!.height
              : 1),
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
  function startDrag(id: string, event: InventoryPointer) {
    if (event.button !== 0 || state.dialogue || modalOpen || dragRef.current)
      return;
    suppressClick.current = false;
    event.element.setPointerCapture(event.pointerId);
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
      element: event.element,
    };
  }
  const dragItem = content.items.find((entry) => entry.id === drag?.id);
  function clearUI() {
    resetConversation();
    setMapOpen(false);
    finishDrag();
    setSelectedItem(null);
    setHovered(null);
    setObjectsOpen(false);
    setJournal(false);
  }

  function hudAction(id: string, pointer: boolean) {
    if (ending && id !== 'menu') return;
    if (id.startsWith('item:')) {
      if (state.dialogue || modalOpen) return;
      const itemId = id.slice(5);
      if (pointer && suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      if (selected && selected !== itemId) {
        dispatch({ type: 'combine', first: selected, second: itemId });
        setSelectedItem(null);
      } else {
        setSelectedItem(selected === itemId ? null : itemId);
        dispatch({ type: 'inspectItem', itemId });
      }
    } else if (id === 'map-close') {
      if (!content.worldMap || state.dialogue) return;
      finishDrag();
      setSelectedItem(null);
      setObjectsOpen(false);
      setHovered(null);
      setMenu(false);
      setJournal(false);
      mapTravelLock.current = false;
      setMapOpen(false);
    } else if (id.startsWith('map-point:')) {
      if (!mapOpen || mapTravelLock.current) return;
      const point = content.worldMap?.points.find((p) => p.id === id.slice(10));
      if (!point || !canTravel(content, state, point.sceneId)) return;
      mapTravelLock.current = true;
      finishDrag();
      setSelectedItem(null);
      setHovered(null);
      setMapOpen(false);
      dispatch({ type: 'travel', sceneId: point.sceneId });
    } else if (id === 'journal' || id === 'journal-close') {
      setMapOpen(false);
      finishDrag();
      setSelectedItem(null);
      setObjectsOpen(false);
      setHovered(null);
      setMenu(false);
      setJournal((value) => (id === 'journal-close' ? false : !value));
    } else if (id === 'menu') {
      setMapOpen(false);
      finishDrag();
      setJournal(false);
      setMenu((value) => !value);
    } else if (id === 'objects' && !state.dialogue && !modalOpen)
      setObjectsOpen((value) => !value);
  }
  const sceneArea = gameViewport(areaSize.width, areaSize.height);
  const sceneScale = Math.min(
    areaSize.width / scene.width,
    sceneArea.height / scene.height,
  );
  const sceneLeft = (areaSize.width - scene.width * sceneScale) / 2;
  const sceneTop =
    sceneArea.y + (sceneArea.height - scene.height * sceneScale) / 2;
  const labelPadding = Math.min(150, areaSize.width / 2);

  return (
    <section
      ref={gameRef}
      className={`game-window ${pointer?.inScene && (currentHover || selected) && !modalOpen && !state.dialogue ? 'has-scene-cursor' : ''} ${drag?.active ? 'is-dragging' : ''} ${journal ? 'is-journal-open' : ''}`}
      aria-label="Herné okno"
      onPointerMove={(event) => {
        if (event.pointerType === 'touch') return;
        const box = event.currentTarget.getBoundingClientRect();
        setPointer({
          x: event.clientX - box.x,
          y: event.clientY - box.y,
          inScene:
            event.target instanceof Element &&
            Boolean(event.target.closest('.canvas-host')) &&
            !hudController.current?.blocksPointer(
              event.clientX,
              event.clientY,
            ) &&
            Boolean(
              viewport.current &&
              scenePoint(
                sceneViewportRect(viewport.current),
                scene,
                event.clientX,
                event.clientY,
              ),
            ),
        });
      }}
      onPointerLeave={() => {
        setPointer(null);
        setHovered(null);
      }}
    >
      <div className="play-area" ref={viewport}>
        <div inert={Boolean(ending)}>
          <GameCanvas
            scene={scene}
            state={state}
            animations={content.animations}
            animationTrigger={animationTrigger}
            speechPlayback={speechPlayback}
            onPickerReady={registerPicker}
            hud={{
              content,
              state,
              selectedItem: selected,
              drag,
              journal,
              map: mapOpen,
              menu: menu || Boolean(ending),
              objectsOpen,
            }}
            onHudReady={registerHud}
            onHudAction={hudAction}
            onItemDown={startDrag}
            onHover={setHovered}
            onInteract={act}
            blocked={modalOpen || Boolean(drag?.active)}
          />
        </div>
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
        {!ending && !state.dialogue && !mapOpen && Boolean(state.message) && (
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
        {!ending && state.dialogue && (
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
        {ending && !menu && (
          <EndingPanel
            ending={ending}
            onMenu={() => setMenu(true)}
            onReset={() => {
              reset();
              clearUI();
            }}
          />
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
                    if (getEnding(content, result.value)) setMenu(false);
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
                  focusHud('menu');
                }}
              >
                Nová hra
              </button>
              <button onClick={toggleSound} aria-pressed={soundEnabled}>
                Zvuk prostredia: {soundEnabled ? 'zapnutý' : 'vypnutý'}
              </button>
              <p role="status" aria-label="Ukladanie">
                {storageMessage}
              </p>
              <button
                onClick={() => {
                  setMenu(false);
                  focusHud('menu');
                }}
              >
                {ending ? 'Späť na záver' : 'Pokračovať v hre'}
              </button>
            </section>
          </div>
        )}
      </div>
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
    </section>
  );
}
