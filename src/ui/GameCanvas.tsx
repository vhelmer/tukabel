import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Application, Assets } from 'pixi.js';
import grab from '../assets/cursors/grab.svg';
import type { Texture } from 'pixi.js';
import { scenePoint } from '../game/coordinates';
import { loadAlphaMask } from '../game/alphaMasks';
import type { ScenePicker } from '../game/hitTest';
import { createScene } from '../game/createScene';
import { createHud } from '../game/createHud';
import type {
  HudState,
  HudController,
  HudLayout,
  InventoryPointer,
} from '../game/createHud';
import { gameViewport } from '../game/hudLayout';
import { attachScenePan } from '../game/scenePan';
import {
  gameSceneView,
  panSceneView,
  revealInView,
  visibleSceneFrame,
} from '../game/sceneView';
import type { SceneView, SceneViewController } from '../game/sceneView';
import { hudArt } from '../game/hudArt';
import { HudAccessibility } from './HudAccessibility';
import type {
  AnimationDefinition,
  SceneSpeechPlayback,
  AnimationPreviewState,
  AnimationTrigger,
  GameState,
  SceneCallbacks,
  SceneDefinition,
} from '../game/types';

interface GameCanvasProps extends SceneCallbacks {
  scene: SceneDefinition;
  state: GameState;
  animations?: readonly AnimationDefinition[];
  blocked?: boolean;
  animationTrigger?: AnimationTrigger | null;
  animationPreview?: AnimationPreviewState;
  speechPlayback?: SceneSpeechPlayback;
  onPickerReady?: (picker: ScenePicker | null) => void;
  hud?: HudState;
  onHudAction?: (id: string, pointer: boolean) => void;
  onItemDown?: (id: string, event: InventoryPointer) => void;
  onHudReady?: (controller: HudController | null) => void;
  onReady?: (sceneId: string) => void;
  onError?: () => void;
  pannable?: boolean;
  onViewChange?: (view: SceneView, sceneId: string) => void;
  onViewReady?: (controller: SceneViewController | null) => void;
}

const noAnimations: readonly AnimationDefinition[] = [];

export function GameCanvas(props: GameCanvasProps) {
  return <MountedCanvas key={props.scene.id} {...props} />;
}

