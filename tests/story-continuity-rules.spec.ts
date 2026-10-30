import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getDialogueNode,
  initialState,
  matches,
  reduceGame,
  syncTasks,
} from '../src/game/state';
import { decodeSave } from '../src/game/storage';
import type { GameContent, GameState, Rule } from '../src/game/types';

const read = async () =>
  JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;

const acceptedCase = (content: GameContent): GameState =>
  reduceGame(content, initialState(content), {
    type: 'choose',
    choiceId: 'accept',
  });

const availableChoices = (content: GameContent, state: GameState) =>
  getDialogueNode(content, state)?.choices.filter((choice) =>
    matches(state, choice.when),
  ) ?? [];

test('NPC speech never leaks into world reaction messages', async () => {
  const content = await read();
  const rules: { path: string; rule: Pick<Rule, 'message'> }[] = [];
  for (const scene of content.scenes) {
    for (const hotspot of scene.hotspots) {
      for (const [index, rule] of hotspot.onClick.entries())
        rules.push({
          path: `${scene.id}/${hotspot.id}/onClick/${index}`,
          rule,
        });
      for (const [item, uses] of Object.entries(hotspot.uses ?? {}))
        for (const [index, rule] of uses.entries())
          rules.push({
            path: `${scene.id}/${hotspot.id}/uses/${item}/${index}`,
            rule,
          });
    }
  }
  for (const dialogue of content.dialogues)
    for (const node of dialogue.nodes)
      for (const choice of node.choices)
        rules.push({
          path: `${dialogue.id}/${node.id}/${choice.id}`,
          rule: choice,
        });
  for (const combination of content.combinations)
    for (const [index, rule] of combination.rules.entries())
      rules.push({ path: `${combination.items.join('+')}/${index}`, rule });
  const leakedSpeech = rules.filter(({ rule }) =>
    /(?:Fero|Etela(?: Pečiatka)?|Karol(?: Odmerka)?|Milan(?: Jamka)?|(?:Otec )?Bonifác|Dežo(?: Magnet)?|Jolanda|Eržika|Špľuch|Nika|Béla|Dingo|Ľubo(?: Šťastný)?):/u.test(
      rule.message ?? '',
    ),
  );
  expect(leakedSpeech.map(({ path }) => path)).toEqual([]);
});

test('Dežo reveals the magnet before the player can ask its price', async () => {
  const content = await read();
  let state = reduceGame(
    content,
    { ...acceptedCase(content), sceneId: 'scene1' },
    {
      type: 'interact',
      hotspotId: 'layer2',
    },
  );
  expect(state.dialogue?.id).toBe('dezo-chat');
  expect(
    availableChoices(content, state).map((choice) => choice.id),
  ).not.toContain('deposit');
  const blocked = reduceGame(content, state, {
    type: 'choose',
    choiceId: 'deposit',
  });
  expect(blocked).toBe(state);
  const dialogue = content.dialogues.find((entry) => entry.id === 'dezo-chat')!;
  for (const node of dialogue.nodes) {
    const unread = { ...state, dialogue: { id: dialogue.id, nodeId: node.id } };
    expect(
      availableChoices(content, unread).map((choice) => choice.id),
      node.id,
    ).not.toContain('deposit');
    expect(
      reduceGame(content, unread, { type: 'choose', choiceId: 'deposit' }),
      node.id,
    ).toBe(unread);
  }
  const question = availableChoices(content, state).find(
    (choice) => choice.id === 'magnet',
  );
  expect(question).toBeDefined();
  expect(question?.next).toBe('magnet');
  expect(question?.text).not.toMatch(/magnet/iu);
  state = reduceGame(content, state, { type: 'choose', choiceId: 'magnet' });
  expect(state.dialogue?.nodeId).toBe('magnet');
  expect(state.flags['dezo-magnet-known']).toBe(true);
  expect(getDialogueNode(content, state)?.text).toMatch(/magnet/iu);
  expect(availableChoices(content, state).map((choice) => choice.id)).toContain(
    'deposit',
  );
  const saved = decodeSave(
    JSON.stringify({ version: 1, contentId: content.id, state }),
    content,
  );
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw Error(saved.message);
  state = reduceGame(content, saved.value, {
    type: 'choose',
    choiceId: 'deposit',
  });
  expect(state.dialogue?.nodeId).toBe('deposit');
});

