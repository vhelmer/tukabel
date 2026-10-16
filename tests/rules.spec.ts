import { expect, test } from '@playwright/test';
// URL assets cannot be imported by Node. The browser suite validates the actual
// content bundle; these tests exercise the same reducer with a minimal fixture.
import { initialState, matches, reduceGame } from '../src/game/state';
import { decodeSave, loadGame, saveGame, SAVE_KEY } from '../src/game/storage';
import { validateContent } from '../src/game/validateContent';
import type { GameContent } from '../src/game/types';
import {
  imagePlacement,
  containsPoint,
  rotatedBounds,
  isInsideScene,
} from '../src/game/transforms';

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

          onClick: [
            {
              message: 'Taken',
              effects: [
                { type: 'addItem', id: 'a' },
                { type: 'flag', id: 'taken', value: true },
              ],
            },
          ],
        },
        {
          id: 'person',
          label: 'Person',
          bounds: { x: 20, y: 0, width: 10, height: 10 },

          onClick: [
            { message: 'Hi', effects: [{ type: 'dialogue', id: 'talk' }] },
          ],
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
  const { readFile, readdir } = await import('node:fs/promises');
  const project = JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
  expect(
    validateProject(project, await readdir('src/assets', { recursive: true })),
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
              onClick: [],
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

test('shared image fitting preserves portrait/landscape proportions and only explicit stretching deforms', () => {
  const frame = { x: 10, y: 20, width: 400, height: 200 };
  const portrait = imagePlacement(frame, { width: 100, height: 300 });
  expect(portrait.width / portrait.height).toBeCloseTo(1 / 3);
  expect(portrait.height).toBe(200);
  expect(portrait.x + portrait.width / 2).toBe(210);
  const landscape = imagePlacement(frame, { width: 800, height: 200 });
  expect(landscape).toEqual({ x: 10, y: 70, width: 400, height: 100 });
  expect(imagePlacement(frame, { width: 100, height: 300 }, 'stretch')).toEqual(
    frame,
  );
});

test('rotated clickable geometry follows the visual rectangle rather than its original bounding box', () => {
  const hotspot = {
    bounds: { x: 150, y: 190, width: 100, height: 20 },
    rotation: 90,
  };
  expect(containsPoint(hotspot, { x: 200, y: 245 })).toBe(true);
  expect(containsPoint(hotspot, { x: 245, y: 200 })).toBe(false);
  const bounds = rotatedBounds(hotspot.bounds, 90);
  expect(bounds.x).toBeCloseTo(190);
  expect(bounds.y).toBeCloseTo(150);
  expect(bounds.width).toBeCloseTo(20);
  expect(bounds.height).toBeCloseTo(100);
  expect(isInsideScene(hotspot.bounds, { width: 400, height: 400 }, 90)).toBe(
    true,
  );
  expect(
    isInsideScene(
      { x: 0, y: 0, width: 100, height: 20 },
      { width: 400, height: 400 },
      90,
    ),
  ).toBe(false);
});

test('editor scaling keeps proportions, anchors rotated corners and stops at scene edges', async () => {
  const { resizeBounds, moveBounds, editDimension } =
    await import('../src/editor/transformTools');
  const { centre, rotateAround } = await import('../src/game/transforms');
  const bounds = { x: 200, y: 150, width: 100, height: 200 },
    scene = { width: 1000, height: 800 };
  for (const angle of [0, 30, 90]) {
    const resized = resizeBounds(bounds, angle, { x: 60, y: 100 }, scene, true);
    expect(resized.width / resized.height).toBeCloseTo(0.5, 4);
    const before = rotateAround(
      { x: bounds.x, y: bounds.y },
      centre(bounds),
      angle,
    );
    const after = rotateAround(
      { x: resized.x, y: resized.y },
      centre(resized),
      angle,
    );
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
    expect(isInsideScene(resized, scene, angle)).toBe(true);
    expect(
      isInsideScene(
        resizeBounds(bounds, angle, { x: 5000, y: 5000 }, scene, true),
        scene,
        angle,
      ),
    ).toBe(true);
    expect(
      isInsideScene(
        moveBounds(bounds, angle, { x: -5000, y: 5000 }, scene),
        scene,
        angle,
      ),
    ).toBe(true);
  }
  expect(editDimension(bounds, 'width', 150, true)).toEqual({
    ...bounds,
    width: 150,
    height: 300,
  });
  expect(editDimension(bounds, 'width', 150, false)).toEqual({
    ...bounds,
    width: 150,
  });
});

test('JSON validates transform modes, numeric angles and rotated scene limits', async () => {
  const { validateProject } = await import('../src/game/validateProject');
  const project = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
  const withTransform = (patch: Record<string, unknown>) => ({
    ...project,
    scenes: project.scenes.map((scene, index) =>
      index
        ? scene
        : {
            ...scene,
            hotspots: scene.hotspots.map((h, i) =>
              i ? h : { ...h, ...patch },
            ),
          },
    ),
  });
  expect(
    validateProject(withTransform({ rotation: 15, imageFit: 'contain' })),
  ).toEqual([]);
  for (const patch of [
    { rotation: '90' },
    { rotation: Infinity },
    { rotation: 361 },
    { imageFit: 'squash' },
    { rotation: 45, bounds: { x: 0, y: 0, width: 100, height: 20 } },
  ])
    expect(validateProject(withTransform(patch)).length).toBeGreaterThan(0);
});

test('clicks support silent decoration and effects without mandatory commentary', () => {
  const project: GameContent = {
    ...content,
    scenes: content.scenes.map((scene) => ({
      ...scene,
      hotspots: [
        ...scene.hotspots,
        {
          id: 'silent',
          label: 'Silent',
          bounds: { x: 40, y: 0, width: 10, height: 10 },
          onClick: [],
        },
        {
          id: 'switch',
          label: 'Switch',
          bounds: { x: 50, y: 0, width: 10, height: 10 },
          onClick: [{ effects: [{ type: 'flag', id: 'open', value: true }] }],
        },
      ],
    })),
  };
  expect(validateContent(project)).toEqual([]);
  const state = initialState(project);
  const silent = reduceGame(project, state, {
    type: 'interact',
    hotspotId: 'silent',
  });
  expect(silent).toEqual({ ...state, message: '' });
  const switched = reduceGame(project, silent, {
    type: 'interact',
    hotspotId: 'switch',
  });
  expect(switched.flags.open).toBe(true);
  expect(switched.message).toBe('');
  expect(switched.inventory).toEqual(state.inventory);
});

test('cursor and portrait validation rejects missing links, mismatched sources and old verb data', async () => {
  const { validateProject } = await import('../src/game/validateProject');
  const { readFile } = await import('node:fs/promises');
  const project = JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
  const withCursor = (patch: Record<string, unknown>) => ({
    ...project,
    scenes: project.scenes.map((scene, i) => ({
      ...scene,
      hotspots: scene.hotspots.map((hotspot, j) =>
        i === 0 && j === 0
          ? {
              ...hotspot,
              cursorImage: 'woman.png',
              cursorAnimation: 'woman-blink',
              ...patch,
            }
          : hotspot,
      ),
    })),
  });
  expect(
    validateProject(
      withCursor({ cursorSize: 48, cursorOffset: [4, 4], onClick: [] }),
    ),
  ).toEqual([]);
  for (const patch of [
    { cursorAnimation: 'missing' },
    { cursorImage: 'cable.svg' },
    { cursorSize: 0 },
    { cursorOffset: [-1, 4] },
    { cursor: 'unknown' },
    { onClick: null },
    { onClick: [{ message: 5 }] },
    { actions: { look: [] } },
  ])
    expect(validateProject(withCursor(patch)).length).toBeGreaterThan(0);
  const invalidPortrait = {
    ...project,
    dialogues: project.dialogues.map((d) => ({
      ...d,
      nodes: d.nodes.map((n) => ({
        ...n,
        portrait: 'https://remote.example/portrait.png',
      })),
    })),
  };
  expect(validateProject(invalidPortrait).join('\n')).toContain(
    'local image asset',
  );
});
