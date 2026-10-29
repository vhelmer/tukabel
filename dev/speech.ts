import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
  VoiceDesignResult,
  SavedDesignVoice,
} from '../src/editor/voiceDesign.ts';
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
  extension: 'wav' | 'json' | 'mp3',
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
        : endpoint.startsWith('/v1/text-to-voice/design')
          ? 'Voice Generation (voice_generation)'
          : endpoint === '/v1/text-to-voice'
            ? 'Voices: Write (voices_write)'
            : 'Text to Speech (text_to_speech)';
    let explanation = 'Zkontroluj hlas, model, oprávnění a kredity.';
    if (code === 'missing_permissions' || code === 'insufficient_permissions')
      explanation = `Klíči chybí oprávnění ${permission}. Povol ho v ElevenLabs → Developers → API Keys → Edit.`;
    else if (code === 'invalid_api_key')
      explanation =
        'API klíč je neplatný nebo zrušený. Nastav platný ELEVENLABS_API_KEY v .env.local a restartuj Vite.';
    else if (
      code === 'invalid_output_format' ||
      code === 'unsupported_output_format'
    )
      explanation =
        'Vybraný model nepodporuje požadovaný zvukový formát. Změň formát před dalším ručním spuštěním.';
    else if (
      code === 'invalid_model_id' ||
      code === 'unsupported_model' ||
      code === 'model_not_found'
    )
      explanation =
        'Požadovaný model není dostupný nebo jej tento endpoint nepodporuje.';
    else if (
      code === 'invalid_voice_description' ||
      code === 'invalid_text' ||
      code === 'invalid_request'
    )
      explanation =
        'Popis hlasu nebo ukázkový text nevyhovuje požadavkům ElevenLabs. Uprav zadání před dalším ručním spuštěním.';
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
/** Successful immutable receipts also protect stale editor drafts after reload. */
export async function findVoiceRetirement(
  root: string,
  voiceId: string,
): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(path.join(root, 'speech'), { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return;
    throw error;
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        entry.name,
      )
    )
      continue;
    const manifest = `speech/${entry.name}/retirement.json`;
    for (const candidate of [
      manifest,
      `speech/${entry.name}/.retirement.pending.json`,
    ]) {
      let bytes: Buffer;
      try {
        bytes = await local(root, candidate, 'json');
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          continue;
        throw error;
      }
      const receipt: unknown = JSON.parse(bytes.toString('utf8'));
      if (
        object(receipt) &&
        receipt.version === 1 &&
        receipt.operation === 'voice-retirement' &&
        receipt.provider === 'elevenlabs' &&
        receipt.voiceId === voiceId
      )
        return manifest;
    }
  }
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
  if (
    input.languageCode !== undefined &&
    (typeof input.languageCode !== 'string' ||
      !/^[a-z]{2,3}$/.test(input.languageCode))
  )
    throw new Error(
      'Kód jazyka musí být dvou- nebo třípísmenný malými písmeny.',
    );
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
    if (voice.retired || (await findVoiceRetirement(root, voice.voiceId)))
      throw new Error(
        'Hlas byl uvolněn ze služby. Pro nové repliky navrhni a ulož nový hlas.',
      );
    await validateDesignedVoice(root, voice);
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
    if (
      input.languageCode !== undefined &&
      voice.modelId === 'eleven_multilingual_v2'
    )
      throw new Error('Multilingual v2 nepodporuje vynucení jazyka.');
    if (
      input.languageCode !== undefined &&
      !model.languages?.some(
        (language) => language.language_id === input.languageCode,
      )
    )
      throw new Error('Vybraný model neuvádí podporu požadovaného jazyka.');
    if (model.can_use_speaker_boost)
      settings.use_speaker_boost = voice.useSpeakerBoost;
    if (model.can_use_style) settings.style = voice.style;
    const response = await eleven(
      options,
      `/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/with-timestamps?output_format=pcm_22050`,
      {
        text: input.text,
        model_id: voice.modelId,
        voice_settings: settings,
        ...(input.languageCode === undefined
          ? {}
          : { language_code: input.languageCode }),
      },
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
    if (input.languageCode !== undefined)
      archive.languageCode = input.languageCode;
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
  const checked = new Set<string>();
  for (const scene of project.scenes ?? [])
    for (const hotspot of scene.hotspots) {
      const voice = hotspot.animation?.voice;
      if (!voice?.designRegistration) continue;
      const key = JSON.stringify([
        voice.voiceId,
        voice.designRegistration,
        voice.retired,
        voice.retirementManifest,
      ]);
      if (checked.has(key)) continue;
      await validateDesignedVoice(root, voice);
      await validateVoiceRetirement(root, voice);
      checked.add(key);
    }
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

const designModel = 'eleven_ttv_v3';
const providerId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
interface DesignPreviewArchive {
  audio: string;
  generatedVoiceId: string;
  duration: number;
  audioSha256: string;
}
interface DesignArchive {
  version: 1;
  operation: 'voice-design';
  provider: 'elevenlabs';
  model: string;
  description: string;
  text: string;
  textSha256: string;
  seed: number;
  guidanceScale: number;
  outputFormat: 'mp3_44100_128';
  previews: DesignPreviewArchive[];
}

// Validate two complete MPEG Layer III frames (including an optional ID3v2 tag).
// Duration remains provider metadata; MP3 previews never enter the WAV/TTS pipeline.
function validateDesignMp3(bytes: Buffer): void {
  const invalid = () => {
    throw new Error('ElevenLabs vrátil neplatnou MP3 ukázku.');
  };
  if (!bytes.length || bytes.length > MAX_BYTES) invalid();
  let offset = 0;
  if (bytes.toString('ascii', 0, 3) === 'ID3') {
    if (
      bytes.length < 10 ||
      ![2, 3, 4].includes(bytes[3]!) ||
      bytes.subarray(6, 10).some((n) => n > 127)
    )
      invalid();
    offset = 10 + bytes.subarray(6, 10).reduce((size, n) => size * 128 + n, 0);
    if (bytes[3] === 4 && bytes[5]! & 0x10) offset += 10;
  }
  for (let frame = 0; frame < 2; frame++) {
    if (offset + 4 > bytes.length) invalid();
    const header = bytes.readUInt32BE(offset);
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const sampleIndex = (header >>> 10) & 3;
    if (
      header >>> 21 !== 0x7ff ||
      version === 1 ||
      layer !== 1 ||
      !bitrateIndex ||
      bitrateIndex === 15 ||
      sampleIndex === 3
    )
      invalid();
    const bitrate = (
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    )[bitrateIndex]!;
    const sampleRate =
      [44100, 48000, 32000][sampleIndex]! /
      (version === 3 ? 1 : version === 2 ? 2 : 4);
    offset +=
      Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / sampleRate) +
      ((header >>> 9) & 1);
    if (offset > bytes.length) invalid();
  }
}

