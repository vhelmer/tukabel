import { expect, test } from '@playwright/test';
import { initialState, reduceGame } from '../src/game/state';
import { decodeSave } from '../src/game/storage';
import type {
  GameAction,
  GameContent,
  GameState,
  Hotspot,
} from '../src/game/types';
import { getActionSound } from '../src/game/actionSound';
import { validateProject } from '../src/game/validateProject';

const content: GameContent = {
  id: 'soundtrack-test',
  startScene: 'yard',
  initialMessage: '',
  flags: ['ready', 'done'],
  scenes: [
    {
      id: 'yard',
      title: 'Dvor',
      width: 100,
      height: 100,
      background: 'yard.svg',
      ambient: 'audio/ambient.wav',
      music: 'audio/music.wav',
      hotspots: [
        {
          id: 'machine',
          label: 'Stroj',
          bounds: { x: 10, y: 10, width: 20, height: 20 },
          onClick: [
            {
              when: { flag: 'ready' },
              sound: 'audio/click.wav',
              effects: [{ type: 'flag', id: 'done', value: true }],
            },
            { message: 'Ešte nie.' },
          ],
          uses: {
            key: [
              {
                when: { flag: 'ready' },
                sound: 'audio/use.wav',
                effects: [{ type: 'removeItem', id: 'key' }],
              },
              { message: 'Ešte nie.' },
            ],
          },
        },
      ],
    },
  ],
  items: [
    { id: 'key', label: 'Kľúč', description: '', icon: 'K' },
    { id: 'wire', label: 'Drôt', description: '', icon: 'D' },
  ],
  dialogues: [],
  endings: [
    {
      id: 'finish',
      when: { flag: 'done' },
      title: 'Koniec',
      text: 'Hotovo.',
      music: 'audio/ending.wav',
    },
  ],
  combinations: [
    {
      items: ['key', 'wire'],
      rules: [
        {
          when: { flag: 'ready' },
          sound: 'audio/combine.wav',
          effects: [{ type: 'removeItem', id: 'wire' }],
        },
        { message: 'Ešte nie.' },
      ],
    },
  ],
};
const assets = [
  'yard.svg',
  ...['ambient', 'music', 'click', 'use', 'ending', 'combine'].map(
    (name) => `audio/${name}.wav`,
  ),
];
const withHotspot = (change: Partial<Hotspot>): GameContent => ({
  ...content,
  scenes: [
    {
      ...content.scenes[0]!,
      hotspots: [{ ...content.scenes[0]!.hotspots[0]!, ...change }],
    },
  ],
});

test('music and branch sounds accept local WAV assets without changing existing projects', () => {
  expect(validateProject(content, assets)).toEqual([]);
  expect(
    validateProject(
      { ...content, scenes: [{ ...content.scenes[0]!, music: undefined }] },
      assets,
    ),
  ).toEqual([]);
});

test('music and branch sounds reject remote, malformed and missing asset IDs', () => {
  for (const sound of [
    'https://example.com/music.wav',
    '/audio/music.wav',
    '../music.wav',
    'audio//music.wav',
    'audio/./music.wav',
    'audio/music.mp3',
    '',
    null,
    123,
  ]) {
    const scene = { ...content.scenes[0]!, music: sound };
    const ending = { ...content.endings![0]!, music: sound };
    const hotspot = {
      ...content.scenes[0]!.hotspots[0]!,
      onClick: [{ sound }],
    };
    for (const changed of [
      { ...content, scenes: [scene] },
      { ...content, endings: [ending] },
      { ...content, scenes: [{ ...content.scenes[0]!, hotspots: [hotspot] }] },
      {
        ...content,
        combinations: [{ items: ['key', 'wire'], rules: [{ sound }] }],
      },
      {
        ...content,
        scenes: [
          {
            ...content.scenes[0]!,
            hotspots: [{ ...hotspot, onClick: [], uses: { key: [{ sound }] } }],
          },
        ],
      },
    ])
      expect(validateProject(changed).join(' ')).toContain('local WAV');
  }
  expect(validateProject(content, ['yard.svg']).join(' ')).toContain(
    'missing asset',
  );
});

