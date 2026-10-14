export function scenePoint(
  rect: { left: number; top: number; width: number; height: number },
  scene: { width: number; height: number },
  clientX: number,
  clientY: number,
) {
  const scale = Math.min(rect.width / scene.width, rect.height / scene.height);
  if (scale <= 0) return null;
  const x =
    (clientX - rect.left - (rect.width - scene.width * scale) / 2) / scale;
  const y =
    (clientY - rect.top - (rect.height - scene.height * scale) / 2) / scale;
  return x >= 0 && y >= 0 && x <= scene.width && y <= scene.height
    ? { x, y }
    : null;
}
