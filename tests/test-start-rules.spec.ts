import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getEnding, reduceGame } from '../src/game/state';
import {
  defaultTestSetup,
  endingFlags,
  setupFromState,
  testStartState,
} from '../src/editor/testStart';
import type { GameContent } from '../src/game/types';

const load = async (): Promise<GameContent> =>
  JSON.parse(await readFile('src/game/content/project.json', 'utf8'));

test('dev test start opens the crypt with every item and plays from there', async () => {
  const content = await load();
  const setup = {
    ...defaultTestSetup(content, 'scene12'),
    flags: ['crypt-open'],
  };
  let state = testStartState(content, setup);
  expect(state.sceneId).toBe('scene12');
  expect(state.inventory).toEqual(content.items.map((item) => item.id));
  expect(state.flags).toEqual({ 'crypt-open': true });
  expect([...state.unlockedScenes].sort()).toEqual(
    content.scenes.map((scene) => scene.id).sort(),
  );
  expect(state.dialogue).toBeNull();
  expect(getEnding(content, state)).toBeUndefined();
  // Tasks follow the chosen flags like in a real playthrough.
  expect(state.tasks).toEqual(
    testStartState(content, { ...setup, inventory: [] }).tasks,
  );
  // The crypt puzzle is immediately playable with the granted items.
  state = reduceGame(content, state, {
    type: 'interact',
    hotspotId: 'object2',
    itemId: 'wrench',
  });
  expect(state.flags['battery-isolated']).toBe(true);
  state = reduceGame(content, state, {
    type: 'interact',
    hotspotId: 'object3',
    itemId: 'rubber-gloves',
  });
  expect(state.flags['cable-recovered']).toBe(true);
  expect(state.inventory).toContain('stolen-cable');
});

test('dev test start drops stale ids, never selects ending flags in bulk and round-trips game state', async () => {
  const content = await load();
  expect([...endingFlags(content)].sort()).toEqual([
    'ending-community',
    'ending-jackpot',
  ]);
  const state = testStartState(content, {
    sceneId: 'missing-scene',
    inventory: ['wrench', 'removed-item'],
    flags: ['crypt-open', 'removed-flag'],
    unlockedScenes: ['scene12', 'removed-scene'],
  });
  expect(state.sceneId).toBe(content.startScene);
  expect(state.inventory).toEqual(['wrench']);
  expect(state.flags).toEqual({ 'crypt-open': true });
  expect(state.unlockedScenes).toContain('scene12');
  expect(state.unlockedScenes).not.toContain('removed-scene');
  const copied = setupFromState({
    ...state,
    flags: { ...state.flags, 'cable-recovered': false },
  });
  expect(copied.flags).toEqual(['crypt-open']);
  const again = testStartState(content, copied);
  expect({
    ...again,
    unlockedScenes: [...again.unlockedScenes].sort(),
  }).toEqual({ ...state, unlockedScenes: [...state.unlockedScenes].sort() });
});