/** Explicit paid generation, with all three previews published together. */
export async function designVoice(
  root: string,
  input: unknown,
  options: SpeechOptions,
): Promise<VoiceDesignResult> {
  if (!object(input) || input.confirmed !== true)
    throw new Error('Voice Design vyžaduje výslovné potvrzení generování.');
  if (
    typeof input.description !== 'string' ||
    input.description.trim().length < 20 ||
    input.description.length > 1000
  )
    throw new Error('Popis hlasu musí mít 20–1000 znaků.');
  if (
    typeof input.text !== 'string' ||
    input.text.trim().length < 100 ||
    input.text.length > 1000
  )
    throw new Error('Ukázkový text musí mít 100–1000 znaků.');
  if (
    input.seed !== undefined &&
    (!Number.isInteger(input.seed) ||
      Number(input.seed) < 0 ||
      Number(input.seed) > 2147483647)
  )
    throw new Error('Seed musí být celé číslo 0–2147483647.');
  const guidanceScale = input.guidanceScale ?? 5;
  if (
    typeof guidanceScale !== 'number' ||
    !Number.isFinite(guidanceScale) ||
    guidanceScale < 0 ||
    guidanceScale > 100
  )
    throw new Error('Síla popisu musí být číslo 0–100.');
  const seed =
    input.seed === undefined ? randomInt(2147483648) : Number(input.seed);
  const response = await eleven(
    options,
    '/v1/text-to-voice/design?output_format=mp3_44100_128',
    {
      voice_description: input.description,
      model_id: designModel,
      text: input.text,
      auto_generate_text: false,
      ...(input.guidanceScale === undefined
        ? {}
        : { guidance_scale: guidanceScale }),
      seed,
    },
  );
  const data: unknown = await response.json().catch(() => null);
  if (
    !object(data) ||
    !Array.isArray(data.previews) ||
    data.previews.length !== 3
  )
    throw new Error('ElevenLabs nevrátil tři platné ukázky Voice Design.');
  const files: Record<string, Buffer | string> = {};
  const previews = data.previews.map(
    (preview: unknown, index: number): DesignPreviewArchive => {
      if (
        !object(preview) ||
        !providerId(preview.generated_voice_id) ||
        typeof preview.audio_base_64 !== 'string' ||
        preview.audio_base_64.length > MAX_BYTES * 1.4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          preview.audio_base_64,
        )
      )
        throw new Error('ElevenLabs vrátil neplatnou ukázku Voice Design.');
      if (
        preview.media_type !== 'audio/mpeg' ||
        typeof preview.duration_secs !== 'number' ||
        !Number.isFinite(preview.duration_secs) ||
        preview.duration_secs <= 0 ||
        preview.duration_secs > 180
      )
        throw new Error(
          'ElevenLabs nevrátil MP3 ukázku s platnou délkou do 180 sekund. Generování se neopakuje.',
        );
      const bytes = Buffer.from(preview.audio_base_64, 'base64');
      validateDesignMp3(bytes);
      const duration = preview.duration_secs;
      const audio = `preview-${index + 1}.mp3`;
      files[audio] = bytes;
      return {
        audio,
        generatedVoiceId: preview.generated_voice_id,
        duration,
        audioSha256: digest(bytes),
      };
    },
  );
  if (new Set(previews.map((p) => p.generatedVoiceId)).size !== 3)
    throw new Error('ElevenLabs vrátil duplicitní ukázky Voice Design.');
  const archive: DesignArchive = {
    version: 1,
    operation: 'voice-design',
    provider: 'elevenlabs',
    model: designModel,
    description: input.description,
    text: input.text,
    textSha256: digest(Buffer.from(input.text)),
    seed,
    guidanceScale,
    outputFormat: 'mp3_44100_128',
    previews,
  };
  files['design.json'] = JSON.stringify(archive);
  const directory = await publish(root, files);
  return {
    manifest: `${directory}/design.json`,
    model: designModel,
    description: input.description,
    previews: previews.map((p) => ({
      audio: `${directory}/${p.audio}`,
      generatedVoiceId: p.generatedVoiceId,
      duration: p.duration,
    })),
  };
}

