import type { SceneView } from './sceneView';

export function scenePoint(
  rect: { left: number; top: number; width: number; height: number },
  scene: { width: number; height: number },
  clientX: number,
  clientY: number,
  view?: SceneView,
) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const localX =
    (clientX - rect.left) * ((view?.width ?? rect.width) / rect.width);
  const localY =
    (clientY - rect.top) * ((view?.height ?? rect.height) / rect.height);
  if (
    localX < 0 ||
    localY < 0 ||
    localX > (view?.width ?? rect.width) ||
    localY > (view?.height ?? rect.height)
  )
    return null;
  const scale = view
    ? view.frame.width / scene.width
    : Math.min(rect.width / scene.width, rect.height / scene.height);
  if (scale <= 0) return null;
  const x =
    (localX - (view?.frame.x ?? (rect.width - scene.width * scale) / 2)) /
    scale;
  const y =
    (localY - (view?.frame.y ?? (rect.height - scene.height * scale) / 2)) /
    scale;
  return x >= 0 && y >= 0 && x <= scene.width && y <= scene.height
    ? { x, y }
    : null;
}
