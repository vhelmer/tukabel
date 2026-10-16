import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { format } from 'prettier';
import { tmpdir } from 'node:os';
import { lipSyncIssue, voiceIssue } from '../src/game/speech.ts';
import type {
  DialogueSpeech,
  GameContent,
  LipSyncTrack,
  VoiceSettings,
} from '../src/game/types.ts';

const execute = promisify(execFile);
const MAX_BYTES = 20 * 1024 * 1024;
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export interface SpeechOptions {
  apiKey?: string;
  rhubarbBin?: string;
  fetch?: typeof fetch;
}
export function pcmWave(pcm: Buffer, sampleRate = 22050): Buffer {
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_BYTES)
    throw new Error('ElevenLabs vrátil neplatný PCM zvuk.');
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export function waveDuration(bytes: Buffer): number {
  if (
    bytes.length > MAX_BYTES ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    throw new Error('Použi platný WAV PCM 16-bit (max. 20 MB / 180 s).');
  let rate = 0,
    alignment = 0,
    size = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4),
      start = offset + 8,
      end = start + length;
    if (end > bytes.length) throw new Error('Poškodený WAV.');
    const id = bytes.toString('ascii', offset, offset + 4);
    if (id === 'fmt ') {
      if (
        length < 16 ||
        bytes.readUInt16LE(start) !== 1 ||
        ![1, 2].includes(bytes.readUInt16LE(start + 2)) ||
        bytes.readUInt16LE(start + 14) !== 16
      )
        throw new Error('Podporovaný je WAV PCM 16-bit, mono alebo stereo.');
      const channels = bytes.readUInt16LE(start + 2),
        sampleRate = bytes.readUInt32LE(start + 4);
      alignment = channels * 2;
      rate = sampleRate * alignment;
      if (
        sampleRate < 8000 ||
        sampleRate > 48000 ||
        bytes.readUInt32LE(start + 8) !== rate ||
        bytes.readUInt16LE(start + 12) !== alignment
      )
        throw new Error('Neplatný WAV formát.');
    }
    if (id === 'data') size += length;
    offset = end + (length % 2);
  }
  const seconds = size / rate;
  if (
    !size ||
    size % alignment ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 180
  )
    throw new Error('Replika môže trvať najviac 180 sekúnd.');
  return seconds;
}
async function local(
  root: string,
  id: unknown,
  extension: 'wav' | 'json',
): Promise<Buffer> {
  if (
    typeof id !== 'string' ||
    !/^[a-zA-Z0-9_./-]+$/.test(id) ||
    id.split('/').some((s) => !s || s === '..' || s === '.') ||
    !id.endsWith(`.${extension}`)
  )
    throw new Error('Neplatný lokálny audio asset.');
  const base = await realpath(root),
    filename = path.resolve(root, id),
    resolved = await realpath(filename);
  if (
    !resolved.startsWith(base + path.sep) ||
    (await lstat(filename)).isSymbolicLink() ||
    !(await lstat(resolved)).isFile()
  )
    throw new Error('Asset musí byť lokálny súbor.');
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_BYTES) throw new Error('Asset je príliš veľký.');
  return bytes;
}
async function publish(
  root: string,
  files: Record<string, Buffer | string>,
): Promise<string> {
  const parent = path.join(root, 'speech');
  await mkdir(parent, { recursive: true });
  if ((await realpath(parent)) !== path.join(await realpath(root), 'speech'))
    throw new Error('Audio priečinok nesmie byť symlink.');
  const id = randomUUID(),
    staging = path.join(parent, `.${id}.tmp`);
  await mkdir(staging);
  try {
    for (const [name, bytes] of Object.entries(files))
      await writeFile(
        path.join(staging, name),
        typeof bytes === 'string' && name.endsWith('.json')
          ? await format(bytes, { parser: 'json' })
          : bytes,
        { flag: 'wx' },
      );
    await rename(staging, path.join(parent, id));
    return `speech/${id}`;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
async function eleven(
  options: SpeechOptions,
  endpoint: string,
  body?: unknown,
) {
  if (!options.apiKey)
    throw new Error('Nastav ELEVENLABS_API_KEY v .env.local a reštartuj Vite.');
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      `https://api.elevenlabs.io${endpoint}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          'xi-api-key': options.apiKey,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
      },
    );
  } catch {
    throw new Error(
      'ElevenLabs je nedostupný. Skontroluj pripojenie. Generovanie sa automaticky neopakuje.',
    );
  }
  if (!response.ok) {
    // Read only a known error code. Never echo provider messages, arbitrary
    // codes, response bodies or headers: any of them could contain a secret.
    const data: unknown = await response.json().catch(() => null);
    const detail =
      object(data) && object(data.detail) ? data.detail : undefined;
    const code = detail?.status;
    const permission = endpoint.startsWith('/v1/models')
      ? 'Models: Read (models_read)'
      : endpoint.startsWith('/v2/voices')
        ? 'Voices: Read (voices_read)'
        : 'Text to Speech (text_to_speech)';
    let explanation = 'Skontroluj hlas, model, oprávnenia a kredity.';
    if (code === 'missing_permissions' || code === 'insufficient_permissions')
      explanation = `Kľúču chýba oprávnenie ${permission}. Povoľ ho v ElevenLabs → Developers → API Keys → Edit.`;
    else if (code === 'invalid_api_key')
      explanation =
        'API kľúč je neplatný alebo zrušený. Nastav platný ELEVENLABS_API_KEY v .env.local a reštartuj Vite.';
    else if (code === 'quota_exceeded')
      explanation = 'Bol prekročený kreditný limit účtu alebo API kľúča.';
    else if (code === 'paid_plan_required')
      explanation =
        'Vybraný hlas alebo model vyžaduje platený tarif. Hlasy z Voice Library nie sú cez API dostupné na bezplatnom tarife. Vyber hlas dostupný pre svoj tarif, zmeň predplatné v ElevenLabs alebo importuj vlastný WAV.';
    else if (code === 'payment_required' || response.status === 402)
      explanation =
        'ElevenLabs vyžaduje platbu alebo vyšší tarif. Skontroluj predplatné a kredity účtu; hlasy z Voice Library nie sú cez API dostupné na bezplatnom tarife. Môžeš vybrať iný dostupný hlas alebo importovať vlastný WAV.';
    else if (response.status === 401 || response.status === 403)
      explanation = `Over API kľúč a jeho oprávnenie ${permission}. Po zmene .env.local reštartuj Vite.`;
    throw new Error(
      `ElevenLabs HTTP ${response.status}: ${explanation} Požiadavka sa neopakuje.`,
    );
  }
  return response;
}
interface ElevenModel {
  model_id: string;
  name: string;
  can_do_text_to_speech: boolean;
  can_use_style?: boolean;
  can_use_speaker_boost?: boolean;
  languages?: { language_id: string }[];
}
async function elevenModels(options: SpeechOptions): Promise<ElevenModel[]> {
  return (await eleven(options, '/v1/models')).json();
}
export async function speechCatalog(options: SpeechOptions) {
  const [voices, models] = await Promise.all([
    eleven(options, '/v2/voices?page_size=100'),
    elevenModels(options),
  ]);
  const v = (await voices.json()) as {
      voices: { voice_id: string; name: string }[];
      has_more?: boolean;
    },
    m = models;
  return {
    voices: v.voices.map((x) => ({ id: x.voice_id, label: x.name })),
    hasMore: Boolean(v.has_more),
    models: m
      .filter((x) => x.can_do_text_to_speech)
      .map((x) => ({
        id: x.model_id,
        label: x.name,
        style: Boolean(x.can_use_style),
        speakerBoost: Boolean(x.can_use_speaker_boost),
        languages: x.languages?.map((l) => l.language_id) ?? [],
      })),
  };
}
export async function speechStatus(options: SpeechOptions) {
  let rhubarb = false;
  try {
    await execute(options.rhubarbBin || 'rhubarb', ['--version'], {
      timeout: 5000,
      maxBuffer: 4096,
    });
    rhubarb = true;
  } catch {
    /* Configured separately from generation. */
  }
  return { elevenLabs: Boolean(options.apiKey), rhubarb };
}
export async function createSpeech(
  root: string,
  input: unknown,
  options: SpeechOptions,
): Promise<DialogueSpeech> {
  if (
    !object(input) ||
    typeof input.text !== 'string' ||
    !input.text.trim() ||
    input.text.length > 5000
  )
    throw new Error('Replika musí mať 1–5000 znakov.');
  let bytes: Buffer;
  const archive: Record<string, unknown> = { text: input.text };
  if (input.data !== undefined) {
    if (typeof input.data !== 'string' || input.data.length > MAX_BYTES * 1.4)
      throw new Error('Neplatný WAV upload.');
    bytes = Buffer.from(input.data, 'base64');
    archive.provider = 'upload';
  } else {
    if (input.confirmed !== true)
      throw new Error('Generovanie vyžaduje výslovné potvrdenie.');
    const issue = voiceIssue(input.voice);
    if (issue) throw new Error(issue);
    const voice = input.voice as unknown as VoiceSettings;
    const settings: Record<string, unknown> = {
      stability: voice.stability,
      similarity_boost: voice.similarityBoost,
      speed: voice.speed,
    };
    const model = (await elevenModels(options)).find(
      (m) => m.model_id === voice.modelId && m.can_do_text_to_speech,
    );
    if (!model)
      throw new Error(
        'Model nepodporuje text-to-speech alebo nie je dostupný pre tento účet.',
      );
    if (model.can_use_speaker_boost)
      settings.use_speaker_boost = voice.useSpeakerBoost;
    if (model.can_use_style) settings.style = voice.style;
    const response = await eleven(
      options,
      `/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=pcm_22050`,
      { text: input.text, model_id: voice.modelId, voice_settings: settings },
    );
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES) throw new Error('Nahrávka je príliš veľká.');
    bytes = pcmWave(Buffer.from(await response.arrayBuffer()));
    archive.provider = 'elevenlabs';
    archive.voice = voice;
  }
  const duration = waveDuration(bytes);
  const folder = await publish(root, {
    'audio.wav': bytes,
    'record.json':
      JSON.stringify(
        { ...archive, duration, audioSha256: digest(bytes) },
        null,
        2,
      ) + '\n',
  });
  return { audio: `${folder}/audio.wav`, text: input.text };
}
export async function analyzeSpeech(
  root: string,
  input: unknown,
  options: SpeechOptions,
) {
  if (!object(input)) throw new Error('Vyber nahrávku.');
  const bytes = await local(root, input.audio, 'wav'),
    duration = waveDuration(bytes);
  const temp = await mkdtemp(path.join(tmpdir(), 'tukabel-rhubarb-'));
  try {
    const wav = path.join(temp, 'audio.wav');
    await writeFile(wav, bytes);
    let stdout: string;
    try {
      ({ stdout } = await execute(
        options.rhubarbBin || 'rhubarb',
        ['-r', 'phonetic', '-f', 'json', '--threads', '2', wav],
        { timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
      ));
    } catch {
      throw new Error(
        'Rhubarb analýza zlyhala. Nainštaluj Rhubarb a nastav RHUBARB_BIN; podporovaný je WAV PCM 16-bit.',
      );
    }
    const track = JSON.parse(stdout) as LipSyncTrack;
    const issue = lipSyncIssue(track);
    if (issue) throw new Error(issue);
    if (Math.abs(track.metadata.duration - duration) > 0.1)
      throw new Error('Rhubarb vrátil inú dĺžku audia.');
    const data = {
      metadata: {
        duration: track.metadata.duration,
        audioSha256: digest(bytes),
      },
      mouthCues: track.mouthCues,
    };
    const folder = await publish(root, {
      'track.lipsync.json': JSON.stringify(data, null, 2) + '\n',
    });
    return { lipSync: `${folder}/track.lipsync.json` };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
export async function validateSpeechAssets(root: string, project: GameContent) {
  for (const dialogue of project.dialogues)
    for (const node of dialogue.nodes)
      if (node.speech) {
        const bytes = await local(root, node.speech.audio, 'wav'),
          duration = waveDuration(bytes);
        if (node.speech.lipSync) {
          const track = JSON.parse(
            (await local(root, node.speech.lipSync, 'json')).toString('utf8'),
          ) as LipSyncTrack;
          const issue = lipSyncIssue(track);
          if (issue) throw new Error(`${dialogue.id}/${node.id}: ${issue}`);
          if (
            Math.abs(track.metadata.duration - duration) > 0.1 ||
            track.metadata.audioSha256 !== digest(bytes)
          )
            throw new Error(
              `${dialogue.id}/${node.id}: lip-sync nezodpovedá audio súboru; zopakuj analýzu.`,
            );
        }
      }
}
