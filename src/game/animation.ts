import type {
  AnimationDefinition,
  CharacterAnimation,
  Hotspot,
  GameState,
} from './types';

export function frameAt(
  clip: AnimationDefinition,
  elapsedMs: number,
  loop = true,
): string {
  const position = Math.floor((Math.max(0, elapsedMs) * clip.fps) / 1000);
  return clip.frames[
    loop
      ? position % clip.frames.length
      : Math.min(position, clip.frames.length - 1)
  ]!;
}

export function isCharacterSpeaking(
  hotspot: Hotspot,
  state: GameState,
): boolean {
  if (!state.dialogue) return false;
  if (hotspot.animation?.dialogueId)
    return hotspot.animation.dialogueId === state.dialogue.id;
  return (
    hotspot.actions.talk?.some((rule) =>
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
  return {
    tick(
      deltaMs: number,
      speaking: boolean,
    ): {
      frame?: string;
      priority: 'base' | 'idle' | 'blink' | 'talk';
      elapsedMs: number;
    } {
      idleTime += deltaMs;
      if (speaking && talk) {
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
      if (blinkTime !== null && blink) {
        blinkTime += deltaMs;
        if (blinkTime >= (blink.frames.length * 1000) / blink.fps) {
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
          ? frameAt(idle, idleTime, binding.idleLoop ?? true)
          : undefined,
        priority: idle ? 'idle' : 'base',
        elapsedMs: idleTime,
      };
    },
  };
}
