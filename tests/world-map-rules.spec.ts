import { expect, test } from '@playwright/test';
import { initialState, reduceGame } from '../src/game/state';
import { decodeSave, saveGame } from '../src/game/storage';
import type { GameContent, GameState, WorldMapPoint } from '../src/game/types';
import { validateContent } from '../src/game/validateContent';
import { validateProject } from '../src/game/validateProject';

const points: WorldMapPoint[] = [
  { id: 'home-point', label: 'Domov', sceneId: 'home', x: 0, y: 0 },
  {
    id: 'road-point',
    label: 'Cesta',
    sceneId: 'road',
    x: 20,
    y: 20,
    unlockWhen: { all: [] },
  },
  {
    id: 'gate-point',
    label: 'Brána',
    sceneId: 'gate',
    x: 40,
    y: 40,
    unlockWhen: { all: [{ flag: 'open' }, { not: { item: 'key' } }] },
  },
  {
    id: 'cache-point',
    label: 'Skrýša',
    sceneId: 'cache',
    x: 60,
    y: 60,
    unlockWhen: { item: 'key' },
  },
  {
    id: 'walk-point',
    label: 'Pešo',
    sceneId: 'walk',
    x: 80,
    y: 80,
    unlockWhen: { all: [] },
    fastTravel: false,
  },
  { id: 'manual-point', label: 'Tajnosť', sceneId: 'manual', x: 100, y: 100 },
];
const content: GameContent = {
  id: 'map-test',
  startScene: 'home',
  initialMessage: '',
  flags: ['open'],
  items: [{ id: 'key', label: 'Kľúč', description: '', icon: 'K' }],
  scenes: ['home', 'road', 'gate', 'cache', 'walk', 'manual', 'unmapped'].map(
    (id) => ({
      id,
      title: id,
      width: 100,
      height: 100,
      background: 'map.svg',
      hotspots: [
        {
          id: 'pickup',
          label: 'Kľúč',
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          onClick: [{ effects: [{ type: 'addItem', id: 'key' }] }],
        },
        {
          id: 'consume',
          label: 'Odomknúť',
          bounds: { x: 20, y: 0, width: 10, height: 10 },
          onClick: [
            {
              effects: [
                { type: 'removeItem', id: 'key' },
                { type: 'flag', id: 'open', value: true },
              ],
            },
          ],
        },
        {
          id: 'walk',
          label: 'Prejsť',
          bounds: { x: 40, y: 0, width: 10, height: 10 },
          onClick: [{ effects: [{ type: 'scene', id: 'walk' }] }],
        },
        {
          id: 'manual',
          label: 'Odhalenie',
          bounds: { x: 60, y: 0, width: 10, height: 10 },
          onClick: [{ effects: [{ type: 'unlockScene', id: 'manual' }] }],
        },
        {
          id: 'talk',
          label: 'Rozhovor',
          bounds: { x: 80, y: 0, width: 10, height: 10 },
          onClick: [{ effects: [{ type: 'dialogue', id: 'talk' }] }],
        },
      ],
    }),
  ),
  dialogues: [
    {
      id: 'talk',
      start: 'start',
      nodes: [
        {
          id: 'start',
          speaker: 'Fero',
          text: 'Ahoj',
          choices: [{ id: 'leave', text: 'Čau' }],
        },
      ],
    },
  ],
  combinations: [],
  worldMap: { image: 'map.svg', width: 100, height: 100, points },
};
const click = (state: GameState, hotspotId: string) =>
  reduceGame(content, state, { type: 'interact', hotspotId });
const serialized = (state: unknown) =>
  JSON.stringify({ version: 1, contentId: content.id, state });

test('locations unlock from shared conditions and stay unlocked after consuming the revealing item', () => {
  const start = initialState(content);
  expect(start.unlockedScenes).toEqual(['home', 'road', 'walk']);
  const picked = click(start, 'pickup');
  expect(picked.unlockedScenes).toEqual(['home', 'road', 'walk', 'cache']);
  const consumed = click(picked, 'consume');
  expect(consumed.inventory).toEqual([]);
  expect(consumed.unlockedScenes).toEqual([
    'home',
    'road',
    'walk',
    'cache',
    'gate',
  ]);
  expect(start.unlockedScenes).toEqual(['home', 'road', 'walk']);
  expect(click(consumed, 'manual').unlockedScenes).toContain('manual');
  expect(consumed.unlockedScenes).not.toContain('manual');
});

