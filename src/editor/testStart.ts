import { initialState, syncLocations, syncTasks } from '../game/state';
import type { Condition, GameContent, GameState } from '../game/types';

// Dev-only starting point for a test run. Never part of project JSON or saves.
export interface TestSetup {
  sceneId: string;
  inventory: readonly string[];
  flags: readonly string[];
  unlockedScenes: readonly string[];
}

function conditionFlags(condition: Condition, into: Set<string>) {
  if ('flag' in condition) into.add(condition.flag);
  else if ('all' in condition)
    for (const child of condition.all) conditionFlags(child, into);
  else if ('not' in condition) conditionFlags(condition.not, into);
}

// Flags that end the game; setting them would open the epilogue instead of a test.
export function endingFlags(content: GameContent): Set<string> {
  const flags = new Set<string>();
  for (const ending of content.endings ?? [])
    conditionFlags(ending.when, flags);
  return flags;
}

export function defaultTestSetup(
  content: GameContent,
  sceneId: string,
): TestSetup {
  return {
    sceneId,
    inventory: content.items.map((item) => item.id),
    flags: [],
    unlockedScenes: content.scenes.map((scene) => scene.id),
  };
}

export function setupFromState(state: GameState): TestSetup {
  return {
    sceneId: state.sceneId,
    inventory: [...state.inventory],
    flags: Object.keys(state.flags).filter((flag) => state.flags[flag]),
    unlockedScenes: [...state.unlockedScenes],
  };
}

// Unknown ids from an older selection are dropped against the current draft.
export function testStartState(
  content: GameContent,
  setup: TestSetup,
): GameState {
  const sceneId = content.scenes.some((scene) => scene.id === setup.sceneId)
    ? setup.sceneId
    : content.startScene;
  return syncLocations(
    content,
    syncTasks(content, {
      ...initialState(content),
      sceneId,
      inventory: content.items
        .map((item) => item.id)
        .filter((id) => setup.inventory.includes(id)),
      flags: Object.fromEntries(
        content.flags
          .filter((flag) => setup.flags.includes(flag))
          .map((flag) => [flag, true]),
      ),
      unlockedScenes: content.scenes
        .map((scene) => scene.id)
        .filter((id) => setup.unlockedScenes.includes(id)),
      tasks: {},
      dialogue: null,
      minigame: null,
      message: '',
    }),
  );
}
