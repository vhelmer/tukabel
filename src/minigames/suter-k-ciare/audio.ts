// Tiny synthesized sound effects. No audio files, unlocked on first user gesture.
let ctx: AudioContext | undefined;
let master: GainNode | undefined;

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, out: master! };
}

export function unlockAudio() {
  audio();
}

function noiseBuffer(c: AudioContext, seconds: number) {
  const buf = c.createBuffer(
    1,
    Math.ceil(c.sampleRate * seconds),
    c.sampleRate,
  );
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function envelope(
  c: AudioContext,
  peak: number,
  attack: number,
  release: number,
) {
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  return g;
}

function noise(
  seconds: number,
  filter: BiquadFilterType,
  freq: number,
  peak: number,
) {
  const { ctx: c, out } = audio();
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, seconds);
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  const g = envelope(c, peak, 0.01, seconds);
  src.connect(f).connect(g).connect(out);
  src.start();
  return { f, c };
}

function tone(
  type: OscillatorType,
  from: number,
  to: number,
  seconds: number,
  peak: number,
  delay = 0,
) {
  const { ctx: c, out } = audio();
  const o = c.createOscillator();
  o.type = type;
  const t = c.currentTime + delay;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + seconds);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + seconds + 0.05);
}

export const sfx = {
  stretch(power: number) {
    tone('triangle', 120 + power * 260, 130 + power * 280, 0.05, 0.05);
  },
  whoosh(power: number) {
    const { f, c } = noise(0.35, 'bandpass', 600, 0.25 + power * 0.3);
    f.frequency.exponentialRampToValueAtTime(2400, c.currentTime + 0.3);
  },
  thud(strength: number) {
    tone('sine', 140, 45, 0.18, 0.25 + strength * 0.5);
    noise(0.12, 'lowpass', 900, 0.15 + strength * 0.4);
  },
  scrape(intensity: number) {
    if (intensity > 0.05) noise(0.06, 'highpass', 1800, intensity * 0.12);
  },
  whistle() {
    const { ctx: c, out } = audio();
    const o = c.createOscillator();
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 28;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(o.frequency);
    o.frequency.value = 2900;
    const g = envelope(c, 0.18, 0.02, 0.55);
    o.connect(g).connect(out);
    o.start();
    lfo.start();
    o.stop(c.currentTime + 0.7);
    lfo.stop(c.currentTime + 0.7);
  },
  /** Gibberish "voice" blips, pitched per character. */
  babble(pitch: number, syllables: number) {
    for (let i = 0; i < syllables; i++) {
      const p = pitch * (0.8 + Math.random() * 0.5);
      tone('square', p, p * 0.85, 0.06, 0.05, i * 0.075);
    }
  },
  win() {
    [392, 494, 587, 784].forEach((f, i) =>
      tone('square', f, f, 0.16, 0.12, i * 0.12),
    );
  },
  lose() {
    [311, 293, 277, 220].forEach((f, i) =>
      tone('sawtooth', f, f * 0.97, 0.32, 0.12, i * 0.3),
    );
  },
};
