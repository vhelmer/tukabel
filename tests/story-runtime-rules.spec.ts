import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  initialState,
  reduceGame,
  getDialogueNode,
  matches,
} from '../src/game/state';
import * as gameState from '../src/game/state';
const getEnding = (...args: Parameters<typeof gameState.getEnding>) =>
  gameState.getEnding(...args);
import { decodeSave } from '../src/game/storage';
import { validateProject } from '../src/game/validateProject';
import type { GameContent } from '../src/game/types';

const content: GameContent = {
  id: 'story-runtime-test',
  startScene: 'yard',
  startDialogue: 'intro',
  initialMessage: '',
  flags: ['community', 'jackpot'],
  scenes: [
    {
      id: 'yard',
      title: 'Dvor',
      width: 1280,
      height: 720,
      background: 'yard.svg',
      ambient: 'ambience/village.wav',
      hotspots: [
        {
          id: 'win',
          label: 'Oprava',
          bounds: { x: 10, y: 10, width: 30, height: 30 },
          onClick: [
            { effects: [{ type: 'flag', id: 'community', value: true }] },
          ],
        },
      ],
    },
  ],
  items: [],
  dialogues: [
    {
      id: 'intro',
      start: 'hello',
      entry: 'speech',
      nodes: [{ id: 'hello', speaker: 'Fero', text: 'Vitaj.', choices: [] }],
    },
  ],
  endings: [
    {
      id: 'community',
      when: { flag: 'community' },
      title: 'Dedina žije',
      text: 'Svetlo pre všetkých.',
      ambient: 'ambience/ending.wav',
    },
    {
      id: 'jackpot',
      when: { flag: 'jackpot' },
      title: 'Výhra',
      text: 'Automat vyhral.',
    },
  ],
  combinations: [],
};

test('a new game opens the authored conversation while older content remains compatible', () => {
  expect(initialState(content).dialogue).toEqual({
    id: 'intro',
    nodeId: 'hello',
  });
  expect(
    initialState({ ...content, startDialogue: undefined }).dialogue,
  ).toBeNull();
});

test('ending is derived from persistent flags and survives save decoding without a separate ending state', () => {
  const start = { ...initialState(content), dialogue: null };
  expect(getEnding(content, start)).toBeUndefined();
  const won = reduceGame(content, start, {
    type: 'interact',
    hotspotId: 'win',
  });
  expect(getEnding(content, won)?.id).toBe('community');
  const decoded = decodeSave(
    JSON.stringify({ version: 1, contentId: content.id, state: won }),
    content,
  );
  expect(decoded.ok).toBe(true);
  if (decoded.ok)
    expect(getEnding(content, decoded.value)?.id).toBe('community');
  expect(getEnding(content, { ...start, flags: { jackpot: true } })?.id).toBe(
    'jackpot',
  );
  expect(getEnding(content, start)).toBeUndefined();
  expect(reduceGame(content, won, { type: 'interact', hotspotId: 'win' })).toBe(
    won,
  );
});

test('story references and local WAV ambience are validated', () => {
  expect(
    validateProject(content, [
      'yard.svg',
      'ambience/village.wav',
      'ambience/ending.wav',
    ]),
  ).toEqual([]);
  expect(
    validateProject({ ...content, startDialogue: 'missing' }).join(' '),
  ).toContain('startDialogue');
  expect(
    validateProject({ ...content, openingCutscene: 'blackout' }, [
      'yard.svg',
      'ambience/village.wav',
      'ambience/ending.wav',
    ]),
  ).toEqual([]);
  expect(
    validateProject({
      ...content,
      openingCutscene: 'sunrise' as 'blackout',
    }).join(' '),
  ).toContain('openingCutscene');
  expect(
    validateProject({
      ...content,
      startDialogue: undefined,
      openingCutscene: 'blackout',
    }).join(' '),
  ).toContain('requires startDialogue');
  expect(
    validateProject({
      ...content,
      endings: [{ ...content.endings![0], when: { flag: 'missing' } }],
    }).join(' '),
  ).toContain('unknown reference');
  expect(
    validateProject({
      ...content,
      endings: [{ ...content.endings![0], when: undefined }],
    }).join(' '),
  ).toContain('when');
  expect(
    validateProject({
      ...content,
      endings: [content.endings![0], content.endings![0]],
    }).join(' '),
  ).toContain('duplicate');
  expect(
    validateProject({
      ...content,
      scenes: [
        { ...content.scenes[0], ambient: 'https://example.com/audio.wav' },
      ],
    }).join(' '),
  ).toContain('local WAV');
  expect(validateProject(content, ['yard.svg']).join(' ')).toContain(
    'missing asset',
  );
});

test('ending IDs follow the shared stable ID contract', () => {
  expect(
    validateProject({
      ...content,
      endings: [{ ...content.endings![0], id: '__proto__' }],
    }).join(' '),
  ).toContain('Invalid stable ID');
});