const click: GameAction = { type: 'interact', hotspotId: 'machine' };
const use: GameAction = { ...click, itemId: 'key' };
const combine: GameAction = { type: 'combine', first: 'wire', second: 'key' };
const ready = (): GameState => ({
  ...initialState(content),
  flags: { ready: true },
  inventory: ['key', 'wire'],
});
const cue = (state: GameState, action: GameAction, project = content) =>
  getActionSound(project, state, action, reduceGame(project, state, action));

test('the first matching rule alone chooses the click, use and reverse-order combination sound', () => {
  expect(cue(ready(), click)).toBe('audio/click.wav');
  expect(cue(ready(), use)).toBe('audio/use.wav');
  expect(cue(ready(), combine)).toBe('audio/combine.wav');
  const firstSilent = withHotspot({
    onClick: [{ message: 'Ticho.' }, { sound: 'audio/click.wav' }],
  });
  expect(cue(ready(), click, firstSilent)).toBeUndefined();
});

test('unmatched conditions, later fallbacks and silent scenery do not choose a sound', () => {
  for (const action of [click, use, combine])
    expect(cue({ ...ready(), flags: {} }, action)).toBeUndefined();
  expect(cue(ready(), click, withHotspot({ onClick: [] }))).toBeUndefined();
  expect(
    cue(
      ready(),
      click,
      withHotspot({
        onClick: [
          { when: { flag: 'ready', value: false }, sound: 'audio/click.wav' },
        ],
      }),
    ),
  ).toBeUndefined();
});

test('rejected world dispatches cannot play a sound even when a stale next state is supplied', () => {
  const state = ready();
  expect(getActionSound(content, state, click, state)).toBeUndefined();
  for (const blocked of [
    { ...state, dialogue: { id: 'talk', nodeId: 'start' } },
    { ...state, flags: { ready: true, done: true } },
    { ...state, inventory: [] },
  ])
    for (const action of [use, combine])
      expect(
        getActionSound(content, blocked, action, { ...blocked }),
      ).toBeUndefined();
  for (const change of [
    { hidden: true },
    { decorative: true },
    { opacity: 0 },
    { visibleWhen: { flag: 'ready', value: false } },
  ]) {
    const project = withHotspot(change);
    expect(getActionSound(project, state, click, { ...state })).toBeUndefined();
    expect(cue(state, click, project)).toBeUndefined();
  }
  for (const action of [
    { type: 'interact', hotspotId: 'missing' },
    { type: 'interact', hotspotId: 'machine', itemId: 'missing' },
    { type: 'combine', first: 'key', second: 'key' },
    { type: 'combine', first: 'key', second: 'missing' },
    { type: 'inspectItem', itemId: 'key' },
    { type: 'travel', sceneId: 'yard' },
    { type: 'choose', choiceId: 'stale' },
    { type: 'closeDialogue' },
  ] satisfies GameAction[])
    expect(
      getActionSound(content, state, action, { ...state }),
    ).toBeUndefined();
});

test('sound is transient and restoring progress cannot replay an earlier action cue', () => {
  const state = ready();
  const next = reduceGame(content, state, use);
  expect(getActionSound(content, state, use, next)).toBe('audio/use.wav');
  const serialized = JSON.stringify({
    version: 1,
    contentId: content.id,
    state: next,
  });
  const loaded = decodeSave(serialized, content);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.message);
  expect(
    getActionSound(content, loaded.value, use, loaded.value),
  ).toBeUndefined();
  expect(cue(loaded.value, use)).toBeUndefined();
  expect(serialized).not.toContain('audio/');
  expect(initialState(content)).not.toHaveProperty('sound');
});
