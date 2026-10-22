import type { AnimationDefinition, GameContent } from '../game/types';
import type { Point } from '../game/transforms';
import type { ArtContext } from './jobs';

export type CodexTask = 'blink' | 'talk' | 'blink-talk' | 'ambient';
export interface CodexContext extends ArtContext {
  mode: 'character' | 'scene';
  source: string;
  selection?: readonly Point[];
}
export interface CodexResult {
  source: string;
  sourceSha256: string;
  clips: AnimationDefinition[];
  image?: string;
  manifest: string;
  notes: string;
  assets: string[];
}
export interface CodexStatus {
  available: boolean;
  version: string;
  model: string;
  effort: string;
  message: string;
}

// Both entry points use the ordinary project draft and one undo transaction.
export function applyCodexResult(
  content: GameContent,
  context: CodexContext,
  result: CodexResult,
): GameContent {
  return {
    ...content,
    animations: [...(content.animations ?? []), ...result.clips],
    scenes: content.scenes.map((scene) => {
      if (scene.id !== context.sceneId) return scene;
      if (context.mode === 'scene') {
        const clip = result.clips[0]!;
        return {
          ...scene,
          hotspots: [
            ...scene.hotspots,
            {
              id: clip.id,
              label: context.label,
              ...context.placement,
              image: result.image!,
              onClick: [],
              decorative: true,
              animation: { idle: clip.id, idleLoop: true },
            },
          ],
        };
      }
      return {
        ...scene,
        hotspots: scene.hotspots.map((hotspot) => {
          if (hotspot.id !== context.targetId) return hotspot;
          const animation = { ...hotspot.animation };
          for (const clip of result.clips) {
            if (clip.kind === 'blink') {
              animation.blink = clip.id;
              animation.blinkIntervalMs ??= [3000, 7000];
            } else if (clip.kind === 'talk') {
              animation.talk = clip.id;
              animation.mouthShapes = undefined;
            }
          }
          return { ...hotspot, animation };
        }),
      };
    }),
  };
}
