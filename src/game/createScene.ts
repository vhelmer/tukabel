import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { SceneCallbacks, SceneDefinition } from './types';

// A background and a few interactive regions, rather than a general game engine.
export function createScene(
  definition: SceneDefinition,
  texture: Texture,
  callbacks: SceneCallbacks,
  render: () => void,
) {
  const root = new Container();
  const background = new Sprite(texture);
  background.width = definition.width;
  background.height = definition.height;
  background.eventMode = 'none';
  root.addChild(background);

  const outlines = new Map<string, Graphics>();
  for (const hotspot of definition.hotspots) {
    const { x, y, width, height } = hotspot.bounds;
    const region = new Container();
    region.position.set(x, y);
    region.eventMode = 'static';
    region.cursor = 'pointer';
    region.hitArea = new Rectangle(0, 0, width, height);

    const outline = new Graphics()
      .roundRect(0, 0, width, height, 18)
      .fill({ color: 0xffd16e, alpha: 0.13 })
      .stroke({ color: 0xffd16e, width: 4 });
    outline.eventMode = 'none';
    outline.visible = false;
    region.addChild(outline);
    region.on('pointerover', () => callbacks.onHover(hotspot));
    region.on('pointerout', () => callbacks.onHover(null));
    region.on('pointertap', (event) => {
      if (event.button === 0) callbacks.onInteract(hotspot);
    });
    outlines.set(hotspot.id, outline);
    root.addChild(region);
  }

  return {
    root,
    resize(width: number, height: number) {
      const scale = Math.min(
        width / definition.width,
        height / definition.height,
      );
      root.scale.set(scale);
      root.position.set(
        (width - definition.width * scale) / 2,
        (height - definition.height * scale) / 2,
      );
      render();
    },
    highlight(
      hoveredId: string | null,
      selectedId: string | null,
      showAll: boolean,
    ) {
      for (const [id, outline] of outlines) {
        outline.visible = showAll || id === hoveredId || id === selectedId;
        outline.alpha = id === hoveredId || id === selectedId ? 1 : 0.45;
      }
      render();
    },
  };
}
