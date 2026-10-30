import { useEffect, useRef, useState } from 'react';
import litUrl from '../assets/cutscenes/blackout/lit.webp';
import darkUrl from '../assets/cutscenes/blackout/dark.webp';
import switchUrl from '../assets/cutscenes/blackout/switch.mp3';
import electricityUrl from '../assets/cutscenes/blackout/electricity.mp3';
import voiceUrl from '../assets/cutscenes/blackout/voice.mp3';
import './cutscene.css';
import { t } from '../game/i18n';

// Village-wide blackout: Voronoi districts flicker and die out in a cascade
// from a random fault, timed to the switch and electricity recordings.
const ZONES = 10;
const MASK_W = 96;
const MASK_H = 72;
const ELECTRICITY_AFTER_SWITCH = 0.9; // s after the main switch click
const LIGHTS_CUT = 2.55; // s into the hum when districts start dying
const VOICE_PAUSE = 1000; // ms of silence after the hum
const HOLD_AFTER = 900; // ms on the dark village before fading to the game
const FADE_OUT = 700;
// Hum loudness in dB per 25 ms, measured from the electricity recording.
const ELECTRICITY_DB = [
  -101, -58, -26, -25, -24, -20, -21, -25, -24, -23, -22, -21, -20, -22, -23,
  -23, -23, -23, -23, -24, -26, -26, -26, -27, -25, -23, -24, -25, -27, -29,
  -27, -27, -27, -26, -26, -26, -26, -25, -25, -25, -25, -24, -23, -22, -22,
  -21, -21, -21, -22, -21, -23, -22, -24, -24, -23, -23, -23, -23, -23, -23,
  -23, -24, -24, -24, -26, -25, -24, -24, -27, -28, -28, -28, -26, -25, -25,
  -26, -28, -29, -28, -27, -28, -27, -27, -26, -25, -26, -27, -26, -26, -26,
  -23, -23, -24, -24, -24, -21, -18, -19, -19, -18, -20, -23, -22, -24, -28,
  -29, -29, -31, -32, -34, -35, -35, -33, -34, -34, -35, -36, -36, -39, -40,
  -42, -44, -45, -47, -47, -49, -50, -51, -52, -52, -56, -57, -60, -60, -63,
  -65, -65, -67, -69, -72, -73, -74, -76, -78, -78, -79, -81, -81, -80, -84,
  -87, -86, -85, -85, -85, -86, -86, -86, -84, -84, -82, -180,
];
// The dark photo is slightly scaled and shifted against the lit one:
// lit (x, y) maps to dark (AX*x + BX*y + CX, AY*x + BY*y + CY).
const AX = 1.002698,
  BX = 0.001101,
  CX = -0.149;
const AY = 0.000308,
  BY = 1.005351,
  CY = 0.304;
const CROP_W = 1442;
const CROP_H = 1079;

