import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type {
  AnimationDefinition,
  GameState,
  Hotspot,
  SceneCallbacks,
  SceneDefinition,
} from './types';
import { matches } from './state';
import { createAnimationPlayer, isCharacterSpeaking } from './animation';
import { imagePlacement, radians } from './transforms';

// A background and a few interactive regions, rather than a general game engine.
export function createScene(
  definition: SceneDefinition,
  texture: Texture,
  callbacks: SceneCallbacks,
  render: () => void,
  textures: ReadonlyMap<string, Texture>,
  animations: readonly AnimationDefinition[] = [],
) {
  const root = new Container();
  const background = new Sprite(texture);
  background.width = definition.width;
  background.height = definition.height;
  background.eventMode = 'none';
  root.addChild(background);

  const actors: {
    hotspot: Hotspot;
    sprite: Sprite;
    visual: Container;
    player: ReturnType<typeof createAnimationPlayer>;
    lastFrame: string;
    placement: ReturnType<typeof imagePlacement>;
  }[] = [];
  let state: GameState | null = null;
  let paused = false;
  const regions = new Map<string, Container>();
  const indicators = new Map<string, Graphics>();
  for (const hotspot of definition.hotspots) {
    const { x, y, width, height } = hotspot.bounds;
    const region = new Container();
    region.pivot.set(width / 2, height / 2);
    region.position.set(x + width / 2, y + height / 2);
    region.rotation = radians(hotspot.rotation ?? 0);
    region.eventMode = 'static';
    region.cursor = 'none';
    region.hitArea = new Rectangle(0, 0, width, height);

    if (hotspot.image) {
      const sprite = new Sprite(textures.get(hotspot.image));
      const placement = imagePlacement(
        { x: 0, y: 0, width, height },
        sprite.texture.orig,
        hotspot.imageFit,
      );
      sprite.position.set(placement.x, placement.y);
      sprite.width = placement.width;
      sprite.height = placement.height;
      sprite.eventMode = 'none';
      const visual = new Container();
      visual.pivot.set(width / 2, height);
      visual.position.set(width / 2, height);
      visual.eventMode = 'none';
      visual.addChild(sprite);
      region.addChild(visual);
      if (
        hotspot.animation &&
        [
          hotspot.animation.idle,
          hotspot.animation.blink,
          hotspot.animation.talk,
          hotspot.animation.motion,
          hotspot.animation.onClick,
          hotspot.animation.onUse,
        ].some(Boolean)
      )
        actors.push({
          hotspot,
          sprite,
          visual,
          player: createAnimationPlayer(hotspot.animation, animations),
          lastFrame: hotspot.image,
          placement,
        });
    }
    if (hotspot.tintWhen) {
      const indicator = new Graphics()
        .roundRect(0, height - 18, width, 16, 6)
        .fill(0xb6e582);
      indicator.eventMode = 'none';
      indicator.visible = false;
      indicators.set(hotspot.id, indicator);
      region.addChild(indicator);
    }
    region.on('pointerover', () => callbacks.onHover(hotspot));
    region.on('pointerout', () => callbacks.onHover(null));
    region.on('pointertap', (event) => {
      if (event.button === 0) callbacks.onInteract(hotspot);
    });
    regions.set(hotspot.id, region);
    root.addChild(region);
  }

  return {
    root,
    get hasActiveAnimations() {
      return (
        !paused &&
        actors.some((actor) => regions.get(actor.hotspot.id)?.visible)
      );
    },
    trigger(hotspotId: string, interaction: 'click' | 'use') {
      if (paused || !state) return;
      const actor = actors.find(
        (entry) =>
          entry.hotspot.id === hotspotId && regions.get(hotspotId)?.visible,
      );
      actor?.player.trigger(interaction);
    },
    animate(deltaMs: number) {
      if (!state || paused) return;
      for (const actor of actors) {
        if (!regions.get(actor.hotspot.id)?.visible) continue;
        const sample = actor.player.tick(
          deltaMs,
          isCharacterSpeaking(actor.hotspot, state),
        );
        const frame = sample.frame ?? actor.hotspot.image!;
        if (frame !== actor.lastFrame) {
          const next = textures.get(frame);
          const base = textures.get(actor.hotspot.image!)!;
          actor.sprite.texture =
            next &&
            next.orig.width === base.orig.width &&
            next.orig.height === base.orig.height
              ? next
              : base;
          actor.sprite.width = actor.placement.width;
          actor.sprite.height = actor.placement.height;
          actor.lastFrame = frame;
        }
        if (actor.hotspot.animation?.motion === 'breath')
          actor.visual.scale.y =
            1 + Math.sin((sample.elapsedMs * Math.PI * 2) / 3200) * 0.012;
        if (actor.hotspot.animation?.motion === 'sway')
          actor.visual.rotation =
            Math.sin((sample.elapsedMs * Math.PI * 2) / 4000) * 0.015;
      }
    },
    resetMotion() {
      for (const actor of actors) {
        actor.visual.scale.set(1);
        actor.visual.rotation = 0;
        actor.sprite.texture = textures.get(actor.hotspot.image!)!;
        actor.sprite.width = actor.placement.width;
        actor.sprite.height = actor.placement.height;
        actor.lastFrame = actor.hotspot.image!;
      }
      render();
    },
    update(nextState: GameState, blocked = false) {
      state = nextState;
      paused = blocked;
      for (const hotspot of definition.hotspots) {
        const region = regions.get(hotspot.id)!;
        region.visible = matches(state, hotspot.visibleWhen);
        region.eventMode = state.dialogue || blocked ? 'none' : 'static';
        const indicator = indicators.get(hotspot.id);
        if (indicator) indicator.visible = matches(state, hotspot.tintWhen);
      }
      render();
    },
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
  };
}
