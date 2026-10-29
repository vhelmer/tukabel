import type {
  AnimationDefinition,
  CharacterAnimation,
  Hotspot,
  GameState,
  AnimationSample,
  AnimationLayer,
  SpeechPlayback,
} from './types';

export function frameDuration(
  clip: AnimationDefinition,
  index: number,
): number {
  return (clip.durationsMs?.[index] ?? 1000 / clip.fps) / (clip.speed ?? 1);
}
export function clipDuration(clip: AnimationDefinition): number {
  return clip.frames.reduce((sum, _, i) => sum + frameDuration(clip, i), 0);
}
export function frameAt(
  clip: AnimationDefinition,
  elapsedMs: number,
  loop = clip.loop ?? true,
): string {
  const duration = clipDuration(clip);
  let time = Math.max(0, elapsedMs);
  if (loop) time %= duration;
  else if (time >= duration) return clip.frames.at(-1)!;
  for (let i = 0; i < clip.frames.length; i++) {
    time -= frameDuration(clip, i);
    if (time < 0) return clip.frames[i]!;
  }
  return clip.frames.at(-1)!;
}

export function isCharacterSpeaking(
  hotspot: Hotspot,
  state: GameState,
): boolean {
  if (!state.dialogue) return false;
  if (hotspot.animation?.dialogueId)
    return hotspot.animation.dialogueId === state.dialogue.id;
  return (
    hotspot.onClick.some((rule) =>
      rule.effects?.some(
        (effect) =>
          effect.type === 'dialogue' && effect.id === state.dialogue?.id,
      ),
    ) ?? false
  );
}

// Visual state only. This clock never mutates or gets serialized with player progress.
function createLegacyPlayer(
  binding: CharacterAnimation,
  clips: readonly AnimationDefinition[],
  random = Math.random,
) {
  const find = (id?: string) => clips.find((clip) => clip.id === id);
  const idle = find(binding.idle);
  const blink = find(binding.blink);
  const talk = find(binding.talk);
  const interval = binding.blinkIntervalMs ?? [3000, 7000];
  const delay = () => interval[0] + random() * (interval[1] - interval[0]);
  let idleTime = 0;
  let talkTime = 0;
  let blinkTime: number | null = null;
  let untilBlink = delay();
  let wasSpeaking = false;
  let interaction: { clip: AnimationDefinition; time: number } | null = null;
  return {
    blink() {
      if (blink) {
        blinkTime = 0;
        untilBlink = delay();
      }
    },
    trigger(kind: 'click' | 'use') {
      const clip = find(kind === 'click' ? binding.onClick : binding.onUse);
      if (clip) {
        interaction = { clip, time: 0 };
        blinkTime = null;
        untilBlink = delay();
      }
    },
    tick(
      deltaMs: number,
      speaking: boolean,
    ): {
      frame?: string;
      priority: 'base' | 'idle' | 'blink' | 'talk' | 'interaction';
      elapsedMs: number;
    } {
      idleTime += deltaMs;
      if (speaking && talk) {
        interaction = null;
        talkTime = wasSpeaking ? talkTime + deltaMs : 0;
        wasSpeaking = true;
        blinkTime = null;
        return {
          frame: frameAt(talk, talkTime),
          priority: 'talk',
          elapsedMs: idleTime,
        };
      }
      if (wasSpeaking) {
        wasSpeaking = false;
        untilBlink = delay();
      }
      if (interaction) {
        interaction.time += deltaMs;
        if (interaction.time < clipDuration(interaction.clip))
          return {
            frame: frameAt(interaction.clip, interaction.time, false),
            priority: 'interaction',
            elapsedMs: idleTime,
          };
        interaction = null;
        untilBlink = delay();
      }
      if (blinkTime !== null && blink) {
        blinkTime += deltaMs;
        if (blinkTime >= clipDuration(blink)) {
          blinkTime = null;
          untilBlink = delay();
        }
      } else if (blink) {
        untilBlink -= deltaMs;
        if (untilBlink <= 0) blinkTime = 0;
      }
      if (blinkTime !== null && blink)
        return {
          frame: frameAt(blink, blinkTime, false),
          priority: 'blink',
          elapsedMs: idleTime,
        };
      return {
        frame: idle
          ? frameAt(idle, idleTime, binding.idleLoop ?? idle.loop ?? true)
          : undefined,
        priority: idle ? 'idle' : 'base',
        elapsedMs: idleTime,
      };
    },
  };
}

