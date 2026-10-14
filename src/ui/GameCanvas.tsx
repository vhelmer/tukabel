import { useEffect, useRef, useState } from 'react';
import { Application, Assets } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { createScene } from '../game/createScene';
import type {
  AnimationDefinition,
  GameState,
  SceneCallbacks,
  SceneDefinition,
} from '../game/types';

interface GameCanvasProps extends SceneCallbacks {
  scene: SceneDefinition;
  state: GameState;
  animations?: readonly AnimationDefinition[];
  blocked?: boolean;
  hoveredId: string | null;
  selectedId: string | null;
  showHotspots: boolean;
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
  hoveredId,
  selectedId,
  showHotspots,
  onHover,
  onInteract,
}: GameCanvasProps) {
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
    let observer: ResizeObserver | undefined;
    let stopPlayback: (() => void) | undefined;

    const destroy = () => {
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
          background: '#172823',
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
                  ].includes(animation.id),
                ),
              )
              .flatMap((animation) => animation.frames),
            ...scene.hotspots.flatMap((hotspot) =>
              hotspot.image ? [hotspot.image] : [],
            ),
          ]),
        ];
        const loaded = await Promise.all(
          urls.map(
            async (url) => [url, await Assets.load<Texture>(url)] as const,
          ),
        );
        const textures = new Map(loaded);
        const texture = textures.get(scene.background)!;
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
        );
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
        playbackRef.current = syncPlayback;
        reducedMotion.addEventListener('change', syncPlayback);
        document.addEventListener('visibilitychange', syncPlayback);
        stopPlayback = () => {
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
        };
        observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();
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
  }, [scene, animations]);

  useEffect(() => {
    if (status === 'ready') {
      sceneRef.current?.update(state, blocked);
      sceneRef.current?.highlight(hoveredId, selectedId, showHotspots);
      playbackRef.current?.();
    }
  }, [hoveredId, selectedId, showHotspots, status, state, blocked]);

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
