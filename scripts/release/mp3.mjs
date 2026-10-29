import { Mp3Encoder } from '@breezystack/lamejs';

// LAME's own encoder delay; decoders add their 529-sample decoder delay.
const ENCODER_DELAY = 576;
const SAMPLES_PER_FRAME = 1152;
const BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const RATES = [44100, 48000, 32000];

export function readWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF')
    throw new Error('Not a RIFF WAV file');
  let fmt;
  let data;
  for (let o = 12; o + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', o, o + 4);
    const size = buffer.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = buffer.subarray(o + 8, o + 8 + size);
    if (id === 'data') data = buffer.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV is missing fmt or data');
  const channels = fmt.readUInt16LE(2);
  const sampleRate = fmt.readUInt32LE(4);
  if (fmt.readUInt16LE(0) !== 1 || fmt.readUInt16LE(14) !== 16)
    throw new Error('Only 16-bit PCM WAV is supported');
  if (channels < 1 || channels > 2)
    throw new Error(`Unsupported channel count ${channels}`);
  const samples = Math.floor(data.length / 2 / channels);
  const planes = Array.from(
    { length: channels },
    () => new Int16Array(samples),
  );
  for (let i = 0; i < samples; i++)
    for (let c = 0; c < channels; c++)
      planes[c][i] = data.readInt16LE((i * channels + c) * 2);
  return { channels, sampleRate, samples, planes };
}

function frames(mp3) {
  const list = [];
  for (let o = 0; o + 4 <= mp3.length;) {
    if (mp3[o] !== 0xff || (mp3[o + 1] & 0xe0) !== 0xe0)
      throw new Error(`Lost MP3 frame sync at byte ${o}`);
    const mpeg1 = (mp3[o + 1] & 0x18) === 0x18;
    const rateIndex = (mp3[o + 2] >> 2) & 3;
    const rate =
      RATES[rateIndex] / (mpeg1 ? 1 : (mp3[o + 1] & 0x18) === 0x10 ? 2 : 4);
    const kbps = (
      mpeg1
        ? BITRATES
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    )[mp3[o + 2] >> 4];
    const size =
      Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / rate) +
      ((mp3[o + 2] >> 1) & 1);
    list.push({ offset: o, size, mpeg1, mono: mp3[o + 3] >> 6 === 3 });
    o += size;
  }
  return list;
}

function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

// Xing "Info" + LAME tag frame. Browsers read encoder delay/padding from it and
// trim the decoded buffer, so buffer loops keep the authored WAV seam.
function infoFrame(template, audio, frameCount, byteCount, padding) {
  const frame = Buffer.alloc(template.size);
  audio.copy(frame, 0, template.offset, template.offset + 4);
  frame[2] &= ~0x02; // no padding bit: the frame is exactly template.size bytes
  if ((audio[template.offset + 2] >> 1) & 1) frame[2] |= 0x02;
  const sideInfo = template.mpeg1
    ? template.mono
      ? 17
      : 32
    : template.mono
      ? 9
      : 17;
  let o = 4 + sideInfo;
  frame.write('Info', o, 'ascii');
  frame.writeUInt32BE(0x3, o + 4); // frames + bytes fields
  frame.writeUInt32BE(frameCount, o + 8);
  frame.writeUInt32BE(byteCount, o + 12);
  o += 16;
  const lame = o;
  frame.write('LAME3.100', lame, 'ascii');
  const delay = (ENCODER_DELAY << 12) | padding;
  frame[lame + 21] = (delay >> 16) & 0xff;
  frame[lame + 22] = (delay >> 8) & 0xff;
  frame[lame + 23] = delay & 0xff;
  frame.writeUInt32BE(byteCount, lame + 28);
  const audioCrc = crc16(audio);
  frame.writeUInt16BE(audioCrc, lame + 32);
  frame.writeUInt16BE(crc16(frame.subarray(0, lame + 34)), lame + 34);
  return frame;
}

function rawEncode({ channels, sampleRate, samples, planes }, kbps) {
  const encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const chunks = [];
  for (let i = 0; i < samples; i += SAMPLES_PER_FRAME) {
    const end = Math.min(samples, i + SAMPLES_PER_FRAME);
    const chunk = encoder.encodeBuffer(
      planes[0].subarray(i, end),
      channels === 2 ? planes[1].subarray(i, end) : undefined,
    );
    if (chunk.length) chunks.push(Buffer.from(chunk));
  }
  chunks.push(Buffer.from(encoder.flush()));
  return Buffer.concat(chunks);
}

function frameRate(mp3) {
  const version = (mp3[1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  return RATES[(mp3[2] >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
}

// Lanczos (a = 8) resampler. LAME silently resamples low bitrates; doing it
// up front keeps input and output rates equal so delay/padding stay exact.
function resample(wav, rate) {
  const ratio = rate / wav.sampleRate;
  const samples = Math.round(wav.samples * ratio);
  const cutoff = Math.min(1, ratio);
  const a = 8;
  const radius = Math.ceil(a / cutoff);
  const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const planes = wav.planes.map((input) => {
    const output = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      const center = i / ratio;
      const first = Math.ceil(center - radius);
      let sum = 0;
      let weights = 0;
      for (let j = first; j <= center + radius; j++) {
        const t = (center - j) * cutoff;
        if (Math.abs(t) >= a) continue;
        const w = sinc(t) * sinc(t / a);
        weights += w;
        if (j >= 0 && j < input.length) sum += input[j] * w;
      }
      output[i] = Math.max(-32768, Math.min(32767, Math.round(sum / weights)));
    }
    return output;
  });
  return { ...wav, sampleRate: rate, samples, planes };
}

export function encodeMp3(source, kbps) {
  const probe = rawEncode(
    { ...source, samples: Math.min(source.samples, 4 * SAMPLES_PER_FRAME) },
    kbps,
  );
  const rate = frameRate(probe);
  const wav = rate === source.sampleRate ? source : resample(source, rate);
  const audio = rawEncode(wav, kbps);
  if (frameRate(audio) !== wav.sampleRate)
    throw new Error('LAME changed the sample rate');
  const list = frames(audio);
  const perFrame = list[0].mpeg1 ? SAMPLES_PER_FRAME : SAMPLES_PER_FRAME / 2;
  const padding = list.length * perFrame - ENCODER_DELAY - wav.samples;
  if (padding < 0 || padding > 4095)
    throw new Error(`Unexpected MP3 padding ${padding}`);
  const template =
    list.find((f) => !((audio[f.offset + 2] >> 1) & 1)) ?? list[0];
  const info = infoFrame(
    template,
    audio,
    list.length,
    audio.length + template.size,
    padding,
  );
  return Buffer.concat([info, audio]);
}