async function readDesignPreview(
  root: string,
  manifest: unknown,
  previewIndex: unknown,
  generatedVoiceId?: unknown,
) {
  if (
    typeof manifest !== 'string' ||
    !/^speech\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/design\.json$/.test(
      manifest,
    )
  )
    throw new Error('Vyber archivovaný návrh Voice Design.');
  if (
    !Number.isInteger(previewIndex) ||
    Number(previewIndex) < 0 ||
    Number(previewIndex) > 2
  )
    throw new Error('Vyber jednu ze tří ukázek.');
  const manifestBytes = await local(root, manifest, 'json');
  let archive: unknown;
  try {
    archive = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('Poškozený archiv Voice Design.');
  }
  if (
    !object(archive) ||
    archive.version !== 1 ||
    archive.operation !== 'voice-design' ||
    archive.provider !== 'elevenlabs' ||
    archive.model !== designModel ||
    archive.outputFormat !== 'mp3_44100_128' ||
    typeof archive.description !== 'string' ||
    archive.description.length < 20 ||
    archive.description.length > 1000 ||
    typeof archive.text !== 'string' ||
    archive.textSha256 !== digest(Buffer.from(archive.text)) ||
    !Array.isArray(archive.previews) ||
    archive.previews.length !== 3
  )
    throw new Error('Neplatný archiv Voice Design.');
  const preview: unknown = archive.previews[Number(previewIndex)];
  if (
    !object(preview) ||
    !providerId(preview.generatedVoiceId) ||
    preview.audio !== `preview-${Number(previewIndex) + 1}.mp3` ||
    typeof preview.duration !== 'number' ||
    !Number.isFinite(preview.duration) ||
    preview.duration <= 0 ||
    preview.duration > 180
  )
    throw new Error('Neplatná archivovaná ukázka.');
  if (
    generatedVoiceId !== undefined &&
    generatedVoiceId !== preview.generatedVoiceId
  )
    throw new Error('Vybraný hlas neodpovídá archivu.');
  const audio = await local(
    root,
    `${path.posix.dirname(manifest)}/${preview.audio}`,
    'mp3',
  );
  validateDesignMp3(audio);
  if (preview.audioSha256 !== digest(audio))
    throw new Error('Archivovaná ukázka byla změněna.');
  return { archive, preview, manifestBytes, manifest };
}

