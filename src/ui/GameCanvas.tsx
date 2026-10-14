import { useEffect, useRef, useState } from 'react';
import { Application, Assets } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { createScene } from '../game/createScene';
import type { SceneCallbacks, SceneDefinition } from '../game/types';

interface GameCanvasProps extends SceneCallbacks {
  scene: SceneDefinition;
  hoveredId: string | null;
  selectedId: string | null;
  showHotspots: boolean;
}

export function GameCanvas(props: GameCanvasProps) {
  return <MountedCanvas key={props.scene.id} {...props} />;
}

function MountedCanvas({
  scene,
  hoveredId,
  selectedId,
  showHotspots,
  onHover,
  onInteract,
}: GameCanvasProps) {
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

    const destroy = () => {
      observer?.disconnect();
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
        const texture = await Assets.load<Texture>(scene.background);
        if (disposed) return;
        const mountedScene = createScene(
          scene,
          texture,
          { onHover, onInteract },
          () => app.render(),
        );
        sceneRef.current = mountedScene;
        app.stage.addChild(mountedScene.root);
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
  }, [scene, onHover, onInteract]);

  useEffect(() => {
    if (status === 'ready')
      sceneRef.current?.highlight(hoveredId, selectedId, showHotspots);
  }, [hoveredId, selectedId, showHotspots, status]);

  return (
    <div className="scene-frame" aria-label={`Lokácia: ${scene.title}`}>
      <div className="canvas-host" ref={hostRef} />
      {status === 'loading' && (
        <div className="scene-notice" role="status">
          Pripravujem skúšobňu…
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
