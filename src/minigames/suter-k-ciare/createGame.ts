// Pixi scene for "Šuter k čiare": dirt lane, the scratched line and stones only.
// React mounts it and renders the intro, the kids' remarks and the result.
import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type Texture,
} from 'pixi.js';
import playgroundUrl from '../../assets/minigames/suter-k-ciare/playground.webp';
import { sfx } from './audio.ts';
import { NAMES, OPPONENT, pickLine, type Cue, type Speaker } from './lines.ts';
import {
  matchResult,
  planOpponentThrow,
  scoreThrow,
  STONES_EACH,
  TURN_ORDER,
  type MatchResult,
  type Thrower,
  type ThrowRecord,
} from './match.ts';
import {
  LINE_X,
  MAX_ANGLE,
  MAX_SPEED,
  MIN_SPEED,
  RELEASE_Z,
  SAMPLE_RATE,
  simulateThrow,
  type ThrowInput,
} from './physics.ts';

export const WIDTH = 1280;
export const HEIGHT = 720;
const LANE_Y = 640;
const ORIGIN_X = 200;
const PX_PER_CM = (1000 - ORIGIN_X) / LINE_X;
const LINE_SLANT = 0.1; // the scratched line leans into the distance
const MAX_DRAG = 240;
const LANE_OFFSETS = [-8, 6, 14, -14, 0, 18];
const FONT = '"Trebuchet MS", system-ui, sans-serif';
// TUKABEL palette: ink, plum panel, gold edge, cream paper
const INK = 0x2a1d17;
const PANEL = 0x291e24;
const GOLD = 0xd9a75b;
const CREAM = 0xffe0a0;
const PAPER = 0xf1dfbd;
const RED = 0xd8573c;

export interface GameHandle {
  restart(): void;
  destroy(): void;
}

export interface GameEvents {
  onFinish(result: MatchResult): void;
  /** A kid's remark; the host shows it for `seconds`. */
  onSay?(speaker: Speaker, name: string, text: string, seconds: number): void;
}

export type GamePhase = 'aim' | 'busy' | 'done';