async function validateDesignedVoice(root: string, voice: VoiceSettings) {
  if (voice.designRegistration === undefined) return;
  const issue = voiceIssue(voice);
  if (issue) throw new Error(issue);
  const registration: unknown = JSON.parse(
    (await local(root, voice.designRegistration, 'json')).toString('utf8'),
  );
  if (
    !object(registration) ||
    registration.version !== 1 ||
    registration.operation !== 'voice-registration' ||
    registration.provider !== 'elevenlabs' ||
    registration.voiceId !== voice.voiceId ||
    !providerId(registration.generatedVoiceId)
  )
    throw new Error('Archiv registrace neodpovídá vybranému hlasu.');
  const { manifestBytes } = await readDesignPreview(
    root,
    registration.designManifest,
    registration.previewIndex,
    registration.generatedVoiceId,
  );
  if (registration.designSha256 !== digest(manifestBytes))
    throw new Error('Archiv návrhu hlasu byl změněn.');
}

async function validateVoiceRetirement(root: string, voice: VoiceSettings) {
  if (!voice.retirementManifest) return;
  const receipt: unknown = JSON.parse(
    (await local(root, voice.retirementManifest, 'json')).toString('utf8'),
  );
  if (
    !object(receipt) ||
    receipt.version !== 1 ||
    receipt.operation !== 'voice-retirement' ||
    receipt.provider !== 'elevenlabs' ||
    receipt.voiceId !== voice.voiceId ||
    receipt.designRegistration !== voice.designRegistration ||
    receipt.verification !==
      `${path.posix.dirname(voice.retirementManifest)}/verification.json`
  )
    throw new Error('Archiv uvolnění neodpovídá vybranému hlasu.');
  const proofBytes = await local(root, receipt.verification, 'json');
  if (receipt.verificationSha256 !== digest(proofBytes))
    throw new Error('Důkaz uvolnění hlasu byl změněn.');
  const proof: unknown = JSON.parse(proofBytes.toString('utf8'));
  const registrationBytes = await local(root, voice.designRegistration, 'json');
  if (
    !object(proof) ||
    proof.version !== 1 ||
    proof.operation !== 'voice-retirement-verification' ||
    proof.provider !== 'elevenlabs' ||
    proof.voiceId !== voice.voiceId ||
    proof.designRegistration !== voice.designRegistration ||
    proof.registrationSha256 !== digest(registrationBytes) ||
    JSON.stringify(proof.registration) !==
      JSON.stringify(JSON.parse(registrationBytes.toString('utf8'))) ||
    !Array.isArray(proof.lines) ||
    !proof.lines.length ||
    receipt.verifiedLines !== proof.lines.length
  )
    throw new Error('Neplatný důkaz uvolnění hlasu nebo změněná registrace.');
  for (const line of proof.lines) {
    if (
      !object(line) ||
      typeof line.text !== 'string' ||
      line.textSha256 !== digest(Buffer.from(line.text)) ||
      typeof line.audio !== 'string' ||
      typeof line.duration !== 'number' ||
      !Number.isFinite(line.duration) ||
      line.record !== `${path.posix.dirname(line.audio)}/record.json`
    )
      throw new Error('Neplatná archivovaná replika v důkazu uvolnění.');
    const audio = await local(root, line.audio, 'wav');
    const duration = waveDuration(audio);
    const lipSyncBytes = await local(root, line.lipSync, 'json');
    const recordBytes = await local(root, line.record, 'json');
    if (
      line.audioSha256 !== digest(audio) ||
      Math.abs(line.duration - duration) > 0.1 ||
      line.lipSyncSha256 !== digest(lipSyncBytes) ||
      line.recordSha256 !== digest(recordBytes)
    )
      throw new Error('Podklady archivované repliky byly změněny.');
    const track = JSON.parse(lipSyncBytes.toString('utf8')) as LipSyncTrack;
    const record: unknown = JSON.parse(recordBytes.toString('utf8'));
    if (
      lipSyncIssue(track) ||
      track.metadata.audioSha256 !== line.audioSha256 ||
      Math.abs(track.metadata.duration - duration) > 0.1 ||
      !object(record) ||
      record.provider !== 'elevenlabs' ||
      !object(record.voice) ||
      record.voice.voiceId !== voice.voiceId ||
      record.voice.designRegistration !== voice.designRegistration ||
      record.text !== line.text ||
      record.audioSha256 !== line.audioSha256 ||
      typeof record.duration !== 'number' ||
      !Number.isFinite(record.duration) ||
      Math.abs(record.duration - duration) > 0.1 ||
      !line.subtitles ||
      subtitleTrackIssue(line.subtitles, duration)
    )
      throw new Error('Archivovaná replika nedokládá ověřené WAV a lip-sync.');
  }
}