// Local clips have separate clocks. Full-frame legacy clips remain a base layer;
// they cannot erase regional eyes/mouth, which are composed above that base.
export function createAnimationPlayer(
  binding: CharacterAnimation,
  clips: readonly AnimationDefinition[],
  random = Math.random,
) {
  const find = (id?: string) => clips.find((clip) => clip.id === id);
  const regional = (id?: string) => {
    const clip = find(id);
    return clip?.region ? clip : undefined;
  };
  const baseBinding = { ...binding };
  for (const key of ['idle', 'blink', 'talk', 'onClick', 'onUse'] as const)
    if (regional(binding[key])) delete baseBinding[key];
  const base = createLegacyPlayer(baseBinding, clips, random);
  const blink = regional(binding.blink),
    talk = regional(binding.talk),
    idle = regional(binding.idle);
  const gesture = find(binding.gesture);
  const gestureInterval = binding.gestureIntervalMs ?? [2000, 5000];
  const gestureDelay = () =>
    gestureInterval[0] + random() * (gestureInterval[1] - gestureInterval[0]);
  let untilGesture = gestureDelay();
  let gestureTime: number | null = null;
  let gestureBlocked = false;
  const interval = binding.blinkIntervalMs ?? [3000, 7000];
  const delay = () => interval[0] + random() * (interval[1] - interval[0]);
  let elapsed = 0,
    talkTime = 0,
    wasSpeaking = false,
    blinkTime: number | null = null,
    untilBlink = delay();
  let reaction: { clip: AnimationDefinition; time: number } | null = null;
  return {
    blink() {
      if (blink) blinkTime = 0;
      else base.blink();
    },
    trigger(kind: 'click' | 'use') {
      if (find(kind === 'click' ? binding.onClick : binding.onUse)) {
        gestureTime = null;
        untilGesture = gestureDelay();
      }
      const clip = regional(kind === 'click' ? binding.onClick : binding.onUse);
      if (clip) reaction = { clip, time: 0 };
      else base.trigger(kind);
    },
    tick(deltaMs: number, speech: boolean | SpeechPlayback): AnimationSample {
      const speaking = typeof speech === 'boolean' ? speech : speech.active;
      const sample = base.tick(deltaMs, speaking);
      elapsed += deltaMs;
      const layers: AnimationLayer[] = [];
      const add = (
        clip: AnimationDefinition,
        time: number,
        loop?: boolean,
        frameIndex?: number,
      ) =>
        layers.push({
          clipId: clip.id,
          region: clip.region!,
          frame:
            frameIndex === undefined
              ? frameAt(clip, time, loop)
              : clip.frames[
                  Math.max(
                    0,
                    Math.min(clip.frames.length - 1, Math.floor(frameIndex)),
                  )
                ]!,
        });
      if (idle) add(idle, elapsed, binding.idleLoop ?? idle.loop ?? true);
      if (blinkTime !== null && blink) {
        blinkTime += deltaMs;
        if (blinkTime >= clipDuration(blink)) {
          blinkTime = null;
          untilBlink = delay();
        }
      } else if (blink) {
        untilBlink -= deltaMs;
        if (untilBlink <= 0) blinkTime = 0;
      }
      if (blink && blinkTime !== null) add(blink, blinkTime, false);
      if (speaking) {
        talkTime = wasSpeaking ? talkTime + deltaMs : 0;
        const time =
          typeof speech === 'boolean' ? talkTime : Math.max(0, speech.timeMs);
        const index =
          typeof speech === 'boolean' ? undefined : speech.frameIndex;
        if (talk) add(talk, time, undefined, index);
        else if (sample.priority === 'talk' && typeof speech !== 'boolean') {
          const full = find(binding.talk)!;
          sample.frame =
            index === undefined
              ? frameAt(full, time)
              : full.frames[
                  Math.max(
                    0,
                    Math.min(full.frames.length - 1, Math.floor(index)),
                  )
                ]!;
        }
      }
      wasSpeaking = speaking;
      if (reaction) {
        reaction.time += deltaMs;
        if (reaction.time >= clipDuration(reaction.clip)) reaction = null;
        else add(reaction.clip, reaction.time, false);
      }
      // Full-frame speech/reactions own the base. Local eyes and mouth continue
      // independently above a gesture, including changes to the body's alpha.
      const blocked =
        sample.priority === 'talk' ||
        sample.priority === 'interaction' ||
        sample.priority === 'blink' ||
        !!reaction;
      if (gesture) {
        if (blocked || gestureBlocked) {
          gestureTime = null;
          untilGesture = gestureDelay();
        } else if (gestureTime !== null) {
          gestureTime += deltaMs;
          if (gestureTime >= clipDuration(gesture)) {
            gestureTime = null;
            untilGesture = gestureDelay();
          }
        } else {
          untilGesture -= deltaMs;
          if (untilGesture <= 0) gestureTime = 0;
        }
        if (gestureTime !== null) {
          if (gesture.region) add(gesture, gestureTime, false);
          else sample.frame = frameAt(gesture, gestureTime, false);
        }
      }
      gestureBlocked = blocked;
      return { ...sample, layers, elapsedMs: elapsed };
    },
  };
}

// Smooth, seemingly random wandering for decorative layers such as clouds.
// Incommensurate sine waves never repeat visibly and never jump; the hotspot
// ID seeds the phases so neighbouring layers drift independently.
export const DRIFT_RANGE = { x: 70, y: 6 };
export function driftOffset(seed: string, elapsedMs: number) {
  let hash = 2166136261;
  for (const char of seed)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const unit = (shift: number) => ((hash >>> shift) & 0xff) / 255;
  const t = elapsedMs / 1000;
  const wave = (period: number, phase: number) =>
    Math.sin((t / period + phase) * Math.PI * 2);
  return {
    x:
      DRIFT_RANGE.x *
      (0.65 * wave(60 + unit(0) * 30, unit(8)) +
        0.35 * wave(23 + unit(16) * 11, unit(24))),
    y: DRIFT_RANGE.y * wave(17 + unit(4) * 9, unit(12)),
  };
}
