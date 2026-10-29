import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  initialState,
  reduceGame,
  canTravel,
  getDialogueNode,
} from '../src/game/state';
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
function prepareFarm(content: GameContent, lateMagnet = false) {
  const p = player(content);
  expect(p.state.sceneId).toBe('scene4');
  expect(p.state.dialogue?.id).toBe('fero-intro');
  p.choose('accept');
  expect(p.state.unlockedScenes).toEqual(
    expect.arrayContaining(['scene1', 'scene3', 'scene6', 'scene7']),
  );
  expect(p.state.unlockedScenes).not.toContain('scene10');
  for (const id of ['bread-box', 'tape-roll', 'peg-basket']) p.use(id);
  expect(p.state.inventory).toEqual(
    expect.arrayContaining(['bread', 'tape', 'clothespin']),
  );
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
  p.use('funeral-form');
  p.use('holy-font', 'empty-bottle');
  p.travel('scene10');
  return p;
}
function solveToCrypt(content: GameContent, lateMagnet = false) {
  const p = prepareFarm(content, lateMagnet);
  p.use('cow', 'holy-water');
  p.close();
  expect(p.state.inventory).toContain('empty-bottle');
  p.use('cow', 'funeral-form');
  expect(p.state.inventory).toContain('funeral-form');
  p.use('milking-bucket', 'empty-bottle');
  p.use('cow-bell-hook');
  expect(p.state.inventory).toEqual(
    expect.arrayContaining(['milk', 'cow-bell']),
  );
  p.travel('scene6');
  p.use('innkeeper');
  p.choose('grounds');
  p.close();
  p.combine('milk', 'coffee-grounds');
  expect(p.state.inventory).toContain('cold-coffee');
  p.travel('scene9');
  p.use('layer1', 'cold-coffee');
  p.close();
  expect(p.state.inventory).toContain('cold-coffee');
  expect(p.state.inventory).not.toContain('wrench');
  p.use('tool-chest');
  expect(p.state.inventory).not.toContain('wrench');
  p.use('resuscitator', 'cold-coffee');
  expect(p.state.inventory).toContain('empty-bottle');
  expect(p.state.flags['dingo-awake']).not.toBe(true);
  p.use('resuscitator');
  p.close();
  expect(p.state.inventory).not.toContain('wrench');
  p.use('tool-chest');
  expect(p.state.inventory).toEqual(
    expect.arrayContaining(['wrench', 'rubber-gloves']),
  );
  if (lateMagnet) {
    p.travel('scene1');
    p.use('layer2', 'empty-bottle');
    p.close();
  }
  p.travel('scene6');
  p.use('beer-tap', 'wrench');
  p.use('gaming-door');
  expect(p.state.sceneId).toBe('scene6');
  expect(p.state.inventory).not.toContain('foil');
  p.use('beer-mugs');
  p.use('foil-wrapper');
  p.use('gaming-door');
  expect(p.state.sceneId).toBe('scene8');
  p.use('service-hatch', 'wrench');
  expect(p.state.inventory).toContain('machine-log');
  p.travel('scene1');
  p.use('layer1', 'machine-log');
  p.close();
  expect(p.state.inventory).toContain('rubber-stamp');
  p.travel('scene7');
  p.use('swing-axle', 'wrench');
  p.use('swing-seat');
  expect(p.state.flags['kids-helped']).not.toBe(true);
  p.use('swing-seat', 'bread');
  p.use('swing-seat');
  p.close();
  p.use('loose-string');
  p.use('loose-washer');
  p.combine('magnet', 'string');
  expect(p.state.inventory).toContain('magnet-line');
  p.travel('scene3');
  p.combine('funeral-form', 'rubber-stamp');
  p.use('absolution-machine', 'cow-bell');
  p.use('cemetery-gate');
  expect(p.state.sceneId).toBe('scene3');
  p.use('absolution-machine');
  p.close();
  p.use('cemetery-gate');
  expect(p.state.sceneId).toBe('scene5');
  p.use('coffin');
  expect(p.state.flags['chapel-open']).not.toBe(true);
  expect(p.state.inventory).toContain('stamped-form');
  p.use('coffin', 'stamped-form');
  p.use('coffin');
  expect(p.state.flags['chapel-open']).not.toBe(true);
  expect(p.state.inventory).toContain('clothespin');
  p.use('coffin', 'clothespin');
  p.use('coffin');
  p.close();
  expect(p.state.sceneId).toBe('scene5');
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
  p.use('battery-reconnect');
  expect(p.state.flags['battery-isolated']).toBe(false);
  p.use('battery', 'wrench');
  p.use('main-cable', 'rubber-gloves');
  expect(p.state.inventory).toContain('stolen-cable');
  p.use('battery-reconnect');
  expect(p.state.flags['battery-isolated']).toBe(true);
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
  const ending = p.state;
  p.use('layer1');
  expect(p.state).toBe(ending);
});
test('late bottle exchange remains solvable and a forged token causes the physically distinct jackpot ending', async () => {
  const content = await read(),
    p = solveToCrypt(content, true);
  p.combine('washer', 'foil');
  expect(p.state.inventory).toContain('fake-token');
  p.use('battery', 'wrench');
  p.use('crypt-machine', 'fake-token');
  expect(p.state.inventory).toContain('fake-token');
  expect(p.state.flags['ending-jackpot']).not.toBe(true);
  p.use('battery-reconnect');
  p.use('crypt-machine', 'fake-token');
  expect(p.state.flags['ending-jackpot']).toBe(true);
  expect(p.state.flags['machine-burnt']).toBe(true);
  expect(p.state.flags['power-restored']).not.toBe(true);
  expect(p.state.sceneId).toBe('scene12');
  expect(deserializeSave(content, serializeSave(content, p.state))).toEqual(
    p.state,
  );
});
test('the cow keeps both the bottle cycle and funeral evidence through premature and repeated interactions', async () => {
  const content = await read(),
    p = prepareFarm(content);
  p.use('cow', 'funeral-form');
  expect(p.state.flags['cow-asleep']).not.toBe(true);
  expect(p.state.inventory).toContain('funeral-form');
  p.use('cow-bell-hook');
  expect(p.state.inventory).not.toContain('cow-bell');
  p.use('cow', 'holy-water');
  p.close();
  p.use('milking-bucket', 'empty-bottle');
  expect(p.state.inventory).toContain('empty-bottle');
  expect(p.state.inventory).not.toContain('milk');
  p.travel('scene3');
  p.use('holy-font', 'empty-bottle');
  p.travel('scene10');
  p.use('cow', 'holy-water');
  expect(p.state.inventory).toContain('empty-bottle');
  expect(p.state.inventory).not.toContain('holy-water');
  p.use('cow', 'funeral-form');
  p.use('milking-bucket', 'empty-bottle');
  p.use('cow-bell-hook');
  expect(p.state.inventory).toEqual(
    expect.arrayContaining(['milk', 'cow-bell', 'funeral-form']),
  );
  p.state = { ...p.state, inventory: [...p.state.inventory, 'empty-bottle'] };
  p.use('milking-bucket', 'empty-bottle');
  expect(p.state.inventory).toContain('empty-bottle');
  p.use('cow-bell-hook');
  expect(p.state.inventory.filter((id) => id === 'cow-bell')).toHaveLength(1);
});
test('seven outdoor destinations keep fast travel separate from interior passages and wrong uses preserve supplies', async () => {
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
    ].sort(),
  );
  const p = player(content);
  p.choose('accept');
  for (const id of ['bread-box', 'tape-roll', 'peg-basket']) p.use(id);
  const inventory = [...p.state.inventory];
  p.use('layer1', 'tape');
  p.close();
  p.combine('bread', 'tape');
  expect(p.state.inventory).toEqual(inventory);
  p.use('alley-door');
  expect(p.state.sceneId).toBe('scene11');
  p.use('yard-door');
  expect(p.state.sceneId).toBe('scene4');
  for (const id of ['scene2', 'scene5', 'scene8', 'scene11', 'scene12'])
    expect(
      canTravel(
        content,
        { ...p.state, unlockedScenes: content.scenes.map((s) => s.id) },
        id,
      ),
    ).toBe(false);
});
test('Eržika has repeated standalone barks whose sequence survives a save without supplying quest items', async () => {
  const content = await read(),
    p = player(content);
  p.choose('accept');
  const barks: string[] = [];
  for (let index = 0; index < 5; index++) {
    p.use('layer2');
    const node = getDialogueNode(content, p.state);
    expect(node?.choices).toEqual([]);
    expect(
      content.dialogues.find((d) => d.id === p.state.dialogue?.id)?.entry,
    ).toBe('speech');
    barks.push(node!.text);
    p.close();
    if (index === 1)
      p.state = deserializeSave(content, serializeSave(content, p.state));
  }
  expect(new Set(barks).size).toBe(5);
  p.use('layer2');
  expect(getDialogueNode(content, p.state)?.text).toBe(barks[0]);
  p.close();
  expect(p.state.inventory).toEqual([]);
  expect(content.dialogues.some((d) => d.id === 'wife-chat')).toBe(false);
});
test('new puzzle props are visible placeholders contained in their authored locations', async () => {
  const content = await read();
  const props = {
    scene4: ['bread-box', 'tape-roll', 'peg-basket'],
    scene10: ['milking-bucket', 'cow-bell-hook'],
    scene9: ['resuscitator', 'tool-chest'],
    scene6: ['foil-wrapper'],
    scene3: ['absolution-machine'],
    scene7: ['swing-axle', 'swing-seat', 'loose-string', 'loose-washer'],
    scene5: ['coffin'],
  };
  for (const [sceneId, ids] of Object.entries(props)) {
    const scene = content.scenes.find((entry) => entry.id === sceneId)!;
    for (const id of ids) {
      const hotspot = scene.hotspots.find((entry) => entry.id === id)!;
      expect(hotspot, `${sceneId}/${id}`).toBeDefined();
      expect(hotspot.placeholder, id).toBe(true);
      expect(hotspot.hidden, id).not.toBe(true);
      expect(hotspot.bounds.x, id).toBeGreaterThanOrEqual(0);
      expect(hotspot.bounds.y, id).toBeGreaterThanOrEqual(0);
      expect(hotspot.bounds.width, id).toBeGreaterThan(0);
      expect(hotspot.bounds.height, id).toBeGreaterThan(0);
      expect(hotspot.bounds.x + hotspot.bounds.width, id).toBeLessThanOrEqual(
        scene.width,
      );
      expect(hotspot.bounds.y + hotspot.bounds.height, id).toBeLessThanOrEqual(
        scene.height,
      );
    }
  }
});
test('the rewrite preserves registered actor voices and the eight static slots', async () => {
  const content = await read();
  const expected = {
    'scene1/layer2': 'hK1QkZqr6jNBJ8sJlEuc',
    'scene1/layer1': 'xKlQrC6RzWnhQhiCFKBS',
    'scene4/layer2': 'H4DieoTMxMYl6lx1prWW',
    'scene4/layer1': 'T4iGZQue94RIBivJIuhN',
    'scene3/priest': 'Dm506FEP6AkprXTsWzmW',
    'scene5/layer1': 'zWHgsvbNzrffMNY5MMeW',
    'scene6/innkeeper': 'GMq1ucyG2a8EKFsKRbDQ',
    'scene7/swing-boy': 'iiDZOH9TArCghKD6MfNt',
    'scene7/sand-girl': 'wk5NuWmufYkSfjl2kJr1',
    'scene7/climbing-boy': 'GTTXoS7HeTELz6svNEnz',
    'scene9/layer1': 'OAHw71DTm0tFvJJU4HGL',
    'scene10/layer1': 'Jfvw40qotTOck51vIvrm',
    'scene12/layer1': 'Cs0q9bNTpnXhVCnLNXGI',
  };
  const voices = content.scenes.flatMap((scene) =>
    scene.hotspots.flatMap((hotspot) =>
      hotspot.animation?.voice
        ? [[`${scene.id}/${hotspot.id}`, hotspot.animation.voice] as const]
        : [],
    ),
  );
  expect(
    Object.fromEntries(voices.map(([id, voice]) => [id, voice.voiceId])),
  ).toEqual(expected);
  expect(voices.filter(([, voice]) => voice.slot === 'static')).toHaveLength(8);
  expect(
    voices.filter(([, voice]) => voice.slot === 'rotating' && voice.retired),
  ).toHaveLength(5);
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
