import { useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

// A browser can suppress the compatibility click immediately after a touch drag.
// Activate a genuine touch tap on pointerup and consume its optional click once.
// Mouse, pen and keyboard continue to use the native button click.
export function useButtonActivation(activate: () => void) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const handledTouch = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      handledTouch.current = false;
      start.current =
        event.pointerType === 'touch' && event.isPrimary
          ? { id: event.pointerId, x: event.clientX, y: event.clientY }
          : null;
    },
    onPointerCancel: () => {
      start.current = null;
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const origin = start.current;
      if (
        origin &&
        origin.id === event.pointerId &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8
      )
        start.current = null;
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const origin = start.current;
      start.current = null;
      if (
        !origin ||
        origin.id !== event.pointerId ||
        event.currentTarget.disabled
      )
        return;
      const box = event.currentTarget.getBoundingClientRect();
      if (
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8 ||
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        return;
      handledTouch.current = true;
      event.preventDefault();
      activate();
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.currentTarget.disabled) return;
      if (event.detail > 0 && handledTouch.current) {
        handledTouch.current = false;
        return;
      }
      handledTouch.current = false;
      activate();
    },
  };
}
