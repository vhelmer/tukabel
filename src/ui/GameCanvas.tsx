import { useEffect, useRef, useState } from 'react';
import { Application, Assets } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { scenePoint } from '../game/coordinates';
import { loadAlphaMask } from '../game/alphaMasks';
import type { ScenePicker } from '../game/hitTest';
import { createScene } from '../game/createScene';
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
}: GameCanvasProps) {
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
  const callbacks = useRef({ onHover, onInteract });
  useEffect(() => {
    callbacks.current = { onHover, onInteract };
  }, [onHover, onInteract]);
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
    let observer: ResizeObserver | undefined;
    let stopPlayback: (() => void) | undefined;

    const destroy = () => {
      if (pickerPublished) {
        onPickerReady?.(null);
        pickerPublished = false;
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
        const urls = [
          ...new Set([
            scene.background,
            ...animations
              .filter((animation) =>
                scene.hotspots.some((hotspot) =>
                  [
                    hotspot.animation?.idle,
                    hotspot.animation?.blink,
                    hotspot.animation?.talk,
                    hotspot.animation?.onClick,
                    hotspot.animation?.onUse,
                  ].includes(animation.id),
                ),
              )
              .flatMap((animation) => animation.frames),
            ...scene.hotspots.flatMap((hotspot) =>
              hotspot.image ? [hotspot.image] : [],
            ),
          ]),
        ];
        const maskUrls = new Set(
          scene.hotspots.flatMap((hotspot) => {
            if (
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
                  ].includes(clip.id),
                )
                .flatMap((clip) => clip.frames),
            ];
          }),
        );
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
        const mountedScene = createScene(
          scene,
          texture,
          {
            onHover: (hotspot) => callbacks.current.onHover(hotspot),
            onInteract: (hotspot) => callbacks.current.onInteract(hotspot),
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
        const reducedMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        );
        app.ticker.maxFPS = 30;
        app.ticker.add((ticker) =>
          mountedScene.animate(Math.min(100, ticker.deltaMS)),
        );
        const syncPlayback = () => {
          if (
            reducedMotion.matches ||
            document.hidden ||
            !mountedScene.hasActiveAnimations
          )
            app.stop();
          else app.start();
          if (reducedMotion.matches) mountedScene.resetMotion();
        };
        // Keep a scene-space pointer for stationary hover as animation silhouettes
        // change. Reuse the existing animation ticker instead of another ticker.
        let pointer: { x: number; y: number } | null = null;
        const syncPointer = () =>
          mountedScene.hoverAt(
            pointer
              ? scenePoint(
                  app.canvas.getBoundingClientRect(),
                  scene,
                  pointer.x,
                  pointer.y,
                )
              : null,
          );
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

        const resize = () => {
          const width = Math.max(1, host.clientWidth);
          const height = Math.max(1, host.clientHeight);
          app.renderer.resize(width, height);
          mountedScene.resize(width, height);
          syncPointer();
        };
        observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();
        syncPlayback();
        setStatus('ready');
      } catch (error) {
        destroy();
        if (!disposed) {
          console.error('Scene initialization failed:', error);
          setStatus('error');
        }
      }
    };

    void start();
    return () => {
      disposed = true;
      sceneRef.current = null;
      destroy();
    };
  }, [scene, animations, onPickerReady]);

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
    <div className="scene-frame" aria-label={`Lokácia: ${scene.title}`}>
      <div className="canvas-host" ref={hostRef} />
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
