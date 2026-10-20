import { useMemo } from 'react';
import { GameCanvas } from '../ui/GameCanvas';
import { resolveAssets } from '../game/assets';
import { initialState } from '../game/state';
import type { GameContent } from '../game/types';
const ignore = () => {};
export function SceneLivePreview({
  content,
  sceneId,
}: {
  content: GameContent;
  sceneId: string;
}) {
  const resolved = useMemo(() => resolveAssets(content), [content]);
  const scene = resolved.scenes.find((s) => s.id === sceneId)!;
  const state = useMemo(
    () => ({ ...initialState(content), sceneId }),
    [content, sceneId],
  );
  return (
    <div className="scene-live-preview" aria-label="Živý náhľad vrstiev">
      <GameCanvas
        scene={scene}
        state={state}
        animations={resolved.animations}
        onHover={ignore}
        onInteract={ignore}
      />
    </div>
  );
}
