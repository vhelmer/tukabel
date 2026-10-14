import { expect, test } from '@playwright/test';
// URL assets cannot be imported by Node. The browser suite validates the actual
// content bundle; these tests exercise the same reducer with a minimal fixture.
import { initialState, matches, reduceGame } from '../src/game/state';
import { decodeSave, loadGame, saveGame, SAVE_KEY } from '../src/game/storage';
import { validateContent } from '../src/game/validateContent';
import type { GameContent } from '../src/game/types';

const content: GameContent = {
  id: 'test',
  startScene: 'room',
  initialMessage: 'Ready',
  flags: ['taken', 'open'],
  items: ['a', 'b', 'c'].map((id) => ({
    id,
    label: id,
    description: id,
    icon: id,
  })),
  scenes: [
    {
      id: 'room',
      title: 'Room',
      width: 100,
      height: 100,
      background: '',
      hotspots: [
        {
          id: 'pickup',
          label: 'A',
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          visibleWhen: { not: { flag: 'taken' } },
          defaultVerb: 'take',
          actions: {
            take: [
              {
                message: 'Taken',
                effects: [
                  { type: 'addItem', id: 'a' },
                  { type: 'flag', id: 'taken', value: true },
                ],
              },
            ],
          },
        },
        {
          id: 'person',
          label: 'Person',
          bounds: { x: 20, y: 0, width: 10, height: 10 },
          defaultVerb: 'talk',
          actions: {
            talk: [
              { message: 'Hi', effects: [{ type: 'dialogue', id: 'talk' }] },
            ],
          },
        },
      ],
    },
  ],
  dialogues: [
    {
      id: 'talk',
      start: 'start',
      nodes: [
        {
          id: 'start',
          speaker: 'Person',
          text: 'Hi',
          choices: [
            {
              id: 'reward',
              text: 'Reward',
              when: { not: { item: 'b' } },
              effects: [{ type: 'addItem', id: 'b' }],
            },
            {
              id: 'locked',
              text: 'Locked',
              when: { flag: 'open' },
              effects: [{ type: 'flag', id: 'open', value: false }],
            },
          ],
        },
      ],
    },
  ],
  combinations: [
    {
      items: ['a', 'b'],
      rules: [
        {
          message: 'Combined',
          effects: [
            { type: 'removeItem', id: 'a' },
            { type: 'removeItem', id: 'b' },
            { type: 'addItem', id: 'c' },
          ],
        },
      ],
    },
  ],
};

test('rules enforce conditions, dialogue blocking, unique pickups and symmetric combinations', () => {
  let state = initialState(content);
  expect(
    matches(state, {
      all: [{ not: { item: 'a' } }, { flag: 'taken', value: false }],
    }),
  ).toBe(true);
  state = reduceGame(content, state, { type: 'interact', hotspotId: 'pickup' });
  expect(
    reduceGame(content, state, { type: 'interact', hotspotId: 'pickup' }),
  ).toBe(state);
  state = reduceGame(content, state, { type: 'interact', hotspotId: 'person' });
  expect(
    reduceGame(content, state, { type: 'choose', choiceId: 'locked' }),
  ).toBe(state);
  expect(
    reduceGame(content, state, { type: 'interact', hotspotId: 'pickup' }),
  ).toBe(state);
  state = reduceGame(content, state, { type: 'choose', choiceId: 'reward' });
  expect(state.inventory).toEqual(['a', 'b']);
  state = reduceGame(content, state, {
    type: 'combine',
    first: 'b',
    second: 'a',
  });
  expect(state.inventory).toEqual(['c']);
  expect(
    reduceGame(content, state, { type: 'combine', first: 'a', second: 'b' }),
  ).toBe(state);
});

