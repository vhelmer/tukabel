// Deterministic side-view throw simulation in centimetres and seconds.
// x = distance from the thrower along the lane, z = height above the dirt.

export const LINE_X = 600;
export const RELEASE_Z = 95;
export const MIN_SPEED = 180;
export const MAX_SPEED = 820;
export const MIN_ANGLE = 0;
export const MAX_ANGLE = 75;

const GRAVITY = 981;
const RESTITUTION = 0.28; // vertical bounce kept after impact
const IMPACT_FRICTION = 0.32; // horizontal speed lost per unit of vertical impact
const SLIDE_DECEL = 470; // dirt friction while sliding (μ·g)
const MIN_BOUNCE = 110; // slower vertical impacts don't bounce at all
const STEP = 1 / 240;
export const SAMPLE_RATE = 60;

export interface ThrowInput {
  angle: number; // degrees above the ground
  speed: number; // cm/s
}

export interface PathSample {
  x: number;
  z: number;
  sliding: number; // 0..1 scrape intensity, drives the sound
}

export interface ThrowEvent {
  sample: number;
  type: 'land';
  strength: number; // 0..1
}

export interface ThrowResult {
  samples: PathSample[];
  events: ThrowEvent[];
  restX: number;
}

export function clampThrow(input: ThrowInput): ThrowInput {
  return {
    angle: Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, input.angle)),
    speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, input.speed)),
  };
}

export function simulateThrow(input: ThrowInput): ThrowResult {
  const { angle, speed } = clampThrow(input);
  const rad = (angle * Math.PI) / 180;
  let x = 0;
  let z = RELEASE_Z;
  let vx = speed * Math.cos(rad);
  let vz = speed * Math.sin(rad);
  let airborne = true;
  const samples: PathSample[] = [{ x, z, sliding: 0 }];
  const events: ThrowEvent[] = [];
  const stepsPerSample = Math.round(1 / STEP / SAMPLE_RATE);
  let step = 0;

  while (step < 240 * 20) {
    if (airborne) {
      vz -= GRAVITY * STEP;
      x += vx * STEP;
      z += vz * STEP;
      if (z <= 0) {
        z = 0;
        const impact = -vz;
        vx = Math.max(0, vx - IMPACT_FRICTION * (1 + RESTITUTION) * impact);
        const bounce = impact * RESTITUTION;
        airborne = bounce > MIN_BOUNCE;
        vz = airborne ? bounce : 0;
        events.push({
          sample: samples.length,
          type: 'land',
          strength: Math.min(1, impact / 900),
        });
      }
    } else {
      x += vx * STEP;
      vx = Math.max(0, vx - SLIDE_DECEL * STEP);
    }
    step++;
    const resting = !airborne && vx === 0;
    if (step % stepsPerSample === 0 || resting) {
      samples.push({
        x,
        z,
        sliding: airborne ? 0 : Math.min(1, vx / 400),
      });
    }
    if (resting) break;
  }
  return { samples, events, restX: x };
}

/** Speed needed to stop at targetX for a given angle (bisection; result is monotonic enough). */
export function solveSpeed(angle: number, targetX: number): number {
  let lo = MIN_SPEED;
  let hi = MAX_SPEED;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (simulateThrow({ angle, speed: mid }).restX < targetX) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
