// Match rules and the opponent's throwing brain. Pure, no Pixi.
import { LINE_X, solveSpeed, type ThrowInput } from './physics.ts';

export type Thrower = 'player' | 'opponent';
export const STONES_EACH = 3;
export const TURN_ORDER: Thrower[] = Array.from(
  { length: STONES_EACH * 2 },
  (_, i) => (i % 2 === 0 ? 'player' : 'opponent'),
);

export interface ThrowRecord {
  who: Thrower;
  restX: number;
  valid: boolean;
  distance: number; // cm short of the line; Infinity when over
}

export type Outcome = 'win' | 'lose' | 'draw' | 'nobody';

export interface MatchResult {
  outcome: Outcome;
  playerBest: number; // Infinity = no valid throw
  opponentBest: number;
  throws: ThrowRecord[];
}

export function scoreThrow(who: Thrower, restX: number): ThrowRecord {
  const valid = restX <= LINE_X;
  return { who, restX, valid, distance: valid ? LINE_X - restX : Infinity };
}

export function bestDistance(throws: ThrowRecord[], who: Thrower): number {
  return Math.min(
    Infinity,
    ...throws.filter((t) => t.who === who).map((t) => t.distance),
  );
}

/** Distances are compared at whole-centimetre precision, like the rat measures them. */
export function matchResult(throws: ThrowRecord[]): MatchResult {
  const playerBest = bestDistance(throws, 'player');
  const opponentBest = bestDistance(throws, 'opponent');
  const p = Math.round(playerBest);
  const o = Math.round(opponentBest);
  const outcome: Outcome =
    playerBest === Infinity && opponentBest === Infinity
      ? 'nobody'
      : p < o
        ? 'win'
        : p > o
          ? 'lose'
          : 'draw';
  return { outcome, playerBest, opponentBest, throws };
}

function gaussian(rng: () => number): number {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * Ďurko aims a bit short of the line and gets greedier when he is losing.
 * Noise is applied to his release, so he obeys the same physics as the player.
 */
export function planOpponentThrow(
  throws: ThrowRecord[],
  rng: () => number = Math.random,
): ThrowInput {
  const mine = bestDistance(throws, 'opponent');
  const theirs = bestDistance(throws, 'player');
  const losing = theirs < mine;
  const margin = losing ? Math.max(6, Math.min(theirs * 0.6, 22)) : 34;
  const angle = 28 + rng() * 24;
  const speed = solveSpeed(angle, LINE_X - margin);
  return {
    angle: angle + gaussian(rng) * 1.6,
    speed: speed * (1 + gaussian(rng) * 0.027),
  };
}
