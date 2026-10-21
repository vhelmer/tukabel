import { useEffect, useRef, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { CharacterPreview } from './CharacterPreview';
import { frameDuration } from '../game/animation';
import { assetUrl } from '../game/assets';
import type { AnimationDefinition } from '../game/types';

export function AnimationPreview({
  active,
  animation,
  index,
  onIndex,
  playing,
  onPlaying,
}: {
  active: boolean;
  animation: AnimationDefinition;
  index: number;
  onIndex: Dispatch<SetStateAction<number>>;
  playing: boolean;
  onPlaying: (value: boolean) => void;
}) {
  const image = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing || !animation.frames.length) return;
    const current = Math.min(index, animation.frames.length - 1);
    const duration = frameDuration(animation, current);
    if (!Number.isFinite(duration) || duration < 1) return;
    let timer: number;
    const advance = () => {
      if (
        document.hidden ||
        !image.current?.getClientRects().length ||
        !image.current.querySelector('canvas') ||
        image.current.querySelector('.scene-notice')
      ) {
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
  const binding = useMemo(() => ({ idle: animation.id }), [animation.id]);
  const clips = useMemo(() => [animation], [animation]);
  const sample = useMemo(
    () => ({
      sample: {
        elapsedMs: 0,
        priority: 'base' as const,
        frame: animation.region ? undefined : animation.frames[current],
        layers: animation.region
          ? [
              {
                clipId: animation.id,
                frame: animation.frames[current]!,
                region: animation.region,
              },
            ]
          : [],
      },
    }),
    [animation, current],
  );
  return (
    <div className="animation-preview">
      <div ref={image} className="clip-preview-stage">
        <CharacterPreview
          active={active}
          source={animation.source}
          binding={binding}
          clips={clips}
          preview={sample}
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
          {playing ? 'Zastavit náhled' : 'Přehrát náhled'}
        </button>
        <span>
          {current + 1} / {animation.frames.length} · {animation.speed ?? 1}×
        </span>
      </div>
      <div className="animation-timeline">
        {animation.frames.map((frame, position) => (
          <button
            aria-label={`Snímek ${position + 1}`}
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
