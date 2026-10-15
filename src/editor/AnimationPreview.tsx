import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { frameDuration } from '../game/animation';
import { assetUrl } from '../game/assets';
import type { AnimationDefinition } from '../game/types';

export function AnimationPreview({
  animation,
  index,
  onIndex,
  playing,
  onPlaying,
}: {
  animation: AnimationDefinition;
  index: number;
  onIndex: Dispatch<SetStateAction<number>>;
  playing: boolean;
  onPlaying: (value: boolean) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const images = animation.frames.map((frame) => {
      const image = new Image();
      image.src = assetUrl(frame);
      return image;
    });
    return () => {
      for (const image of images) image.src = '';
    };
  }, [animation.frames]);

  useEffect(() => {
    if (!playing || !animation.frames.length) return;
    const current = Math.min(index, animation.frames.length - 1);
    const duration = frameDuration(animation, current);
    if (!Number.isFinite(duration) || duration < 1) return;
    let timer: number;
    const advance = () => {
      if (document.hidden || !image.current?.getClientRects().length) {
        timer = window.setTimeout(advance, 100);
        return;
      }
      if (current === animation.frames.length - 1 && animation.loop === false)
        onPlaying(false);
      else onIndex((current + 1) % animation.frames.length);
    };
    timer = window.setTimeout(advance, duration);
    return () => window.clearTimeout(timer);
  }, [playing, animation, index, onIndex, onPlaying]);
  const current = Math.min(index, animation.frames.length - 1);
  return (
    <div className="animation-preview">
      <div className="animation-image">
        <img
          ref={image}
          src={assetUrl(animation.frames[current] ?? animation.source)}
          alt={`Náhľad animácie: snímka ${current + 1}`}
        />
      </div>
      <div className="row-actions">
        <button
          aria-pressed={playing}
          onClick={() => {
            if (!playing && current === animation.frames.length - 1) onIndex(0);
            onPlaying(!playing);
          }}
        >
          {playing ? 'Zastaviť náhľad' : 'Prehrať náhľad'}
        </button>
        <span>
          {current + 1} / {animation.frames.length} · {animation.speed ?? 1}×
        </span>
      </div>
      <div className="animation-timeline">
        {animation.frames.map((frame, position) => (
          <button
            aria-label={`Snímka ${position + 1}`}
            aria-pressed={position === current}
            key={position}
            onClick={() => {
              onPlaying(false);
              onIndex(position);
            }}
          >
            <img src={assetUrl(frame)} alt="" />
            <small>{position + 1}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
