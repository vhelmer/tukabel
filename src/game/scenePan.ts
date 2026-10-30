import type { Point } from './transforms';

// Own only world gestures; inventory drags and modal controls keep their handlers.
export function attachScenePan(
  canvas: HTMLCanvasElement,
  options: {
    canPan: () => boolean;
    blocked: () => boolean;
    blocksPointer: (x: number, y: number) => boolean;
    horizontalOnly: () => boolean;
    pan: (delta: Point) => void;
  },
) {
  let origin: {
    id: number;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
  } | null = null;
  let suppressTap = false;
  const cancel = () => {
    const current = origin;
    origin = null;
    if (current) {
      suppressTap = true;
      if (canvas.hasPointerCapture(current.id))
        canvas.releasePointerCapture(current.id);
    }
  };
  const down = (event: PointerEvent) => {
    if (!event.isPrimary) {
      cancel();
      suppressTap = true;
      return;
    }
    if (event.button !== 0) return;
    suppressTap = false;
    if (
      origin ||
      !options.canPan() ||
      options.blocked() ||
      options.blocksPointer(event.clientX, event.clientY)
    )
      return;
    origin = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    canvas.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!origin || origin.id !== event.pointerId) return;
    if (options.blocked()) {
      cancel();
      return;
    }
    if (
      !suppressTap &&
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= 7
    )
      return;
    suppressTap = true;
    event.preventDefault();
    options.pan({
      x: event.clientX - origin.lastX,
      y: event.clientY - origin.lastY,
    });
    origin.lastX = event.clientX;
    origin.lastY = event.clientY;
  };
  const up = (event: PointerEvent) => {
    if (origin?.id !== event.pointerId) return;
    const id = origin.id;
    origin = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const pointerCancel = (event: PointerEvent) => {
    if (origin?.id === event.pointerId) cancel();
  };
  const wheel = (event: WheelEvent) => {
    if (
      event.ctrlKey ||
      !options.canPan() ||
      options.blocked() ||
      options.blocksPointer(event.clientX, event.clientY)
    )
      return;
    event.preventDefault();
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? canvas.clientHeight
          : 1;
    const horizontal = event.shiftKey || options.horizontalOnly();
    options.pan({
      x: -(horizontal ? event.deltaX || event.deltaY : event.deltaX) * unit,
      y: horizontal ? 0 : -event.deltaY * unit,
    });
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      cancel();
      return;
    }
    if (
      !options.canPan() ||
      options.blocked() ||
      !(event.target instanceof Element) ||
      !canvas.parentElement?.parentElement?.contains(event.target) ||
      event.target.closest('.hud-accessibility')
    )
      return;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: 80, y: 0 },
      ArrowRight: { x: -80, y: 0 },
      ArrowUp: { x: 0, y: 80 },
      ArrowDown: { x: 0, y: -80 },
    };
    if (!delta[event.key]) return;
    event.preventDefault();
    options.pan(delta[event.key]!);
  };
  canvas.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, {
    capture: true,
    passive: false,
  });
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', pointerCancel, true);
  canvas.addEventListener('lostpointercapture', pointerCancel);
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', key);
  return {
    get suppressTap() {
      return suppressTap;
    },
    destroy() {
      cancel();
      canvas.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      canvas.removeEventListener('lostpointercapture', pointerCancel);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
    },
  };
}
