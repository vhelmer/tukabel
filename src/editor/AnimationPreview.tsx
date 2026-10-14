import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
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
    if (!playing || !animation.frames.length) return;
    const timer = window.setInterval(
      () => {
        if (!document.hidden && image.current?.getClientRects().length)
          onIndex((previous) => (previous + 1) % animation.frames.length);
      },
      1000 / Math.max(1, animation.fps),
    );
    return () => window.clearInterval(timer);
  }, [playing, animation.fps, animation.frames.length, onIndex]);
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
        <button aria-pressed={playing} onClick={() => onPlaying(!playing)}>
          {playing ? 'Zastaviť náhľad' : 'Prehrať náhľad'}
        </button>
        <span>
          {current + 1} / {animation.frames.length} · {animation.fps} fps
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
