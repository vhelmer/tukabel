import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  initialState,
  reduceGame,
  canTravel,
  getDialogueNode,
  getEnding,
  matches,
  syncTasks,
} from '../src/game/state';
import { decodeSave } from '../src/game/storage';
import type {
  Effect,
  GameAction,
  GameContent,
  GameState,
  Hotspot,
} from '../src/game/types';

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
// Visual layers are editable; follow the authored puzzle effect, not old sprite IDs.
const propEffects: Record<string, Pick<Effect, 'type' | 'id'>> = {
  'peg-basket': { type: 'addItem', id: 'clothespin' },
  'tape-roll': { type: 'addItem', id: 'tape' },
  'scrap-metal': { type: 'addItem', id: 'scrap-metal' },
  'foil-wrapper': { type: 'addItem', id: 'foil' },
  'absolution-machine': { type: 'flag', id: 'bell-installed' },
  coffin: { type: 'flag', id: 'coffin-certified' },
  'milking-bucket': { type: 'addItem', id: 'milk' },
  'cow-bell-hook': { type: 'addItem', id: 'cow-bell' },
  resuscitator: { type: 'flag', id: 'dingo-awake' },
  'tool-chest': { type: 'addItem', id: 'wrench' },
  'main-cable': { type: 'addItem', id: 'stolen-cable' },
  'car-battery': { type: 'flag', id: 'battery-isolated' },
};
function hasPropEffect(hotspot: Hotspot, alias: string) {
  const wanted = propEffects[alias];
  return (
    wanted &&
    [hotspot.onClick, ...Object.values(hotspot.uses ?? {})]
      .flat()
      .some((rule) =>
        rule.effects?.some(
          (effect) => effect.type === wanted.type && effect.id === wanted.id,
        ),
      )
  );
}
function propId(content: GameContent, sceneId: string, alias: string) {
  const scene = content.scenes.find((entry) => entry.id === sceneId)!;
  if (scene.hotspots.some((entry) => entry.id === alias)) return alias;
  const candidates = scene.hotspots.filter((entry) =>
    hasPropEffect(entry, alias),
  );
  expect(
    candidates.length,
    `${sceneId}/${alias} effect must identify one prop`,
  ).toBeLessThanOrEqual(1);
  return candidates[0]?.id ?? alias;
}
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
        hotspotId: propId(content, state.sceneId, hotspotId),
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
  p.use('peg-basket');
  p.use('alley-door');
  expect(p.state.sceneId).toBe('scene11');
  p.use('tape-roll');
  p.use('scrap-metal');
  p.use('yard-door');
  expect(p.state.sceneId).toBe('scene4');
  expect(p.state.inventory).toEqual(
    expect.arrayContaining(['tape', 'clothespin', 'scrap-metal']),
  );
  p.travel('scene1');
  p.use('layer3');
  p.use('stop-bin');
  p.use('layer2');
  p.choose('scrapyard');
  p.close();
  if (!lateMagnet) {
    p.use('layer2', 'scrap-metal');
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
  expect(p.state.inventory).not.toContain('empty-bottle');
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
    p.use('layer2', 'scrap-metal');
    p.close();
  }
  p.travel('scene6');
  p.use('beer-tap', 'wrench');
  p.use('gaming-door');
  expect(p.state.sceneId).toBe('scene6');
  p.close();
  expect(p.state.inventory).not.toContain('foil');
  p.use('beer-mugs');
  expect(p.state.flags['beer-drained']).toBe(true);
  p.close();
  p.use('gaming-door');
  expect(p.state.sceneId).toBe('scene8');
  p.use('foil-wrapper');
  p.use('service-hatch', 'wrench');
  expect(p.state.inventory).toContain('machine-log');
  p.travel('scene1');
  p.use('layer1', 'machine-log');
  p.close();
  expect(p.state.inventory).toContain('rubber-stamp');
  expect(p.state.inventory).not.toContain('machine-log');
  p.travel('scene7');
  p.use('swing-boy');
  p.choose('trade');
  p.close();
  p.use('stone-line');
  p.act({ type: 'finishMinigame', won: true });
  p.act({ type: 'closeMinigame' });
  p.use('swing-boy');
  p.close();
  p.combine('potato-medal', 'scissors');
  expect(p.state.inventory).toEqual(
    expect.arrayContaining(['potato', 'string']),
  );
  expect(p.state.inventory).not.toContain('scissors');
  p.combine('magnet', 'string');
  expect(p.state.inventory).toContain('magnet-line');
  p.travel('scene3');
  p.combine('funeral-form', 'rubber-stamp');
  expect(p.state.inventory).not.toContain('rubber-stamp');
  p.use('absolution-machine', 'cow-bell');
  p.use('cemetery-gate');
  expect(p.state.sceneId).toBe('scene3');
  p.close();
  p.use('absolution-machine');
  p.close();
  p.use('cemetery-gate');
  expect(p.state.sceneId).toBe('scene5');
  p.use('coffin');
  expect(p.state.flags['chapel-open']).not.toBe(true);
  p.close();
  expect(p.state.inventory).toContain('stamped-form');
  p.use('coffin', 'stamped-form');
  p.use('coffin');
  expect(p.state.flags['chapel-open']).not.toBe(true);
  p.close();
  expect(p.state.inventory).toContain('clothespin');
  p.use('coffin', 'clothespin');
  p.use('coffin');
  p.close();
  expect(p.state.sceneId).toBe('scene5');
  p.use('chapel-door');
  expect(p.state.sceneId).toBe('scene2');
  p.use('key-grate', 'magnet-line');
  expect(p.state.inventory).toContain('crypt-key');
  expect(p.state.inventory).not.toContain('magnet-line');
  p.use('crypt-door', 'crypt-key');
  expect(p.state.sceneId).toBe('scene12');
  p.close();
  return p;
}
test('the authored game completes through restoration and saves both before and after the ending', async () => {
  const content = await read(),
    p = solveToCrypt(content);
  const before = p.state;
  p.use('main-cable');
  p.use('main-cable', 'rubber-gloves');
  expect(p.state.inventory).not.toContain('stolen-cable');
  expect(p.state.inventory).toContain('rubber-gloves');
  p.use('car-battery', 'wrench');
  expect(p.state.flags['battery-isolated']).toBe(true);
  p.use('main-cable', 'rubber-gloves');
  expect(p.state.inventory).toContain('stolen-cable');
  expect(p.state.flags['cable-recovered']).toBe(true);
  expect(p.state.inventory).not.toContain('wrench');
  expect(p.state.inventory).not.toContain('rubber-gloves');
  p.combine('stolen-cable', 'tape');
  p.travel('scene4');
  p.use('junction-box', 'fixed-cable');
  expect(p.state.dialogue?.id).toBe('fero-ending');
  expect(getEnding(content, p.state)).toBeUndefined();
  p.close();
  expect(getEnding(content, p.state)?.id).toBe('community');
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
test('late scrap exchange remains solvable and a forged token causes the physically distinct jackpot ending', async () => {
  const content = await read(),
    p = solveToCrypt(content, true);
  p.combine('potato', 'foil');
  expect(p.state.inventory).toContain('fake-token');
  p.use('crypt-machine', 'fake-token');
  expect(p.state.flags['ending-jackpot']).toBe(true);
  expect(p.state.dialogue?.id).toBe('lubo-ending');
  expect(getEnding(content, p.state)).toBeUndefined();
  p.close();
  expect(getEnding(content, p.state)?.id).toBe('jackpot');
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
  p.close();
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
test('the sleeping cow keeps its eyes shut and stops blinking after travel and load', async () => {
  const content = await read(),
    p = prepareFarm(content);
  const farm = content.scenes.find((s) => s.id === 'scene10')!.hotspots;
  const clip = content.animations!.find(
    (a) => a.kind === 'blink' && a.frames.at(-2)?.includes('4e928ce3'),
  )!;
  const blinking = farm.find((h) => h.animation?.blink === clip.id)!;
  const sleeping = farm.find((h) => h.image === clip.frames[3])!;
  expect(sleeping.animation).toBeUndefined();
  expect(sleeping.bounds).toEqual(blinking.bounds);
  const shown = (h: Hotspot) => !h.hidden && matches(p.state, h.visibleWhen);
  expect([shown(blinking), shown(sleeping)]).toEqual([true, false]);
  p.use('cow', 'holy-water');
  p.close();
  p.use('cow', 'funeral-form');
  expect(p.state.flags['cow-asleep']).toBe(true);
  expect([shown(blinking), shown(sleeping)]).toEqual([false, true]);
  p.travel('scene3');
  p.travel('scene10');
  p.state = deserializeSave(content, serializeSave(content, p.state));
  expect([shown(blinking), shown(sleeping)]).toEqual([false, true]);
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
  p.use('peg-basket');
  p.use('alley-door');
  expect(p.state.sceneId).toBe('scene11');
  p.use('tape-roll');
  p.use('scrap-metal');
  p.use('yard-door');
  expect(p.state.sceneId).toBe('scene4');
  const inventory = [...p.state.inventory];
  p.use('layer1', 'tape');
  p.close();
  p.combine('clothespin', 'tape');
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
test('the alley tape is a unique visible pickup that stays collected after save/load', async () => {
  const content = await read(),
    p = player(content);
  const pickups = content.scenes.flatMap((scene) =>
    scene.hotspots
      .filter((hotspot) => hasPropEffect(hotspot, 'tape-roll'))
      .map((hotspot) => ({ scene, hotspot })),
  );
  expect(pickups).toHaveLength(1);
  const { scene, hotspot } = pickups[0]!;
  expect(scene.id).toBe('scene11');
  expect(hotspot.image).toBeTruthy();
  expect(content.items.find((item) => item.id === 'tape')?.image).toBeTruthy();
  expect(hotspot.placeholder).not.toBe(true);
  expect(hotspot.hidden).not.toBe(true);
  expect(hotspot.bounds.x).toBeGreaterThanOrEqual(0);
  expect(hotspot.bounds.y).toBeGreaterThanOrEqual(0);
  expect(hotspot.bounds.width).toBeGreaterThan(0);
  expect(hotspot.bounds.height).toBeGreaterThan(0);
  expect(hotspot.bounds.x + hotspot.bounds.width).toBeLessThanOrEqual(
    scene.width,
  );
  expect(hotspot.bounds.y + hotspot.bounds.height).toBeLessThanOrEqual(
    scene.height,
  );
  p.choose('accept');
  p.use('tape-roll');
  expect(p.state.inventory).not.toContain('tape');
  p.use('alley-door');
  expect(p.state.sceneId).toBe('scene11');
  expect(matches(p.state, hotspot.visibleWhen)).toBe(true);
  p.state = deserializeSave(content, serializeSave(content, p.state));
  p.use('tape-roll');
  expect(p.state.flags['tape-taken']).toBe(true);
  expect(p.state.inventory.filter((id) => id === 'tape')).toHaveLength(1);
  expect(matches(p.state, hotspot.visibleWhen)).toBe(false);
  p.state = deserializeSave(content, serializeSave(content, p.state));
  const collected = p.state;
  p.use('tape-roll');
  expect(p.state).toBe(collected);
  expect(matches(p.state, hotspot.visibleWhen)).toBe(false);
  p.use('yard-door');
  expect(p.state.sceneId).toBe('scene4');
  p.use('alley-door');
  p.use('tape-roll');
  expect(p.state.inventory.filter((id) => id === 'tape')).toHaveLength(1);
});
test('puzzle props retain visible artwork or authored targets in their locations', async () => {
  const content = await read();
  const props = {
    scene4: ['peg-basket'],
    scene10: ['milking-bucket', 'cow-bell-hook'],
    scene9: ['resuscitator', 'tool-chest'],
    scene8: ['foil-wrapper'],
    scene3: ['absolution-machine'],
    scene5: ['coffin'],
  };
  for (const [sceneId, ids] of Object.entries(props)) {
    const scene = content.scenes.find((entry) => entry.id === sceneId)!;
    for (const id of ids) {
      const hotspot = scene.hotspots.find(
        (entry) => entry.id === propId(content, sceneId, id),
      )!;
      expect(hotspot, `${sceneId}/${id}`).toBeDefined();
      expect(
        Boolean(hotspot.image || hotspot.placeholder || hotspot.polygon),
        id,
      ).toBe(true);
      expect(hotspot.decorative, id).not.toBe(true);
      expect(hotspot.opacity ?? 1, id).toBeGreaterThan(0);
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
test('static actor voices stay fixed while rotating voices retain registration and retirement evidence', async () => {
  const content = await read();
  const expected = {
    'scene1/layer2': 'OrfjtrzVNMp0DoREiFhZ',
    'scene1/layer1': 'xKlQrC6RzWnhQhiCFKBS',
    'scene4/layer1': 'T4iGZQue94RIBivJIuhN',
    'scene3/priest': 'Dm506FEP6AkprXTsWzmW',
    'scene5/layer1': 'zWHgsvbNzrffMNY5MMeW',
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
    Object.fromEntries(
      voices
        .filter(([, voice]) => voice.slot === 'static')
        .map(([id, voice]) => [id, voice.voiceId]),
    ),
  ).toEqual(expected);
  expect(
    Object.fromEntries(
      voices
        .filter(([, voice]) => voice.slot === 'rotating')
        .map(([id, voice]) => [id, voice.voiceId]),
    ),
  ).toEqual({
    'scene4/layer2': 'l1irIuUP5mHtvmn3ALC9',
    'scene6/innkeeper': 'oos3VRpD3WwsoKNF0MKb',
    'scene7/swing-boy': 'QjlCD1k8X7bEBCXezj33',
    'scene7/sand-girl': 'qeIj9I3uCRmajGyrxeZc',
    'scene7/climbing-boy': 'DyIdTI8oWFiulpU3HRMH',
  });
  expect(voices).toHaveLength(13);
  expect(voices.filter(([, voice]) => voice.slot === 'static')).toHaveLength(8);
  expect(
    voices.filter(([, voice]) => voice.slot === 'rotating' && voice.retired),
  ).toHaveLength(5);
  for (const [id, voice] of voices.filter(
    ([, voice]) => voice.slot === 'rotating',
  )) {
    expect(voice.voiceId, id).not.toBe('');
    const registration = JSON.parse(
      await readFile(`src/assets/${voice.designRegistration}`, 'utf8'),
    );
    const retirement = JSON.parse(
      await readFile(`src/assets/${voice.retirementManifest}`, 'utf8'),
    );
    expect(registration.voiceId, id).toBe(voice.voiceId);
    expect(retirement.voiceId, id).toBe(voice.voiceId);
    expect(retirement.designRegistration, id).toBe(voice.designRegistration);
    expect(retirement.verifiedLines, id).toBeGreaterThan(0);
  }
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

test('accepting the case opens one notebook task and tools alone reveal no future errands', async () => {
  const content = await read();
  const state = reduceGame(content, initialState(content), {
    type: 'choose',
    choiceId: 'accept',
  });
  expect(state.tasks).toEqual({ 'find-cable': 'active' });
  expect(state.message).not.toContain('Rožok je pri dverách');
  const after = (flag: string) =>
    syncTasks(content, { ...state, flags: { ...state.flags, [flag]: true } })
      .tasks;
  expect(after('tools-taken')['open-herna']).toBeUndefined();
  expect(after('tap-fixed')['playground-prize']).toBeUndefined();
  expect(after('bell-taken').cemetery).toBeUndefined();
  expect(after('pub-deal-known')['open-herna']).toBe('active');
  expect(after('playground-game-known')['playground-prize']).toBe('active');
  expect(after('stone-game-won')['playground-prize']).toBe('active');
  expect(after('priest-distraction-known').cemetery).toBe('active');
});

test('Dežo barters one unique alley scrap pickup and refuses bottles, holy water and the potato prize', async () => {
  const content = await read(),
    p = player(content);
  const pickups = content.scenes.flatMap((scene) =>
    scene.hotspots
      .filter((hotspot) => hasPropEffect(hotspot, 'scrap-metal'))
      .map((hotspot) => ({ scene, hotspot })),
  );
  expect(pickups).toHaveLength(1);
  const { scene, hotspot } = pickups[0]!;
  expect(scene.id).toBe('scene11');
  expect(hotspot.image).toBeTruthy();
  expect(
    content.items.find((item) => item.id === 'scrap-metal')?.image,
  ).toBeTruthy();
  expect(hotspot.placeholder).not.toBe(true);
  // Placement is editable in Dev Mode; shared validation checks scene bounds.
  expect(
    matches(
      { ...p.state, flags: { ...p.state.flags, 'magnet-given': true } },
      hotspot.visibleWhen,
    ),
  ).toBe(false);
  p.choose('accept');
  p.use('scrap-metal');
  expect(p.state.inventory).not.toContain('scrap-metal');
  p.use('alley-door');
  expect(matches(p.state, hotspot.visibleWhen)).toBe(true);
  p.use('scrap-metal');
  expect(p.state.flags['scrap-taken']).toBe(true);
  expect(p.state.inventory.filter((id) => id === 'scrap-metal')).toHaveLength(
    1,
  );
  expect(matches(p.state, hotspot.visibleWhen)).toBe(false);
  p.state = deserializeSave(content, serializeSave(content, p.state));
  const collected = p.state;
  p.use('scrap-metal');
  expect(p.state).toBe(collected);
  p.use('yard-door');
  p.travel('scene1');
  const base = p.state;
  for (const itemId of ['empty-bottle', 'holy-water', 'potato']) {
    p.state = { ...base, inventory: [...base.inventory, itemId] };
    const before = p.state;
    p.use('layer2', itemId);
    expect(p.state.inventory, itemId).toEqual(before.inventory);
    expect(p.state.flags, itemId).toEqual(before.flags);
    const reaction = getDialogueNode(content, p.state);
    expect(reaction?.actor, itemId).toEqual({
      sceneId: 'scene1',
      hotspotId: 'layer2',
    });
    expect(reaction?.text, itemId).not.toBe('');
    p.close();
    expect(p.state.inventory, itemId).not.toContain('magnet');
  }
  p.state = deserializeSave(content, serializeSave(content, base));
  p.use('layer2', 'scrap-metal');
  expect(p.state.inventory).not.toContain('scrap-metal');
  expect(p.state.inventory.filter((id) => id === 'magnet')).toHaveLength(1);
  expect(p.state.flags['magnet-given']).toBe(true);
  expect(p.state.flags['scrapyard-known']).toBe(true);
  expect(p.state.dialogue?.id).toBe('dezo-bottle');
  p.close();
  p.state = deserializeSave(content, serializeSave(content, p.state));
  const traded = p.state;
  p.use('layer2', 'scrap-metal');
  expect(p.state).toBe(traded);
  // Even an old/inconsistent position retaining scrap cannot claim another magnet.
  p.state = { ...p.state, inventory: [...p.state.inventory, 'scrap-metal'] };
  p.use('layer2', 'scrap-metal');
  expect(p.state.inventory.filter((id) => id === 'magnet')).toHaveLength(1);
  expect(p.state.inventory).toContain('scrap-metal');
  p.close();
  p.travel('scene4');
  p.use('alley-door');
  expect(matches(p.state, hotspot.visibleWhen)).toBe(false);
});

test('bus stop bin yields scissors once and stays collected after reload', async () => {
  const content = await read(),
    p = player(content);
  p.choose('accept');
  p.travel('scene1');
  p.use('stop-bin');
  expect(p.state.inventory).toContain('scissors');
  expect(p.state.message.trim()).not.toBe('');
  p.state = deserializeSave(content, serializeSave(content, p.state));
  p.use('stop-bin');
  expect(p.state.inventory.filter((id) => id === 'scissors')).toHaveLength(1);
});

test('only a minigame winner can claim one potato medal and scissors release its string without duplicating rewards', async () => {
  const content = await read(),
    p = player(content);
  p.choose('accept');
  p.use('peg-basket');
  p.travel('scene7');
  p.use('swing-boy');
  p.close();
  expect(p.state.inventory).not.toContain('potato-medal');
  p.use('stone-line');
  p.act({ type: 'finishMinigame', won: false });
  p.act({ type: 'closeMinigame' });
  p.use('swing-boy');
  p.close();
  expect(p.state.inventory).not.toContain('potato-medal');
  p.use('stone-line');
  p.act({ type: 'finishMinigame', won: true });
  p.act({ type: 'closeMinigame' });
  p.use('swing-boy');
  p.close();
  expect(p.state.inventory).toContain('potato-medal');
  expect(p.state.inventory).not.toContain('string');
  p.combine('potato-medal', 'clothespin');
  expect(p.state.inventory).toContain('potato-medal');
  p.travel('scene1');
  p.use('stop-bin');
  p.combine('scissors', 'potato-medal');
  expect(p.state.inventory).toEqual(
    expect.arrayContaining(['potato', 'string']),
  );
  expect(p.state.inventory).not.toContain('scissors');
  expect(p.state.inventory).not.toContain('potato-medal');
  expect(p.state.tasks['playground-prize']).toBe('completed');
  p.state = deserializeSave(content, serializeSave(content, p.state));
  p.combine('potato-medal', 'scissors');
  p.travel('scene7');
  p.use('stone-line');
  p.act({ type: 'finishMinigame', won: true });
  p.act({ type: 'finishMinigame', won: false });
  p.act({ type: 'closeMinigame' });
  p.use('swing-boy');
  p.close();
  expect(p.state.inventory).not.toContain('potato-medal');
  expect(p.state.inventory).not.toContain('scissors');
  for (const id of ['potato', 'string'])
    expect(p.state.inventory.filter((item) => item === id)).toHaveLength(1);
});

test('chocolate foil is a unique pickup inside the gaming room unlocked by repairing and draining the tap', async () => {
  const content = await read(),
    p = player(content);
  const pickups = content.scenes.flatMap((scene) =>
    scene.hotspots
      .filter((h) => hasPropEffect(h, 'foil-wrapper'))
      .map((hotspot) => ({ scene, hotspot })),
  );
  expect(pickups).toHaveLength(1);
  expect(pickups[0]!.scene.id).toBe('scene8');
  p.choose('accept');
  p.travel('scene6');
  p.use('gaming-door');
  p.close();
  expect(p.state.sceneId).toBe('scene6');
  expect(p.state.inventory).not.toContain('foil');
  p.state = { ...p.state, inventory: ['wrench'] };
  p.use('beer-tap', 'wrench');
  p.use('beer-mugs');
  p.close();
  p.use('gaming-door');
  expect(p.state.sceneId).toBe('scene8');
  p.use('foil-wrapper');
  expect(p.state.inventory).toContain('foil');
  p.state = deserializeSave(content, serializeSave(content, p.state));
  p.use('foil-wrapper');
  expect(p.state.inventory.filter((id) => id === 'foil')).toHaveLength(1);
});

test('the cable needs the battery disconnected with the wrench and gloves; reconnecting reopens the token ending', async () => {
  const content = await read();
  const crypt = content.scenes.find((scene) => scene.id === 'scene12')!;
  const shown = (id: string) =>
    matches(
      p.state,
      crypt.hotspots.find((h) => h.id === propId(content, crypt.id, id))!
        .visibleWhen,
    );
  const p = player(content);
  const start: GameState = {
    ...p.state,
    sceneId: crypt.id,
    dialogue: null,
    inventory: ['fake-token', 'wrench', 'rubber-gloves'],
  };
  p.state = start;
  p.use('main-cable');
  p.use('main-cable', 'rubber-gloves');
  expect(p.state.inventory).toEqual(start.inventory);
  expect(p.state.flags['cable-recovered']).not.toBe(true);
  expect(shown('machine-off')).toBe(false);
  p.use('car-battery', 'wrench');
  expect(p.state.flags['battery-isolated']).toBe(true);
  expect(shown('machine-off')).toBe(true);
  p.use('crypt-machine', 'fake-token');
  expect(p.state.inventory).toContain('fake-token');
  expect(p.state.flags['ending-jackpot']).not.toBe(true);
  p.use('car-battery', 'wrench');
  expect(p.state.flags['battery-isolated']).toBe(false);
  expect(shown('machine-off')).toBe(false);
  p.use('crypt-machine', 'fake-token');
  expect(p.state.dialogue?.id).toBe('lubo-ending');
  expect(p.state.flags['ending-jackpot']).toBe(true);

  p.state = start;
  p.use('car-battery', 'wrench');
  p.use('main-cable', 'rubber-gloves');
  expect(p.state.inventory).toEqual(['fake-token', 'stolen-cable']);
  expect(p.state.flags['cable-recovered']).toBe(true);
  expect(shown('machine-off')).toBe(true);
  expect(shown('main-cable')).toBe(false);
  p.use('crypt-machine', 'fake-token');
  expect(p.state.inventory).toContain('fake-token');
  expect(p.state.flags['ending-jackpot']).not.toBe(true);
});
