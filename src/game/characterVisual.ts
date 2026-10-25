import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type {
  AnimationDefinition,
  AnimationSample,
  CharacterAnimation,
} from './types';

export function characterClips(
  binding: CharacterAnimation | undefined,
  clips: readonly AnimationDefinition[],
) {
  return clips.filter((clip) =>
    [
      binding?.idle,
      binding?.blink,
      binding?.talk,
      binding?.onClick,
      binding?.onUse,
      binding?.gesture,
    ].includes(clip.id),
  );
}

// Partition the original canvas along region edges. Every pixel is drawn exactly
// once: source/base outside active regions, the selected frame inside them.
// Unlike source-over overlays this also preserves partial alpha and erased pixels.
export function createCharacterVisual(
  source: string,
  textures: ReadonlyMap<string, Texture>,
  clips: readonly AnimationDefinition[],
) {
  const original = textures.get(source)!;
  const { width, height } = original.orig;
  const regions = clips.flatMap((clip) => (clip.region ? [clip.region] : []));
  const xs = [
    ...new Set([0, width, ...regions.flatMap((r) => [r.x, r.x + r.width])]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([0, height, ...regions.flatMap((r) => [r.y, r.y + r.height])]),
  ].sort((a, b) => a - b);
  const root = new Container();
  root.eventMode = 'none';
  const views = new Map<string, Texture>();
  const view = (frame: string, rect: Rectangle) => {
    const key = `${frame}:${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    if (!views.has(key)) {
      const texture = textures.get(frame) ?? original;
      views.set(key, new Texture({ source: texture.source, frame: rect }));
    }
    return views.get(key)!;
  };
  const tiles: { sprite: Sprite; rect: Rectangle; frame: string }[] = [];
  for (let y = 0; y < ys.length - 1; y++)
    for (let x = 0; x < xs.length - 1; x++) {
      const rect = new Rectangle(
        xs[x]!,
        ys[y]!,
        xs[x + 1]! - xs[x]!,
        ys[y + 1]! - ys[y]!,
      );
      const sprite = new Sprite(view(source, rect));
      sprite.position.set(rect.x, rect.y);
      sprite.eventMode = 'none';
      root.addChild(sprite);
      tiles.push({ sprite, rect, frame: source });
    }
  const debug = new Graphics();
  debug.eventMode = 'none';
  debug.visible = false;
  regions.forEach((r, i) =>
    debug
      .rect(r.x, r.y, r.width, r.height)
      .stroke({ color: i % 2 ? 0xeea5ba : 0x86e0c4, width: 2 }),
  );
  root.addChild(debug);
  root.on('destroyed', () => {
    for (const texture of views.values()) texture.destroy(false);
    views.clear();
  });
  return {
    root,
    showRegions(value: boolean) {
      debug.visible = value;
    },
    apply(sample: AnimationSample) {
      for (const tile of tiles) {
        const layer = [...(sample.layers ?? [])]
          .reverse()
          .find(
            ({ region: r }) =>
              tile.rect.x >= r.x &&
              tile.rect.y >= r.y &&
              tile.rect.x + tile.rect.width <= r.x + r.width &&
              tile.rect.y + tile.rect.height <= r.y + r.height,
          );
        const frame = layer?.frame ?? sample.frame ?? source;
        if (frame !== tile.frame) {
          tile.sprite.texture = view(frame, tile.rect);
          tile.frame = frame;
        }
      }
    },
  };
}
