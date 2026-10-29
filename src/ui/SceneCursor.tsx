import { useEffect, useState } from 'react';
import { frameAt } from '../game/animation';
import type { AnimationDefinition, Hotspot } from '../game/types';
import grab from '../assets/cursors/grab.svg';
import mouth from '../assets/cursors/mouth.svg';
import exit from '../assets/cursors/exit.svg';
import exitDown from '../assets/cursors/exit-down.svg';

export function SceneCursor({
  hotspot,
  clips,
  x,
  y,
}: {
  hotspot: Hotspot;
  clips: readonly AnimationDefinition[];
  x: number;
  y: number;
}) {
  const clip = clips.find((c) => c.id === hotspot.cursorAnimation);
  const [frame, setFrame] = useState<string>();
  useEffect(() => {
    if (!clip) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = performance.now();
    const timer = window.setInterval(() => {
      if (!document.hidden)
        setFrame(frameAt(clip, motion.matches ? 0 : performance.now() - start));
    }, 33);
    return () => window.clearInterval(timer);
  }, [clip]);
  const kind =
    hotspot.cursor && hotspot.cursor !== 'auto'
      ? hotspot.cursor
      : hotspot.openMap
        ? 'exit'
        : hotspot.onClick.some((rule) =>
              rule.effects?.some((e) => e.type === 'dialogue'),
            )
          ? 'talk'
          : 'interact';
  const src = clip ? (frame ?? clip.frames[0]) : hotspot.cursorImage;
  return (
    <div
      className={`scene-cursor ${!src && kind === 'talk' ? 'talk-cursor' : ''}`}
      style={{
        left: x - (hotspot.cursorOffset?.[0] ?? 0),
        top: y - (hotspot.cursorOffset?.[1] ?? 0),
        width: hotspot.cursorSize ?? 40,
        height: hotspot.cursorSize ?? 40,
      }}
      aria-hidden="true"
      data-cursor-kind={kind}
    >
      <img
        src={
          src ??
          // The map opens from the bottom edge of every location.
          (kind === 'exit' && hotspot.openMap
            ? exitDown
            : { talk: mouth, interact: grab, exit }[kind])
        }
        alt=""
      />
    </div>
  );
}
