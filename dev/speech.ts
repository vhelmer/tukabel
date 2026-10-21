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
import { lipSyncIssue, modelFeatures, voiceIssue } from '../src/game/speech.ts';
import {
  alignmentIssue,
  buildSubtitles,
  subtitleText,
  subtitleTrackIssue,
} from '../src/game/subtitles.ts';
import type {
  DialogueSpeech,
  GameContent,
  LipSyncTrack,
  VoiceSettings,
  SpeechAlignment,
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
    throw new Error('Použij platný WAV PCM 16-bit (max. 20 MB / 180 s).');
  let rate = 0,
    alignment = 0,
    size = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4),
      start = offset + 8,
      end = start + length;
    if (end > bytes.length) throw new Error('Poškozený WAV.');
    const id = bytes.toString('ascii', offset, offset + 4);
    if (id === 'fmt ') {
      if (
        length < 16 ||
        bytes.readUInt16LE(start) !== 1 ||
        ![1, 2].includes(bytes.readUInt16LE(start + 2)) ||
        bytes.readUInt16LE(start + 14) !== 16
      )
        throw new Error('Podporovaný je WAV PCM 16-bit, mono nebo stereo.');
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
    throw new Error('Replika může trvat nejvýše 180 sekund.');
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
    throw new Error('Neplatný lokální audio asset.');
  const base = await realpath(root),
    filename = path.resolve(root, id),
    resolved = await realpath(filename);
  if (
    !resolved.startsWith(base + path.sep) ||
    (await lstat(filename)).isSymbolicLink() ||
    !(await lstat(resolved)).isFile()
  )
    throw new Error('Asset musí být lokální soubor.');
  const bytes = await readFile(resolved);
  if (bytes.length > MAX_BYTES) throw new Error('Asset je příliš velký.');
  return bytes;
}
async function publish(
  root: string,
  files: Record<string, Buffer | string>,
): Promise<string> {
  const parent = path.join(root, 'speech');
  await mkdir(parent, { recursive: true });
  if ((await realpath(parent)) !== path.join(await realpath(root), 'speech'))
    throw new Error('Audio složka nesmí být symlink.');
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
    throw new Error('Nastav ELEVENLABS_API_KEY v .env.local a restartuj Vite.');
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
      'ElevenLabs je nedostupný. Zkontroluj připojení. Generování se automaticky neopakuje.',
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
    let explanation = 'Zkontroluj hlas, model, oprávnění a kredity.';
    if (code === 'missing_permissions' || code === 'insufficient_permissions')
      explanation = `Klíči chybí oprávnění ${permission}. Povol ho v ElevenLabs → Developers → API Keys → Edit.`;
    else if (code === 'invalid_api_key')
      explanation =
        'API klíč je neplatný nebo zrušený. Nastav platný ELEVENLABS_API_KEY v .env.local a restartuj Vite.';
    else if (code === 'quota_exceeded')
      explanation = 'Byl překročený kreditní limit účtu nebo API klíče.';
    else if (code === 'paid_plan_required')
      explanation =
        'Vybraný hlas nebo model vyžaduje placený tarif. Hlasy z Voice Library nejsou přes API dostupné na bezplatném tarifu. Vyber hlas dostupný pro svůj tarif, změň předplatné v ElevenLabs nebo importuj vlastní WAV.';
    else if (code === 'payment_required' || response.status === 402)
      explanation =
        'ElevenLabs vyžaduje platbu nebo vyšší tarif. Zkontroluj predplatné a kredity účtu; hlasy z Voice Library nejsou přes API dostupné na bezplatném tarifu. Můžeš vybrat iný dostupný hlas nebo importovat vlastní WAV.';
    else if (response.status === 401 || response.status === 403)
      explanation = `Ověř API klíč a jeho oprávnění ${permission}. Po zmene .env.local restartuj Vite.`;
    throw new Error(
      `ElevenLabs HTTP ${response.status}: ${explanation} Požadavek se neopakuje.`,
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
  maximum_text_length_per_request?: number;
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
        audioTags: modelFeatures(x.model_id).audioTags,
        speed: modelFeatures(x.model_id).speed,
        maxCharacters: x.maximum_text_length_per_request ?? null,
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
    throw new Error('Replika musí mít 1–5000 znaků.');
  if (
    input.subtitle !== undefined &&
    (typeof input.subtitle !== 'string' || input.subtitle.length > 10000)
  )
    throw new Error('Neplatný text titulků.');
  let bytes: Buffer;
  let alignment: SpeechAlignment | undefined;
  const archive: Record<string, unknown> = { text: input.text };
  if (input.data !== undefined) {
    if (typeof input.data !== 'string' || input.data.length > MAX_BYTES * 1.4)
      throw new Error('Neplatný WAV upload.');
    bytes = Buffer.from(input.data, 'base64');
    archive.provider = 'upload';
  } else {
    if (input.confirmed !== true)
      throw new Error('Generování vyžaduje výslovné potvrzení.');
    const issue = voiceIssue(input.voice);
    if (issue) throw new Error(issue);
    const voice = input.voice as unknown as VoiceSettings;
    const settings: Record<string, unknown> = {
      stability: voice.stability,
      similarity_boost: voice.similarityBoost,
    };
    const features = modelFeatures(voice.modelId);
    if (features.speed) settings.speed = voice.speed;
    const model = (await elevenModels(options)).find(
      (m) => m.model_id === voice.modelId && m.can_do_text_to_speech,
    );
    if (!model)
      throw new Error(
        'Model nepodporuje text-to-speech nebo není dostupný pro tento účet.',
      );
    if (
      model.maximum_text_length_per_request &&
      input.text.length > model.maximum_text_length_per_request
    )
      throw new Error(
        `Model povoluje nejvýše ${model.maximum_text_length_per_request} znaků.`,
      );
    if (model.can_use_speaker_boost)
      settings.use_speaker_boost = voice.useSpeakerBoost;
    if (model.can_use_style) settings.style = voice.style;
    const response = await eleven(
      options,
      `/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/with-timestamps?output_format=pcm_22050`,
      { text: input.text, model_id: voice.modelId, voice_settings: settings },
    );
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES * 1.4 + 2 * 1024 * 1024)
      throw new Error('Nahrávka je příliš velká.');
    const result: unknown = await response.json().catch(() => null);
    if (
      !object(result) ||
      typeof result.audio_base64 !== 'string' ||
      result.audio_base64.length > MAX_BYTES * 1.4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(result.audio_base64)
    )
      throw new Error(
        'ElevenLabs vrátil neplatný zvuk s časovaním. Požadavek se neopakuje.',
      );
    bytes = pcmWave(Buffer.from(result.audio_base64, 'base64'));
    // Prefer original text timing, so pronunciation normalization does not move
    // captions or accidentally display audio tags. Null/invalid timing uses an
    // explicitly labelled estimate; audio is never generated a second time.
    for (const candidate of [result.alignment, result.normalized_alignment]) {
      if (!object(candidate)) continue;
      const proposed = {
        characters: candidate.characters,
        character_start_times_seconds: candidate.character_start_times_seconds,
        character_end_times_seconds: candidate.character_end_times_seconds,
        metadata: { duration: waveDuration(bytes), audioSha256: digest(bytes) },
      };
      if (!alignmentIssue(proposed)) {
        alignment = proposed as unknown as SpeechAlignment;
        break;
      }
    }
    archive.provider = 'elevenlabs';
    archive.voice = voice;
  }
  const duration = waveDuration(bytes);
  const subtitles = buildSubtitles(
    subtitleText({
      text: input.text,
      subtitle: input.subtitle as string | undefined,
    }),
    duration,
    alignment,
  );
  const folder = await publish(root, {
    'audio.wav': bytes,
    ...(alignment
      ? { 'alignment.json': JSON.stringify(alignment, null, 2) + '\n' }
      : {}),
    'record.json':
      JSON.stringify(
        { ...archive, duration, audioSha256: digest(bytes) },
        null,
        2,
      ) + '\n',
  });
  return {
    audio: `${folder}/audio.wav`,
    text: input.text,
    subtitles,
    ...(alignment ? { alignment: `${folder}/alignment.json` } : {}),
  };
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
        'Rhubarb analýza selhala. Nainstaluj Rhubarb a nastav RHUBARB_BIN; podporovaný je WAV PCM 16-bit.',
      );
    }
    const track = JSON.parse(stdout) as LipSyncTrack;
    const issue = lipSyncIssue(track);
    if (issue) throw new Error(issue);
    if (Math.abs(track.metadata.duration - duration) > 0.1)
      throw new Error('Rhubarb vrátil jinou délku audia.');
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
        if (node.speech.subtitles) {
          const issue = subtitleTrackIssue(node.speech.subtitles, duration);
          if (issue) throw new Error(`${dialogue.id}/${node.id}: ${issue}`);
        }
        if (node.speech.alignment) {
          const alignment = JSON.parse(
            (await local(root, node.speech.alignment, 'json')).toString('utf8'),
          ) as SpeechAlignment;
          const issue = alignmentIssue(alignment);
          if (
            issue ||
            Math.abs(alignment.metadata.duration - duration) > 0.1 ||
            alignment.metadata.audioSha256 !== digest(bytes)
          )
            throw new Error(
              `${dialogue.id}/${node.id}: neplatné zarovnání titulků nebo jiné audio.`,
            );
        }
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
              `${dialogue.id}/${node.id}: lip-sync neodpovídá audio souboru; zopakuj analýzu.`,
            );
        }
      }
}
