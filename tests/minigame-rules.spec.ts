import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { initialState, reduceGame } from '../src/game/state';
import { decodeSave } from '../src/game/storage';
import { validateProject } from '../src/game/validateProject';
import type { GameContent, GameState } from '../src/game/types';
import {
  LINE_X,
  MAX_SPEED,
  simulateThrow,
  solveSpeed,
} from '../src/minigames/suter-k-ciare/physics';
import {
  matchResult,
  planOpponentThrow,
  scoreThrow,
  TURN_ORDER,
  type ThrowRecord,
} from '../src/minigames/suter-k-ciare/match';

const project = JSON.parse(
  readFileSync('src/game/content/project.json', 'utf8'),
) as GameContent;

function atPlayground(): GameState {
  return { ...initialState(project), sceneId: 'scene7', dialogue: null };
}

test('the scratched line in the playground starts Šuter k čiare', () => {
  const state = reduceGame(project, atPlayground(), {
    type: 'interact',
    hotspotId: 'stone-line',
  });
  expect(state.minigame).toBe('suter-k-ciare');
  // The running minigame owns input: no world actions, no travel.
  expect(
    reduceGame(project, state, { type: 'interact', hotspotId: 'swing-boy' }),
  ).toBe(state);
  expect(
    reduceGame(project, state, { type: 'travel', sceneId: 'scene4' }),
  ).toBe(state);
});

test('a win latches the flag, a later loss keeps it, leaving closes the game', () => {
  let state = reduceGame(project, atPlayground(), {
    type: 'interact',
    hotspotId: 'stone-line',
  });
  state = reduceGame(project, state, { type: 'finishMinigame', won: false });
  expect(state.flags['stone-game-won']).toBeFalsy();
  expect(state.message).toContain('tehlou');
  state = reduceGame(project, state, { type: 'finishMinigame', won: true });
  expect(state.flags['stone-game-won']).toBe(true);
  state = reduceGame(project, state, { type: 'finishMinigame', won: false });
  expect(state.flags['stone-game-won']).toBe(true);
  state = reduceGame(project, state, { type: 'closeMinigame' });
  expect(state.minigame).toBeNull();
  expect(
    reduceGame(project, state, { type: 'finishMinigame', won: true }),
  ).toBe(state);
});

test('a save made during the minigame loads back into the scene', () => {
  const state = reduceGame(project, atPlayground(), {
    type: 'interact',
    hotspotId: 'stone-line',
  });
  const loaded = decodeSave(
    JSON.stringify({ version: 1, contentId: project.id, state }),
    project,
  );
  expect(loaded.ok && loaded.value.minigame).toBeNull();
  expect(loaded.ok && loaded.value.sceneId).toBe('scene7');
});

test('validator knows minigames and their win flag', () => {
  expect(validateProject(project)).toEqual([]);
  const unknown = structuredClone(project) as GameContent & {
    minigames: { id: string; winFlag: string }[];
  };
  unknown.minigames.push({ id: 'pexeso', winFlag: 'stone-game-won' });
  expect(validateProject(unknown).join('\n')).toContain('unknown minigame');
  const missingFlag = structuredClone(project) as typeof unknown;
  missingFlag.minigames[0]!.winFlag = 'missing-flag';
  expect(validateProject(missingFlag).join('\n')).toContain('missing-flag');
});

test('Šuter k čiare: deterministic throws, lobs stop sooner, solver is precise', () => {
  const a = simulateThrow({ angle: 35, speed: 600 });
  expect(simulateThrow({ angle: 35, speed: 600 })).toEqual(a);
  expect(simulateThrow({ angle: 40, speed: MAX_SPEED }).restX).toBeGreaterThan(
    LINE_X + 100,
  );
  const low = simulateThrow({ angle: 10, speed: solveSpeed(10, 500) });
  const lob = simulateThrow({ angle: 65, speed: solveSpeed(65, 500) });
  const landing = (r: typeof low) => r.samples[r.events[0]!.sample]!.x;
  expect(low.restX - landing(low)).toBeGreaterThan(lob.restX - landing(lob));
  for (const angle of [15, 35, 55])
    expect(
      Math.abs(
        simulateThrow({ angle, speed: solveSpeed(angle, 560) }).restX - 560,
      ),
    ).toBeLessThan(3);
});

test('Šuter k čiare: scoring and a beatable opponent', () => {
  const at = (who: 'player' | 'opponent', d: number): ThrowRecord =>
    scoreThrow(who, LINE_X - d);
  expect(scoreThrow('player', LINE_X + 1).valid).toBe(false);
  expect(matchResult([at('player', 10), at('opponent', 20)]).outcome).toBe(
    'win',
  );
  expect(matchResult([at('player', 30), at('opponent', 20)]).outcome).toBe(
    'lose',
  );
  expect(matchResult([at('player', 20.2), at('opponent', 19.9)]).outcome).toBe(
    'draw',
  );
  expect(TURN_ORDER).toHaveLength(6);
  let seed = 7;
  const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let wins = 0;
  for (let game = 0; game < 300; game++) {
    const throws: ThrowRecord[] = [];
    for (let i = 0; i < 3; i++) {
      throws.push(at('player', 20));
      throws.push(
        scoreThrow(
          'opponent',
          simulateThrow(planOpponentThrow(throws, rng)).restX,
        ),
      );
    }
    if (matchResult(throws).opponentBest < 20) wins++;
  }
  // Against a steady 20 cm player Špľuch should win sometimes, not always.
  expect(wins / 300).toBeGreaterThan(0.2);
  expect(wins / 300).toBeLessThan(0.7);
});