for (const reaction of [
  {
    sceneId: 'scene6',
    hotspotId: 'gaming-door',
    actor: 'innkeeper',
    speaker: 'Karol',
    knowledge: 'pub-deal-known',
  },
  {
    sceneId: 'scene10',
    hotspotId: 'cow',
    itemId: 'funeral-form',
    actor: 'layer1',
    speaker: 'Jolanda',
    knowledge: 'cow-deal-known',
  },
  {
    sceneId: 'scene9',
    hotspotId: 'layer1',
    itemId: 'cold-coffee',
    actor: 'layer1',
    speaker: 'Dingo',
    knowledge: 'dingo-remedy-known',
  },
  {
    sceneId: 'scene1',
    hotspotId: 'layer2',
    itemId: 'empty-bottle',
    actor: 'layer2',
    speaker: 'Dežo',
    knowledge: undefined,
  },
]) {
  test(`${reaction.speaker} speaks an immediate text reaction without consuming supplies`, async () => {
    const content = await read();
    const before: GameState = {
      ...acceptedCase(content),
      sceneId: reaction.sceneId,
      inventory: reaction.itemId ? [reaction.itemId] : [],
    };
    const after = reduceGame(content, before, {
      type: 'interact',
      hotspotId: reaction.hotspotId,
      itemId: reaction.itemId,
    });
    const dialogue = content.dialogues.find(
      (entry) => entry.id === after.dialogue?.id,
    );
    expect(dialogue?.entry).toBe('speech');
    const node = getDialogueNode(content, after);
    expect(node?.actor).toEqual({
      sceneId: reaction.sceneId,
      hotspotId: reaction.actor,
    });
    expect(node?.speaker).toContain(reaction.speaker);
    expect(node?.text.trim().length).toBeGreaterThan(0);
    expect(node?.speech).toBeUndefined();
    expect(node?.choices).toEqual([]);
    expect(after.message).toBe('');
    expect(after.sceneId).toBe(before.sceneId);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.flags).toEqual({
      ...before.flags,
      ...(reaction.knowledge ? { [reaction.knowledge]: true } : {}),
    });
    expect(
      reduceGame(content, after, {
        type: 'interact',
        hotspotId: reaction.hotspotId,
      }),
    ).toBe(after);
    expect(
      reduceGame(content, after, { type: 'closeDialogue' }).dialogue,
    ).toBeNull();
  });
}

test('inventory inspection describes evidence without revealing future puzzle solutions', async () => {
  const content = await read();
  const spoilers: Record<string, RegExp> = {
    'crypt-key': /Ľub|posmrtn.{0,30}podnik/iu,
    'scrap-metal': /Dežo.{0,80}magnet|vymen|vymie[nň]|výmen/iu,
    potato: /žetón/iu,
    milk: /resuscitátor/iu,
    'coffee-grounds': /Dingo/iu,
    'cow-bell': /jackpot/iu,
    'funeral-form': /uspí.{0,20}krav|vstupenk/iu,
    'magnet-line': /kaplnk/iu,
    clothespin: /Milan|zastaví.{0,20}pohyb/iu,
  };
  for (const [itemId, spoiler] of Object.entries(spoilers)) {
    const state = reduceGame(
      content,
      { ...acceptedCase(content), inventory: [itemId] },
      {
        type: 'inspectItem',
        itemId,
      },
    );
    expect(state.message.trim().length, itemId).toBeGreaterThan(0);
    expect(state.message, itemId).not.toMatch(spoiler);
  }
});

