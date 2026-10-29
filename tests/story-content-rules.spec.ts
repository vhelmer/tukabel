import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { initialState, reduceGame, canTravel } from '../src/game/state';
import { decodeSave } from '../src/game/storage';
import type { GameAction, GameContent, GameState } from '../src/game/types';
const read = async () =>
  JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
const serializeSave = (content: GameContent, state: GameState) =>
  JSON.stringify({ version: 1, contentId: content.id, state });
const deserializeSave = (content: GameContent, raw: string) => {
  const result = decodeSave(raw, content);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.message);
  return result.value;
};
function player(content: GameContent) {
  let state = initialState(content);
  return {
    get state() {
      return state;
    },
    set state(next: GameState) {
      state = next;
    },
    act(action: GameAction) {
      state = reduceGame(content, state, action);
      return state;
    },
    close() {
      state = reduceGame(content, state, { type: 'closeDialogue' });
    },
    choose(choiceId: string) {
      state = reduceGame(content, state, { type: 'choose', choiceId });
    },
    use(hotspotId: string, itemId?: string) {
      state = reduceGame(content, state, {
        type: 'interact',
        hotspotId,
        itemId,
      });
    },
    travel(sceneId: string) {
      expect(canTravel(content, state, sceneId), sceneId).toBe(true);
      state = reduceGame(content, state, { type: 'travel', sceneId });
    },
    combine(first: string, second: string) {
      state = reduceGame(content, state, { type: 'combine', first, second });
    },
  };
}
function solveToCrypt(content: GameContent, lateMagnet = false) {
  const p = player(content);
  expect(p.state.sceneId).toBe('scene4');
  expect(p.state.dialogue?.id).toBe('fero-intro');
  p.choose('accept');
  expect(p.state.unlockedScenes).toEqual(
    expect.arrayContaining(['scene1', 'scene3', 'scene6', 'scene7', 'scene11']),
  );
  p.use('layer2');
  p.choose('supplies');
  p.close();
  expect(p.state.inventory).toEqual(expect.arrayContaining(['bread', 'tape']));
  p.travel('scene1');
  p.use('layer3');
  p.use('layer2');
  p.choose('scrapyard');
  p.close();
  if (!lateMagnet) {
    p.use('layer2', 'empty-bottle');
    p.close();
  }
  p.use('layer1');
  p.choose('farm');
  p.close();
  p.travel('scene3');
  p.use('holy-font', 'empty-bottle');
  p.travel('scene10');
  p.use('layer1', 'holy-water');
  p.close();
  p.travel('scene6');
  p.use('innkeeper');
  p.choose('grounds');
  p.close();
  p.combine('milk', 'coffee-grounds');
  expect(p.state.inventory).toContain('cold-coffee');
  p.travel('scene9');
  p.use('layer1', 'cold-coffee');
  p.close();
  expect(p.state.inventory).toEqual(
    expect.arrayContaining(['wrench', 'rubber-gloves', 'empty-bottle']),
  );
  if (lateMagnet) {
    p.travel('scene1');
    p.use('layer2', 'empty-bottle');
    p.close();
  }
  p.travel('scene6');
  p.use('beer-tap', 'wrench');
  p.use('gaming-door');
  expect(p.state.sceneId).toBe('scene8');
  p.use('service-hatch', 'wrench');
  expect(p.state.inventory).toContain('machine-log');
  p.travel('scene1');
  p.use('layer1', 'machine-log');
  p.close();
  expect(p.state.inventory).toContain('rubber-stamp');
  p.travel('scene7');
  p.use('swing-boy', 'bread');
  p.close();
  p.combine('magnet', 'string');
  expect(p.state.inventory).toContain('magnet-line');
  p.travel('scene3');
  p.use('funeral-form');
  p.combine('funeral-form', 'rubber-stamp');
  p.use('priest', 'cow-bell');
  p.close();
  p.use('cemetery-gate');
  expect(p.state.sceneId).toBe('scene5');
  p.use('layer1', 'stamped-form');
  p.close();
  p.use('chapel-door');
  expect(p.state.sceneId).toBe('scene2');
  p.use('key-grate', 'magnet-line');
  expect(p.state.inventory).toContain('crypt-key');
  p.use('crypt-door', 'crypt-key');
  expect(p.state.sceneId).toBe('scene12');
  p.close();
  return p;
}
test('the authored game completes through restoration and saves both before and after the ending', async () => {
  const content = await read(),
    p = solveToCrypt(content);
  const before = p.state;
  p.use('main-cable', 'rubber-gloves');
  expect(p.state.inventory).not.toContain('stolen-cable');
  expect(p.state.inventory).toContain('rubber-gloves');
  p.use('battery', 'wrench');
  p.use('main-cable', 'rubber-gloves');
  expect(p.state.inventory).toContain('stolen-cable');
  p.combine('stolen-cable', 'tape');
  p.travel('scene4');
  p.use('junction-box', 'fixed-cable');
  expect(p.state.flags['ending-community']).toBe(true);
  expect(p.state.flags['power-restored']).toBe(true);
  expect(p.state.flags['ending-jackpot']).not.toBe(true);
  expect(deserializeSave(content, serializeSave(content, p.state))).toEqual(
    p.state,
  );
  expect(deserializeSave(content, serializeSave(content, before))).toEqual(
    before,
  );
});
test('late bottle exchange remains solvable and a forged token causes the physically distinct jackpot ending', async () => {
  const content = await read(),
    p = solveToCrypt(content, true);
  p.combine('washer', 'foil');
  expect(p.state.inventory).toContain('fake-token');
  p.use('crypt-machine', 'fake-token');
  expect(p.state.flags['ending-jackpot']).toBe(true);
  expect(p.state.flags['machine-burnt']).toBe(true);
  expect(p.state.flags['power-restored']).not.toBe(true);
  expect(p.state.sceneId).toBe('scene12');
  expect(deserializeSave(content, serializeSave(content, p.state))).toEqual(
    p.state,
  );
});
test('only eight outdoor destinations fast travel and essential objects survive incorrect uses', async () => {
  const content = await read();
  expect(content.worldMap!.points.map((p) => p.sceneId).sort()).toEqual(
    [
      'scene1',
      'scene3',
      'scene4',
      'scene6',
      'scene7',
      'scene9',
      'scene10',
      'scene11',
    ].sort(),
  );
  const p = player(content);
  p.choose('accept');
  p.use('layer2');
  p.choose('supplies');
  p.close();
  const inventory = [...p.state.inventory];
  p.use('layer1', 'tape');
  p.close();
  p.combine('bread', 'tape');
  expect(p.state.inventory).toEqual(inventory);
  for (const id of ['scene2', 'scene5', 'scene8', 'scene12'])
    expect(
      canTravel(
        content,
        { ...p.state, unlockedScenes: content.scenes.map((s) => s.id) },
        id,
      ),
    ).toBe(false);
});

test('starting a Dev Mode preview elsewhere can still accept Fero’s case', async () => {
  const content = await read();
  let state: GameState = {
    ...initialState(content),
    sceneId: 'scene3',
    unlockedScenes: ['scene4', 'scene3'],
    dialogue: null,
  };
  state = reduceGame(content, state, { type: 'travel', sceneId: 'scene4' });
  state = reduceGame(content, state, { type: 'interact', hotspotId: 'layer1' });
  expect(state.dialogue?.id).toBe('fero-intro');
  state = reduceGame(content, state, { type: 'choose', choiceId: 'accept' });
  expect(state.flags['case-open']).toBe(true);
  expect(canTravel(content, state, 'scene1')).toBe(true);
});
