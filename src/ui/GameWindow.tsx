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
import { sceneViewportRect } from '../game/hudLayout';
import { gameSceneView } from '../game/sceneView';
import type { SceneView, SceneViewController } from '../game/sceneView';
import { matches } from '../game/state';
import { scenePoint } from '../game/coordinates';
import type { ScenePicker } from '../game/hitTest';
import { rotatedBounds } from '../game/transforms';
import { saveGame, loadGame } from '../game/storage';
import { platform } from '../platform';
import { languages, t, type Language } from '../game/i18n';
import { GameCanvas } from './GameCanvas';
import { DialoguePanel } from './DialoguePanel';
import { EndingPanel } from './EndingPanel';
import { BlackoutCutscene } from './BlackoutCutscene';
import { SuterKCiare } from '../minigames/suter-k-ciare';
import { useSceneAudio } from './useSceneAudio';
import { getActionSound } from '../game/actionSound';

type Target = { type: 'item'; id: string } | { type: 'hotspot'; id: string };
interface Drag {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  active: boolean;
  target: Target | null;
}

// Long enough to read comfortably, short enough not to cover the scene for good.
function reactionDuration(message: string) {
  return Math.min(10000, 3000 + message.length * 60);
}

export function GameWindow({
  content,
  state,
  dispatch: dispatchGame,
  restore,
  reset,
  openingSequence = 0,
  language,
  onLanguage,
}: {
  content: GameContent;
  language: Language;
  onLanguage: (language: Language) => void;
  state: GameState;
  dispatch: (action: GameAction) => void;
  restore: (state: GameState) => void;
  reset: () => void;
  openingSequence?: number;
}) {
  const startsWithDialogue = Boolean(
    content.startDialogue &&
    state.sceneId === content.startScene &&
    state.dialogue?.id === content.startDialogue,
  );
  // A new game first plays the authored cutscene, then the opening dialogue.
  const startOpening = () => ({
    sequence: openingSequence,
    pending: startsWithDialogue,
    cutscene: startsWithDialogue && content.openingCutscene === 'blackout',
  });
  const [opening, setOpening] = useState(startOpening);
  if (opening.sequence !== openingSequence) setOpening(startOpening());
  const current =
    opening.sequence === openingSequence ? opening : startOpening();
  const openingPending = current.pending;
  const cutscenePlaying = current.pending && current.cutscene;
  const finishCutscene = useCallback(
    () =>
      setOpening((previous) =>
        previous.sequence === openingSequence
          ? { ...previous, cutscene: false }
          : previous,
      ),
    [openingSequence],
  );
  const [readyScene, setReadyScene] = useState<string | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const markSceneReady = useCallback((id: string) => {
    setReadyScene(id);
    setSceneFailed(false);
  }, []);
  const markSceneFailed = useCallback(() => setSceneFailed(true), []);
  useEffect(() => {
    if (!openingPending || cutscenePlaying || readyScene !== state.sceneId)
      return;
    const timer = window.setTimeout(
      () =>
        setOpening({
          sequence: openingSequence,
          pending: false,
          cutscene: false,
        }),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [
    openingPending,
    cutscenePlaying,
    readyScene,
    state.sceneId,
    openingSequence,
  ]);
  const [animationTrigger, setAnimationTrigger] =
    useState<AnimationTrigger | null>(null);
  const [hovered, setHovered] = useState<Hotspot | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  // The shell's pause (button or hidden tab) opens the menu, which already
  // pauses sound, speech and input.
  useEffect(() => platform?.onPause(() => setMenu(true)), []);
  const [journal, setJournal] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const mapTravelLock = useRef(false);
  const ending = getEnding(content, state);
  const modalOpen =
    menu || journal || mapOpen || Boolean(ending) || Boolean(state.minigame);
  // Each dispatch restarts the reaction, so repeating the same click shows it again.
  const [reactionSerial, setReactionSerial] = useState(0);
  const [expiredReaction, setExpiredReaction] = useState<string | null>(null);
  const reactionKey = `${reactionSerial}:${state.message}`;
  const showReaction =
    !openingPending &&
    !ending &&
    !state.dialogue &&
    !state.minigame &&
    !mapOpen &&
    Boolean(state.message) &&
    expiredReaction !== reactionKey;
  useEffect(() => {
    if (!showReaction || menu || journal) return;
    const timer = window.setTimeout(
      () => setExpiredReaction(reactionKey),
      reactionDuration(t(state.message)),
    );
    return () => window.clearTimeout(timer);
  }, [showReaction, menu, journal, reactionKey, state.message]);
  const hudController = useRef<HudController | null>(null);
  const registerHud = useCallback((controller: HudController | null) => {
    hudController.current = controller;
  }, []);
  function focusHud(id: string) {
    gameRef.current
      ?.querySelector<HTMLButtonElement>('[data-hud-control="' + id + '"]')
      ?.focus();
  }
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
  const viewRef = useRef<{ view: SceneView; sceneId: string } | null>(null);
  const viewController = useRef<SceneViewController | null>(null);
  const [sceneView, setSceneView] = useState<{
    view: SceneView;
    sceneId: string;
  } | null>(null);
  const registerView = useCallback((view: SceneView, sceneId: string) => {
    viewRef.current = { view, sceneId };
    setSceneView({ view, sceneId });
  }, []);
  const registerViewController = useCallback(
    (controller: SceneViewController | null) => {
      viewController.current = controller;
    },
    [],
  );
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
    openingPending || menu || journal,
    {
      music: ending ? ending.music : scene.music,
      ducked: Boolean(state.dialogue),
    },
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
      if (ending || openingPending) return;
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
      const cue = getActionSound(content, state, action, next);
      if (cue) playEffect(cue);
      else if (next.sceneId !== state.sceneId) playEffect('travel');
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
        const frame =
          viewRef.current?.sceneId === location.id
            ? viewRef.current.view.frame
            : gameSceneView(
                viewport.current!.clientWidth,
                viewport.current!.clientHeight,
                location,
              ).frame;
        const scale = frame.width / location.width;
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
          frame.x + originX * scale - (origin && !collected ? width / 2 : 0);
        const y =
          frame.y + originY * scale - (origin && !collected ? height / 2 : 0);
        for (const id of added) {
          const item = content.items.find((i) => i.id === id)!;
          hudController.current?.pickup({
            itemId: id,
            image: collected ? actor!.image : item.image,
            icon: item.icon,
            x,
            y,
            width,
            height,
            rotation: collected ? (actor?.rotation ?? 0) : 0,
          });
        }
      }
      setReactionSerial((serial) => serial + 1);
      dispatchGame(action);
    },
    [dispatchGame, content, state, ending, openingPending, playEffect],
  );
  const conversation = useConversation(
    content,
    state,
    dispatch,
    modalOpen || openingPending,
  );
  const { reset: resetConversation } = conversation;
  const dialogueAudio = useDialogueAudio(
    dialogueNode,
    voiceActor?.animation,
    modalOpen || openingPending,
    !openingPending && !ending && conversation.phase === 'speech',
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
      if (openingPending) return;
      if (
        hotspot.openMap &&
        content.worldMap &&
        !state.dialogue &&
        !modalOpen
      ) {
        setSelectedItem(null);
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
    },
    [
      dispatch,
      selectedItem,
      content.worldMap,
      state.dialogue,
      modalOpen,
      openingPending,
    ],
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
        viewRef.current?.sceneId === scene.id
          ? viewRef.current.view
          : undefined,
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
    setJournal(false);
  }

  function hudAction(id: string, pointer: boolean) {
    if (openingPending) return;
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
      setHovered(null);
      setMenu(false);
      setJournal((value) => (id === 'journal-close' ? false : !value));
    } else if (id === 'menu') {
      setMapOpen(false);
      finishDrag();
      setJournal(false);
      setMenu((value) => !value);
    }
  }
  const frame =
    sceneView?.sceneId === scene.id
      ? sceneView.view.frame
      : gameSceneView(areaSize.width, areaSize.height, scene).frame;
  const sceneScale = frame.width / scene.width;
  const sceneLeft = frame.x;
  const sceneTop = frame.y;
  const labelPadding = Math.min(150, areaSize.width / 2);
  const interactiveHover =
    currentHover &&
    (currentHover.openMap ||
      currentHover.onClick.length ||
      Object.keys(currentHover.uses ?? {}).length)
      ? currentHover
      : null;

  return (
    <section
      ref={gameRef}
      className={`game-window ${pointer?.inScene && (interactiveHover || selected) && !modalOpen && !state.dialogue ? 'has-scene-cursor' : ''} ${drag?.active ? 'is-dragging' : ''} ${journal ? 'is-journal-open' : ''}`}
      aria-label={t('Herné okno')}
      aria-busy={openingPending && !sceneFailed}
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
                viewRef.current?.sceneId === scene.id
                  ? viewRef.current.view
                  : undefined,
              ),
            ),
        });
      }}
      onPointerLeave={() => {
        setPointer(null);
        setHovered(null);
      }}
    >
      <div
        className="play-area"
        ref={viewport}
        inert={openingPending && !sceneFailed}
      >
        <div inert={Boolean(ending)}>
          <GameCanvas
            scene={scene}
            pannable
            onViewChange={registerView}
            onViewReady={registerViewController}
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
            }}
            onHudReady={registerHud}
            onReady={markSceneReady}
            onError={markSceneFailed}
            onHudAction={hudAction}
            onItemDown={startDrag}
            onHover={setHovered}
            onInteract={act}
            blocked={openingPending || modalOpen || Boolean(drag?.active)}
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
        {showReaction && (
          <div
            className="reaction"
            role="status"
            aria-label={t('Reakcia')}
            aria-live="polite"
            aria-atomic="true"
          >
            <p key={reactionKey}>{t(state.message)}</p>
          </div>
        )}
        {!openingPending && !ending && state.dialogue && (
          <DialoguePanel
            conversation={conversation}
            audio={dialogueAudio.controls}
            subtitle={
              dialogueAudio.unavailable && dialogueNode
                ? subtitleText(dialogueNode)
                : dialogueAudio.subtitle
            }
            needsAudioGesture={dialogueAudio.needsGesture}
            onAdvance={() => {
              if (dialogueAudio.needsGesture) {
                conversation.lockInput();
                dialogueAudio.playFromGesture();
              } else conversation.advance(dialogueAudio.stop);
            }}
          />
        )}
        {state.minigame === 'suter-k-ciare' && !ending && (
          <div
            className="minigame-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('Šuter k čiare')}
          >
            <SuterKCiare
              onFinish={(result) =>
                dispatch({
                  type: 'finishMinigame',
                  won: result.outcome === 'win',
                })
              }
              onExit={() => dispatch({ type: 'closeMinigame' })}
            />
          </div>
        )}
        {!state.dialogue && !modalOpen && (
          <div
            className="scene-accessibility"
            aria-label={t('Ovládanie scény')}
          >
            {hotspots
              .filter(
                (hotspot) =>
                  hotspot.openMap ||
                  hotspot.onClick.length ||
                  Object.keys(hotspot.uses ?? {}).length,
              )
              .map((hotspot) => (
                <button
                  key={hotspot.id}
                  data-hotspot-id={hotspot.id}
                  data-open-map={hotspot.openMap || undefined}
                  aria-label={`${hotspot.label} ↗`}
                  style={{
                    left: sceneLeft + hotspot.bounds.x * sceneScale,
                    top: sceneTop + hotspot.bounds.y * sceneScale,
                    width: hotspot.bounds.width * sceneScale,
                    height: hotspot.bounds.height * sceneScale,
                  }}
                  onClick={(event) => {
                    if (event.detail === 0) act(hotspot);
                  }}
                  onFocus={() => {
                    viewController.current?.reveal(
                      rotatedBounds(hotspot.bounds, hotspot.rotation),
                    );
                    setHovered(hotspot);
                  }}
                  onBlur={() => setHovered(null)}
                  onKeyDown={(event) => {
                    if (
                      event.repeat &&
                      (event.key === 'Enter' || event.key === ' ')
                    )
                      event.preventDefault();
                  }}
                >
                  {hotspot.label}
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
            // In the Azet shell its end screen offers the next play instead.
            onFinish={platform ? () => platform?.finish(ending.id) : undefined}
          />
        )}
        {menu && (
          <div className="menu-overlay">
            <section
              className="game-menu"
              role="dialog"
              aria-label={t('Herné menu')}
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
              <h2>{t('Pauza na kávu')}</h2>
              <button
                autoFocus
                onClick={() => {
                  const result = saveGame(content, state);
                  setStorageMessage(
                    result.ok
                      ? platform
                        ? 'Hra je uložená.'
                        : 'Hra je uložená v tomto prehliadači.'
                      : result.message,
                  );
                }}
              >
                {t('Uložiť hru')}
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
                {t('Načítať hru')}
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
                {t('Nová hra')}
              </button>
              <button onClick={toggleSound} aria-pressed={soundEnabled}>
                {t(
                  soundEnabled
                    ? 'Zvuk prostredia: zapnutý'
                    : 'Zvuk prostredia: vypnutý',
                )}
              </button>
              <div
                className="language-switch"
                role="group"
                aria-label={t('Jazyk')}
              >
                {languages.map((option) => (
                  <button
                    key={option.id}
                    lang={option.id}
                    aria-pressed={language === option.id}
                    onClick={() => onLanguage(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p role="status" aria-label={t('Ukladanie')}>
                {t(storageMessage)}
              </p>
              <button
                onClick={() => {
                  setMenu(false);
                  focusHud('menu');
                }}
              >
                {t(ending ? 'Späť na záver' : 'Pokračovať v hre')}
              </button>
            </section>
          </div>
        )}
      </div>
      {pointer?.inScene &&
        interactiveHover &&
        !drag?.active &&
        !selected &&
        !state.dialogue &&
        !modalOpen && (
          <SceneCursor
            key={interactiveHover.id}
            hotspot={interactiveHover}
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
      {cutscenePlaying && !sceneFailed && (
        <BlackoutCutscene key={openingSequence} onFinish={finishCutscene} />
      )}
    </section>
  );
}
