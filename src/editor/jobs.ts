import type {
  AnimationDefinition,
  CharacterAnimation,
  Hotspot,
} from '../game/types';
import type { ArtworkResult } from './api';
import type { CodexContext, CodexResult } from './codex';

export interface ArtContext {
  sceneId: string;
  targetId: string;
  label: string;
  fingerprint: string;
  placement: Pick<Hotspot, 'bounds' | 'rotation' | 'imageFit'>;
}
export interface AnimationContext {
  instruction?: string;
  sceneId: string;
  targetId: string;
  source: string;
  binding: CharacterAnimation;
  clips: readonly AnimationDefinition[];
}
export interface AnimationDirection {
  blink: string | null;
  talk: string | null;
  idle: string | null;
  minMs: number;
  maxMs: number;
  motion: 'none' | 'breath' | 'sway';
  notes: string;
}
export type EditorJob = {
  id: string;
  label: string;
  createdAt: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  stage: string;
  error?: string;
  log?: string[];
} & (
  | { kind: 'art'; context: ArtContext; result?: ArtworkResult }
  | { kind: 'codex'; context: CodexContext; result?: CodexResult }
  | {
      kind: 'animation';
      context: AnimationContext;
      result?: AnimationDirection;
    }
);

// Preserve speech/mouth mapping and interaction bindings. A changed talk clip
// must not keep frame indices authored for the previous mouth atlas.
export function directedBinding(
  context: AnimationContext,
  plan: AnimationDirection,
): CharacterAnimation {
  return {
    ...context.binding,
    blink: plan.blink ?? undefined,
    talk: plan.talk ?? undefined,
    idle: plan.idle ?? undefined,
    idleLoop: plan.idle ? true : context.binding.idleLoop,
    blinkIntervalMs: [plan.minMs, plan.maxMs],
    motion: plan.motion === 'none' ? undefined : plan.motion,
    mouthShapes:
      plan.talk === context.binding.talk
        ? context.binding.mouthShapes
        : undefined,
  };
}
export function artFingerprint(
  scene: import('../game/types').SceneDefinition,
  targetId: string,
): string {
  // Ignore unrelated scene edits, but never silently rebase a changed source,
  // its placement, animation or the scene coordinate system.
  return JSON.stringify([
    scene.width,
    scene.height,
    targetId ? scene.hotspots.find((h) => h.id === targetId) : scene.background,
  ]);
}