interface Zone {
  steps: { t: number; v: number }[];
  end: number;
  fade: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function buildZones() {
  const cols = 4,
    rows = Math.ceil(ZONES / cols);
  const seeds = Array.from({ length: ZONES }, (_, i) => ({
    x: ((i % cols) + rand(0.15, 0.85)) / cols,
    y: (Math.floor(i / cols) + rand(0.15, 0.85)) / rows,
  })).map((s) => ({ x: s.x * MASK_W, y: s.y * MASK_H }));
  const map = new Uint8Array(MASK_W * MASK_H);
  for (let y = 0; y < MASK_H; y++)
    for (let x = 0; x < MASK_W; x++) {
      let best = 0,
        bestDistance = Infinity;
      seeds.forEach((s, i) => {
        const d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      map[y * MASK_W + x] = best;
    }
  const origin = { x: rand(0, MASK_W), y: rand(0, MASK_H) };
  const zones: Zone[] = new Array<Zone>(ZONES);
  seeds
    .map((s, i) => ({ i, d: Math.hypot(s.x - origin.x, s.y - origin.y) }))
    .sort((a, b) => a.d - b.d)
    .forEach(({ i }, rank) => {
      let t = LIGHTS_CUT + rank * 0.03 + rand(0, 0.05);
      const steps: Zone['steps'] = [];
      // Some districts flicker once before dying.
      if (Math.random() < 0.4) {
        steps.push({ t, v: 0.25 });
        t += rand(0.06, 0.1);
        steps.push({ t, v: 0.9 });
        t += rand(0.08, 0.15);
      }
      zones[i] = { steps, end: t, fade: 0.25 };
    });
  return { map, zones };
}

// Weaker hum means weaker voltage before the cut.
function brownout(t: number) {
  if (t <= 0) return 1;
  const db =
    ELECTRICITY_DB[Math.min(ELECTRICITY_DB.length - 1, Math.floor(t / 0.025))]!;
  return 0.78 + 0.22 * Math.max(0, Math.min(1, (db + 28) / 8));
}

function zoneValue(zone: Zone, t: number) {
  let v = 1;
  for (const step of zone.steps) if (t >= step.t) v = step.v;
  if (t < zone.end) return v;
  // Filament afterglow: a fast drop with a slow tail.
  const p = Math.min(1, (t - zone.end) / zone.fade);
  return v * Math.pow(1 - p, 2.5);
}

function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}

export function BlackoutCutscene({ onFinish }: { onFinish: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<(() => void) | null>(null);
  const finishRef = useRef(onFinish);
  const [phase, setPhase] = useState<'loading' | 'gesture' | 'playing'>(
    'loading',
  );
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    finishRef.current = onFinish;
  }, [onFinish]);
  useEffect(() => skipRef.current?.focus(), []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const layer = document.createElement('canvas');
    const layerCtx = layer.getContext('2d')!;
    const mask = document.createElement('canvas');
    mask.width = MASK_W;
    mask.height = MASK_H;
    const maskCtx = mask.getContext('2d')!;
    const maskData = maskCtx.createImageData(MASK_W, MASK_H);
    const sound = (src: string, volume = 1) => {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = volume;
      return audio;
    };
    const switchSound = sound(switchUrl);
    const electricity = sound(electricityUrl);
    const voice = sound(voiceUrl, 0.3);
    const sounds = [switchSound, electricity, voice];
    const timers: number[] = [];
    const later = (callback: () => void, ms: number) =>
      timers.push(window.setTimeout(callback, ms));
    let frame = 0;
    let disposed = false;
    let finished = false;
    let lit: HTMLImageElement | null = null;
    let dark: HTMLImageElement | null = null;

    const drawDark = () => {
      const det = AX * BY - BX * AY;
      const a = BY / det,
        b = -AY / det,
        c = -BX / det,
        d = AX / det;
      ctx.setTransform(a, b, c, d, -(a * CX + c * CY), -(b * CX + d * CY));
      ctx.drawImage(dark!, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    const render = (map: Uint8Array, values: number[]) => {
      const data = maskData.data;
      for (let i = 0; i < map.length; i++) {
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
        data[i * 4 + 3] = values[map[i]!]! * 255;
      }
      maskCtx.putImageData(maskData, 0, 0);
      layerCtx.globalCompositeOperation = 'source-over';
      layerCtx.clearRect(0, 0, layer.width, layer.height);
      layerCtx.drawImage(lit!, 0, 0);
      layerCtx.globalCompositeOperation = 'destination-in';
      layerCtx.filter = 'blur(25px)';
      layerCtx.drawImage(mask, -40, -40, layer.width + 80, layer.height + 80);
      layerCtx.filter = 'none';
      drawDark();
      ctx.drawImage(layer, 0, 0);
    };
    const finish = () => {
      if (disposed || finished) return;
      finished = true;
      setLeaving(true);
      later(() => finishRef.current(), FADE_OUT);
    };
    const play = () => {
      setPhase('playing');
      const { map, zones } = buildZones();
      const shown = new Array<number>(ZONES).fill(1);
      const started = performance.now();
      let last = started;
      // Missing or blocked recordings must never stall the opening.
      const voiceDone = new Promise<void>((resolve) => {
        voice.addEventListener('ended', () => resolve(), { once: true });
        voice.addEventListener('error', () => resolve(), { once: true });
      });
      electricity.addEventListener(
        'ended',
        () =>
          later(() => {
            void voice.play().catch(() => undefined);
            later(finish, 6000);
          }, VOICE_PAUSE),
        { once: true },
      );
      later(
        () => void electricity.play().catch(() => later(finish, 4000)),
        ELECTRICITY_AFTER_SWITCH * 1000,
      );
      void voiceDone.then(() => later(finish, HOLD_AFTER));
      const tick = (now: number) => {
        const t = (now - started) / 1000 - ELECTRICITY_AFTER_SWITCH;
        const voltage = t >= LIGHTS_CUT ? 1 : brownout(t);
        const k = 1 - Math.exp(-Math.min(0.05, (now - last) / 1000) / 0.04);
        last = now;
        zones.forEach((zone, i) => {
          shown[i]! += (zoneValue(zone, t) * voltage - shown[i]!) * k;
        });
        render(map, shown);
        if (zones.some((zone) => t <= zone.end + zone.fade + 0.3))
          frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    startRef.current = () => {
      startRef.current = null;
      switchSound.play().then(play, play);
    };
    void Promise.all([loadImage(litUrl), loadImage(darkUrl)])
      .then(([litImage, darkImage]) => {
        if (disposed) return;
        lit = litImage;
        dark = darkImage;
        canvas.width = layer.width = Math.min(CROP_W, lit.naturalWidth);
        canvas.height = layer.height = Math.min(CROP_H, lit.naturalHeight);
        ctx.drawImage(lit, 0, 0);
        switchSound.play().then(
          () => {
            startRef.current = null;
            play();
          },
          // Browsers block sound until the player interacts with the page.
          () => {
            if (!disposed) setPhase('gesture');
          },
        );
      })
      .catch(finish);
    return () => {
      disposed = true;
      startRef.current = null;
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      for (const audio of sounds) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, []);

  return (
    <div
      className={`cutscene ${leaving ? 'is-leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('Úvod: výpadok prúdu')}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {phase === 'gesture' && (
        <button className="cutscene-start" onClick={() => startRef.current?.()}>
          ▶ {t('Spustiť úvod')}
        </button>
      )}
      <button
        ref={skipRef}
        className="cutscene-skip"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          onFinish();
        }}
      >
        {t('Preskočiť')} ›
      </button>
    </div>
  );
}