test('content validation reports broken references, duplicate ids, bounds and unreachable rules', () => {
  expect(validateContent(content)).toEqual([]);
  const broken: GameContent = {
    ...content,
    startScene: 'missing',
    flags: ['taken', 'taken'],
    combinations: [
      {
        items: ['a', 'missing'],
        rules: [
          { message: 'fallback' },
          {
            when: { flag: 'missing' },
            message: 'bad',
            effects: [{ type: 'dialogue', id: 'missing' }],
          },
        ],
      },
    ],
    dialogues: [
      {
        id: 'talk',
        start: 'missing',
        nodes: [
          {
            id: 'node',
            speaker: '',
            text: '',
            choices: [{ id: 'next', text: '', next: 'missing' }],
          },
        ],
      },
    ],
    scenes: [
      {
        ...content.scenes[0]!,
        hotspots: [
          {
            ...content.scenes[0]!.hotspots[0]!,
            bounds: { x: -1, y: 0, width: 10, height: 10 },
          },
        ],
      },
    ],
  };
  const errors = validateContent(broken).join('\n');
  expect(errors).toContain('duplicate');
  expect(errors).toContain('bounds');
  expect(errors).toContain('shadows');
  expect(errors).toContain('talk/node');
  expect(errors).toContain('unknown reference');
});

test('saves round trip a dialogue and reject corrupt, incompatible and unknown state', () => {
  const state = reduceGame(content, initialState(content), {
    type: 'interact',
    hotspotId: 'person',
  });
  let raw = '';
  expect(
    saveGame(content, state, {
      setItem: (key, value) => {
        expect(key).toBe(SAVE_KEY);
        raw = value;
      },
    }).ok,
  ).toBe(true);
  expect(loadGame(content, { getItem: () => raw })).toEqual({
    ok: true,
    value: state,
  });
  for (const invalid of [
    '{',
    '{}',
    raw.replace('"version":1', '"version":99'),
    raw.replace('"inventory":[]', '"inventory":["missing"]'),
    raw.replace('"flags":{}', '"flags":{"open":"yes"}'),
    raw.replace('"nodeId":"start"', '"nodeId":"missing"'),
  ])
    expect(decodeSave(invalid, content).ok).toBe(false);
  expect(loadGame(content, { getItem: () => null }).ok).toBe(false);
  expect(
    saveGame(content, state, {
      setItem: () => {
        throw new Error('Quota');
      },
    }).ok,
  ).toBe(false);
  expect(
    loadGame(content, {
      getItem: () => {
        throw new Error('Denied');
      },
    }).ok,
  ).toBe(false);
});

test('JSON boundary rejects malformed shapes, unknown fields, remote assets and excessive nesting', async () => {
  const { validateProject } = await import('../src/game/validateProject');
  const { readFile } = await import('node:fs/promises');
  const project = JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
  expect(
    validateProject(project, [
      'demo-room.svg',
      'cable.svg',
      'caretaker.svg',
      'courtyard.svg',
      'favicon.svg',
    ]),
  ).toEqual([]);
  for (const invalid of [
    null,
    [],
    { ...project, scenes: null },
    { ...project, typo: true },
    { ...project, flags: [42] },
    {
      ...project,
      items: [
        {
          id: 'a',
          label: 'a',
          icon: '',
          description: '',
          image: 'https://remote.example/image.png',
        },
      ],
    },
    { ...project, combinations: [{ items: ['cable'], rules: null }] },
    {
      ...project,
      scenes: [
        {
          ...project.scenes[0],
          hotspots: [
            {
              id: 'bad',
              label: 'Bad',
              bounds: null,
              actions: {},
              defaultVerb: 'fly',
            },
          ],
        },
      ],
    },
  ])
    expect(validateProject(invalid).length).toBeGreaterThan(0);
  let deep: import('../src/game/types').Condition = { flag: 'powered' };
  for (let index = 0; index < 20; index++) deep = { not: deep };
  const malformed = {
    ...project,
    combinations: [
      {
        items: ['cable', 'tape'],
        rules: [
          {
            message: '',
            when: deep,
            effects: [{ type: 'flag', id: 'powered', value: 'yes' }],
          },
        ],
      },
    ],
  };
  expect(validateProject(malformed).join('\n')).toContain('too deep');
  expect(validateProject(malformed).join('\n')).toContain('effect value');
  expect(validateProject(project, []).join('\n')).toContain('missing asset');
});

test('pointer coordinates account for letterboxing and reject scene margins', async () => {
  const { scenePoint } = await import('../src/game/coordinates');
  const rect = { left: 10, top: 20, width: 640, height: 720 };
  const scene = { width: 1280, height: 720 };
  expect(scenePoint(rect, scene, 330, 380)).toEqual({ x: 640, y: 360 });
  expect(scenePoint(rect, scene, 20, 25)).toBeNull();
  expect(scenePoint({ ...rect, width: 0 }, scene, 10, 20)).toBeNull();
});
