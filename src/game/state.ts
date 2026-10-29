import type {
  Condition,
  Effect,
  GameAction,
  GameContent,
  GameState,
  Rule,
} from './types';

export function initialState(content: GameContent): GameState {
  const opening = content.dialogues.find(
    (dialogue) => dialogue.id === content.startDialogue,
  );
  return syncLocations(
    content,
    syncTasks(content, {
      sceneId: content.startScene,
      unlockedScenes: [],
      inventory: [],
      flags: {},
      tasks: {},
      dialogue: opening ? { id: opening.id, nodeId: opening.start } : null,
      message: content.initialMessage,
    }),
  );
}

export function matches(state: GameState, condition?: Condition): boolean {
  if (!condition) return true;
  if ('flag' in condition)
    return (state.flags[condition.flag] ?? false) === (condition.value ?? true);
  if ('item' in condition) return state.inventory.includes(condition.item);
  if ('all' in condition)
    return condition.all.every((child) => matches(state, child));
  return !matches(state, condition.not);
}

export function getEnding(content: GameContent, state: GameState) {
  return content.endings?.find((ending) => matches(state, ending.when));
}

// Journal entries latch once discovered/completed, even if an item is consumed
// or a condition later becomes false. Definitions never become player state.
export function syncTasks(content: GameContent, state: GameState): GameState {
  let tasks = state.tasks;
  for (const task of content.tasks ?? []) {
    const current = Object.hasOwn(tasks, task.id) ? tasks[task.id] : undefined;
    if (current === 'completed') continue;
    const next =
      task.completeWhen && matches(state, task.completeWhen)
        ? 'completed'
        : (current ??
          (task.startWhen && matches(state, task.startWhen)
            ? 'active'
            : undefined));
    if (next && next !== current) {
      if (tasks === state.tasks) tasks = { ...tasks };
      tasks[task.id] = next;
    }
  }
  return tasks === state.tasks ? state : { ...state, tasks };
}

// Discovery survives consumed items and later changes to authoring conditions.
export function syncLocations(
  content: GameContent,
  state: GameState,
): GameState {
  let unlockedScenes = state.unlockedScenes;
  const unlock = (id: string) => {
    if (unlockedScenes.includes(id)) return;
    if (unlockedScenes === state.unlockedScenes)
      unlockedScenes = [...unlockedScenes];
    unlockedScenes.push(id);
  };
  unlock(content.startScene);
  unlock(state.sceneId);
  for (const point of content.worldMap?.points ?? [])
    if (point.unlockWhen && matches(state, point.unlockWhen))
      unlock(point.sceneId);
  return unlockedScenes === state.unlockedScenes
    ? state
    : { ...state, unlockedScenes };
}

export function canTravel(
  content: GameContent,
  state: GameState,
  sceneId: string,
): boolean {
  return (
    !state.dialogue &&
    sceneId !== state.sceneId &&
    state.unlockedScenes.includes(sceneId) &&
    !!content.worldMap?.points.some(
      (point) => point.sceneId === sceneId && point.fastTravel !== false,
    )
  );
}

function applyEffects(
  content: GameContent,
  state: GameState,
  effects: readonly Effect[] = [],
): GameState {
  const next: GameState = {
    ...state,
    unlockedScenes: [...state.unlockedScenes],
    inventory: [...state.inventory],
    flags: { ...state.flags },
    tasks: { ...state.tasks },
  };
  for (const effect of effects) {
    switch (effect.type) {
      case 'flag':
        next.flags[effect.id] = effect.value;
        break;
      case 'addItem':
        if (!next.inventory.includes(effect.id)) next.inventory.push(effect.id);
        break;
      case 'removeItem':
        next.inventory = next.inventory.filter((id) => id !== effect.id);
        break;
      case 'scene':
        next.sceneId = effect.id;
        next.dialogue = null;
        if (!next.unlockedScenes.includes(effect.id))
          next.unlockedScenes.push(effect.id);
        break;
      case 'unlockScene':
        if (!next.unlockedScenes.includes(effect.id))
          next.unlockedScenes.push(effect.id);
        break;
      case 'dialogue': {
        const dialogue = content.dialogues.find(
          (entry) => entry.id === effect.id,
        )!;
        next.dialogue = { id: dialogue.id, nodeId: dialogue.start };
        break;
      }
      case 'startTask':
        if (!Object.hasOwn(next.tasks, effect.id))
          next.tasks[effect.id] = 'active';
        break;
      case 'completeTask':
        next.tasks[effect.id] = 'completed';
        break;
    }
  }
  return next;
}

