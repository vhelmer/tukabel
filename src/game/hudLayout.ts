import type { Bounds } from './transforms';

// CSS-pixel UI coordinates, independent of the location's authored coordinates.
// The scene, pointer conversion and React captions all use this same viewport.
export function gameViewport(
  width: number,
  height: number,
  hud = true,
): Bounds {
  const top = hud ? (height < 420 ? 100 : 126) : 0;
  return { x: 0, y: top, width, height: Math.max(1, height - top) };
}

export function contains(rect: Bounds, x: number, y: number) {
  return (
    x >= rect.x &&
    y >= rect.y &&
    x < rect.x + rect.width &&
    y < rect.y + rect.height
  );
}

export function sceneViewportRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const view = gameViewport(element.clientWidth, element.clientHeight);
  const scaleY = rect.height / element.clientHeight;
  return {
    x: rect.x,
    y: rect.y + view.y * scaleY,
    left: rect.left,
    top: rect.top + view.y * scaleY,
    width: rect.width,
    height: view.height * scaleY,
  };
}