/** Registration accepts only a verified preview from an immutable local archive. */
export async function saveDesignedVoice(
  root: string,
  input: unknown,
  options: SpeechOptions,
): Promise<SavedDesignVoice> {
  if (!object(input) || input.confirmed !== true)
    throw new Error('Uložení hlasu vyžaduje výslovné potvrzení.');
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 100
  )
    throw new Error('Název hlasu musí mít 1–100 znaků.');
  const { archive, preview, manifestBytes, manifest } = await readDesignPreview(
    root,
    input.manifest,
    input.previewIndex,
    input.generatedVoiceId,
  );
  const response = await eleven(options, '/v1/text-to-voice', {
    voice_name: input.name.trim(),
    voice_description: archive.description,
    generated_voice_id: preview.generatedVoiceId,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!object(data) || !providerId(data.voice_id))
    throw new Error('ElevenLabs nevrátil platné ID uloženého hlasu.');
  const registration = {
    version: 1,
    operation: 'voice-registration',
    provider: 'elevenlabs',
    designManifest: manifest,
    designSha256: digest(manifestBytes),
    generatedVoiceId: preview.generatedVoiceId,
    previewIndex: input.previewIndex,
    voiceId: data.voice_id,
    name: input.name.trim(),
    description: archive.description,
  };
  const directory = await publish(root, {
    'registration.json': JSON.stringify(registration),
  });
  return {
    voiceId: data.voice_id,
    manifest: `${directory}/registration.json`,
    designManifest: manifest,
    name: input.name.trim(),
  };
}

// Shared by the explicitly confirmed local rotating-slot workflow.
export {
  local as readSpeechAsset,
  publish as publishSpeechArchive,
  validateDesignedVoice,
};
