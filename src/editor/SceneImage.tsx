import { useEffect, useState } from 'react';
import { assetUrl } from '../game/assets';
import { imagePlacement } from '../game/transforms';
import type { Bounds } from '../game/transforms';
import type { Hotspot } from '../game/types';

export function SceneImage({
  asset,
  bounds,
  fit = 'contain',
}: {
  asset: string;
  bounds: Bounds;
  fit?: Hotspot['imageFit'];
}) {
  const url = assetUrl(asset);
  const [loaded, setLoaded] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  useEffect(() => {
    let disposed = false;
    const image = new Image();
    image.onload = () => {
      if (!disposed)
        setLoaded({
          url,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
    };
    image.src = url;
    return () => {
      disposed = true;
      image.onload = null;
    };
  }, [url]);
  const size = loaded?.url === url ? loaded : undefined;
  return (
    <image
      data-scene-image={asset}
      href={url}
      {...(size ? imagePlacement(bounds, size, fit) : bounds)}
      preserveAspectRatio={size || fit === 'stretch' ? 'none' : 'xMidYMid meet'}
      pointerEvents="none"
    />
  );
}
