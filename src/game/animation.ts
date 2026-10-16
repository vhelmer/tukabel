import type {
  AnimationDefinition,
  CharacterAnimation,
  Hotspot,
  GameState,
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
export function createAnimationPlayer(
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
