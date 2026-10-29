import type { Hotspot } from '../game/types';

// Behavior follows the prop; geometry, artwork and animation belong to its new layer.
export function copyHotspotBehavior(source: Hotspot, target: Hotspot): Hotspot {
  return {
    ...target,
    ...structuredClone({
      decorative: source.decorative,
      visibleWhen: source.visibleWhen,
      onClick: source.onClick,
      uses: source.uses,
      openMap: source.openMap,
      cursor: source.cursor,
      cursorImage: source.cursorImage,
      cursorAnimation: source.cursorAnimation,
      cursorSize: source.cursorSize,
      cursorOffset: source.cursorOffset,
    }),
  };
}
