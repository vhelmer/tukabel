import { getEnding, matches } from './state';
import type { GameAction, GameContent, GameState, Rule } from './types';

// Read only the rule accepted for this dispatch. Cues are never reconstructed
// from a rendered or restored player state.
export function getActionSound(
  content: GameContent,
  state: GameState,
  action: GameAction,
  next: GameState,
): string | undefined {
  if (next === state || state.dialogue || getEnding(content, state))
    return undefined;
  let rules: readonly Rule[] | undefined;
  if (action.type === 'combine') {
    if (
      action.first === action.second ||
      ![action.first, action.second].every((id) => state.inventory.includes(id))
    )
      return undefined;
    rules = content.combinations.find(
      (entry) =>
        entry.items.includes(action.first) &&
        entry.items.includes(action.second),
    )?.rules;
  } else if (action.type === 'interact') {
    const hotspot = content.scenes
      .find((scene) => scene.id === state.sceneId)
      ?.hotspots.find(
        (entry) =>
          entry.id === action.hotspotId &&
          !entry.hidden &&
          !entry.decorative &&
          (entry.opacity ?? 1) > 0 &&
          matches(state, entry.visibleWhen),
      );
    if (!hotspot) return undefined;
    if (action.itemId && !state.inventory.includes(action.itemId))
      return undefined;
    rules = action.itemId ? hotspot.uses?.[action.itemId] : hotspot.onClick;
  }
  return rules?.find((rule) => matches(state, rule.when))?.sound;
}