interface Tween {
  elapsed: number;
  duration: number;
  update(p: number): void;
  resolve(): void;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeBack = (p: number) => 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function screenX(xCm: number, laneY: number) {
  return ORIGIN_X + xCm * PX_PER_CM + (LANE_Y - laneY) * LINE_SLANT;
}

function inputFromDrag(dx: number, dy: number): ThrowInput & { power: number } {
  // dx/dy = launch vector (opposite of the pull), screen space.
  const raw = (Math.atan2(-dy, Math.max(dx, 0.0001)) * 180) / Math.PI;
  const angle = Math.min(MAX_ANGLE, Math.max(0, raw));
  const power = Math.min(1, Math.hypot(dx, dy) / MAX_DRAG);
  return { angle, power, speed: MIN_SPEED + power * (MAX_SPEED - MIN_SPEED) };
}

function powerOf(input: ThrowInput) {
  return (input.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
}

export function formatDistance(d: number) {
  return d === Infinity ? '✗' : `${Math.round(d)} cm`;
}

export async function createGame(
  host: HTMLElement,
  events: GameEvents,
): Promise<GameHandle> {
  const app = new Application();
  await app.init({
    background: 0x18131b,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    width: host.clientWidth || WIDTH,
    height: host.clientHeight || HEIGHT,
  });
  const texture = (await Assets.load(playgroundUrl)) as Texture;
  host.appendChild(app.canvas);
  app.canvas.style.display = 'block';
  app.canvas.style.touchAction = 'none';

  let destroyed = false;
  let run = 0;
  const tweens = new Set<Tween>();
  const setPhase = (phase: GamePhase) => (host.dataset.phase = phase);

  // ---------- layers ----------
  const root = new Container();
  app.stage.addChild(root);
  const mask = new Graphics().rect(0, 0, WIDTH, HEIGHT).fill(0xffffff);
  root.addChild(mask);
  root.mask = mask;

  const bg = new Sprite(texture);
  bg.setSize(WIDTH, HEIGHT);
  const ground = new Container();
  const stones = new Container();
  const fx = new Container();
  const aimLayer = new Graphics();
  const hud = new Container();
  root.addChild(bg, ground, stones, fx, aimLayer, hud);
  drawLines(ground);

  // ---------- HUD ----------
  const board = new Container();
  board.position.set(16, 14);
  const caption = new Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: 26,
      fontWeight: '700',
      fill: CREAM,
      stroke: { color: PANEL, width: 6 },
    },
  });
  caption.anchor.set(0.5, 0);
  caption.position.set(WIDTH / 2, 18);
  const hint = new Text({
    text: 'Chyť myšou, potiahni DOZADU a pusť.  Dĺžka = sila, sklon = výška.',
    style: {
      fontFamily: FONT,
      fontSize: 19,
      fontWeight: '700',
      fill: CREAM,
      stroke: { color: PANEL, width: 5 },
    },
  });
  hint.anchor.set(0.5);
  hint.position.set(WIDTH / 2, 176);
  hud.addChild(board, caption, hint);

  function drawBoard(throws: ThrowRecord[], turn: number) {
    board.removeChildren().forEach((c) => c.destroy());
    board.addChild(
      new Graphics()
        .roundRect(0, 0, 356, 88, 10)
        .fill({ color: PANEL, alpha: 0.93 })
        .stroke({ color: GOLD, width: 2 }),
    );
    (['player', 'opponent'] as Thrower[]).forEach((who, row) => {
      const mine = throws.filter((t) => t.who === who);
      const best = Math.min(Infinity, ...mine.map((t) => t.distance));
      const active = TURN_ORDER[turn] === who;
      const y = 12 + row * 36;
      const icon = new Graphics()
        .poly(stoneShape(who, 0.62))
        .fill(stoneColor(who))
        .stroke({ color: INK, width: 2 });
      icon.position.set(22, y + 14);
      board.addChild(icon);
      const label = new Text({
        text: who === 'player' ? 'Ty' : NAMES[OPPONENT],
        style: {
          fontFamily: FONT,
          fontSize: 19,
          fontWeight: '700',
          fill: active ? CREAM : 0xb9afa0,
        },
      });
      label.position.set(40, y + 2);
      board.addChild(label);
      if (active) {
        board.addChild(
          new Graphics().rect(40, y + 26, label.width, 2).fill(GOLD),
        );
      }
      for (let i = 0; i < STONES_EACH; i++) {
        const t = mine[i];
        const isBest = t && t.valid && t.distance === best;
        const slot = new Text({
          text: t ? formatDistance(t.distance) : '·',
          style: {
            fontFamily: FONT,
            fontSize: 18,
            fontWeight: isBest ? '700' : '400',
            fill: !t ? 0x7d6e62 : !t.valid ? RED : isBest ? CREAM : 0xb9afa0,
          },
        });
        slot.anchor.set(0.5, 0);
        slot.position.set(160 + i * 72, y + 3);
        board.addChild(slot);
      }
    });
  }

  // ---------- tweens & ticker ----------
  function tween(duration: number, update: (p: number) => void = () => {}) {
    return new Promise<void>((resolve) => {
      tweens.add({ elapsed: 0, duration, update, resolve });
    });
  }
  const wait = (s: number) => tween(s);

  let time = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    time += dt;
    for (const t of [...tweens]) {
      t.elapsed += dt;
      const p = Math.min(1, t.elapsed / t.duration);
      t.update(p);
      if (p >= 1) {
        tweens.delete(t);
        t.resolve();
      }
    }
    if (handStone.visible && !drag) {
      handStone.y = releaseScreen.y + Math.sin(time * 3) * 2;
    }
  });

  // ---------- layout ----------
  const resize = () => {
    const w = host.clientWidth || WIDTH;
    const h = host.clientHeight || HEIGHT;
    app.renderer.resize(w, h);
    const s = Math.min(w / WIDTH, h / HEIGHT);
    root.scale.set(s);
    root.position.set((w - WIDTH * s) / 2, (h - HEIGHT * s) / 2);
    app.stage.hitArea = new Rectangle(0, 0, w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // ---------- remarks ----------
  function cue(c: Cue) {
    const [speaker, text] = pickLine(c);
    const seconds = 2.2 + text.length * 0.04;
    events.onSay?.(speaker, NAMES[speaker], text, seconds);
    sfx.babble(VOICES[speaker], Math.min(9, 3 + Math.round(text.length / 10)));
    return wait(0.7 + text.length * 0.02);
  }

  // ---------- aiming ----------
  const releaseScreen = {
    x: screenX(0, LANE_Y),
    y: LANE_Y - RELEASE_Z * PX_PER_CM,
  };
  let ghost: ThrowInput | undefined;
  let aimResolve: ((input: ThrowInput) => void) | undefined;
  let drag: { sx: number; sy: number; x: number; y: number } | undefined;
  let keyboardAim: ThrowInput = {
    angle: 35,
    speed: (MIN_SPEED + MAX_SPEED) / 2,
  };
  let lastStretchTick = 0;
  const handShadow = new Graphics()
    .ellipse(0, 0, 14, 4)
    .fill({ color: INK, alpha: 0.3 });
  handShadow.position.set(releaseScreen.x, LANE_Y + 4);
  const handStone = makeStone('player');
  fx.addChild(handShadow, handStone);
  const aimText = new Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: 18,
      fontWeight: '700',
      fill: CREAM,
      stroke: { color: PANEL, width: 4 },
    },
  });
  aimText.visible = false;
  fx.addChild(aimText);

  function showHandStone(who: Thrower | undefined) {
    handStone.visible = handShadow.visible = !!who;
    if (!who) return;
    handStone.clear();
    paintStone(handStone, who);
    handStone.position.set(releaseScreen.x, releaseScreen.y);
  }

  function drawArrow(
    input: ThrowInput,
    color: number,
    alpha: number,
    withMeter: boolean,
  ) {
    const power = powerOf(input);
    const rad = (input.angle * Math.PI) / 180;
    const len = 50 + power * 190;
    const dots = 10;
    for (let i = 1; i <= dots; i++) {
      const d = (len * i) / dots;
      aimLayer
        .circle(
          releaseScreen.x + Math.cos(rad) * d,
          releaseScreen.y - Math.sin(rad) * d,
          2.5 + (i / dots) * 3,
        )
        .fill({ color, alpha })
        .stroke({ color: INK, width: 2, alpha });
    }
    const tip = {
      x: releaseScreen.x + Math.cos(rad) * (len + 14),
      y: releaseScreen.y - Math.sin(rad) * (len + 14),
    };
    const side = rad + Math.PI / 2;
    aimLayer
      .poly([
        tip.x + Math.cos(rad) * 10,
        tip.y - Math.sin(rad) * 10,
        tip.x + Math.cos(side) * 9,
        tip.y - Math.sin(side) * 9,
        tip.x - Math.cos(side) * 9,
        tip.y + Math.sin(side) * 9,
      ])
      .fill({ color, alpha })
      .stroke({ color: INK, width: 2, alpha });
    if (withMeter) {
      const bx = 34;
      const by = 440;
      aimLayer
        .roundRect(bx, by, 18, 150, 6)
        .fill({ color: PANEL, alpha: 0.9 })
        .stroke({ color: GOLD, width: 2 });
      aimLayer
        .roundRect(bx + 3, by + 3 + 144 * (1 - power), 12, 144 * power, 4)
        .fill(color);
      aimText.text = `${Math.round(input.angle)}°  ${Math.round(power * 100)} %`;
      aimText.position.set(tip.x + 12, tip.y - 20);
      aimText.visible = true;
    }
  }

  function powerColor(p: number) {
    const r = Math.round(lerp(0xef, 0xd8, p));
    const g = Math.round(lerp(0xc8, 0x57, p));
    const b = Math.round(lerp(0x88, 0x3c, p));
    return (r << 16) | (g << 8) | b;
  }

  function renderAim(input?: ThrowInput, showGhost = true) {
    aimLayer.clear();
    aimText.visible = false;
    if (ghost && showGhost) drawArrow(ghost, 0xffffff, 0.3, false);
    if (input) drawArrow(input, powerColor(powerOf(input)), 1, true);
  }

  app.stage.eventMode = 'static';
  app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
    if (!aimResolve) return;
    host.focus({ preventScroll: true });
    const p = root.toLocal(e.global);
    drag = { sx: p.x, sy: p.y, x: p.x, y: p.y };
  });
  app.stage.on('globalpointermove', (e: FederatedPointerEvent) => {
    if (!drag || !aimResolve) return;
    const p = root.toLocal(e.global);
    drag.x = p.x;
    drag.y = p.y;
    const input = inputFromDrag(drag.sx - drag.x, drag.sy - drag.y);
    const pull = Math.min(
      1,
      Math.hypot(drag.sx - drag.x, drag.sy - drag.y) / MAX_DRAG,
    );
    const rad = (input.angle * Math.PI) / 180;
    handStone.position.set(
      releaseScreen.x - Math.cos(rad) * pull * 40,
      releaseScreen.y + Math.sin(rad) * pull * 40,
    );
    renderAim(input);
    if (time - lastStretchTick > 0.07) {
      lastStretchTick = time;
      sfx.stretch(input.power);
    }
  });
  const release = () => {
    if (!drag || !aimResolve) return;
    const dx = drag.sx - drag.x;
    const dy = drag.sy - drag.y;
    drag = undefined;
    if (Math.hypot(dx, dy) < 14) {
      renderAim();
      handStone.position.set(releaseScreen.x, releaseScreen.y);
      return;
    }
    const { angle, speed } = inputFromDrag(dx, dy);
    submitThrow({ angle, speed });
  };
  app.stage.on('pointerup', release);
  app.stage.on('pointerupoutside', release);

  function submitThrow(input: ThrowInput) {
    if (!aimResolve) return;
    const resolve = aimResolve;
    aimResolve = undefined;
    drag = undefined;
    setPhase('busy');
    resolve(input);
  }

  function renderKeyboardAim() {
    renderAim(keyboardAim);
    host.setAttribute(
      'aria-label',
      `Mierenie: ${Math.round(keyboardAim.angle)}°, ${Math.round(powerOf(keyboardAim) * 100)} %. Šípky hore a dole menia uhol, vľavo a vpravo silu. Enter alebo medzerník hodí šuter.`,
    );
  }

  function onAimKey(event: KeyboardEvent) {
    if (
      ![
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Enter',
        ' ',
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!aimResolve) return;
    if (event.key === 'Enter' || event.key === ' ') {
      if (!event.repeat) submitThrow(keyboardAim);
      return;
    }
    drag = undefined;
    handStone.position.set(releaseScreen.x, releaseScreen.y);
    const step = event.shiftKey ? 10 : 1;
    const angleDelta =
      event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
    const powerDelta =
      event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    keyboardAim = {
      angle: Math.max(0, Math.min(MAX_ANGLE, keyboardAim.angle + angleDelta)),
      speed: Math.max(
        MIN_SPEED,
        Math.min(
          MAX_SPEED,
          keyboardAim.speed + (powerDelta / 100) * (MAX_SPEED - MIN_SPEED),
        ),
      ),
    };
    renderKeyboardAim();
  }
  host.addEventListener('keydown', onAimKey);

  function playerAim() {
    showHandStone('player');
    keyboardAim = ghost ?? keyboardAim;
    renderKeyboardAim();
    setPhase('aim');
    return new Promise<ThrowInput>((resolve) => (aimResolve = resolve));
  }

  async function opponentAim(input: ThrowInput) {
    showHandStone('opponent');
    const startAngle = 20 + Math.random() * 30;
    await tween(1.1, (p) => {
      const e = easeOut(p);
      renderAim(
        {
          angle: lerp(startAngle, input.angle, e),
          speed: lerp(MIN_SPEED, input.speed, e),
        },
        false,
      );
      const rad = (lerp(startAngle, input.angle, e) * Math.PI) / 180;
      handStone.position.set(
        releaseScreen.x - Math.cos(rad) * e * 30,
        releaseScreen.y + Math.sin(rad) * e * 30,
      );
    });
    await wait(0.25);
  }

  // ---------- stones ----------
  function makeStone(who: Thrower) {
    return paintStone(new Graphics(), who);
  }

  function dust(x: number, y: number, strength: number) {
    for (let i = 0; i < 4 + strength * 5; i++) {
      const puff = new Graphics()
        .circle(0, 0, 6 + Math.random() * 7)
        .fill({ color: 0xd9b27a })
        .stroke({ color: 0xa8804e, width: 2 });
      puff.position.set(x, y);
      fx.addChild(puff);
      const vx = (Math.random() - 0.5) * 90;
      const vy = -10 - Math.random() * 40 * (0.5 + strength);
      void tween(0.5 + Math.random() * 0.3, (p) => {
        puff.position.set(x + vx * p, y + vy * p);
        puff.scale.set(1 + p * 1.2);
        puff.alpha = 0.85 * (1 - p);
      }).then(() => puff.destroy());
    }
  }

  async function animateThrow(who: Thrower, input: ThrowInput, laneY: number) {
    const result = simulateThrow(input);
    const stone = makeStone(who);
    const shadow = new Graphics()
      .ellipse(0, 0, 13, 4)
      .fill({ color: INK, alpha: 0.3 });
    stones.addChild(shadow, stone);
    showHandStone(undefined);
    renderAim();
    aimLayer.clear();
    aimText.visible = false;
    sfx.whoosh(powerOf(input));
    const last = result.samples.length - 1;
    let eventIdx = 0;
    let lastScrape = 0;
    await tween(last / SAMPLE_RATE, (p) => {
      const f = p * last;
      const i = Math.min(last - 1, Math.floor(f));
      const a = result.samples[i]!;
      const b = result.samples[Math.min(last, i + 1)]!;
      const k = f - i;
      const x = lerp(a.x, b.x, k);
      const z = lerp(a.z, b.z, k);
      const sx = screenX(x, laneY);
      stone.position.set(sx, laneY - z * PX_PER_CM);
      stone.rotation += (b.x - a.x) * 0.02;
      shadow.position.set(sx, laneY + 4);
      shadow.scale.set(Math.max(0.4, 1 - z / 300));
      while (
        eventIdx < result.events.length &&
        result.events[eventIdx]!.sample <= f
      ) {
        const ev = result.events[eventIdx++]!;
        sfx.thud(ev.strength);
        dust(sx, laneY, ev.strength);
      }
      if (a.sliding > 0 && time - lastScrape > 0.06) {
        lastScrape = time;
        sfx.scrape(a.sliding);
        if (Math.random() < 0.3) dust(sx, laneY, 0.05);
      }
    });
    return result.restX;
  }

  async function measure(record: ThrowRecord, laneY: number) {
    const sx = screenX(record.restX, laneY);
    const lx = screenX(LINE_X, laneY);
    const tag = new Text({
      text: record.valid ? `${Math.round(record.distance)}` : '✗',
      style: {
        fontFamily: FONT,
        fontSize: 15,
        fontWeight: '700',
        fill: record.valid ? (record.who === 'player' ? PAPER : 0xffc2a8) : RED,
        stroke: { color: INK, width: 4 },
      },
    });
    tag.anchor.set(0.5, 0);
    tag.position.set(Math.min(WIDTH - 16, sx), laneY + 10);
    stones.addChild(tag);
    if (!record.valid) {
      sfx.whistle();
      const big = bigLabel('PREHODENÉ!', RED);
      big.position.set(Math.min(lx, WIDTH - 180), 360);
      await popLabel(big);
      return;
    }
    const tape = new Graphics();
    fx.addChild(tape);
    const big = bigLabel(formatDistance(record.distance), CREAM);
    big.position.set((sx + lx) / 2, laneY - 70);
    await tween(0.35, (p) => {
      const end = lerp(sx, lx, easeOut(p));
      tape
        .clear()
        .rect(sx, laneY - 3, end - sx, 6)
        .fill(0xefc888)
        .stroke({ color: INK, width: 2 });
      for (let t = sx; t < end; t += 8)
        tape
          .moveTo(t, laneY - 3)
          .lineTo(t, laneY)
          .stroke({ color: INK, width: 1 });
    });
    await popLabel(big);
    tape.destroy();
  }

  function bigLabel(text: string, color: number) {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT,
        fontSize: 42,
        fontWeight: '700',
        fill: color,
        stroke: { color: PANEL, width: 8 },
      },
    });
    t.anchor.set(0.5);
    fx.addChild(t);
    return t;
  }

  async function popLabel(t: Text) {
    await tween(0.3, (p) => t.scale.set(easeBack(p)));
    await wait(0.6);
    await tween(0.25, (p) => (t.alpha = 1 - p));
    t.destroy();
  }

  function reactionCue(r: ThrowRecord): Cue {
    const prefix = r.who === 'player' ? 'player' : 'opponent';
    if (!r.valid) return `${prefix}Over`;
    if (r.distance < 12) return `${prefix}Great`;
    if (r.distance < 40) return `${prefix}Good`;
    return `${prefix}Meh`;
  }

  async function runMatch() {
    const myRun = ++run;
    const alive = () => !destroyed && myRun === run;
    const throws: ThrowRecord[] = [];
    let playerThrows = 0;
    caption.text = 'Šuter k čiare';
    drawBoard(throws, 0);
    await cue('intro');
    for (let turn = 0; turn < TURN_ORDER.length; turn++) {
      if (!alive()) return;
      const who = TURN_ORDER[turn]!;
      drawBoard(throws, turn);
      const laneY = LANE_Y + LANE_OFFSETS[turn]!;
      let input: ThrowInput;
      if (who === 'player') {
        caption.text = `Tvoj hod ${playerThrows + 1}/${STONES_EACH}`;
        if (playerThrows > 0 && Math.random() < 0.4) void cue('yourTurn');
        hint.visible = playerThrows === 0;
        input = await playerAim();
        hint.visible = false;
        ghost = input;
        playerThrows++;
      } else {
        caption.text = `Hádže ${NAMES[OPPONENT]}`;
        await wait(0.3);
        input = planOpponentThrow(throws);
        await opponentAim(input);
      }
      if (!alive()) return;
      const restX = await animateThrow(who, input, laneY);
      if (!alive()) return;
      const record = scoreThrow(who, restX);
      throws.push(record);
      drawBoard(throws, turn);
      await measure(record, laneY);
      if (!alive()) return;
      await cue(reactionCue(record));
    }
    if (!alive()) return;
    const result = matchResult(throws);
    drawBoard(throws, -1);
    caption.text =
      result.outcome === 'win'
        ? 'Vyhral si!'
        : result.outcome === 'lose'
          ? 'Prehral si.'
          : result.outcome === 'draw'
            ? 'Remíza'
            : 'Nikto netrafil';
    sfx.whistle();
    await wait(0.5);
    if (result.outcome === 'win') sfx.win();
    else if (result.outcome === 'lose') sfx.lose();
    await cue(result.outcome);
    await wait(0.6);
    if (!alive()) return;
    setPhase('done');
    events.onFinish(result);
  }

  function reset() {
    setPhase('busy');
    // Pending tweens of the previous match never resolve, so its async flow just stops.
    tweens.clear();
    stones.removeChildren().forEach((c) => c.destroy());
    fx.removeChildren().forEach(
      (c) =>
        c !== handStone && c !== handShadow && c !== aimText && c.destroy(),
    );
    fx.addChild(handShadow, handStone, aimText);
    aimResolve = undefined;
    drag = undefined;
    ghost = undefined;
    showHandStone(undefined);
    renderAim();
  }

  reset();
  void runMatch();

  return {
    restart() {
      run++;
      reset();
      void runMatch();
    },
    destroy() {
      destroyed = true;
      run++;
      tweens.clear();
      observer.disconnect();
      host.removeEventListener('keydown', onAimKey);
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

const VOICES: Record<Speaker, number> = { spluch: 210, nika: 420, bela: 170 };

function stoneColor(who: Thrower) {
  return who === 'player' ? 0x9a968a : 0xb0513a;
}

function stoneShape(who: Thrower, scale = 1) {
  const pts: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r =
      (11 + Math.sin(i * 2.7 + (who === 'player' ? 0 : 1.3)) * 2.5) * scale;
    pts.push(Math.cos(a) * r * 1.15, Math.sin(a) * r * 0.85);
  }
  return pts;
}

/** Flat stone with one cel-shade band and a bold outline. */
function paintStone(g: Graphics, who: Thrower) {
  const shape = stoneShape(who);
  g.poly(shape).fill(stoneColor(who));
  g.ellipse(2, 4, 10, 4.5).fill({ color: INK, alpha: 0.22 });
  g.ellipse(-4, -4, 4, 2).fill({ color: 0xffffff, alpha: 0.35 });
  g.poly(shape).stroke({ color: INK, width: 3 });
  return g;
}

/** Throw mark on the left and the scratched target line Nika drew. */
function drawLines(layer: Container) {
  const g = new Graphics();
  const lineAt = (y: number) => screenX(LINE_X, y);
  for (const [offset, color, width] of [
    [3, 0xf0d29c, 10],
    [0, 0x3e2414, 6],
  ] as const) {
    g.moveTo(lineAt(578) + offset, 578);
    for (let y = 578; y <= 720; y += 12) {
      g.lineTo(lineAt(y) + offset + Math.sin(y * 0.13) * 1.6, y);
    }
    g.stroke({ color, width, cap: 'round', join: 'round' });
  }
  // short scuffed throw mark under the release point
  const mx = screenX(0, LANE_Y) - 4;
  g.moveTo(mx + 6, LANE_Y - 26)
    .lineTo(mx - 4, LANE_Y + 34)
    .stroke({ color: 0x4a2c1a, width: 4, cap: 'round', alpha: 0.7 });
  layer.addChild(g);
}
