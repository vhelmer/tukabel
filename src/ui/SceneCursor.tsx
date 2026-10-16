import { useEffect, useRef, useState } from 'react';
import { frameAt } from '../game/animation';
import type { AnimationDefinition, Hotspot } from '../game/types';
import hand from '../assets/cursors/hand.svg';
import mouth from '../assets/cursors/mouth.svg';
import exit from '../assets/cursors/exit.svg';

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
      <img src={src ?? { talk: mouth, interact: hand, exit }[kind]} alt="" />
    </div>
  );
}

export interface Pickup {
  id: number;
  itemId: string;
  image?: string;
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
export function PickupFlight({
  pickup,
  onDone,
}: {
  pickup: Pickup;
  onDone: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    const root = element?.closest('.game-window');
    const target = root?.querySelector<HTMLElement>(
      `[data-inventory-id="${pickup.itemId}"]`,
    );
    if (
      !element ||
      !root ||
      !target ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      onDone(pickup.id);
      return;
    }
    const box = root.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const dx = end.x + end.width / 2 - box.x - pickup.x - pickup.width / 2;
    const dy = end.y + end.height / 2 - box.y - pickup.y - pickup.height / 2;
    const animation = element.animate(
      [
        {
          transform: `translate(0,0) rotate(${pickup.rotation}deg) scale(1)`,
          opacity: 1,
          offset: 0,
        },
        {
          transform: `translate(0,-10px) rotate(${pickup.rotation}deg) scale(1.15)`,
          opacity: 0.9,
          offset: 0.2,
        },
        {
          transform: `translate(${dx}px,${dy}px) rotate(0deg) scale(${Math.min(42 / pickup.width, 42 / pickup.height)})`,
          opacity: 0,
          offset: 1,
        },
      ],
      { duration: 680, easing: 'cubic-bezier(.25,.6,.3,1)', fill: 'forwards' },
    );
    const arrival = target.animate(
      [
        { filter: 'brightness(1)' },
        { filter: 'brightness(1.8)' },
        { filter: 'brightness(1)' },
      ],
      { duration: 680 },
    );
    animation.onfinish = () => onDone(pickup.id);
    return () => {
      animation.cancel();
      arrival.cancel();
    };
  }, [pickup, onDone]);
  return (
    <div
      ref={ref}
      className="pickup-flight"
      style={{
        left: pickup.x,
        top: pickup.y,
        width: pickup.width,
        height: pickup.height,
      }}
      aria-hidden="true"
    >
      {pickup.image ? (
        <img src={pickup.image} alt="" />
      ) : (
        <span>{pickup.icon}</span>
      )}
    </div>
  );
}