test('map travel accepts only unlocked configured destinations with fast travel enabled', () => {
  const start = initialState(content);
  for (const sceneId of [
    'gate',
    'manual',
    'unmapped',
    'missing',
    'home',
    'walk',
  ])
    expect(reduceGame(content, start, { type: 'travel', sceneId })).toBe(start);
  const road = reduceGame(content, start, { type: 'travel', sceneId: 'road' });
  expect(road.sceneId).toBe('road');
  expect(road.message).toBe('');
  const talking = click(start, 'talk');
  expect(
    reduceGame(content, talking, { type: 'travel', sceneId: 'road' }),
  ).toBe(talking);
  const walked = click(start, 'walk');
  expect(walked.sceneId).toBe('walk');
  expect(walked.unlockedScenes).toContain('walk');
  expect(
    reduceGame({ ...content, worldMap: undefined }, start, {
      type: 'travel',
      sceneId: 'road',
    }),
  ).toBe(start);
});

test('normal transitions latch visited locations even without a world map', () => {
  const plain = { ...content, worldMap: undefined };
  const start = initialState(plain);
  expect(start.unlockedScenes).toEqual(['home']);
  const visited = reduceGame(plain, start, {
    type: 'interact',
    hotspotId: 'walk',
  });
  expect(visited.unlockedScenes).toEqual(['home', 'walk']);
});

test('version 1 save migration reconstructs only start, current and currently provable unlocks', () => {
  const legacy = {
    ...initialState(content),
    sceneId: 'manual',
    inventory: ['key'],
  } as Partial<GameState>;
  delete legacy.unlockedScenes;
  const decoded = decodeSave(serialized(legacy), content);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error(decoded.message);
  expect(decoded.value.unlockedScenes).toEqual([
    'home',
    'manual',
    'road',
    'cache',
    'walk',
  ]);
  const progressed = click(click(initialState(content), 'pickup'), 'consume');
  let raw = '';
  expect(
    saveGame(content, progressed, {
      setItem: (_key, value) => {
        raw = value;
      },
    }).ok,
  ).toBe(true);
  expect(decodeSave(raw, content)).toEqual({ ok: true, value: progressed });
});

test('saved unlocked locations reject malformed values, duplicates and unknown scenes', () => {
  for (const unlockedScenes of [
    null,
    {},
    'home',
    ['home', 'home'],
    ['missing'],
    [42],
  ])
    expect(
      decodeSave(
        serialized({ ...initialState(content), unlockedScenes }),
        content,
      ).ok,
    ).toBe(false);
});

test('project validation checks map shape, local image, coordinates, references and conditions', () => {
  expect(validateProject(content, ['map.svg'])).toEqual([]);
  for (const worldMap of [
    null,
    {},
    { ...content.worldMap, image: 'https://example.com/map.png' },
    { ...content.worldMap, image: 'missing.svg' },
    { ...content.worldMap, width: 0 },
    { ...content.worldMap, height: -1 },
    { ...content.worldMap, width: Infinity },
    { ...content.worldMap, points: {} },
  ])
    expect(
      validateProject({ ...content, worldMap }, ['map.svg']).length,
    ).toBeGreaterThan(0);
  for (const change of [
    { id: 'bad id' },
    { id: '__proto__' },
    { label: '' },
    { sceneId: 'missing' },
    { x: -1 },
    { y: 101 },
    { x: NaN },
    { fastTravel: 'yes' },
    { unlockWhen: { flag: 'missing' } },
    { unlockWhen: { item: 'missing' } },
    { unlockWhen: { all: 'invalid' } },
    { unexpected: true },
  ])
    expect(
      validateProject({
        ...content,
        worldMap: {
          ...content.worldMap,
          points: [{ ...points[0], ...change }],
        },
      }).length,
    ).toBeGreaterThan(0);
  for (const duplicate of [
    { ...points[1]!, id: points[0]!.id },
    { ...points[1]!, sceneId: points[0]!.sceneId },
  ])
    expect(
      validateContent({
        ...content,
        worldMap: { ...content.worldMap!, points: [points[0]!, duplicate] },
      }).length,
    ).toBeGreaterThan(0);
  const invalidEffect: GameContent = {
    ...content,
    scenes: [
      {
        ...content.scenes[0]!,
        hotspots: [
          {
            ...content.scenes[0]!.hotspots[0]!,
            onClick: [{ effects: [{ type: 'unlockScene', id: 'missing' }] }],
          },
        ],
      },
    ],
  };
  expect(validateContent(invalidEffect).join(' ')).toContain('missing');
});

test('world map image IDs are relative local paths even without an asset registry', () => {
  for (const image of ['/map.svg', 'maps//map.svg', '../map.svg'])
    expect(
      validateProject({ ...content, worldMap: { ...content.worldMap, image } })
        .length,
    ).toBeGreaterThan(0);
});
