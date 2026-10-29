import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { Texture, FederatedPointerEvent } from 'pixi.js';
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
import {
  createAnimationPlayer,
  driftOffset,
  isCharacterSpeaking,
} from './animation';
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
  background.visible = !definition.backgroundHidden;
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
  const mapIcons = new Map<string, Graphics>();
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const hover = (hotspot: Hotspot | null) => {
    if (hotspot?.id === hovered?.id) return;
    hovered = hotspot;
    for (const [id, icon] of mapIcons)
      icon.visible =
        !paused && !state?.dialogue && (coarse || id === hovered?.id);
    callbacks.onHover(hotspot);
    render();
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
    region.eventMode = hotspot.decorative ? 'none' : 'static';
    region.alpha = hotspot.opacity ?? 1;
    region.cursor = 'inherit';
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
          hotspot.animation.gesture,
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
    if (hotspot.placeholder === true && !hotspot.image) {
      const art = new Container();
      art.eventMode = 'none';
      art.addChild(
        new Graphics()
          .rect(0, 0, width, height)
          .fill(0x283b43)
          .rect(1, 1, Math.max(0, width - 2), Math.max(0, height - 2))
          .stroke({ width: 2, color: 0xdfb671 }),
      );
      const label = new Text({
        text: hotspot.label,
        style: {
          fontFamily: 'Arial, sans-serif',
          fontSize: 24,
          fontWeight: 'bold',
          fill: 0xf6edda,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: Math.max(1, width - 16),
          breakWords: true,
        },
      });
      label.anchor.set(0.5);
      label.position.set(width / 2, height / 2);
      label.scale.set(
        Math.min(
          1,
          Math.max(1, width - 16) / label.width,
          Math.max(1, height - 16) / label.height,
        ),
      );
      art.addChild(label);
      region.addChild(art);
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
    if (hotspot.openMap) {
      const size = Math.min(64, width * 0.8, height * 0.8);
      const icon = new Graphics()
        .poly([8, 13, 16, 9, 28, 14, 36, 10, 36, 31, 28, 35, 16, 30, 8, 34])
        .fill(0xead2a0)
        .stroke({ width: 2, color: 0x493725 })
        .moveTo(16, 9)
        .lineTo(16, 30)
        .moveTo(28, 14)
        .lineTo(28, 35)
        .stroke({ width: 1.5, color: 0x7d6949 });
      icon.pivot.set(22, 22);
      icon.position.set(width / 2, height / 2);
      icon.scale.set(size / 44);
      icon.eventMode = 'none';
      icon.visible = coarse;
      region.addChild(icon);
      mapIcons.set(hotspot.id, icon);
      region.on('pointerdown', (event: FederatedPointerEvent) => {
        if (event.pointerType === 'touch') event.preventDefault();
      });
    }
    region.on('pointerover', () => hover(hotspot));
    region.on('pointerout', () => hover(null));
    region.on('pointertap', (event) => {
      if (event.button === 0) callbacks.onInteract(hotspot);
    });
    regions.set(hotspot.id, region);
    root.addChild(region);
    if (hotspot.clipMask) {
      // The mask lives in location coordinates, so a drifting or rotated
      // layer is clipped against the fixed background (e.g. only the sky).
      const clip = root.addChild(new Sprite(textures.get(hotspot.clipMask)!));
      clip.width = definition.width;
      clip.height = definition.height;
      clip.eventMode = 'none';
      region.mask = clip;
    }
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
      if (hotspot.decorative || !regions.get(hotspot.id)?.visible) continue;
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
        if (actor.hotspot.animation?.motion === 'drift') {
          const offset = driftOffset(actor.hotspot.id, sample.elapsedMs);
          actor.visual.position.set(
            actor.visual.pivot.x + offset.x,
            actor.visual.pivot.y + offset.y,
          );
        }
      }
      syncHover();
    },
    resetMotion() {
      for (const actor of actors) {
        actor.visual.scale.set(1);
        actor.visual.rotation = 0;
        actor.visual.position.copyFrom(actor.visual.pivot);
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
        region.visible =
          !hotspot.hidden &&
          (hotspot.opacity ?? 1) > 0 &&
          matches(state, hotspot.visibleWhen);
        region.eventMode =
          state.dialogue || blocked || hotspot.decorative ? 'none' : 'static';
        const mapIcon = mapIcons.get(hotspot.id);
        if (mapIcon)
          mapIcon.visible =
            !state.dialogue &&
            !blocked &&
            (coarse || hovered?.id === hotspot.id);
        const indicator = indicators.get(hotspot.id);
        if (indicator) indicator.visible = matches(state, hotspot.tintWhen);
      }
      syncHover();
      render();
    },
    resize(width: number, height: number, left = 0, top = 0) {
      const scale = Math.min(
        width / definition.width,
        height / definition.height,
      );
      root.scale.set(scale);
      root.position.set(
        left + (width - definition.width * scale) / 2,
        top + (height - definition.height * scale) / 2,
      );
      render();
    },
  };
}