function runRules(
  content: GameContent,
  state: GameState,
  rules: readonly Rule[] = [],
  fallback: string,
): GameState {
  const rule = rules.find((entry) => matches(state, entry.when));
  return rule
    ? {
        ...applyEffects(content, state, rule.effects),
        message: rule.message ?? '',
      }
    : { ...state, message: fallback };
}

export function getDialogueNode(content: GameContent, state: GameState) {
  const dialogue = content.dialogues.find(
    (entry) => entry.id === state.dialogue?.id,
  );
  return dialogue?.nodes.find((node) => node.id === state.dialogue?.nodeId);
}

function reduceAction(
  content: GameContent,
  state: GameState,
  action: GameAction,
): GameState {
  if (action.type === 'closeDialogue') return { ...state, dialogue: null };
  if (action.type === 'choose') {
    if (
      action.from &&
      (action.from.id !== state.dialogue?.id ||
        action.from.nodeId !== state.dialogue.nodeId)
    )
      return state;
    const choice = getDialogueNode(content, state)?.choices.find(
      (entry) => entry.id === action.choiceId && matches(state, entry.when),
    );
    if (!choice || !state.dialogue) return state;
    const next = {
      ...state,
      dialogue: choice.next ? { ...state.dialogue, nodeId: choice.next } : null,
    };
    return {
      ...applyEffects(content, next, choice.effects),
      message: choice.message ?? state.message,
    };
  }
  // A conversation blocks world actions, including keyboard and stale clicks.
  if (state.dialogue) return state;
  if (action.type === 'travel')
    return canTravel(content, state, action.sceneId)
      ? { ...state, sceneId: action.sceneId, message: '' }
      : state;
  if (action.type === 'inspectItem') {
    const item = content.items.find(
      (entry) =>
        entry.id === action.itemId && state.inventory.includes(entry.id),
    );
    return item ? { ...state, message: item.description } : state;
  }
  if (action.type === 'combine') {
    if (
      action.first === action.second ||
      ![action.first, action.second].every((id) => state.inventory.includes(id))
    )
      return state;
    const combination = content.combinations.find(
      (entry) =>
        entry.items.includes(action.first) &&
        entry.items.includes(action.second),
    );
    return runRules(
      content,
      state,
      combination?.rules,
      'Tieto predmety spolu zatiaľ nič nevymyslia.',
    );
  }
  const scene = content.scenes.find((entry) => entry.id === state.sceneId)!;
  const hotspot = scene.hotspots.find(
    (entry) =>
      entry.id === action.hotspotId &&
      !entry.hidden &&
      (entry.opacity ?? 1) > 0 &&
      !entry.decorative &&
      matches(state, entry.visibleWhen),
  );
  if (!hotspot) return state;
  if (action.itemId) {
    if (!state.inventory.includes(action.itemId)) return state;
    return runRules(
      content,
      state,
      hotspot.uses?.[action.itemId],
      'Toto tu nepomôže. Predmet si radšej nechám.',
    );
  }
  return runRules(content, state, hotspot.onClick, '');
}

export function reduceGame(
  content: GameContent,
  state: GameState,
  action: GameAction,
): GameState {
  if (getEnding(content, state)) return state;
  const next = reduceAction(content, state, action);
  return next === state
    ? state
    : syncLocations(content, syncTasks(content, next));
}
