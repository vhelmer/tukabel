import { Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type {
  AnimationDefinition,
  SceneSpeechPlayback,
  AnimationPreviewState,
  AnimationSample,
  AnimationRegion,
  GameState,
  Hotspot,
  SceneCallbacks,
  SceneDefinition,
} from './types';
import { createCharacterVisual, characterClips } from './characterVisual';
import { matches } from './state';
import { createAnimationPlayer, isCharacterSpeaking } from './animation';
import { hitTestLocal, hotspotLocalPoint } from './hitTest';
import type { AlphaMask } from './hitTest';
import type { Point } from './transforms';
import { imagePlacement, radians } from './transforms';

// A background and a few interactive regions, rather than a general game engine.
export function createScene(
  definition: SceneDefinition,
  texture: Texture,
  callbacks: SceneCallbacks,
  render: () => void,
  textures: ReadonlyMap<string, Texture>,
  animations: readonly AnimationDefinition[] = [],
  masks: ReadonlyMap<string, AlphaMask> = new Map(),
) {
  const root = new Container();
  const background = new Sprite(texture);
  background.width = definition.width;
  background.height = definition.height;
  background.eventMode = 'none';
  root.addChild(background);

  const actors: {
    hotspot: Hotspot;
    character: ReturnType<typeof createCharacterVisual>;
    visual: Container;
    player: ReturnType<typeof createAnimationPlayer>;
    hit: {
      frame: string;
      layers: readonly { region: AnimationRegion; mask: AlphaMask }[];
      visual?: Container;
    };
  }[] = [];
  let state: GameState | null = null;
  let paused = false;
  let preview: AnimationPreviewState | undefined;
  let blinkNonce = 0;
  let speechPlayback: SceneSpeechPlayback | undefined;
  const speechFor = (hotspot: Hotspot) => {
    if (!speechPlayback)
      return (
        preview?.speech ?? (state ? isCharacterSpeaking(hotspot, state) : false)
      );
    const actor = speechPlayback.actor;
    return (
      actor
        ? actor.sceneId === definition.id && actor.hotspotId === hotspot.id
        : state && isCharacterSpeaking(hotspot, state)
    )
      ? speechPlayback.read()
      : false;
  };
  let pointer: Point | null = null;
  let hovered: Hotspot | null = null;
  const hover = (hotspot: Hotspot | null) => {
    if (hotspot?.id === hovered?.id) return;
    hovered = hotspot;
    callbacks.onHover(hotspot);
  };
  const regions = new Map<string, Container>();
  const hits = new Map<
    string,
    { contains: (x: number, y: number) => boolean }
  >();
  const indicators = new Map<string, Graphics>();
  for (const hotspot of definition.hotspots) {
    const { x, y, width, height } = hotspot.bounds;
    const region = new Container();
    region.pivot.set(width / 2, height / 2);
    region.position.set(x + width / 2, y + height / 2);
    region.rotation = radians(hotspot.rotation ?? 0);
    region.eventMode = 'static';
    region.cursor = 'none';
    const hit: {
      frame: string;
      layers: readonly { region: AnimationRegion; mask: AlphaMask }[];
      visual?: Container;
    } = {
      frame: hotspot.image ?? '',
      layers: [],
    };
    const hitArea = {
      contains: (x: number, y: number) =>
        hitTestLocal(
          hotspot,
          { x, y },
          masks.get(hit.frame),
          hit.visual
            ? {
                rotation: (hit.visual.rotation * 180) / Math.PI,
                scaleX: hit.visual.scale.x,
                scaleY: hit.visual.scale.y,
              }
            : undefined,
          hit.layers,
        ),
    };
    region.hitArea = hitArea;
    hits.set(hotspot.id, hitArea);

    if (hotspot.image) {
      const base = textures.get(hotspot.image)!;
      const character = createCharacterVisual(
        hotspot.image,
        textures,
        characterClips(hotspot.animation, animations),
      );
      const placement = imagePlacement(
        { x: 0, y: 0, width, height },
        base.orig,
        hotspot.imageFit,
      );
      character.root.position.set(placement.x, placement.y);
      character.root.scale.set(
        placement.width / base.orig.width,
        placement.height / base.orig.height,
      );
      const visual = new Container();
      visual.pivot.set(width / 2, height);
      visual.position.set(width / 2, height);
      hit.visual = visual;
      visual.eventMode = 'none';
      visual.addChild(character.root);
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
          character,
          visual,
          player: createAnimationPlayer(hotspot.animation, animations),
          hit,
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
    region.on('pointerover', () => hover(hotspot));
    region.on('pointerout', () => hover(null));
    region.on('pointertap', (event) => {
      if (event.button === 0) callbacks.onInteract(hotspot);
    });
    regions.set(hotspot.id, region);
    root.addChild(region);
  }

  function apply(actor: (typeof actors)[number], sample: AnimationSample) {
    actor.character.apply(sample);
    actor.hit.frame = sample.frame ?? actor.hotspot.image!;
    actor.hit.layers = (sample.layers ?? []).flatMap((layer) => {
      const mask = masks.get(layer.frame);
      return mask ? [{ region: layer.region, mask }] : [];
    });
  }
  // The same predicate serves Pixi, inventory drops and stationary hover.
  function pick(point: Point): Hotspot | null {
    if (!state || state.dialogue) return null;
    for (let i = definition.hotspots.length - 1; i >= 0; i--) {
      const hotspot = definition.hotspots[i]!;
      if (!regions.get(hotspot.id)?.visible) continue;
      const local = hotspotLocalPoint(hotspot, point);
      if (hits.get(hotspot.id)!.contains(local.x, local.y)) return hotspot;
    }
    return null;
  }
  function syncHover() {
    hover(pointer && !paused ? pick(pointer) : null);
  }

  return {
    root,
    hoverAt(point: Point | null) {
      pointer = point;
      syncHover();
    },
    pick,
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
        const sample =
          preview?.sample ??
          actor.player.tick(deltaMs, speechFor(actor.hotspot));
        apply(actor, sample);
        if (actor.hotspot.animation?.motion === 'breath')
          actor.visual.scale.y =
            1 + Math.sin((sample.elapsedMs * Math.PI * 2) / 3200) * 0.012;
        if (actor.hotspot.animation?.motion === 'sway')
          actor.visual.rotation =
            Math.sin((sample.elapsedMs * Math.PI * 2) / 4000) * 0.015;
      }
      syncHover();
    },
    resetMotion() {
      for (const actor of actors) {
        actor.visual.scale.set(1);
        actor.visual.rotation = 0;
        apply(actor, preview?.sample ?? { elapsedMs: 0, priority: 'base' });
      }
      syncHover();
      render();
    },
    update(
      nextState: GameState,
      blocked = false,
      nextPreview?: AnimationPreviewState,
      nextSpeech?: SceneSpeechPlayback,
    ) {
      state = nextState;
      preview = nextPreview;
      speechPlayback = nextSpeech;
      for (const actor of actors) {
        actor.character.showRegions(preview?.showRegions ?? false);
        if (preview?.blinkNonce && preview.blinkNonce !== blinkNonce)
          actor.player.blink();
        apply(
          actor,
          preview?.sample ?? actor.player.tick(0, speechFor(actor.hotspot)),
        );
      }
      blinkNonce = preview?.blinkNonce ?? 0;
      paused = blocked;
      for (const hotspot of definition.hotspots) {
        const region = regions.get(hotspot.id)!;
        region.visible = matches(state, hotspot.visibleWhen);
        region.eventMode = state.dialogue || blocked ? 'none' : 'static';
        const indicator = indicators.get(hotspot.id);
        if (indicator) indicator.visible = matches(state, hotspot.tintWhen);
      }
      syncHover();
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
