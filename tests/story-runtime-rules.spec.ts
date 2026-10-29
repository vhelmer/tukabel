import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { initialState, reduceGame } from '../src/game/state';
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