test('original ambience and effect assets are quiet valid local PCM WAVs', () => {
  for (const name of [
    'village',
    'tavern',
    'graveyard',
    'barn',
    'crypt',
    'ending',
    'pickup',
    'combine',
    'travel',
  ]) {
    const bytes = readFileSync(`src/assets/ambience/${name}.wav`);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect(bytes.readUInt16LE(20)).toBe(1);
    expect(bytes.readUInt16LE(22)).toBe(1);
    expect(bytes.readUInt32LE(24)).toBe(22050);
    expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
    let peak = 0;
    for (let index = 44; index < bytes.length; index += 2)
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(index)));
    expect(peak).toBeGreaterThan(100);
    expect(peak).toBeLessThan(6000);
    expect(bytes.readInt16LE(44)).toBe(0);
    expect(Math.abs(bytes.readInt16LE(bytes.length - 2))).toBeLessThan(2);
  }
});

test('a flag and closing speech in one action defer the epilogue until the dialogue closes', () => {
  const withSpeech: GameContent = {
    ...content,
    scenes: [
      {
        ...content.scenes[0]!,
        hotspots: [
          {
            ...content.scenes[0]!.hotspots[0]!,
            onClick: [
              {
                effects: [
                  { type: 'flag', id: 'community', value: true },
                  { type: 'dialogue', id: 'intro' },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const pending = reduceGame(
    withSpeech,
    { ...initialState(withSpeech), dialogue: null },
    {
      type: 'interact',
      hotspotId: 'win',
    },
  );
  expect(pending.flags.community).toBe(true);
  expect(pending.dialogue?.id).toBe('intro');
  expect(getEnding(withSpeech, pending)).toBeUndefined();
  const finished = reduceGame(withSpeech, pending, { type: 'closeDialogue' });
  expect(finished.dialogue).toBeNull();
  expect(getEnding(withSpeech, finished)?.id).toBe('community');
  expect(reduceGame(withSpeech, finished, { type: 'closeDialogue' })).toBe(
    finished,
  );
});

for (const finale of [
  {
    sceneId: 'scene4',
    target: 'junction-box',
    item: 'fixed-cable',
    dialogueId: 'fero-ending',
    endingId: 'community',
    flag: 'ending-community',
    actorId: 'layer1',
    speaker: 'Fero',
  },
  {
    sceneId: 'scene12',
    target: 'crypt-machine',
    item: 'fake-token',
    dialogueId: 'lubo-ending',
    endingId: 'jackpot',
    flag: 'ending-jackpot',
    actorId: 'layer1',
    speaker: 'Ľubo Šťastný',
  },
]) {
  test(`${finale.speaker} speaks before the authored ${finale.endingId} epilogue and a saved pending line resumes safely`, () => {
    const authored = JSON.parse(
      readFileSync('src/game/content/project.json', 'utf8'),
    ) as GameContent;
    const pending = reduceGame(
      authored,
      {
        ...initialState(authored),
        sceneId: finale.sceneId,
        dialogue: null,
        inventory: [finale.item],
      },
      { type: 'interact', hotspotId: finale.target, itemId: finale.item },
    );
    expect(pending.flags[finale.flag]).toBe(true);
    expect(pending.inventory).not.toContain(finale.item);
    expect(pending.dialogue?.id).toBe(finale.dialogueId);
    expect(getEnding(authored, pending)).toBeUndefined();
    const node = getDialogueNode(authored, pending)!;
    expect(node.speaker).toBe(finale.speaker);
    expect(node.actor).toEqual({
      sceneId: finale.sceneId,
      hotspotId: finale.actorId,
    });
    expect(node.choices).toEqual([]);
    expect(
      authored.dialogues.find((d) => d.id === finale.dialogueId)?.entry,
    ).toBe('speech');
    const actor = authored.scenes
      .find((s) => s.id === finale.sceneId)!
      .hotspots.find((h) => h.id === finale.actorId)!;
    expect(matches(pending, actor.visibleWhen)).toBe(true);
    expect(
      reduceGame(authored, pending, {
        type: 'interact',
        hotspotId: finale.target,
        itemId: finale.item,
      }),
    ).toBe(pending);
    const decoded = decodeSave(
      JSON.stringify({ version: 1, contentId: authored.id, state: pending }),
      authored,
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw Error(decoded.message);
    expect(getEnding(authored, decoded.value)).toBeUndefined();
    const finished = reduceGame(authored, decoded.value, {
      type: 'closeDialogue',
    });
    expect(finished.flags).toEqual(pending.flags);
    expect(finished.inventory).toEqual(pending.inventory);
    expect(getEnding(authored, finished)?.id).toBe(finale.endingId);
    expect(reduceGame(authored, finished, { type: 'closeDialogue' })).toBe(
      finished,
    );
  });
}
