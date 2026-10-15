import { assetUrl } from '../game/assets';
import { useImageSize } from './useImageSize';
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
  const size = useImageSize(asset);
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