function MountedCanvas({
  scene,
  state,
  animations = noAnimations,
  blocked = false,
  animationTrigger,
  animationPreview,
  speechPlayback,
  onHover,
  onInteract,
  onPickerReady,
  hud,
  onHudAction,
  onItemDown,
  onHudReady,
  onReady,
  onError,
  pannable = false,
  onViewChange,
  onViewReady,
}: GameCanvasProps) {
  const [camera, setCamera] = useState<SceneView | null>(null);
  const [panned, setPanned] = useState(false);
  const hudRef = useRef<ReturnType<typeof createHud> | null>(null);
  const hudSnapshot = useRef(hud);
  useLayoutEffect(() => {
    hudSnapshot.current = hud;
    if (hud) hudRef.current?.update(hud);
  }, [hud]);
  const [hudController, setHudController] = useState<HudController | null>(
    null,
  );
  const [hudLayout, setHudLayout] = useState<HudLayout | null>(null);
  const [effects, setEffects] = useState({
    dragging: false,
    pickups: 0,
    pickupImage: undefined as string | undefined,
  });
  const hudContent = hud?.content;
  const currentState = useRef({
    state,
    blocked,
    animationPreview,
    speechPlayback,
  });
  useEffect(() => {
    currentState.current = { state, blocked, animationPreview, speechPlayback };
  }, [state, blocked, animationPreview, speechPlayback]);
  const lastTrigger = useRef(0);
  const callbacks = useRef({
    onHover,
    onInteract,
    onHudAction,
    onItemDown,
    onViewChange,
  });
  useEffect(() => {
    callbacks.current = {
      onHover,
      onInteract,
      onHudAction,
      onItemDown,
      onViewChange,
    };
  }, [onHover, onInteract, onHudAction, onItemDown, onViewChange]);
  const playbackRef = useRef<(() => void) | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof createScene> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const app = new Application();
    let disposed = false;
    let initialized = false;
    let destroyed = false;
    let pickerPublished = false;
    let hudPublished = false;
    let observer: ResizeObserver | undefined;
    let stopPlayback: (() => void) | undefined;
    let pan: ReturnType<typeof attachScenePan> | undefined;
    let viewPublished = false;
    let view: SceneView | undefined;

    const destroy = () => {
      pan?.destroy();
      if (viewPublished) {
        onViewReady?.(null);
        viewPublished = false;
      }
      if (pickerPublished) {
        onPickerReady?.(null);
        pickerPublished = false;
      }
      hudRef.current?.destroy();
      if (hudPublished) {
        onHudReady?.(null);
        hudRef.current = null;
        hudPublished = false;
      }
      observer?.disconnect();
      stopPlayback?.();
      if (initialized && !destroyed) {
        destroyed = true;
        // Assets owns cached textures; destroying one here would break remounts.
        app.destroy({ removeView: true }, { children: true });
      }
    };

    const start = async () => {
      try {
        await app.init({
          preference: 'webgl',
          background: '#1c1720',
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
          autoStart: false,
        });
        initialized = true;
        if (disposed) {
          destroy();
          return;
        }
        if (hudContent) {
          app.renderer.events.cursorStyles.default = 'inherit';
          app.renderer.events.cursorStyles.pointer = `url("${grab}") 8 12, pointer`;
        }
        const urls = [
          ...new Set([
            scene.background,
            ...(hudContent ? Object.values(hudArt) : []),
            ...(hudContent?.worldMap ? [hudContent.worldMap.image] : []),
            ...(hudContent?.items.flatMap((item) =>
              item.image ? [item.image] : [],
            ) ?? []),
            ...animations
              .filter((animation) =>
                scene.hotspots.some((hotspot) =>
                  [
                    hotspot.animation?.idle,
                    hotspot.animation?.blink,
                    hotspot.animation?.talk,
                    hotspot.animation?.onClick,
                    hotspot.animation?.onUse,
                    hotspot.animation?.gesture,
                  ].includes(animation.id),
                ),
              )
              .flatMap((animation) => animation.frames),
            ...scene.hotspots.flatMap((hotspot) =>
              hotspot.image ? [hotspot.image] : [],
            ),
            ...scene.hotspots.flatMap((hotspot) =>
              hotspot.clipMask ? [hotspot.clipMask] : [],
            ),
          ]),
        ];
        const maskUrls = new Set(
          scene.hotspots.flatMap((hotspot) => {
            if (
              hotspot.decorative ||
              !hotspot.image ||
              hotspot.polygon ||
              hotspot.hitTest === 'bounds'
            )
              return [];
            const binding = hotspot.animation;
            return [
              hotspot.image,
              ...animations
                .filter((clip) =>
                  [
                    binding?.idle,
                    binding?.blink,
                    binding?.talk,
                    binding?.onClick,
                    binding?.onUse,
                    binding?.gesture,
                  ].includes(clip.id),
                )
                .flatMap((clip) => clip.frames),
            ];
          }),
        );
        if (hudContent) maskUrls.add(hudArt.tray);
        const [loaded, alpha] = await Promise.all([
          Promise.all(
            urls.map(
              async (url) => [url, await Assets.load<Texture>(url)] as const,
            ),
          ),
          Promise.all(
            [...maskUrls].map(
              async (url) => [url, await loadAlphaMask(url)] as const,
            ),
          ),
        ]);
        const textures = new Map(loaded);
        const texture = textures.get(scene.background)!;
        for (const clip of animations) {
          const source = textures.get(clip.source),
            r = clip.region;
          if (
            source &&
            r &&
            (r.x < 0 ||
              r.y < 0 ||
              r.width <= 0 ||
              r.height <= 0 ||
              r.x + r.width > source.orig.width ||
              r.y + r.height > source.orig.height)
          )
            throw new Error(
              `${clip.label}: animation region outside source canvas`,
            );
          if (
            source &&
            clip.frames.some((frame) => {
              const current = textures.get(frame);
              return (
                current &&
                (current.orig.width !== source.orig.width ||
                  current.orig.height !== source.orig.height)
              );
            })
          )
            throw new Error(`${clip.label}: frame canvas differs from source`);
        }
        if (disposed) return;
        let syncPlayback = () => {};
        const mountedScene = createScene(
          scene,
          texture,
          {
            onHover: (hotspot) => callbacks.current.onHover(hotspot),
            onInteract: (hotspot) => {
              if (!pan?.suppressTap) callbacks.current.onInteract(hotspot);
            },
          },
          () => app.render(),
          textures,
          animations,
          new Map(alpha),
        );
        mountedScene.update(
          currentState.current.state,
          currentState.current.blocked,
          currentState.current.animationPreview,
          currentState.current.speechPlayback,
        );
        onPickerReady?.(mountedScene.pick);
        pickerPublished = true;
        sceneRef.current = mountedScene;
        app.stage.addChild(mountedScene.root);
        const mountedHud = hudSnapshot.current
          ? createHud(
              app.canvas,
              textures,
              hudSnapshot.current,
              {
                onAction: (id, pointer) =>
                  callbacks.current.onHudAction?.(id, pointer),
                onItemDown: (id, event) =>
                  callbacks.current.onItemDown?.(id, event),
                onLayout: setHudLayout,
                onEffects: (next) =>
                  setEffects((previous) =>
                    previous.dragging === next.dragging &&
                    previous.pickups === next.pickups &&
                    previous.pickupImage === next.pickupImage
                      ? previous
                      : { ...next, pickupImage: next.pickupImage },
                  ),
              },
              () => app.render(),
              () => syncPlayback(),
              new Map(alpha).get(hudArt.tray)!,
            )
          : null;
        if (mountedHud) {
          hudRef.current = mountedHud;
          setHudController(mountedHud.controller);
          app.stage.addChild(mountedHud.root);
          mountedHud.update(hudSnapshot.current!);
          hudPublished = true;
          onHudReady?.(mountedHud.controller);
        }
        const reducedMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        );
        app.ticker.maxFPS = 30;
        app.ticker.add((ticker) => {
          const delta = Math.min(100, ticker.deltaMS);
          mountedScene.animate(delta);
          if (mountedHud?.active) mountedHud.animate(delta);
        });
        syncPlayback = () => {
          if (
            reducedMotion.matches ||
            document.hidden ||
            (!mountedScene.hasActiveAnimations && !mountedHud?.active)
          )
            app.stop();
          else app.start();
          if (reducedMotion.matches) {
            mountedScene.resetMotion();
            if (mountedHud?.active) mountedHud.resetEffects();
          }
        };
        // Keep a scene-space pointer for stationary hover as animation silhouettes
        // change. Reuse the existing animation ticker instead of another ticker.
        let pointer: { x: number; y: number } | null = null;
        const syncPointer = () =>
          mountedScene.hoverAt(
            pointer &&
              !mountedHud?.controller.blocksPointer(pointer.x, pointer.y)
              ? scenePoint(sceneRect(), scene, pointer.x, pointer.y, view)
              : null,
          );
        const sceneRect = () => app.canvas.getBoundingClientRect();
        const movePointer = (event: PointerEvent) => {
          pointer =
            event.pointerType === 'touch'
              ? null
              : { x: event.clientX, y: event.clientY };
          syncPointer();
        };
        const leavePointer = () => {
          pointer = null;
          syncPointer();
        };
        app.canvas.addEventListener('pointermove', movePointer);
        app.canvas.addEventListener('pointerenter', movePointer);
        app.canvas.addEventListener('pointerleave', leavePointer);
        playbackRef.current = syncPlayback;
        reducedMotion.addEventListener('change', syncPlayback);
        document.addEventListener('visibilitychange', syncPlayback);
        stopPlayback = () => {
          app.canvas.removeEventListener('pointermove', movePointer);
          app.canvas.removeEventListener('pointerenter', movePointer);
          app.canvas.removeEventListener('pointerleave', leavePointer);
          reducedMotion.removeEventListener('change', syncPlayback);
          document.removeEventListener('visibilitychange', syncPlayback);
          playbackRef.current = null;
        };
        app.canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(app.canvas);

        const applyView = (next: SceneView) => {
          view = next;
          mountedScene.resize(
            next.frame.width,
            next.frame.height,
            next.frame.x,
            next.frame.y,
          );
          setCamera(next);
          callbacks.current.onViewChange?.(next, scene.id);
          syncPointer();
        };
        const isBlocked = () =>
          Boolean(
            currentState.current.blocked ||
            currentState.current.state.dialogue ||
            hudSnapshot.current?.menu ||
            hudSnapshot.current?.journal ||
            hudSnapshot.current?.map,
          );
        const resize = () => {
          const width = Math.max(1, host.clientWidth);
          const height = Math.max(1, host.clientHeight);
          app.renderer.resize(width, height);
          if (pannable) {
            let next = gameSceneView(width, height, scene);
            if (view) {
              const focusX = (view.width / 2 - view.frame.x) / view.frame.width;
              const focusY =
                (view.height / 2 - view.frame.y) / view.frame.height;
              next = gameSceneView(width, height, scene, {
                x: (0.5 - focusX) * next.frame.width,
                y: (0.5 - focusY) * next.frame.height,
              });
            }
            applyView(next);
            mountedHud?.resize(width, height, visibleSceneFrame(next));
          } else {
            const area = gameViewport(width, height);
            mountedScene.resize(area.width, area.height, area.x, area.y);
            mountedHud?.resize(width, height);
            syncPointer();
          }
        };
        if (pannable) {
          pan = attachScenePan(app.canvas, {
            canPan: () =>
              Boolean(
                view &&
                (view.frame.width > view.width + 0.5 ||
                  view.frame.height > view.height + 0.5),
              ),
            blocked: isBlocked,
            blocksPointer: (x, y) =>
              mountedHud?.controller.blocksPointer(x, y) ?? false,
            horizontalOnly: () =>
              Boolean(view && view.frame.height <= view.height),
            pan: (delta) => {
              if (!view) return;
              const rect = sceneRect();
              applyView(
                panSceneView(view, scene, {
                  x: (delta.x * view.width) / rect.width,
                  y: (delta.y * view.height) / rect.height,
                }),
              );
              setPanned(true);
            },
          });
          onViewReady?.({
            reveal(bounds) {
              if (view && !isBlocked())
                applyView(revealInView(view, scene, bounds));
            },
          });
          viewPublished = true;
        }
        observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();
        syncPlayback();
        setStatus('ready');
        onReady?.(scene.id);
      } catch (error) {
        destroy();
        if (!disposed) {
          console.error('Scene initialization failed:', error);
          setStatus('error');
          onError?.();
        }
      }
    };

    void start();
    return () => {
      disposed = true;
      sceneRef.current = null;
      destroy();
    };
  }, [
    scene,
    animations,
    onPickerReady,
    hudContent,
    onHudReady,
    onReady,
    onError,
    pannable,
    onViewReady,
  ]);

  useEffect(() => {
    if (status === 'ready') {
      sceneRef.current?.update(
        state,
        blocked,
        animationPreview,
        speechPlayback,
      );
      playbackRef.current?.();
    }
  }, [status, state, blocked, animationPreview, speechPlayback]);

  useEffect(() => {
    if (
      status === 'ready' &&
      animationTrigger?.sceneId === scene.id &&
      animationTrigger.nonce !== lastTrigger.current
    ) {
      lastTrigger.current = animationTrigger.nonce;
      sceneRef.current?.trigger(
        animationTrigger.hotspotId,
        animationTrigger.interaction,
      );
      playbackRef.current?.();
    }
  }, [animationTrigger, status, scene.id]);

  return (
    <div
      className="scene-frame"
      aria-label={`Lokácia: ${scene.title}`}
      tabIndex={pannable ? 0 : undefined}
      aria-description={
        pannable
          ? 'Obraz posunieš potiahnutím, kolieskom alebo šípkami.'
          : undefined
      }
    >
      <div
        className="canvas-host"
        ref={hostRef}
        data-scene-x={camera?.frame.x}
        data-scene-y={camera?.frame.y}
        data-scene-width={camera?.frame.width}
        data-scene-height={camera?.frame.height}
        data-dragging={effects.dragging}
        data-pickups={effects.pickups}
        data-pickup-image={effects.pickupImage}
      />
      {pannable &&
        camera &&
        !panned &&
        !blocked &&
        !state.dialogue &&
        (camera.frame.width > camera.width ||
          camera.frame.height > camera.height) && (
          <span className="scene-pan-hint" aria-hidden="true">
            ↔ Potiahni scénu pre posun
          </span>
        )}
      {hud && hudLayout && (
        <HudAccessibility
          layout={hudLayout}
          hud={hud}
          controller={hudController}
        />
      )}
      {status === 'loading' && (
        <div className="scene-notice" role="status">
          Pripravujem lokáciu…
        </div>
      )}
      {status === 'error' && (
        <div className="scene-notice" role="alert">
          <strong>Scénu sa nepodarilo načítať.</strong>
          <span>Skús obnovenie stránky a prehliadač s podporou WebGL.</span>
          <button onClick={() => window.location.reload()}>
            Obnoviť stránku
          </button>
        </div>
      )}
    </div>
  );
}
