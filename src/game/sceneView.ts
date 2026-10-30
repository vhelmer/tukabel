import type { Bounds, Point } from './transforms';

export interface SceneView {
  width: number;
  height: number;
  frame: Bounds;
}
export interface SceneViewController {
  reveal: (bounds: Bounds) => void;
}
export const minimumSceneWidth = 960;

// Camera placement is transient. The authoring coordinates never change.
export function gameSceneView(
  width: number,
  height: number,
  scene: { width: number; height: number },
  offset: Point = { x: 0, y: 0 },
): SceneView {
  const scale = Math.max(
    Math.min(width / scene.width, height / scene.height),
    minimumSceneWidth / scene.width,
  );
  const w = scene.width * scale,
    h = scene.height * scale;
  const clamp = (size: number, image: number, delta: number) =>
    image <= size
      ? (size - image) / 2
      : Math.max(size - image, Math.min(0, (size - image) / 2 + delta));
  return {
    width,
    height,
    frame: {
      x: clamp(width, w, offset.x),
      y: clamp(height, h, offset.y),
      width: w,
      height: h,
    },
  };
}
export function panSceneView(
  view: SceneView,
  scene: { width: number; height: number },
  delta: Point,
) {
  return gameSceneView(view.width, view.height, scene, {
    x: view.frame.x - (view.width - view.frame.width) / 2 + delta.x,
    y: view.frame.y - (view.height - view.frame.height) / 2 + delta.y,
  });
}
export function visibleSceneFrame(view: SceneView): Bounds {
  const x = Math.max(0, view.frame.x),
    y = Math.max(0, view.frame.y);
  return {
    x,
    y,
    width: Math.max(
      0,
      Math.min(view.width, view.frame.x + view.frame.width) - x,
    ),
    height: Math.max(
      0,
      Math.min(view.height, view.frame.y + view.frame.height) - y,
    ),
  };
}
export function revealInView(
  view: SceneView,
  scene: { width: number; height: number },
  bounds: Bounds,
): SceneView {
  const scale = view.frame.width / scene.width;
  const x = view.frame.x + (bounds.x + bounds.width / 2) * scale;
  const y = view.frame.y + (bounds.y + bounds.height / 2) * scale;
  const targetX = Math.min(view.width - 24, Math.max(24, x));
  const targetY = Math.min(view.height - 24, Math.max(90, y));
  return panSceneView(view, scene, { x: targetX - x, y: targetY - y });
}