// The archived recording is independent evidence of the words actually spoken.
// Matching speech.text alone would let a rewritten line reuse an obsolete WAV.
test('playable dialogue audio retains the words archived with its original recording', async () => {
  const content = await read();
  let checked = 0;
  for (const dialogue of content.dialogues) {
    for (const node of dialogue.nodes) {
      if (!node.speech || node.speech.text !== node.text) continue;
      const record = JSON.parse(
        await readFile(
          path.join(
            'src/assets',
            path.dirname(node.speech.audio),
            'record.json',
          ),
          'utf8',
        ),
      ) as { text: string };
      expect(node.text, `${dialogue.id}/${node.id}`).toBe(record.text);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
});

test('notebook details follow heard explanations and completed work stays completed before discovery', async () => {
  const content = await read();
  const located = syncTasks(content, {
    ...acceptedCase(content),
    flags: {
      'case-open': true,
      'scrapyard-known': true,
      'farm-known': true,
      'tools-taken': true,
      'bell-taken': true,
    },
  });
  const explanations = [
    {
      sceneId: 'scene10',
      hotspotId: 'layer1',
      choiceId: 'blessing',
      flag: 'cow-deal-known',
      task: 'cow-ritual',
    },
    {
      sceneId: 'scene6',
      hotspotId: 'innkeeper',
      choiceId: 'gaming',
      flag: 'pub-deal-known',
      task: 'open-herna',
    },
    {
      sceneId: 'scene3',
      hotspotId: 'priest',
      choiceId: 'cemetery',
      flag: 'priest-distraction-known',
      task: 'cemetery',
    },
    {
      sceneId: 'scene9',
      hotspotId: 'layer1',
      choiceId: 'coffee',
      flag: 'dingo-remedy-known',
      task: 'dingo-remedy',
    },
  ];
  for (const explanation of explanations) {
    expect(located.tasks[explanation.task], explanation.task).toBeUndefined();
    const menu = reduceGame(
      content,
      { ...located, sceneId: explanation.sceneId },
      {
        type: 'interact',
        hotspotId: explanation.hotspotId,
      },
    );
    expect(menu.dialogue).not.toBeNull();
    expect(menu.flags[explanation.flag], explanation.flag).not.toBe(true);
    expect(menu.tasks[explanation.task], explanation.task).toBeUndefined();
    const heard = reduceGame(content, menu, {
      type: 'choose',
      choiceId: explanation.choiceId,
    });
    expect(heard.flags[explanation.flag], explanation.flag).toBe(true);
    expect(heard.tasks[explanation.task], explanation.task).toBe('active');
  }
  const completed = syncTasks(content, {
    ...acceptedCase(content),
    flags: {
      'case-open': true,
      'cow-milked': true,
      'bell-taken': true,
      'log-found': true,
      'cemetery-open': true,
      'dingo-awake': true,
    },
  });
  const discoveredLater = syncTasks(content, {
    ...completed,
    flags: {
      'case-open': true,
      ...Object.fromEntries(explanations.map(({ flag }) => [flag, true])),
    },
  });
  for (const { flag, task } of explanations) {
    expect(completed.flags[flag], flag).not.toBe(true);
    expect(completed.tasks[task], task).toBe('completed');
    expect(discoveredLater.tasks[task], task).toBe('completed');
  }
});

test('Nika and Ľubo offer item-specific topics only while the referenced object is held', async () => {
  const content = await read();
  for (const topic of [
    {
      sceneId: 'scene7',
      hotspotId: 'sand-girl',
      dialogueId: 'girl-chat',
      choiceId: 'token',
      itemId: 'potato',
    },
    {
      sceneId: 'scene12',
      hotspotId: 'layer1',
      dialogueId: 'villain-chat',
      choiceId: 'bribe',
      itemId: 'fake-token',
    },
  ]) {
    const menu = reduceGame(
      content,
      { ...acceptedCase(content), sceneId: topic.sceneId },
      {
        type: 'interact',
        hotspotId: topic.hotspotId,
      },
    );
    expect(menu.dialogue?.id).toBe(topic.dialogueId);
    const dialogue = content.dialogues.find(
      (entry) => entry.id === topic.dialogueId,
    )!;
    for (const node of dialogue.nodes) {
      const withoutItem = {
        ...menu,
        dialogue: { id: dialogue.id, nodeId: node.id },
      };
      expect(
        availableChoices(content, withoutItem).map((choice) => choice.id),
        node.id,
      ).not.toContain(topic.choiceId);
      expect(
        reduceGame(content, withoutItem, {
          type: 'choose',
          choiceId: topic.choiceId,
        }),
        node.id,
      ).toBe(withoutItem);
      const withItem = { ...withoutItem, inventory: [topic.itemId] };
      expect(
        availableChoices(content, withItem).map((choice) => choice.id),
        node.id,
      ).toContain(topic.choiceId);
      const response = reduceGame(content, withItem, {
        type: 'choose',
        choiceId: topic.choiceId,
      });
      expect(response.dialogue?.nodeId).toBe(topic.choiceId);
      expect(
        getDialogueNode(content, response)?.text.trim().length,
      ).toBeGreaterThan(0);
      expect(response.inventory).toEqual([topic.itemId]);
    }
  }
});

test('taking the cable directly preserves the restoration decision through later uses and save/load', async () => {
  const content = await read();
  const start = acceptedCase(content);
  let state: GameState = {
    ...start,
    sceneId: 'scene12',
    unlockedScenes: [...start.unlockedScenes, 'scene12'],
    inventory: ['wrench', 'rubber-gloves', 'fake-token'],
  };
  const crypt = content.scenes.find((scene) => scene.id === 'scene12')!;
  const cable = crypt.hotspots.find((hotspot) =>
    hotspot.onClick.some((rule) =>
      rule.effects?.some(
        (effect) => effect.type === 'addItem' && effect.id === 'stolen-cable',
      ),
    ),
  )!;
  const battery = crypt.hotspots.find(
    (hotspot) => hotspot.label === 'Autobatéria',
  )!;
  state = reduceGame(content, state, {
    type: 'interact',
    hotspotId: cable.id,
  });
  expect(state.flags['cable-recovered']).toBe(true);
  expect(state.inventory).toContain('stolen-cable');
  const recovered = state;
  const saved = decodeSave(
    JSON.stringify({ version: 1, contentId: content.id, state }),
    content,
  );
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw Error(saved.message);
  expect(saved.value).toEqual(recovered);
  state = saved.value;
  for (const action of [
    { type: 'interact', hotspotId: battery.id },
    { type: 'interact', hotspotId: 'crypt-machine', itemId: 'fake-token' },
    { type: 'interact', hotspotId: cable.id },
  ] as const) {
    state = reduceGame(content, state, action);
    expect(state.inventory).toEqual(recovered.inventory);
    expect(state.flags).toEqual(recovered.flags);
    expect(state.flags['battery-isolated']).not.toBe(true);
    expect(state.flags['ending-jackpot']).not.toBe(true);
    expect(state.flags['ending-community']).not.toBe(true);
  }
  expect(matches(state, cable.visibleWhen)).toBe(false);
  expect(
    matches(
      state,
      crypt.hotspots.find((hotspot) => hotspot.id === 'machine-off')!
        .visibleWhen,
    ),
  ).toBe(true);
  state = reduceGame(content, state, {
    type: 'interact',
    hotspotId: 'crypt-machine',
  });
  expect(state.message).toMatch(/bez hlavného kábla/iu);
  state = reduceGame(content, state, { type: 'interact', hotspotId: 'layer1' });
  expect(state.dialogue?.id).toBe('villain-chat');
  const choices = availableChoices(content, state).map((choice) => choice.id);
  expect(choices).not.toContain('power');
  expect(choices).not.toContain('bribe');
  expect(choices).toContain('cable-taken');
  for (const choiceId of ['power', 'bribe'])
    expect(reduceGame(content, state, { type: 'choose', choiceId })).toBe(
      state,
    );
  state = reduceGame(content, state, {
    type: 'choose',
    choiceId: 'cable-taken',
  });
  expect(state.dialogue?.nodeId).toBe('cable-taken');
  expect(state.inventory).toEqual(recovered.inventory);
  expect(state.flags).toEqual(recovered.flags);
});
