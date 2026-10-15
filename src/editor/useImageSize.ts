import { useEffect, useState } from 'react';
import { assetUrl } from '../game/assets';

export function useImageSize(asset?: string) {
  const url = asset ? assetUrl(asset) : '';
  const [loaded, setLoaded] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  useEffect(() => {
    if (!url) return;
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
  return loaded?.url === url ? loaded : undefined;
}
