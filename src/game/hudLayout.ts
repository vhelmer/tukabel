import type { Bounds } from './transforms';

// The HUD is an overlay. It must never reserve space or resize the location.
export function gameViewport(width: number, height: number): Bounds {
  return { x: 0, y: 0, width, height: Math.max(1, height) };
}

export function sceneFrame(
  width: number,
  height: number,
  scene: { width: number; height: number },
): Bounds {
  const scale = Math.min(width / scene.width, height / scene.height);
  return {
    x: (width - scene.width * scale) / 2,
    y: (height - scene.height * scale) / 2,
    width: scene.width * scale,
    height: scene.height * scale,
  };
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
  return element.getBoundingClientRect();
}
