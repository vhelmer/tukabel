import { useEffect, useState } from 'react';
import { assetUrl } from '../game/assets';
import { loadAlphaMask } from '../game/alphaMasks';
import type { AlphaMask } from '../game/hitTest';
import type { SceneDefinition } from '../game/types';

export function useAlphaMasks(scene: SceneDefinition) {
  const key = JSON.stringify(
    [
      ...new Set(
        scene.hotspots.flatMap((hotspot) =>
          hotspot.image && hotspot.hitTest !== 'bounds'
            ? [assetUrl(hotspot.image)]
            : [],
        ),
      ),
    ].sort(),
  );
  const [loaded, setLoaded] = useState<{
    key: string;
    masks: ReadonlyMap<string, AlphaMask>;
    error?: string;
  }>();
  useEffect(() => {
    let disposed = false;
    const urls = JSON.parse(key) as string[];
    void Promise.all(
      urls.map(async (url) => [url, await loadAlphaMask(url)] as const),
    )
      .then((entries) => {
        if (!disposed) setLoaded({ key, masks: new Map(entries) });
      })
      .catch((error: unknown) => {
        if (!disposed)
          setLoaded({ key, masks: new Map(), error: String(error) });
      });
    return () => {
      disposed = true;
    };
  }, [key]);
  return {
    masks: loaded?.key === key ? loaded.masks : undefined,
    error: loaded?.key === key ? loaded.error : undefined,
  };
}
